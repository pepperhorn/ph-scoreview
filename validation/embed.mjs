// PepperScore embedded in a host-styled page (apps/reader /embed-test): one full reader in a 600px box, minimal snippets
// A (ABC, soundSources, settings.zoom), B (ensemble, 200px) and C (invalid XML), and an engraving-only Endless snippet.
// Runs against the build. BROWSER=chromium|firefox|webkit.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';
import { root, serveDist } from './serve-dist.mjs';

const engine = process.env.BROWSER || 'chromium';
const launcher = { chromium, firefox, webkit }[engine];
if (!launcher) throw new Error(`BROWSER must be chromium, firefox or webkit (got "${engine}")`);
const server = await serveDist();
const browser = await launcher.launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}) });
const sounds = join(root, 'packages/pepperscore-sounds-complete');
const inside = (outer, inner) => inner.left >= outer.left - 1 && inner.top >= outer.top - 1 && inner.right <= outer.right + 1 && inner.bottom <= outer.bottom + 1;
const rect = (page, selector) => page.locator(selector).first().evaluate(element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; });
const rendered = (page, root) => page.waitForFunction(root => { const element = document.querySelector(root); return element && element.querySelector('.score-system svg') && !element.querySelector('.score-loading'); }, root, { timeout: 60000 });
/** Roots with a source that engraves (C's invalid XML never renders). */
const SOURCED = ['.pepperscore.embed-full', '.pepperscore.embed-a', '.pepperscore.embed-b', '.pepperscore.embed-none'];
const renderedAll = page => Promise.all(SOURCED.map(root => rendered(page, root)));
/** Full-chrome roots only (they have a More toggle and the drawer); the minimal and engraving-only roots have neither. */
const fullChrome = '.pepperscore.embed-full';
/** Play labels read "Stop/Pause playback" while audio still loads: wait until the instance has actually started. */
const playingIn = (page, button, label) => page.waitForFunction(([button, label]) => { const element = document.querySelector(button); return element && !element.classList.contains('is-loading') && element.getAttribute('aria-label') === label; }, [button, label], { timeout: 60000 });
const brokenXml = { name: 'broken.musicxml', mimeType: 'application/xml', buffer: Buffer.from('<score-partwise><part') };

