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
