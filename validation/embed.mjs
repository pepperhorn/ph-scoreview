// Several readers embedded in a host-styled page (apps/reader /embed-test). Runs against the build. BROWSER=chromium|firefox|webkit.
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright-core';
import { serveDist } from './serve-dist.mjs';

const engine = process.env.BROWSER || 'chromium';
const launcher = { chromium, firefox, webkit }[engine];
if (!launcher) throw new Error(`BROWSER must be chromium, firefox or webkit (got "${engine}")`);
const server = await serveDist();
const browser = await launcher.launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}) });
const inside = (outer, inner) => inner.left >= outer.left - 1 && inner.top >= outer.top - 1 && inner.right <= outer.right + 1 && inner.bottom <= outer.bottom + 1;
const rect = (page, selector) => page.locator(selector).first().evaluate(element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; });
const rendered = (page, root) => page.waitForFunction(root => { const element = document.querySelector(root); return element && element.querySelector('.score-system svg') && !element.querySelector('.score-loading'); }, root, { timeout: 60000 });
try {
  // Two readers importing and engraving at once both render; one AudioContext; playing B stops A; unmounting B leaves A working.
  {
    const multi = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await multi.route(/poppins/i, route => route.abort());
    await multi.addInitScript(() => {
      window.__contexts = [];
      const Native = window.AudioContext;
      window.AudioContext = class extends Native { constructor(...args) { super(...args); window.__contexts.push(this); } };
      window.__verovioWorkers = 0;
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker { constructor(url, ...rest) { super(url, ...rest); if (String(url).includes('verovio')) window.__verovioWorkers++; } };
    });
    const tab = await multi.newPage();
    const tabErrors = [];
    tab.on('pageerror', error => tabErrors.push(error.message));
    await tab.goto(`${server.url}/embed-test`);
    await rendered(tab, '.pepperscore.embed-a');
    await rendered(tab, '.pepperscore.embed-b');
    const label = root => tab.locator(`${root} .play-button`).getAttribute('aria-label');
    // The label reads "Pause playback" while audio still loads: wait until the instance has actually started.
    const playingIn = root => tab.waitForFunction(root => { const button = document.querySelector(`${root} .play-button`); return button && !button.classList.contains('is-loading') && button.getAttribute('aria-label') === 'Pause playback'; }, root, { timeout: 30000 });
    await tab.locator('.embed-a .play-button').click();
    await playingIn('.embed-a');
    await tab.locator('.embed-b .play-button').click();
    await playingIn('.embed-b');
    await tab.waitForFunction(() => document.querySelector('.embed-a .play-button').getAttribute('aria-label') === 'Play score', null, { timeout: 5000 });
    assert.equal(await label('.embed-a'), 'Play score', 'Playing B stops A');
    await tab.locator('.embed-b .stop-button').click();
    assert.equal(await tab.evaluate(() => window.__contexts.length), 1, 'Instances share one AudioContext');
    // Review Focus 3: unmounting B keeps the shared worker and AudioContext for A.
    const workers = await tab.evaluate(() => window.__verovioWorkers);
    await tab.locator('.host-unmount').click();
    await tab.waitForFunction(() => !document.querySelector('.embed-b'));
    await tab.locator('.embed-a').getByRole('button', { name: 'Endless view', exact: true }).click();
    await tab.waitForFunction(() => document.querySelector('.embed-a .score-content.is-painting') === null && document.querySelector('.embed-a .ps-landscape .score-system svg'), null, { timeout: 60000 });
    assert.notEqual(await tab.evaluate(() => window.__contexts[0].state), 'closed', 'The shared AudioContext stays open');
    assert.equal(await tab.evaluate(() => window.__verovioWorkers), workers, 'A re-engraves on the same shared Verovio worker');
    await tab.locator('.embed-a .play-button').click();
    await playingIn('.embed-a');
    await tab.locator('.embed-a .stop-button').click();
    assert.deepEqual(tabErrors, []);
    await multi.close();
  }
  // A worker restart (out of memory in one reader) does not blank the other reader. The failure is armed once both
  // readers have drawn (at mount the first engraving is the placeholder score, whose render the import retires), then
  // both re-engrave at once, so the failing request and the other reader's requests are in flight together.
  {
    const oom = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await oom.route(/poppins/i, route => route.abort());
    await oom.addInitScript(() => {
      window.__verovioWorkers = 0;
      const Native = window.Worker;
      window.Worker = class extends Native { constructor(url, ...rest) { super(url, ...rest); if (String(url).includes('verovio')) window.__verovioWorkers++; } };
    });
    const tab = await oom.newPage();
    await tab.goto(`${server.url}/embed-test`);
    await rendered(tab, '.pepperscore.embed-a');
    await rendered(tab, '.pepperscore.embed-b');
    const workers = await tab.evaluate(() => window.__verovioWorkers);
    await tab.evaluate(() => {
      // Systems drawn so far are marked: the reader that renders must draw new ones.
      for (const svg of document.querySelectorAll('.score-system svg')) svg.setAttribute('data-before', '');
      localStorage.setItem('scoreflow-simulate-oom', '1');
      for (const root of document.querySelectorAll('.pepperscore')) root.querySelector('.mode-toggle-endless').click();
    });
    await tab.waitForFunction(() => [...document.querySelectorAll('.pepperscore')].every(root => root.querySelector('.ps-toast.is-out-of-memory') || (root.querySelector('.ps-landscape .score-system svg:not([data-before])') && !root.querySelector('.score-content.is-painting'))), null, { timeout: 60000 });
    const outcome = await tab.evaluate(() => [...document.querySelectorAll('.pepperscore')].map(root => root.querySelector('.ps-toast.is-out-of-memory') ? 'oom' : 'rendered').sort());
    assert.deepEqual(outcome, ['oom', 'rendered'], `One reader reports the failure, the other still renders: ${outcome}`);
    assert.equal(await tab.evaluate(() => window.__verovioWorkers), workers + 1, 'The failure restarted the shared Verovio worker');
    await oom.close();
  }

  // A real out-of-memory failure repeats in its own reader: its other requests fail with it (no retry of the same
  // layout), so repeated failures never push the other reader past its retry. Each reader switches view twice, so a
  // newer render of the failing reader is queued when the first one fails.
  {
    const repeat = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await repeat.route(/poppins/i, route => route.abort());
    const tab = await repeat.newPage();
    const tabErrors = [];
    tab.on('pageerror', error => tabErrors.push(error.message));
    const failedDraws = [];
    tab.on('console', message => { if (/Could not draw a score system/.test(message.text())) failedDraws.push(message.text()); });
    await tab.goto(`${server.url}/embed-test`);
    await rendered(tab, '.pepperscore.embed-a');
    await rendered(tab, '.pepperscore.embed-b');
    await tab.evaluate(() => {
      for (const svg of document.querySelectorAll('.score-system svg')) svg.setAttribute('data-before', '');
      localStorage.setItem('scoreflow-simulate-oom', '3');
      for (const root of document.querySelectorAll('.pepperscore')) root.querySelector('.mode-toggle-endless').click();
      // Once the first renders have sent their requests (a task later), switch back while they are still queued.
      setTimeout(() => { for (const root of document.querySelectorAll('.pepperscore')) root.querySelector('.mode-toggle-vertical').click(); }, 20);
    });
    await tab.waitForFunction(() => [...document.querySelectorAll('.pepperscore')].every(root => root.querySelector('.ps-toast') || (root.querySelector('.ps-portrait .score-system svg:not([data-before])') && !root.querySelector('.score-content.is-painting'))), null, { timeout: 60000 });
    await tab.waitForTimeout(1500);
    const outcome = await tab.evaluate(() => [...document.querySelectorAll('.pepperscore')].map(root => root.querySelector('.ps-toast.is-out-of-memory') ? 'oom' : root.querySelector('.ps-toast') ? `toast: ${root.querySelector('.ps-toast-text').textContent}` : root.querySelector('.ps-portrait .score-system svg:not([data-before])') ? 'rendered' : 'blank').sort());
    assert.deepEqual(outcome, ['oom', 'rendered'], `Repeated failures stay in one reader; the other renders: ${outcome}`);
    assert.deepEqual(failedDraws, [], 'No system draw fails for good');
    assert.deepEqual(tabErrors, []);
    await repeat.close();
  }
  // A reader removed while its score is still parsing: its import worker is stopped, its channel stays closed (no late
  // engraving brings it back), and the other reader keeps the same Verovio worker. Import replies are delayed so the
  // removal lands mid-import.
  {
    const early = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await early.route(/poppins/i, route => route.abort());
    await early.addInitScript(() => {
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
    const tab = await early.newPage();
    const tabErrors = [];
    tab.on('pageerror', error => tabErrors.push(error.message));
    await tab.goto(`${server.url}/embed-test`);
    await tab.waitForFunction(() => window.__pepperscoreVerovioChannels === 2 && window.__importWorkers.length === 2, null, { timeout: 30000 });
    await tab.locator('.host-unmount').click();
    await tab.waitForFunction(() => !document.querySelector('.embed-b'));
    await tab.waitForTimeout(300);
    assert.equal(await tab.evaluate(() => window.__importWorkers.filter(worker => !worker.__terminated).length), 1, 'Removing a reader stops its import worker');
    await rendered(tab, '.pepperscore.embed-a');
    await tab.waitForTimeout(3000);
    assert.equal(await tab.evaluate(() => window.__pepperscoreVerovioChannels), 1, 'The removed reader\'s channel stays closed');
    const workers = await tab.evaluate(() => window.__verovioWorkers);
    await tab.locator('.embed-a').getByRole('button', { name: 'Endless view', exact: true }).click();
    await tab.waitForFunction(() => document.querySelector('.embed-a .score-content.is-painting') === null && document.querySelector('.embed-a .ps-landscape .score-system svg'), null, { timeout: 60000 });
    assert.equal(await tab.evaluate(() => window.__verovioWorkers), workers, 'A keeps re-engraving on the same Verovio worker');
    assert.deepEqual(tabErrors, []);
    await early.close();
  }
  // Two readers showing the same score: Verovio's SVG and glyph ids are per reader, so each reader's <use> glyphs and
  // scoped <style> rules resolve inside its own root (here A in Petaluma, B in Bravura).
  {
    const same = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await same.route(/poppins/i, route => route.abort());
    const tab = await same.newPage();
    await tab.goto(`${server.url}/embed-test`);
    await rendered(tab, '.pepperscore.embed-a');
    await rendered(tab, '.pepperscore.embed-b');
    await tab.locator('.embed-a input[type=file]').setInputFiles(new URL('./fixtures/expressive.musicxml', import.meta.url).pathname);
    await tab.waitForFunction(() => document.querySelector('.embed-a .score-meta h1')?.textContent === document.querySelector('.embed-b .score-meta h1')?.textContent, null, { timeout: 60000 });
    await tab.locator('.embed-a .drawer-handle').click();
    await tab.locator('.embed-a').getByRole('button', { name: 'Petaluma', exact: true }).click();
    await tab.locator('.embed-a button[aria-label="Close options"]').first().click();
    await tab.waitForFunction(() => document.querySelector('.embed-a .score-content')?.style.getPropertyValue('--music-font') === 'Petaluma' && !document.querySelector('.embed-a .score-content.is-painting') && document.querySelector('.embed-a .score-system svg'), null, { timeout: 60000 });
    const glyphs = await tab.evaluate(() => ['.embed-a', '.embed-b'].map(root => {
      const element = document.querySelector(root);
      const uses = [...element.querySelectorAll('.score-system svg use')];
      const svgIds = [...element.querySelectorAll('.score-system svg[id]')].map(svg => svg.id);
      return { uses: uses.length, foreign: uses.filter(use => !element.contains(document.getElementById((use.getAttribute('href') || use.getAttribute('xlink:href')).slice(1)))).length, svgIds };
    }));
    assert.ok(glyphs.every(item => item.uses > 0), `Both readers draw glyphs: ${JSON.stringify(glyphs)}`);
    assert.deepEqual(glyphs.map(item => item.foreign), [0, 0], 'Every glyph reference resolves inside its own reader');
    assert.ok(!glyphs[0].svgIds.some(id => glyphs[1].svgIds.includes(id)), `SVG ids (which scope Verovio's style rules) differ between readers: ${JSON.stringify(glyphs.map(item => item.svgIds))}`);
    await same.close();
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/poppins/i, route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.url}/embed-test`);
  await rendered(page, '.pepperscore.embed-a');
  await rendered(page, '.pepperscore.embed-b');

  // No styles leak out into the host page.
  const host = await page.evaluate(() => {
    const probe = getComputedStyle(document.getElementById('host-probe'));
    return { font: probe.fontFamily, margin: probe.marginTop, size: probe.fontSize, body: getComputedStyle(document.body).backgroundColor, html: getComputedStyle(document.documentElement).fontFamily, button: getComputedStyle(document.querySelector('.host-button')).fontFamily };
  });
  assert.match(host.font, /Georgia/); assert.equal(host.margin, '13px'); assert.equal(host.size, '17px');
  assert.equal(host.body, 'rgb(253, 246, 227)'); assert.match(host.html, /Georgia/); assert.match(host.button, /Georgia/);

  // Review Focus 1: host preflight-style globals don't leak in.
  const look = await page.evaluate(() => {
    const root = document.querySelector('.pepperscore.embed-a');
    const style = selector => getComputedStyle(root.querySelector(selector));
    const topbar = root.querySelector('.topbar');
    return { play: style('.play-button').backgroundColor, title: style('.score-meta h1').fontSize, font: getComputedStyle(root).fontFamily, fits: topbar.scrollWidth <= topbar.clientWidth, selectedOutline: style('.mode-toggle .is-selected').outlineStyle };
  });
  assert.deepEqual(look, { play: 'rgb(52, 86, 66)', title: '30px', font: look.font, fits: true, selectedOutline: 'none' }, JSON.stringify(look));
  assert.match(look.font, /Poppins/);

  // Review Focus 5: ids are unique, and each ARIA reference resolves inside its own root. Verovio's engraved SVGs are
  // left out: every system's SVG repeats its svg and glyph-def ids even with a single reader, and the reader only ever
  // looks those up inside its own root (no document-level id lookups in packages/pepperscore/src).
  const ids = await page.evaluate(() => [...document.querySelectorAll('[id]')].filter(element => !element.closest('.score-system svg')).map(element => element.id));
  assert.equal(new Set(ids).size, ids.length, `Duplicate ids: ${ids}`);
  // Full-chrome roots only (they have a More toggle); later compositions add roots without one.
  const fullChrome = '.pepperscore.embed-a, .pepperscore.embed-b';
  assert.deepEqual(await page.evaluate(fullChrome => [...document.querySelectorAll(fullChrome)].map(root => {
    const toggle = root.querySelector('.header-more-toggle');
    return !!toggle && !!root.querySelector(`#${CSS.escape(toggle.getAttribute('aria-controls'))}`);
  }), fullChrome), [true, true], 'More toggles control their own panels');

  // The drawer, its backdrop, dialogs and toasts stay inside the root box.
  const boxA = await rect(page, '.pepperscore.embed-a');
  await page.locator('.embed-a .drawer-handle').click();
  await page.waitForTimeout(450);
  assert.ok(inside(boxA, await rect(page, '.embed-a .bottom-drawer')), 'Drawer stays inside the root');
  assert.ok(inside(boxA, await rect(page, '.embed-a .drawer-backdrop')), 'Drawer backdrop stays inside the root');
  await page.locator('.embed-a button[aria-label="Close options"]').first().click();
  await page.locator('.embed-a .header-more-toggle').click();
  await page.locator('.embed-a').getByRole('button', { name: 'Track mixer', exact: true }).click();
  assert.ok(inside(boxA, await rect(page, '.embed-a .mixer-backdrop')), 'Mixer stays inside the root');
  // Opened from the More panel (which hides, taking the focused trigger with it), the mixer still closes on Escape.
  await page.keyboard.press('Escape');
  await page.locator('.embed-a .mixer-backdrop').waitFor({ state: 'detached', timeout: 2000 });
  // The voice picker opened from the mixer closes on Escape; after its close button (which unmounts) Escape still closes the mixer.
  await page.locator('.embed-a .header-more-toggle').click();
  await page.locator('.embed-a').getByRole('button', { name: 'Track mixer', exact: true }).click();
  await page.locator('.embed-a .mixer-voice-button').first().click();
  await page.keyboard.press('Escape');
  await page.locator('.embed-a .instrument-picker-backdrop').waitFor({ state: 'detached', timeout: 2000 });
  assert.equal(await page.locator('.embed-a .mixer-backdrop').count(), 1, 'Escape in the voice picker leaves the mixer open');
  await page.locator('.embed-a .mixer-voice-button').first().click();
  await page.locator('.embed-a').getByRole('button', { name: 'Close voice picker', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('.embed-a .mixer-backdrop').waitFor({ state: 'detached', timeout: 2000 });
  // Open score dialog: after a click on its text, Tab stays in the dialog and Escape closes it.
  await page.locator('.embed-a .header-open-file').click();
  await page.locator('.embed-a .open-dialog-intro').click();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.embed-a .open-dialog')), true, 'Tab stays in the open dialog after a click on its text');
  await page.locator('.embed-a .open-dialog-intro').click();
  await page.keyboard.press('Escape');
  await page.locator('.embed-a .open-dialog').waitFor({ state: 'detached', timeout: 2000 });
  await page.locator('.embed-a input[type=file]').setInputFiles({ name: 'broken.musicxml', mimeType: 'application/xml', buffer: Buffer.from('<score-partwise><part') });
  await page.locator('.embed-a .ps-toast').waitFor({ timeout: 30000 });
  assert.ok(inside(boxA, await rect(page, '.embed-a .ps-toast')), 'Toast stays inside the root');
  await page.locator('.embed-a .ps-toast-dismiss').click();
  await rendered(page, '.pepperscore.embed-a');

  // Keyboard shortcuts only affect the focused instance; Escape elsewhere leaves another instance's More panel open.
  const scrollTop = root => page.evaluate(root => document.querySelector(`${root} .score-viewport`).scrollTop, root);
  await page.locator('.embed-a .score-viewport').click({ position: { x: 300, y: 40 } });
  await page.keyboard.press('PageDown');
  await page.waitForFunction(() => document.querySelector('.embed-a .score-viewport').scrollTop > 0, null, { timeout: 5000 });
  assert.equal(await scrollTop('.embed-b'), 0, 'Page Down in A does not scroll B');
  // A page turn scrolls smoothly: let A land before taking its position.
  const settled = root => page.evaluate(async root => {
    const viewport = document.querySelector(`${root} .score-viewport`);
    for (let last = -1, still = 0; still < 4; await new Promise(done => setTimeout(done, 100))) { still = viewport.scrollTop === last ? still + 1 : 0; last = viewport.scrollTop; }
    return viewport.scrollTop;
  }, root);
  const aTop = await settled('.embed-a');
  await page.locator('.embed-b .score-viewport').click({ position: { x: 300, y: 40 } });
  await page.keyboard.press('PageDown');
  await page.waitForFunction(() => document.querySelector('.embed-b .score-viewport').scrollTop > 0, null, { timeout: 5000 });
  assert.equal(await scrollTop('.embed-a'), aTop, 'Page Down in B does not scroll A');
  await page.locator('.embed-a .header-more-toggle').click();
  await page.locator('.embed-b .score-viewport').click({ position: { x: 300, y: 40 } });
  assert.equal(await page.locator('.embed-a .header-more-toggle').getAttribute('aria-expanded'), 'false', 'A click in B closes A\'s More panel (outside click)');
  await page.locator('.embed-a .header-more-toggle').click();
  await page.locator('.embed-b').focus();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.embed-a .header-more-toggle').getAttribute('aria-expanded'), 'true', 'Escape in B leaves A\'s More panel open');

  // persist: A writes only under "embedtest", B (persist={false}) writes nothing; nothing under the default names.
  await page.locator('.embed-b').getByRole('button', { name: 'Endless view', exact: true }).click();
  await page.locator('.embed-a').getByRole('button', { name: 'Endless view', exact: true }).click();
  await page.waitForTimeout(800);
  const stored = await page.evaluate(async () => ({ local: Object.keys(localStorage).sort(), session: Object.keys(sessionStorage).sort(), listed: typeof indexedDB.databases === 'function', dbs: typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map(db => db.name).sort() : [] }));
  assert.ok(stored.local.length > 0 && stored.local.every(key => key.startsWith('embedtest-')), `Only embedtest-* keys: ${stored.local}`);
  assert.ok(stored.local.includes('embedtest-prefs'), `A keeps its prefs under embedtest-prefs: ${stored.local}`);
  assert.ok(stored.session.every(key => key.startsWith('embedtest-')), `Only embedtest-* session keys: ${stored.session}`);
  if (stored.listed) {
    assert.ok(stored.dbs.includes('embedtest'), `A's score database is listed: ${stored.dbs}`);
    assert.ok(stored.dbs.every(name => name === 'embedtest' || name === 'embedtest-last-file'), `Only embedtest databases (none for B or the default names): ${stored.dbs}`);
  } else console.log(`${engine}: indexedDB.databases() is unavailable; the database-name assertions are skipped`);

  assert.deepEqual(errors, []);
  await context.close();

  // Review Focus 1, exhaustively: the host's preflight-style rules change no computed style or size inside the reader.
  // Each overlay state is compared with the same page after the host's element rules are deleted (its .host-* boxes stay).
  for (const state of ['drawer', 'mixer', 'picker', 'dialog', 'toast']) {
    const look = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await look.route(/poppins/i, route => route.abort());
    const tab = await look.newPage();
    await tab.goto(`${server.url}/embed-test`);
    await rendered(tab, '.pepperscore.embed-a');
    if (state === 'drawer') await tab.locator('.embed-a .drawer-handle').click();
    if (state === 'mixer') { await tab.locator('.embed-a .header-more-toggle').click(); await tab.locator('.embed-a').getByRole('button', { name: 'Track mixer', exact: true }).click(); }
    if (state === 'picker') await tab.locator('.embed-a .instrument-control').first().click();
    if (state === 'dialog') await tab.locator('.embed-a .header-open-file').click();
    if (state === 'toast') { await tab.locator('.embed-a input[type=file]').setInputFiles({ name: 'broken.musicxml', mimeType: 'application/xml', buffer: Buffer.from('<score-partwise><part') }); await tab.locator('.embed-a .ps-toast').waitFor({ timeout: 30000 }); }
    await tab.waitForTimeout(500);
    const snapshot = () => tab.evaluate(() => {
      const props = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'font-size', 'font-weight', 'font-family', 'line-height', 'display', 'vertical-align', 'background-color', 'color', 'outline-style', 'max-width', 'box-sizing'];
      const root = document.querySelector('.pepperscore.embed-a');
      return [root, ...root.querySelectorAll('*')].filter(element => !element.closest('.score-staves')).map(element => {
        const style = getComputedStyle(element), box = element.getBoundingClientRect();
        const name = `${element.tagName.toLowerCase()}.${(element.getAttribute('class') || '').trim().split(/\s+/).join('.')}`;
        return `${name} ${props.map(prop => style.getPropertyValue(prop)).join('|')}|${Math.round(box.width)}x${Math.round(box.height)}`;
      });
    });
    const hosted = await snapshot();
    await tab.evaluate(() => {
      for (const sheet of document.styleSheets) for (let index = sheet.cssRules.length - 1; index >= 0; index--) {
        const rule = sheet.cssRules[index];
        if (rule.selectorText && !/pepperscore|host-|^astro/.test(rule.selectorText)) sheet.deleteRule(index);
      }
      document.styleSheets[0].insertRule('.host-box{box-sizing:border-box}', document.styleSheets[0].cssRules.length);
    });
    await tab.waitForTimeout(300);
    const alone = await snapshot();
    const changed = hosted.map((line, index) => line === alone[index] ? null : `host:  ${line}\nalone: ${alone[index]}`).filter(Boolean);
    assert.deepEqual(changed, [], `Host rules change the reader (${state}):\n${changed.slice(0, 12).join('\n')}`);
    await look.close();
  }
  console.log(`${engine}: embedding (style isolation, containment, unique ids, focused keyboard) passed`);
} finally { await browser.close(); await server.close(); }