/** A page context that serves the custom asset base and the soundSources URL from local files and records every request. */
async function hostContext(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
  await context.route(/poppins/i, route => route.abort());
  const requests = [];
  context.on('request', request => requests.push(request.url()));
  // The custom asset base serves the complete pack, but with an empty FluidR3 list: every melodic program falls back to TimGM6mb.
  await context.route('**/custom-assets/**', async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/custom-assets\//, ''));
    if (path === 'pack.json') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pack: 'core', fluidr3: [] }) });
    try { return route.fulfill({ status: 200, body: await readFile(join(sounds, path)) }); } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await context.route('**/embed-sounds/*.json', async route => route.fulfill({ status: 200, contentType: 'application/json', body: await readFile(join(sounds, 'soundfonts/fluidr3', new URL(route.request().url()).pathname.split('/').pop())) }));
  await context.addInitScript(() => {
    window.__contexts = [];
    const Native = window.AudioContext;
    window.AudioContext = class extends Native { constructor(...args) { super(...args); window.__contexts.push(this); } };
  });
  return { context, requests };
}
/** Counts Verovio worker constructions (window.__verovioWorkers). */
const countVerovioWorkers = context => context.addInitScript(() => {
  window.__verovioWorkers = 0;
  const Native = window.Worker;
  window.Worker = class extends Native { constructor(url, ...rest) { super(url, ...rest); if (String(url).includes('verovio')) window.__verovioWorkers++; } };
});
async function openPage(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.url}/embed-test`);
  return { page, errors };
}
const events = page => page.evaluate(() => window.__events);
/**
 * onPlay, onStop and onError are delivered from React passive effects, which run after the commit that changed the DOM
 * (in WebKit, sometimes after a poll has already seen the new DOM). So wait for the callback itself, never assume it
 * fired because the matching DOM state is visible.
 */
const eventFired = (page, who, kind) => page.waitForFunction(([who, kind]) => window.__events.some(([w, k]) => w === who && k === kind), [who, kind], { timeout: 5000 });

try {
  // 1. Engraving only (chrome="none") loads no audio, even when asked to play, and shows no controls.
  {
    const { context, requests } = await hostContext();
    const { page, errors } = await openPage(context);
    await rendered(page, '.pepperscore.embed-none');
    await page.evaluate(() => window.__embed.refs.none.current.play());
    // A snippet whose score failed to load never plays (in particular not the hidden built-in sample).
    await page.locator('.embed-c .ps-toast').waitFor({ timeout: 30000 });
    await page.evaluate(() => window.__embed.refs.c.current.play());
    await page.waitForTimeout(1500);
    assert.ok(!(await events(page)).some(([who, kind]) => (who === 'c' || who === 'none') && kind === 'play'), 'ref.play() on a failed or engraving-only snippet fires no onPlay');
    assert.equal(await page.evaluate(() => window.__contexts.length), 0, 'chrome="none" creates no AudioContext');
    assert.deepEqual(requests.filter(url => /soundfonts|pack\.json|embed-sounds/.test(url)), [], 'chrome="none" and a failed snippet load no audio assets');
    assert.equal(await page.locator('.embed-none .play-button, .embed-none .ps-compact-play, .embed-none .topbar, .embed-none .drawer-handle, .embed-none .page-controls, .embed-none .part-control').count(), 0, 'no controls at all');
    assert.deepEqual(errors, []);
    await context.close();
  }

  // 2–4. All instances render together; style isolation; unique ids; containment; overlay focus; callbacks; minimal chrome;
  // natural height and settings (Review Focus 2); the keyboard only affects the focused instance.
  {
    const { context } = await hostContext();
    const { page, errors } = await openPage(context);
    await renderedAll(page);

    // No styles leak out into the host page.
    const host = await page.evaluate(() => {
      const probe = getComputedStyle(document.getElementById('host-probe'));
      return { font: probe.fontFamily, margin: probe.marginTop, size: probe.fontSize, body: getComputedStyle(document.body).backgroundColor, html: getComputedStyle(document.documentElement).fontFamily, button: getComputedStyle(document.querySelector('.host-button')).fontFamily };
    });
    assert.match(host.font, /Georgia/); assert.equal(host.margin, '13px'); assert.equal(host.size, '17px');
    assert.equal(host.body, 'rgb(253, 246, 227)'); assert.match(host.html, /Georgia/); assert.match(host.button, /Georgia/);

    // Review Focus 1: host preflight-style globals don't leak in.
    const look = await page.evaluate(() => {
      const root = document.querySelector('.pepperscore.embed-full');
      const style = selector => getComputedStyle(root.querySelector(selector));
      const topbar = root.querySelector('.topbar');
      return { play: style('.play-button').backgroundColor, title: style('.score-meta h1').fontSize, font: getComputedStyle(root).fontFamily, fits: topbar.scrollWidth <= topbar.clientWidth, selectedOutline: style('.mode-toggle .is-selected').outlineStyle, compact: getComputedStyle(document.querySelector('.embed-a .ps-compact-play')).backgroundColor };
    });
    assert.deepEqual(look, { play: 'rgb(52, 86, 66)', title: '30px', font: look.font, fits: true, selectedOutline: 'none', compact: 'rgb(52, 86, 66)' }, JSON.stringify(look));
    assert.match(look.font, /Poppins/);

    // Review Focus 5: ids are unique page-wide, and each ARIA reference resolves inside its own root. Verovio's engraved
    // SVGs are left out: every system's SVG repeats its svg and glyph-def ids even with a single reader, and the reader
    // only ever looks those up inside its own root (the same-score block below pins the ids that matter).
    const ids = await page.evaluate(() => [...document.querySelectorAll('[id]')].filter(element => !element.closest('.score-system svg')).map(element => element.id));
    assert.equal(new Set(ids).size, ids.length, `Duplicate ids: ${ids}`);
    assert.deepEqual(await page.evaluate(fullChrome => [...document.querySelectorAll(fullChrome)].map(root => {
      const toggle = root.querySelector('.header-more-toggle');
      return !!toggle && !!root.querySelector(`#${CSS.escape(toggle.getAttribute('aria-controls'))}`);
    }), fullChrome), [true], 'More toggles control their own panels');

    // Callbacks and the minimal chrome.
    await page.locator('.embed-c .ps-toast').waitFor({ timeout: 30000 });
    assert.ok(inside(await rect(page, '.pepperscore.embed-c'), await rect(page, '.embed-c .ps-toast')), 'Snippet C\'s error toast stays inside it');
    await eventFired(page, 'c', 'error'); // onError fires
    for (const who of ['full', 'a', 'b', 'none']) assert.ok((await events(page)).some(([w, kind, info]) => w === who && kind === 'ready' && info.parts.length > 0 && info.measures > 0), `onReady fires for ${who}`);
    assert.ok((await events(page)).some(([who, kind, info]) => who === 'a' && kind === 'ready' && info.title === 'Snippet A' && info.measures === 4), 'onReady carries the title and measure count');
    for (const root of ['.embed-a', '.embed-b', '.embed-c']) {
      assert.equal(await page.locator(`${root} .topbar, ${root} .drawer-handle, ${root} .bottom-drawer, ${root} .part-controls .part-control, ${root} .page-controls, ${root} input[type=file]`).count(), 0, `minimal has no header, drawer, part icons, page arrows or file input (${root})`);
      assert.equal(await page.locator(`${root} .ps-compact-play`).count(), root === '.embed-c' ? 0 : 1, `minimal has the compact play button once a score loads (${root})`);
    }
    const noneBox = await page.evaluate(() => { const root = document.querySelector('.embed-none'); return { root: root.getBoundingClientRect().height, system: root.querySelector('.score-system').getBoundingClientRect().height, meta: root.querySelector('.score-meta').getBoundingClientRect().height }; });
    assert.ok(noneBox.root <= noneBox.system + noneBox.meta + 60, `an Endless natural-height snippet adds no empty band below its score: ${JSON.stringify(noneBox)}`);
    assert.equal(await page.locator('.embed-a .score-meta h1').textContent(), 'Snippet A', 'credits show in minimal');
    assert.equal(await page.locator('.embed-full .ps-compact-play').count(), 0, 'full has no compact play button');

    // Landmark names: "Score: <title>" once a titled score loads, "Score reader" without one, and the ariaLabel prop wins.
    const label = root => page.locator(root).getAttribute('aria-label');
    assert.equal(await label('.pepperscore.embed-a'), 'Score: Snippet A', 'a titled score names the region after its title');
    assert.equal(await label('.pepperscore.embed-full'), 'Score: A little room to play', 'the full reader is named after the sample it shows');
    assert.equal(await label('.pepperscore.embed-c'), 'Score reader', 'a snippet with no loaded score keeps the generic name');
    assert.equal(await label('.pepperscore.embed-none'), 'Engraving-only example', 'ariaLabel overrides the default name');

    // Review Focus 2 and natural height: a minimal snippet without height sizes to its score; settings.zoom survives the
    // score load and a source change.
    // The paint reveal scales the content for a moment (a transform overflows the viewport): measure once it has settled.
    await page.waitForFunction(() => !document.querySelector('.embed-a .score-content.is-painting') && getComputedStyle(document.querySelector('.embed-a .score-content')).transform === 'none', null, { timeout: 10000 });
    await page.waitForTimeout(600);
    const a = await page.evaluate(() => { const root = document.querySelector('.pepperscore.embed-a'); const viewport = root.querySelector('.score-viewport'); return { height: root.getBoundingClientRect().height, fits: viewport.scrollHeight <= viewport.clientHeight + 1, scale: root.querySelector('.score-content').dataset.staveScale }; });
    assert.ok(a.height > 100 && a.fits, `minimal without height sizes to its score: ${JSON.stringify(a)}`);
    assert.equal(a.scale, '1.5', 'settings.zoom survives the score load');
    assert.ok((await rect(page, '.pepperscore.embed-none')).height > 60, 'an Endless snippet with natural height is not collapsed');
    assert.equal(Math.round((await rect(page, '.pepperscore.embed-b')).height), 200, 'height="200px" fixes the root height');
    await page.evaluate(() => window.__embed.setAbcA('X:1\nT:Snippet A two\nM:4/4\nL:1/4\nK:G\nG B d B | c A F A | G4 |'));
    await page.waitForFunction(() => document.querySelector('.embed-a .score-meta h1')?.textContent === 'Snippet A two' && !document.querySelector('.embed-a .score-loading') && !document.querySelector('.embed-a .score-content.is-painting'), null, { timeout: 30000 });
    assert.equal(await label('.pepperscore.embed-a'), 'Score: Snippet A two', 'the region name follows a source change');
    assert.equal(await page.locator('.embed-a .score-content').getAttribute('data-stave-scale'), '1.5', 'settings.zoom survives a source change');

    // A control override on a minimal snippet: the header shows only that control (no empty More toggle), the compact
    // play button stays, and the edge fade sits on the viewport's bottom edge (no page-controls row below it).
    await page.evaluate(() => window.__embed.setControlsB({ viewToggle: true }));
    await page.locator('.embed-b .topbar .mode-toggle').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('.embed-b .header-more-toggle, .embed-b .header-secondary-panel, .embed-b .play-button').count(), 0, 'no More toggle without secondary controls');
    assert.equal(await page.locator('.embed-b .ps-compact-play').count(), 1, 'a view toggle keeps the compact play button');
    const fade = await page.evaluate(() => { const root = document.querySelector('.embed-b'); return { fade: root.querySelector('.edge-end').getBoundingClientRect().bottom, viewport: root.querySelector('.score-viewport').getBoundingClientRect().bottom }; });
    assert.ok(Math.abs(fade.fade - fade.viewport) <= 1, `the edge fade ends at the viewport bottom: ${JSON.stringify(fade)}`);
    await page.locator('.embed-b .mode-toggle-endless').click();
    await page.waitForFunction(() => document.querySelector('.embed-b .ps-landscape .score-system svg') && !document.querySelector('.embed-b .score-content.is-painting'), null, { timeout: 60000 });
    const sideFade = await page.evaluate(() => { const root = document.querySelector('.embed-b'); return { fade: root.querySelector('.edge-end').getBoundingClientRect().bottom, viewport: root.querySelector('.score-viewport').getBoundingClientRect().bottom }; });
    assert.ok(Math.abs(sideFade.fade - sideFade.viewport) <= 1, `the Endless edge fade ends at the viewport bottom: ${JSON.stringify(sideFade)}`);
    await page.evaluate(() => { window.__embed.setControlsB(undefined); window.__embed.setViews(views => ({ ...views, b: 'vertical' })); });
    await page.waitForFunction(() => !document.querySelector('.embed-b .topbar') && document.querySelector('.embed-b .ps-portrait .score-system svg') && !document.querySelector('.embed-b .score-content.is-painting'), null, { timeout: 60000 });

    // The drawer, its backdrop, dialogs and toasts stay inside the root box; overlays keep focus for Escape and Tab.
    // Measured after each action: clicks scroll the host page to bring the full reader into view.
    const boxFull = () => rect(page, '.pepperscore.embed-full');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('.embed-full .drawer-handle').click();
    await page.waitForTimeout(450);
    assert.ok(inside(await boxFull(), await rect(page, '.embed-full .bottom-drawer')), 'Drawer stays inside the root');
    assert.ok(inside(await boxFull(), await rect(page, '.embed-full .drawer-backdrop')), 'Drawer backdrop stays inside the root');
    await page.locator('.embed-full button[aria-label="Close options"]').first().click();
    await page.locator('.embed-full .header-more-toggle').click();
    await page.locator('.embed-full').getByRole('button', { name: 'Track mixer', exact: true }).click();
    assert.ok(inside(await boxFull(), await rect(page, '.embed-full .mixer-backdrop')), 'Mixer stays inside the root');
    // Opened from the More panel (which hides, taking the focused trigger with it), the mixer still closes on Escape.
    await page.keyboard.press('Escape');
    await page.locator('.embed-full .mixer-backdrop').waitFor({ state: 'detached', timeout: 2000 });
    // The voice picker opened from the mixer closes on Escape; after its close button (which unmounts) Escape still closes the mixer.
    await page.locator('.embed-full .header-more-toggle').click();
    await page.locator('.embed-full').getByRole('button', { name: 'Track mixer', exact: true }).click();
    await page.locator('.embed-full .mixer-voice-button').first().click();
    await page.keyboard.press('Escape');
    await page.locator('.embed-full .instrument-picker-backdrop').waitFor({ state: 'detached', timeout: 2000 });
    assert.equal(await page.locator('.embed-full .mixer-backdrop').count(), 1, 'Escape in the voice picker leaves the mixer open');
    await page.locator('.embed-full .mixer-voice-button').first().click();
    await page.locator('.embed-full').getByRole('button', { name: 'Close voice picker', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.locator('.embed-full .mixer-backdrop').waitFor({ state: 'detached', timeout: 2000 });
    // Open score dialog: after a click on its text, Tab stays in the dialog and Escape closes it.
    await page.locator('.embed-full .header-open-file').click();
    await page.locator('.embed-full .open-dialog-intro').click();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.embed-full .open-dialog')), true, 'Tab stays in the open dialog after a click on its text');
    await page.locator('.embed-full .open-dialog-intro').click();
    await page.keyboard.press('Escape');
    await page.locator('.embed-full .open-dialog').waitFor({ state: 'detached', timeout: 2000 });
    await page.locator('.embed-full input[type=file]').setInputFiles(brokenXml);
    await page.locator('.embed-full .ps-toast').waitFor({ timeout: 30000 });
    assert.ok(inside(await boxFull(), await rect(page, '.embed-full .ps-toast')), 'Toast stays inside the root');
    await page.locator('.embed-full .ps-toast-dismiss').click();

    // Keyboard shortcuts only affect the focused instance (the full reader, given the ensemble, taller than its box, and B at
    // 200px); Escape elsewhere leaves another instance's More panel open.
    // settings are initial values: the reader's own drawer choice (note names on, against the host's noteNames: false)
    // survives opening another score.
    await page.locator('.embed-full .drawer-handle').click();
    await page.locator('.embed-full button[role=switch][aria-label="Note names"]').click();
    assert.equal(await page.locator('.embed-full button[role=switch][aria-label="Note names"]').getAttribute('aria-checked'), 'true');
    await page.locator('.embed-full button[aria-label="Close options"]').first().click();
    await page.locator('.embed-full input[type=file]').setInputFiles(new URL('./fixtures/ensemble.musicxml', import.meta.url).pathname);
    await page.waitForFunction(() => document.querySelector('.embed-full .score-meta h1')?.textContent !== 'A little room to play' && document.querySelector('.embed-full .score-system svg') && !document.querySelector('.embed-full .score-loading') && !document.querySelector('.embed-full .score-content.is-painting'), null, { timeout: 60000 });
    assert.equal(await page.locator('.embed-full button[role=switch][aria-label="Note names"]').getAttribute('aria-checked'), 'true', 'a drawer edit survives a score load (host settings are initial values)');
    const scrollTop = root => page.evaluate(root => document.querySelector(`${root} .score-viewport`).scrollTop, root);
    // A page turn scrolls smoothly: let a reader land before taking its position.
    const settled = root => page.evaluate(async root => {
      const viewport = document.querySelector(`${root} .score-viewport`);
      for (let last = -1, still = 0; still < 4; await new Promise(done => setTimeout(done, 100))) { still = viewport.scrollTop === last ? still + 1 : 0; last = viewport.scrollTop; }
      return viewport.scrollTop;
    }, root);
    await page.locator('.embed-full .score-viewport').click({ position: { x: 300, y: 40 } });
    await page.keyboard.press('PageDown');
    await page.waitForFunction(() => document.querySelector('.embed-full .score-viewport').scrollTop > 0, null, { timeout: 5000 });
    assert.equal(await scrollTop('.embed-b'), 0, 'Page Down in the full reader does not scroll B');
    const fullTop = await settled('.embed-full');
    await page.locator('.embed-b .score-viewport').click({ position: { x: 300, y: 40 } });
    await page.keyboard.press('PageDown');
    await page.waitForFunction(() => document.querySelector('.embed-b .score-viewport').scrollTop > 0, null, { timeout: 5000 });
    assert.equal(await scrollTop('.embed-full'), fullTop, 'Page Down in B does not scroll the full reader');
    await page.locator('.embed-full .header-more-toggle').click();
    await page.locator('.embed-b .score-viewport').click({ position: { x: 300, y: 40 } });
    assert.equal(await page.locator('.embed-full .header-more-toggle').getAttribute('aria-expanded'), 'false', 'A click in B closes the full reader\'s More panel (outside click)');
    await page.locator('.embed-full .header-more-toggle').click();
    await page.locator('.embed-b').focus();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.embed-full .header-more-toggle').getAttribute('aria-expanded'), 'true', 'Escape in B leaves the full reader\'s More panel open');
    // Focus ring (WCAG 2.4.7): a click that focuses a root shows no ring; Tab onto a root shows it.
    await page.keyboard.press('Escape');
    await page.locator('#host-probe').click(); // blur B (focused from the keyboard above) so the next click focuses it afresh
    await page.locator('.embed-b .score-viewport').click({ position: { x: 300, y: 40 } });
    const ring = root => page.evaluate(root => { const element = document.querySelector(root); return { focused: document.activeElement === element, outline: getComputedStyle(element).outlineStyle }; }, root);
    assert.deepEqual(await ring('.pepperscore.embed-b'), { focused: true, outline: 'none' }, 'mouse focus on a root shows no focus ring');
    await page.locator('.host-button').focus();
    await page.keyboard.press('Tab');
    const keyboardRing = await ring('.pepperscore.embed-full');
    if (keyboardRing.focused || engine !== 'webkit') assert.deepEqual(keyboardRing, { focused: true, outline: 'solid' }, 'keyboard focus on a root shows the focus ring');
    else console.log(`${engine}: Tab skips non-form controls (platform setting), keyboard focus ring check skipped`);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // 5–8. Playback (stop-others, soundSources, TimGM6mb fallback read once, custom asset base, one AudioContext), unmount
  // survival (Review Focus 3), ref.transpose, and persist namespaces.
  {
    const { context, requests } = await hostContext();
    await countVerovioWorkers(context);
    const { page, errors } = await openPage(context);
    await renderedAll(page);
    await page.locator('.embed-a .ps-compact-play').click();
    await playingIn(page, '.embed-a .ps-compact-play', 'Stop playback');
    // A plays for 8 s; starting B stops it at once (while B's sounds still load), not when A runs out.
    await page.locator('.embed-b .ps-compact-play').click();
    await page.waitForFunction(() => document.querySelector('.embed-a .ps-compact-play').getAttribute('aria-label') === 'Play score', null, { timeout: 2000 });
    await playingIn(page, '.embed-b .ps-compact-play', 'Stop playback');
    await page.locator('.embed-b .ps-compact-play').click();
    await page.waitForFunction(() => document.querySelector('.embed-b .ps-compact-play').getAttribute('aria-label') === 'Play score', null, { timeout: 5000 });
    await eventFired(page, 'b', 'stop');
    const played = (await events(page)).map(([who, kind]) => `${who}:${kind}`);
    assert.ok(played.indexOf('a:stop') > played.indexOf('a:play') && played.indexOf('a:play') >= 0 && played.indexOf('b:stop') > played.indexOf('b:play') && played.indexOf('b:play') >= 0, `onPlay/onStop: ${played}`);
    const paths = requests.filter(url => url.startsWith(server.url)).map(url => new URL(url).pathname);
    // Silent runs (no audio output, e.g. headless Firefox on CI) show a playback notice and return before loading any
    // sounds, so the sound assertions run per snippet only where its playback was audible (as in reader.mjs).
    const silent = await page.evaluate(() => ({ a: !!document.querySelector('.embed-a .playback-notice'), b: !!document.querySelector('.embed-b .playback-notice') }));
    assert.ok(!paths.includes('/custom-assets/soundfonts/fluidr3/acoustic_grand_piano.json'), 'the source wins over the pack');
    if (!silent.a || !silent.b) assert.ok(paths.includes('/custom-assets/pack.json'), 'pack.json comes from the custom asset base');
    if (!silent.a) assert.ok(paths.includes('/embed-sounds/acoustic_grand_piano.json'), 'A\'s soundSources entry is fetched for its program');
    else console.log(`${engine}: audio unavailable, A's soundSources fetch check skipped`);
    if (!silent.b) assert.equal(paths.filter(path => path === '/custom-assets/soundfonts/TimGM6mb.sf2').length, 1, 'B\'s five programs missing from the pack fall back to TimGM6mb, downloaded once');
    else console.log(`${engine}: audio unavailable, B's TimGM6mb fallback check skipped`);
    if (silent.a && silent.b) assert.deepEqual(paths.filter(path => /soundfonts|pack\.json|embed-sounds/.test(path)), [], 'silent playback loads no sounds');
    assert.ok(paths.includes('/custom-assets/fonts/Bravura.woff2') || (await page.evaluate(() => document.querySelector('style[data-pepperscore-fonts]').textContent)).includes('/custom-assets/fonts/Bravura.woff2'), 'fonts come from the custom asset base');
    assert.deepEqual(paths.filter(path => /^\/(fonts|soundfonts|instruments|pack\.json)/.test(path)), [], 'nothing loads from the default "/" base');
    assert.deepEqual(requests.filter(url => !url.startsWith(server.url) && /^https?:/.test(url) && !/poppins/i.test(url)), [], 'no remote requests (no CDN default)');
    assert.equal(await page.evaluate(() => window.__contexts.length), 1, 'one shared AudioContext');

    // Review Focus 3: removing a snippet keeps the shared worker and AudioContext; the full reader re-engraves and plays.
    const workers = await page.evaluate(() => window.__verovioWorkers);
    await page.evaluate(() => window.__embed.unmountNone());
    await page.waitForFunction(() => !document.querySelector('.embed-none'));
    await page.locator('.embed-full .mode-toggle-endless').click();
    await page.waitForFunction(() => document.querySelector('.embed-full .ps-landscape .score-system svg') && !document.querySelector('.embed-full .score-content.is-painting'), null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.__verovioWorkers), workers, 'the full reader re-engraves on the same shared Verovio worker');
    assert.notEqual(await page.evaluate(() => window.__contexts[0].state), 'closed', 'the shared AudioContext stays open');
    await page.evaluate(() => window.__embed.refs.full.current.play());
    await playingIn(page, '.embed-full .play-button', 'Pause playback');
    await eventFired(page, 'full', 'play'); // ref.play() starts the full reader and fires onPlay
    await page.evaluate(() => window.__embed.refs.full.current.stop());
    await page.waitForFunction(() => document.querySelector('.embed-full .play-button').getAttribute('aria-label') === 'Play score', null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__contexts.length), 1, 'still one shared AudioContext');

    // ref.transpose sets the absolute offset, clamped like settings.semitones (the readout is in the More panel at 600px).
    await page.evaluate(() => window.__embed.refs.full.current.transpose(2));
    await page.locator('.embed-full .header-more-toggle').click();
    await page.waitForFunction(() => document.querySelector('.embed-full .header-transpose-readout')?.textContent.startsWith('+2'), null, { timeout: 5000 });
    await page.evaluate(() => window.__embed.refs.full.current.transpose(40));
    await page.waitForFunction(() => document.querySelector('.embed-full .header-transpose-readout')?.textContent.startsWith('+12'), null, { timeout: 5000 });
    await page.evaluate(() => window.__embed.refs.full.current.transpose(0));
    await page.locator('.embed-full .header-more-toggle').click();

    // persist: the full reader keeps its state under the default "pepperscore" namespace; snippets (default false) store
    // nothing, so every key and database is a pepperscore one.
    await page.waitForTimeout(800);
    const stored = await page.evaluate(async () => ({ local: Object.keys(localStorage).sort(), session: Object.keys(sessionStorage).sort(), listed: typeof indexedDB.databases === 'function', dbs: typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map(db => db.name).sort() : [] }));
    assert.ok(stored.local.length > 0 && stored.local.every(key => key.startsWith('pepperscore-')), `Only pepperscore-* keys: ${stored.local}`);
    assert.ok(stored.local.includes('pepperscore-prefs'), `the full reader keeps its prefs under pepperscore-prefs: ${stored.local}`);
    assert.ok(stored.session.every(key => key.startsWith('pepperscore-')), `Only pepperscore-* session keys: ${stored.session}`);
    // Not vacuous: every engine in the matrix lists databases, and the full reader's own database must be among them.
    assert.ok(stored.listed, `${engine} lists IndexedDB databases`);
    assert.ok(stored.dbs.includes('pepperscore'), `the full reader's score database is listed: ${stored.dbs}`);
    assert.ok(stored.dbs.every(name => name === 'pepperscore' || name === 'pepperscore-last-file'), `Only pepperscore databases: ${stored.dbs}`);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // 9. A worker restart (out of memory in one reader) does not blank the others. The failure is armed once every reader
  // has drawn, then all of them re-engrave at once (the full reader's view toggle, the snippets' view prop), so the
  // failing request and the other readers' requests are in flight together.
  {
    const { context } = await hostContext();
    await countVerovioWorkers(context);
    const { page } = await openPage(context);
    await renderedAll(page);
    const workers = await page.evaluate(() => window.__verovioWorkers);
    await page.evaluate(() => {
      // Systems drawn so far are marked: a reader that renders must draw new ones.
      for (const svg of document.querySelectorAll('.score-system svg')) svg.setAttribute('data-before', '');
      localStorage.setItem('scoreflow-simulate-oom', '1');
      document.querySelector('.embed-full .mode-toggle-endless').click();
      window.__embed.setViews({ a: 'endless', b: 'endless', none: 'vertical' });
    });
    // Each root must draw new systems in its new view: Endless for full, A and B; Vertical for the engraving-only one.
    await page.waitForFunction(roots => roots.every(root => { const element = document.querySelector(root); const view = root.endsWith('none') ? '.ps-portrait' : '.ps-landscape'; return element.querySelector('.ps-toast.is-out-of-memory') || (element.querySelector(`${view} .score-system svg:not([data-before])`) && !element.querySelector('.score-content.is-painting')); }), SOURCED, { timeout: 60000 });
    const outcome = await page.evaluate(roots => roots.map(root => document.querySelector(root).querySelector('.ps-toast.is-out-of-memory') ? 'oom' : 'rendered').sort(), SOURCED);
    assert.deepEqual(outcome, ['oom', 'rendered', 'rendered', 'rendered'], `One reader reports the failure, the others still render: ${outcome}`);
    assert.equal(await page.evaluate(() => window.__verovioWorkers), workers + 1, 'The failure restarted the shared Verovio worker');
    await context.close();
  }

  // A real out-of-memory failure repeats in its own reader: its other requests fail with it (no retry of the same
  // layout), so repeated failures never push another reader past its retry. Every reader switches view twice, so a
  // newer render of the failing reader is queued when the first one fails.
  {
    const { context } = await hostContext();
    const { page, errors } = await openPage(context);
    const failedDraws = [];
    page.on('console', message => { if (/Could not draw a score system/.test(message.text())) failedDraws.push(message.text()); });
    await renderedAll(page);
    await page.evaluate(() => {
      for (const svg of document.querySelectorAll('.score-system svg')) svg.setAttribute('data-before', '');
      localStorage.setItem('scoreflow-simulate-oom', '3');
      document.querySelector('.embed-full .mode-toggle-endless').click();
      window.__embed.setViews({ a: 'endless', b: 'endless', none: 'vertical' });
      // Once the first renders have sent their requests (a task later), switch back while they are still queued.
      setTimeout(() => { document.querySelector('.embed-full .mode-toggle-vertical').click(); window.__embed.setViews({ a: 'vertical', b: 'vertical', none: 'endless' }); }, 20);
    });
    await page.waitForFunction(roots => roots.every(root => { const element = document.querySelector(root); return element.querySelector('.ps-toast') || (element.querySelector('.score-system svg:not([data-before])') && !element.querySelector('.score-content.is-painting')); }), SOURCED, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const outcome = await page.evaluate(roots => roots.map(root => {
      const element = document.querySelector(root);
      const view = root.endsWith('none') ? '.ps-landscape' : '.ps-portrait';
      return element.querySelector('.ps-toast.is-out-of-memory') ? 'oom' : element.querySelector('.ps-toast') ? `toast: ${element.querySelector('.ps-toast-text').textContent}` : element.querySelector(`${view} .score-system svg:not([data-before])`) ? 'rendered' : 'blank';
    }).sort(), SOURCED);
    assert.deepEqual(outcome, ['oom', 'rendered', 'rendered', 'rendered'], `Repeated failures stay in one reader; the others render: ${outcome}`);
    assert.deepEqual(failedDraws, [], 'No system draw fails for good');
    assert.deepEqual(errors, []);
    await context.close();
  }

  // A reader removed while its score is still parsing: its import worker is stopped, its channel stays closed (no late
  // engraving brings it back), and the others keep the same Verovio worker. Import replies are delayed so the removal
  // lands mid-import. B and C import MusicXML in workers; the ABC snippets and the full reader's sample do not.
  {
    const { context } = await hostContext();
    await context.addInitScript(() => {
      window.__verovioWorkers = 0;
      window.__importWorkers = [];
      const Native = window.Worker;
      window.Worker = class extends Native {
        constructor(url, ...rest) {
          super(url, ...rest);
          this.__import = String(url).includes('import');
          if (String(url).includes('verovio')) window.__verovioWorkers++;
          if (this.__import) window.__importWorkers.push(this);
        }
        set onmessage(handler) { super.onmessage = this.__import && handler ? event => setTimeout(() => handler.call(this, event), 2000) : handler; }
        get onmessage() { return super.onmessage; }
        terminate() { this.__terminated = true; super.terminate(); }
      };
    });
    const { page, errors } = await openPage(context);
    await page.waitForFunction(() => window.__pepperscoreVerovioChannels === 5 && window.__importWorkers.length === 2, null, { timeout: 30000 });
    const alive = () => page.evaluate(() => window.__importWorkers.filter(worker => !worker.__terminated).length);
    assert.equal(await alive(), 2, 'B and C are still importing');
    // ref.play() on a snippet still loading its score is a no-op (it never plays the hidden sample).
    await page.evaluate(() => window.__embed.refs.b.current.play());
    await page.waitForTimeout(500);
    assert.ok(!(await events(page)).some(([who, kind]) => who === 'b' && kind === 'play'), 'ref.play() while B is still loading fires no onPlay');
    assert.equal(await page.evaluate(() => window.__contexts.length), 0, 'ref.play() while B is still loading loads no audio');
    await page.evaluate(() => window.__embed.unmount('b'));
    await page.waitForFunction(() => !document.querySelector('.embed-b'));
    await page.waitForTimeout(300);
    assert.equal(await alive(), 1, 'Removing a reader stops its import worker');
    await Promise.all(SOURCED.filter(root => !root.endsWith('-b')).map(root => rendered(page, root)));
    await page.waitForTimeout(3000);
    assert.equal(await page.evaluate(() => window.__pepperscoreVerovioChannels), 4, 'The removed reader\'s channel stays closed');
    const workers = await page.evaluate(() => window.__verovioWorkers);
    await page.locator('.embed-full .mode-toggle-endless').click();
    await page.waitForFunction(() => document.querySelector('.embed-full .ps-landscape .score-system svg') && !document.querySelector('.embed-full .score-content.is-painting'), null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.__verovioWorkers), workers, 'The full reader keeps re-engraving on the same Verovio worker');
    assert.deepEqual(errors, []);
    await context.close();
  }

  // Two readers showing the same score: Verovio's SVG and glyph ids are per reader, so each reader's <use> glyphs and
  // scoped <style> rules resolve inside its own root (here the full reader in Petaluma, B in Bravura).
  {
    const { context } = await hostContext();
    const { page } = await openPage(context);
    await renderedAll(page);
    await page.locator('.embed-full input[type=file]').setInputFiles(new URL('./fixtures/ensemble.musicxml', import.meta.url).pathname);
    await page.waitForFunction(() => document.querySelector('.embed-full .score-meta h1')?.textContent === document.querySelector('.embed-b .score-meta h1')?.textContent, null, { timeout: 60000 });
    await page.locator('.embed-full .drawer-handle').click();
    await page.locator('.embed-full').getByRole('button', { name: 'Petaluma', exact: true }).click();
    await page.locator('.embed-full button[aria-label="Close options"]').first().click();
    await page.waitForFunction(() => document.querySelector('.embed-full .score-content')?.style.getPropertyValue('--music-font') === 'Petaluma' && !document.querySelector('.embed-full .score-content.is-painting') && document.querySelector('.embed-full .score-system svg'), null, { timeout: 60000 });
    const glyphs = await page.evaluate(() => ['.embed-full', '.embed-b'].map(root => {
      const element = document.querySelector(root);
      const uses = [...element.querySelectorAll('.score-system svg use')];
      const svgIds = [...element.querySelectorAll('.score-system svg[id]')].map(svg => svg.id);
      return { uses: uses.length, foreign: uses.filter(use => !element.contains(document.getElementById((use.getAttribute('href') || use.getAttribute('xlink:href')).slice(1)))).length, svgIds };
    }));
    assert.ok(glyphs.every(item => item.uses > 0), `Both readers draw glyphs: ${JSON.stringify(glyphs)}`);
    assert.deepEqual(glyphs.map(item => item.foreign), [0, 0], 'Every glyph reference resolves inside its own reader');
    assert.ok(!glyphs[0].svgIds.some(id => glyphs[1].svgIds.includes(id)), `SVG ids (which scope Verovio's style rules) differ between readers: ${JSON.stringify(glyphs.map(item => item.svgIds))}`);
    await context.close();
  }

  // Review Focus 1, exhaustively: the host's preflight-style rules change no computed style or size inside any reader.
  // Each overlay state of the full reader is compared with the same page after the host's element rules are deleted
  // (its .host-* boxes stay); the snippets (compact play button, natural height, C's toast) are compared too.
  for (const state of ['drawer', 'mixer', 'picker', 'dialog', 'toast']) {
    const { context } = await hostContext();
    const { page } = await openPage(context);
    await renderedAll(page);
    await page.locator('.embed-c .ps-toast').waitFor({ timeout: 30000 });
    if (state === 'drawer') await page.locator('.embed-full .drawer-handle').click();
    if (state === 'mixer') { await page.locator('.embed-full .header-more-toggle').click(); await page.locator('.embed-full').getByRole('button', { name: 'Track mixer', exact: true }).click(); }
    if (state === 'picker') await page.locator('.embed-full .instrument-control').first().click();
    if (state === 'dialog') await page.locator('.embed-full .header-open-file').click();
    if (state === 'toast') { await page.locator('.embed-full input[type=file]').setInputFiles(brokenXml); await page.locator('.embed-full .ps-toast').waitFor({ timeout: 30000 }); }
    await page.waitForTimeout(500);
    const snapshot = () => page.evaluate(() => {
      const props = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'font-size', 'font-weight', 'font-family', 'line-height', 'display', 'vertical-align', 'background-color', 'color', 'outline-style', 'max-width', 'box-sizing'];
      return [...document.querySelectorAll('.pepperscore')].flatMap(root => [root, ...root.querySelectorAll('*')].filter(element => !element.closest('.score-staves')).map(element => {
        const style = getComputedStyle(element), box = element.getBoundingClientRect();
        const name = `${element.tagName.toLowerCase()}.${(element.getAttribute('class') || '').trim().split(/\s+/).join('.')}`;
        return `${name} ${props.map(prop => style.getPropertyValue(prop)).join('|')}|${Math.round(box.width)}x${Math.round(box.height)}`;
      }));
    });
    const hosted = await snapshot();
    await page.evaluate(() => {
      for (const sheet of document.styleSheets) for (let index = sheet.cssRules.length - 1; index >= 0; index--) {
        const rule = sheet.cssRules[index];
        if (rule.selectorText && !/pepperscore|host-|^astro/.test(rule.selectorText)) sheet.deleteRule(index);
      }
      document.styleSheets[0].insertRule('.host-box{box-sizing:border-box}', document.styleSheets[0].cssRules.length);
    });
    await page.waitForTimeout(300);
    const alone = await snapshot();
    const changed = hosted.map((line, index) => line === alone[index] ? null : `host:  ${line}\nalone: ${alone[index]}`).filter(Boolean);
    assert.deepEqual(changed, [], `Host rules change the reader (${state}):\n${changed.slice(0, 12).join('\n')}`);
    await context.close();
  }
  // 9. An assetBaseUrl with nothing behind it (the default CDN URL before the sounds packages are published): engraving
  // works with fallback fonts, playback runs silently with the usual notice and no error, and one console warning names
  // the base. Served locally as 404s, so nothing leaves the machine.
  {
    const { context, requests } = await hostContext();
    await context.route('**/missing-assets/**', route => route.fulfill({ status: 404, body: '' }));
    const page = await context.newPage();
    const errors = [], warnings = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/^pepperscore: could not load/.test(message.text())) warnings.push(message.text()); });
    await page.goto(`${server.url}/embed-missing-assets`);
    await rendered(page, '.pepperscore.embed-missing');
    await page.locator('.embed-missing .ps-compact-play').click();
    await page.locator('.embed-missing .playback-notice').waitFor({ timeout: 30000 });
    assert.match(await page.locator('.embed-missing .playback-notice-text').textContent(), /playing silently/, 'playback degrades to the silent notice');
    await page.waitForFunction(() => window.__missingEvents.some(([kind]) => kind === 'play'), null, { timeout: 10000 });
    assert.equal(await page.locator('.embed-missing .ps-toast').count(), 0, 'no error toast');
    assert.deepEqual((await page.evaluate(() => window.__missingEvents)).filter(([kind]) => kind === 'error'), [], 'no onError');
    const audio = await page.evaluate(() => window.__contexts.some(context => context.state === 'running'));
    const missing = requests.filter(url => url.includes('/missing-assets/'));
    if (audio) assert.ok(missing.some(url => /pack\.json|soundfonts\//.test(url)), `playback asked the missing base for sounds: ${missing}`);
    await page.waitForTimeout(500);
    if (missing.length) {
      assert.equal(warnings.length, 1, `one console warning for the failed base: ${JSON.stringify(warnings)}`);
      assert.ok(warnings[0].includes(`"${server.url}/missing-assets/"`), `the warning names the assetBaseUrl: ${warnings[0]}`);
    } else console.log(`${engine}: no asset was requested from the missing base (audio unavailable, music font unused), warning check skipped`);
    assert.deepEqual(requests.filter(url => /^https?:/.test(url) && !url.startsWith(server.url)), [], 'no remote requests');
    assert.deepEqual(errors, []);
    await context.close();
  }

  console.log(`${engine}: embedding (chrome presets, callbacks, ref, settings, sounds and asset base, style isolation, containment, unique ids, focused keyboard, focus ring, landmark names, shared engine, persist, missing assets) passed`);
} finally { await browser.close(); await server.close(); }
