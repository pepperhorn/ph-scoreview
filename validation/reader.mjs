import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'apps/reader/dist');
const engine = process.env.BROWSER || 'chromium';
const launcher = { chromium, firefox, webkit }[engine];
if (!launcher) throw new Error(`BROWSER must be chromium, firefox or webkit (got "${engine}")`);
if (!process.env.READER_URL && !existsSync(resolve(dist, 'index.html'))) throw new Error('apps/reader/dist/index.html is missing: run `npm run build` before validation/reader.mjs');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const path = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!path.startsWith(`${dist}${sep}`)) { response.writeHead(403).end(); return; }
  try { response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' }).end(await readFile(path)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = process.env.READER_URL || `http://127.0.0.1:${server.address().port}`;
const browser = await launcher.launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}) });
try {
  // First paint: the header's mobile/desktop arrangement is pure CSS, so the server-rendered HTML already matches the
  // viewport and hydration never reflows it (a JS media-query hook used to swap desktop -> mobile after hydration).
  const breakpoint = Number((await readFile(resolve(root, 'packages/pepperscore/src/lib/header-controls.ts'), 'utf8')).match(/MOBILE_HEADER_BREAKPOINT = (\d+);/)[1]);
  assert.match(await readFile(resolve(root, 'packages/pepperscore/src/styles.css'), 'utf8'), new RegExp(`/\\* HEADER BREAKPOINT \\(mobile\\)[^*]*\\*/\\s*@container pepperscore \\(max-width:${breakpoint}px\\)`), `The header's container breakpoint matches MOBILE_HEADER_BREAKPOINT (${breakpoint}px)`);
  const headerArrangement = target => target.evaluate(() => {
    const visible = element => !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
    const box = selector => { const element = document.querySelector(selector); if (!visible(element)) return null; const rect = element.getBoundingClientRect(); return [rect.left, rect.top, rect.width, rect.height].map(value => Math.round(value * 10) / 10); };
    const controls = ['bpm', 'transpose', 'keyFlip', 'bars', 'staveScale', 'mixer'];
    return {
      more: visible(document.querySelector('.header-more-toggle')),
      expanded: document.querySelector('.header-more-toggle')?.getAttribute('aria-expanded') ?? null,
      controls: document.querySelector('.header-more-toggle')?.getAttribute('aria-controls') ?? null,
      panel: !!document.getElementById(document.querySelector('.header-more-toggle')?.getAttribute('aria-controls')),
      secondary: Object.fromEntries(controls.filter(id => document.querySelector(`[data-header-control="${id}"]`)).map(id => [id, visible(document.querySelector(`[data-header-control="${id}"] :is(input, select, button)`))])),
      counts: [...document.querySelectorAll('[data-header-control]')].map(element => element.dataset.headerControl).join(','),
      fits: document.querySelector('.topbar').scrollWidth <= document.querySelector('.topbar').clientWidth,
      boxes: Object.fromEntries(Object.entries({ stop: '.stop-button', play: '.play-button', open: '.header-open-file', mode: '.mode-toggle', more: '.header-more-toggle', bars: '.header-bars-setting', transpose: '.header-transpose-readout', keyFlip: '.header-key-flip-button' }).map(([key, selector]) => [key, box(selector)])),
    };
  });
  const expectedArrangement = (width, layout) => {
    const mobile = width <= breakpoint;
    assert.equal(layout.more, mobile, `More toggle is ${mobile ? 'shown' : 'hidden'} at ${width}px`);
    assert.equal(layout.expanded, 'false', `More starts collapsed at ${width}px`);
    assert.ok(layout.controls?.endsWith('-more'), 'More toggle controls the secondary panel');
    assert.equal(layout.panel, true, 'The secondary panel is always in the DOM');
    assert.ok(Object.keys(layout.secondary).length >= 3, `Secondary controls are rendered: ${JSON.stringify(layout.secondary)}`);
    for (const [id, shown] of Object.entries(layout.secondary)) assert.equal(shown, !mobile, `Secondary control ${id} is ${mobile ? 'collapsed' : 'inline'} at ${width}px`);
    assert.equal(new Set(layout.counts.split(',')).size, layout.counts.split(',').length, `No duplicate header controls: ${layout.counts}`);
    assert.equal(layout.fits, true, `Header fits at ${width}px`);
  };
  const ssr = {};
  const noJsContext = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  // Poppins is blocked in these contexts so a late font swap can't masquerade as (or hide) a hydration shift.
  await noJsContext.route(/poppins/i, route => route.abort());
  const noJs = await noJsContext.newPage();
  for (const width of [breakpoint - 30, breakpoint, breakpoint + 1, 1280]) {
    await noJs.setViewportSize({ width, height: 844 });
    await noJs.goto(url, { waitUntil: 'load' });
    ssr[width] = await headerArrangement(noJs);
    expectedArrangement(width, ssr[width]);
  }
  await noJsContext.close();
  // Fresh visitors (default prefs) and a returning visitor whose saved Endless preference is applied after hydration.
  for (const [width, savedMode] of [[breakpoint - 30, null], [1280, null], [breakpoint - 30, 'landscape'], [1280, 'landscape']]) {
    const hydrateContext = await browser.newContext({ viewport: { width, height: 844 } });
    await hydrateContext.route(/poppins/i, route => route.abort());
    const hydrate = await hydrateContext.newPage();
    if (savedMode) await hydrate.addInitScript(mode => localStorage.setItem('scoreflow-prefs', JSON.stringify({ mode })), savedMode);
    const hydrateErrors = [];
    hydrate.on('pageerror', e => hydrateErrors.push(e.message));
    await hydrate.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
      const box = selector => { const element = document.querySelector(selector); if (!element || !element.getClientRects().length) return null; const rect = element.getBoundingClientRect(); return [rect.left, rect.top, rect.width, rect.height].map(value => Math.round(value * 10) / 10); };
      window.__firstPaint = Object.fromEntries(Object.entries({ stop: '.stop-button', play: '.play-button', open: '.header-open-file', mode: '.mode-toggle', more: '.header-more-toggle', bars: '.header-bars-setting', transpose: '.header-transpose-readout', keyFlip: '.header-key-flip-button' }).map(([key, selector]) => [key, box(selector)]));
    }));
    await hydrate.goto(url);
    if (savedMode) await hydrate.waitForFunction(() => document.querySelector('.mode-toggle-endless.is-selected'), null, { timeout: 30000 });
    await hydrate.waitForFunction(() => !document.querySelector('astro-island[ssr]') && !document.querySelector('.score-loading') && document.querySelector('.score-system svg') && !document.querySelector('.score-content').getAnimations().length, null, { timeout: 30000 });
    const hydrated = await headerArrangement(hydrate);
    const firstPaint = await hydrate.evaluate(() => window.__firstPaint);
    expectedArrangement(width, hydrated);
    const scenario = `${width}px${savedMode ? ` with saved mode ${savedMode}` : ''}`;
    assert.deepEqual(hydrated.boxes, firstPaint, `Header controls do not move between DOMContentLoaded and hydration at ${scenario}`);
    assert.deepEqual(hydrated.boxes, ssr[width].boxes, `Hydrated header matches the no-JS server render at ${scenario}`);
    assert.deepEqual(hydrated.secondary, ssr[width].secondary, `Secondary controls keep their SSR arrangement at ${scenario}`);
    if (savedMode) {
      // Bars stays in the header in Endless (same footprint), disabled with an explanation.
      const bars = await hydrate.evaluate(() => { const select = document.querySelector('[aria-label="Bars per line"]'); return { disabled: select.disabled, aria: select.getAttribute('aria-disabled'), title: select.title }; });
      assert.deepEqual(bars, { disabled: true, aria: 'true', title: 'Bars per line applies to Vertical view' }, `Bars is disabled in Endless at ${width}px`);
    } else if (width <= breakpoint) {
      // Collapsed panel controls are display:none, so they can't take focus; Tab goes from More straight out of the header.
      assert.equal(await hydrate.evaluate(() => [...document.querySelectorAll('.header-secondary-panel :is(input, select, button)')].every(control => { control.focus(); return document.activeElement !== control; })), true, 'Closed More panel controls are not focusable');
      await hydrate.getByRole('button', { name: 'Endless view', exact: true }).focus();
      await hydrate.keyboard.press('Tab');
      assert.equal(await hydrate.evaluate(() => document.activeElement?.classList.contains('header-more-toggle')), true, 'Tab reaches More after the mode toggle');
      await hydrate.keyboard.press('Tab');
      assert.equal(await hydrate.evaluate(() => !document.activeElement?.closest('.header-secondary-panel')), true, 'Tab skips the closed panel');
    } else if (engine !== 'webkit') {
      // Desktop tab order follows the registry and never lands on the hidden More toggle.
      await hydrate.getByRole('button', { name: 'Stop playback', exact: true }).focus();
      const order = [await hydrate.evaluate(() => document.activeElement.closest('[data-header-control]')?.dataset.headerControl)];
      for (let step = 0; step < 12; step++) {
        await hydrate.keyboard.press('Tab');
        const focused = await hydrate.evaluate(() => ({ id: document.activeElement.closest('[data-header-control]')?.dataset.headerControl, more: document.activeElement.classList.contains('header-more-toggle') }));
        assert.equal(focused.more, false, 'The hidden More toggle is not in the desktop tab order');
        if (!focused.id) break;
        if (focused.id !== order.at(-1)) order.push(focused.id);
      }
      // The key flip is aria-disabled (not disabled) on the C major sample, so it stays in the tab order with its explanation.
      assert.deepEqual(order, ['stop', 'play', 'openFile', 'mode', 'bpm', 'transpose', 'keyFlip', 'bars', 'staveScale', 'mixer'], 'Desktop tab order follows the header registry');
    }
    assert.deepEqual(hydrateErrors, []);
    await hydrateContext.close();
  }
  console.log(`${engine}: header first paint matches the server render (no hydration reflow) passed`);

  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: engine !== 'firefox' });
  const errors = [], remote = [], consoleLines = [];
  const assetPaths = [];
  page.on('console', m => consoleLines.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(url)) remote.push(r.url()); else if (r.url().startsWith(url)) assetPaths.push(new URL(r.url()).pathname); });
  await page.addInitScript(() => {
    window.__audioStarts = 0;
    window.__contexts = [];
    const Native = window.AudioContext;
    window.AudioContext = class extends Native { constructor(...args) { super(...args); window.__contexts.push(this); } };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) { window.__audioStarts++; return start.apply(this, args); };
  });
  // Each staff control sits on its own staff's centre line in the first system.
  const assertControlsAligned = async (expected) => {
    const offsets = await page.evaluate(() => {
      const staves = [...document.querySelector('.score-system:first-child svg g.measure').querySelectorAll(':scope > g.staff')].map(staff => {
        const lines = [...staff.querySelectorAll(':scope > path')].slice(0, 5).map(line => line.getBoundingClientRect());
        return (Math.min(...lines.map(line => line.top)) + Math.max(...lines.map(line => line.bottom))) / 2;
      });
      const rects = [...document.querySelectorAll('.part-control')].map(control => control.getBoundingClientRect());
      const controls = rects.map(rect => rect.top + rect.height / 2);
      return { staves: staves.length, controls: controls.length, offsets: controls.map((center, index) => Math.abs(center - staves[index])), overlapping: rects.some((rect, index) => index > 0 && rect.top < rects[index - 1].bottom - .5) };
    });
    assert.equal(offsets.staves, expected, 'Engraved staff count');
    assert.equal(offsets.controls, expected, 'Staff control count');
    assert.ok(offsets.offsets.every(offset => offset < 4), `Staff controls align with their staves: ${offsets.offsets.map(value => value.toFixed(1))}`);
    assert.equal(offsets.overlapping, false, 'Adjacent staff controls do not overlap');
  };
  // At phone widths secondary header controls (bpm, bars, stave scale, mixer) live in the "More controls" dropdown; Vertical/Endless stay top level.
  const moreToggle = () => page.getByRole('button', { name: 'More controls', exact: true });
  const openMore = async () => { if (await moreToggle().count() && await moreToggle().getAttribute('aria-expanded') !== 'true') await moreToggle().click(); };
  const closeMore = async () => { if (await moreToggle().count() && await moreToggle().getAttribute('aria-expanded') === 'true') await page.keyboard.press('Escape'); };
  const header = async (action) => { await openMore(); await action(); await closeMore(); };
  const staveScale = () => page.getByRole('slider', { name: 'Stave scale', exact: true });
  // Top-level header: Play/Open keep their text, Open is outlined, the mode toggle is inline (V/E when condensed).
  const headerLayout = (target = page) => target.evaluate(() => {
    const topbar = document.querySelector('.topbar');
    const visibleText = element => [...element.querySelectorAll('span')].filter(span => span.getClientRects().length && getComputedStyle(span).visibility !== 'hidden').map(span => span.textContent).join('');
    const open = document.querySelector('.header-open-file');
    const openStyle = getComputedStyle(open);
    const targets = [...document.querySelectorAll('.stop-button, .play-button, .header-open-file, .header-more-toggle, .mode-toggle button')].map(element => { const rect = element.getBoundingClientRect(); return { label: element.getAttribute('aria-label'), width: rect.width, height: rect.height }; });
    return {
      fits: topbar.scrollWidth <= topbar.clientWidth,
      play: visibleText(document.querySelector('.play-button')),
      open: visibleText(open),
      openBorder: openStyle.borderTopWidth === '1px' && openStyle.borderTopStyle === 'solid' && !/rgba\(0, 0, 0, 0\)|transparent/.test(openStyle.borderTopColor),
      openLabel: open.getAttribute('aria-label'),
      mode: [...document.querySelectorAll('.mode-toggle button')].map(button => ({ text: visibleText(button), label: button.getAttribute('aria-label'), title: button.getAttribute('title'), top: !button.closest('.header-secondary-panel') })),
      targets,
    };
  });
  const assertHeader = async (width, { modeText, minTarget }, target = page) => {
    const layout = await headerLayout(target);
    assert.equal(layout.fits, true, `Header does not overflow at ${width}px`);
    assert.match(layout.play, /^(Play|Pause|Loading)$/, `Play button keeps its text at ${width}px: ${layout.play}`);
    assert.equal(layout.open, 'Open', `Open button shows its text at ${width}px`);
    assert.equal(layout.openBorder, true, `Open button is outlined at ${width}px`);
    assert.equal(layout.openLabel, 'Open score file');
    assert.deepEqual(layout.mode.map(button => button.text), modeText, `Mode toggle text at ${width}px`);
    assert.deepEqual(layout.mode.map(button => [button.label, button.title, button.top]), [['Vertical view', 'Vertical view', true], ['Endless view', 'Endless view', true]], `Mode toggle is top level with full labels at ${width}px`);
    if (minTarget) for (const target of layout.targets) assert.ok(target.width >= minTarget - .5 && target.height >= minTarget - 6.5, `Header touch target ${target.label} is large enough at ${width}px: ${target.width}x${target.height}`);
  };
  // A range input only accepts min + k * step; the reader rounds a committed value to the 0.05 grid.
  const onStep = async (slider, value) => { const min = Number(await slider.getAttribute('min')); return String(Math.round((min + Math.round((value - min) / .05) * .05) * 1000) / 1000); };
  // Rendered first-system staff height, first control icon size and zoom value text.
  const staffMetrics = () => page.evaluate(() => {
    const lines = [...document.querySelector('.score-system:first-child svg g.measure > g.staff').querySelectorAll(':scope > path')].slice(0, 5).map(line => line.getBoundingClientRect());
    const staff = Math.max(...lines.map(line => line.bottom)) - Math.min(...lines.map(line => line.top));
    const icon = document.querySelector('.part-control .part-icon').getBoundingClientRect().height;
    const font = parseFloat(getComputedStyle(document.querySelector('.part-control .part-name')).fontSize);
    const controlsRight = Math.max(...[...document.querySelectorAll('.part-control')].map(control => control.getBoundingClientRect().right));
    // Later systems use the full width; at phone widths the first system is width-limited beside the controls.
    const rest = [...(document.querySelector('.score-system:nth-child(2) svg g.measure > g.staff') || document.querySelector('.score-system svg g.measure > g.staff')).querySelectorAll(':scope > path')].slice(0, 5).map(line => line.getBoundingClientRect());
    const restStaff = Math.max(...rest.map(line => line.bottom)) - Math.min(...rest.map(line => line.top));
    return { staff, restStaff, icon, font, controlsRight, systemLeft: document.querySelector('.score-system:first-child').getBoundingClientRect().left };
  });
  const ready = async () => {
    await page.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg') && !document.querySelector('.score-content').getAnimations().length, { timeout: 30000 });
    assert.equal(await page.locator('.ps-toast').count(), 0, await page.locator('.ps-toast').allTextContents());
  };
  await page.goto(url);
  await ready();
  const musicFonts = await page.evaluate(() => document.querySelector('style[data-pepperscore-fonts]')?.textContent ?? '');
  for (const file of ['Bravura', 'Petaluma', 'PetalumaScript']) assert.ok(musicFonts.includes(`url('${url}/fonts/${file}.woff2')`), `${file} loads from the asset base: ${musicFonts}`);
  assert.doesNotMatch(await readFile(resolve(root, 'packages/pepperscore/src/styles.css'), 'utf8'), /@font-face/, 'Music fonts are not hardcoded in the stylesheet');
  // Paint reveal zooms out from an enlarged scale while fading in.
  const reveal = await page.evaluate(() => { const style = getComputedStyle(document.querySelector('.score-content')); return { transition: style.transitionProperty, transform: style.transform }; });
  assert.match(reveal.transition, /transform/, 'Score paint animates scale');
  assert.equal(reveal.transform, 'none', 'Painted score settles at its natural scale');
  assert.ok(await page.locator('svg .note').count() > 0, 'Verovio native notes render');
  assert.ok(await page.locator('svg .notehead use').count() > 0, 'Noteheads retain their glyph references');
  // SMuFL text glyphs (the sample's metronome mark) keep their music font, served by the @font-face injected from the asset base.
  const smufl = await page.evaluate(async () => {
    const glyph = document.querySelector('.score-system svg g.tempo tspan[font-family]');
    await document.fonts.load('20px Bravura');
    return { family: glyph?.getAttribute('font-family'), text: glyph?.textContent, loaded: document.fonts.check('20px Bravura'), faces: [...document.fonts].filter(face => face.family.replace(/["']/g, '') === 'Bravura' && face.status === 'loaded').length, embedded: document.querySelectorAll('.score-system svg style').length ? [...document.querySelectorAll('.score-system svg style')].some(style => /@font-face/.test(style.textContent)) : false };
  });
  assert.equal(smufl.family, 'Bravura', 'Tempo glyph keeps the SMuFL font family');
  assert.equal(smufl.text, '\uE1D5', 'Tempo glyph survives sanitizing');
  assert.ok(smufl.loaded && smufl.faces > 0, 'Local Bravura @font-face loads for SMuFL text');
  assert.equal(smufl.embedded, false, 'No embedded font payload is needed');
  // Petaluma applies its SMuFL engravingDefaults (heavier stems/lines) and pairs Sans stave text with Petaluma Script.
  const scoreStyle = () => page.evaluate(async () => {
    await document.fonts.ready;
    const tempo = document.querySelector('.score-system svg g.tempo text');
    return { stem: Number(document.querySelector('.score-system svg .stem path')?.getAttribute('stroke-width')), tempoFont: tempo && getComputedStyle(tempo).fontFamily, script: document.fonts.check("20px 'Petaluma Script'"), meter: [...document.querySelectorAll('.score-system svg .meterSig use')].map(use => { const rect = use.getBoundingClientRect(); return [rect.top, rect.bottom]; }) };
  });
  const bravuraStyle = await scoreStyle();
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('button', { name: 'Petaluma', exact: true }).click();
  await ready();
  const petalumaStyle = await scoreStyle();
  assert.ok(petalumaStyle.stem > bravuraStyle.stem, `Petaluma stems are heavier than Bravura (${petalumaStyle.stem} > ${bravuraStyle.stem})`);
  assert.match(petalumaStyle.tempoFont || '', /Petaluma Script/, 'Petaluma tempo text uses Petaluma Script');
  assert.ok(petalumaStyle.script, 'Local Petaluma Script @font-face loads');
  // Without Verovio's handwrittenFont option the two Petaluma digits overprint each other.
  assert.ok(petalumaStyle.meter.length === 2 && petalumaStyle.meter[0][1] <= petalumaStyle.meter[1][0] + 2, `Petaluma time-signature digits do not overprint: ${JSON.stringify(petalumaStyle.meter)}`);
  assert.doesNotMatch(bravuraStyle.tempoFont || '', /Petaluma/, 'Bravura keeps the chosen stave text font');
  await page.getByRole('button', { name: 'Bravura', exact: true }).click();
  await page.locator('button[aria-label="Close options"]').click();
  await ready();
  // Sample score: Verovio transposes the untouched document exactly once.
  const firstChord = () => page.evaluate(() => [...document.querySelector('.score-system svg .chord').querySelectorAll('.note')].map(note => note.getAttribute('data-pname')).sort().join(''));
  assert.equal(await firstChord(), 'ceg');
  // Mobile header: secondary controls stay in a closed "More controls" dropdown until opened.
  assert.equal(await moreToggle().getAttribute('aria-expanded'), 'false', 'More controls start closed');
  for (const hidden of [staveScale(), page.getByRole('button', { name: 'Track mixer', exact: true }), page.locator('.bpm-control input'), page.locator('.header-transpose-readout'), page.locator('.header-key-flip-button')]) assert.equal(await hidden.isVisible(), false, 'Secondary controls are hidden while More is closed');
  for (const shown of [page.getByRole('button', { name: 'Vertical view', exact: true }), page.getByRole('button', { name: 'Endless view', exact: true })]) assert.ok(await shown.isVisible(), 'Vertical/Endless stay top level on mobile');
  await assertHeader(390, { modeText: ['V', 'E'], minTarget: 36 });
  await moreToggle().click();
  assert.equal(await moreToggle().getAttribute('aria-expanded'), 'true');
  for (const shown of [staveScale(), page.getByRole('button', { name: 'Track mixer', exact: true }), page.locator('.bpm-control input'), page.locator('.header-transpose-readout'), page.locator('.header-key-flip-button')]) assert.ok(await shown.isVisible(), 'Secondary controls are usable in the More panel');
  assert.equal(await page.locator('.header-secondary-panel .header-transpose-readout').textContent(), '0 · C', 'The More panel shows the transpose readout');
  assert.equal(await page.locator('.header-secondary-panel .mode-toggle').count(), 0, 'The mode toggle is not in the More panel');
  await page.keyboard.press('Escape');
  assert.equal(await moreToggle().getAttribute('aria-expanded'), 'false', 'Escape closes More');
  await openMore();
  await page.mouse.click(10, 700);
  assert.equal(await moreToggle().getAttribute('aria-expanded'), 'false', 'Outside click closes More');
  await openMore();
  await page.reload();
  await ready();
  assert.equal(await moreToggle().getAttribute('aria-expanded'), 'false', 'More is closed after reload');
  assert.equal(await staveScale().count(), 0);
  // Stave scale slider: controls keep their ratio to the rendered stave, stay aligned and clear of the notation.
  const atDefault = await staffMetrics();
  // The slider commits zoom once the value settles, then re-lays out at that absolute stave scale.
  const zoomCommitted = zoom => page.waitForFunction(value => document.querySelector('.score-content')?.dataset.staveScale === String(value), zoom, { timeout: 5000 });
  await header(async () => {
    // The default (four bars across in Vertical) is below 1 at 390px; the slider shows it to within a step.
    const fitted = Number(await page.evaluate(() => document.querySelector('.score-content').dataset.staveScale));
    assert.ok(fitted < 1 && Math.abs(Number(await staveScale().inputValue()) - fitted) <= .05, `Slider shows the default scale: ${fitted}`);
    await staveScale().fill('1');
    await page.locator('.header-stave-scale-value', { hasText: '100%' }).waitFor();
  });
  await zoomCommitted(1);
  await ready();
  // Ratios are compared above the controls' minimum sizes (the tiny default stave clamps the icon and name).
  const atOne = await staffMetrics();
  await header(async () => {
    await staveScale().fill('1.25');
    await page.locator('.header-stave-scale-value', { hasText: '125%' }).waitFor();
  });
  await zoomCommitted(1.25);
  await ready();
  const zoomed = await staffMetrics();
  assert.ok(zoomed.restStaff > atOne.restStaff * 1.15, `Stave grows with stave scale: ${atOne.restStaff} -> ${zoomed.restStaff}`);
  assert.ok(zoomed.staff >= atOne.staff - .5, `The width-limited first system never shrinks when zooming in: ${atOne.staff} -> ${zoomed.staff}`);
  for (const key of ['icon', 'font']) assert.ok(Math.abs(zoomed[key] / zoomed.staff - atOne[key] / atOne.staff) < .03, `Control ${key} keeps its ratio to the stave: ${(atOne[key] / atOne.staff).toFixed(3)} vs ${(zoomed[key] / zoomed.staff).toFixed(3)}`);
  for (const metrics of [atDefault, atOne, zoomed]) assert.ok(metrics.controlsRight <= metrics.systemLeft, `Staff controls stay clear of the notation: ${metrics.controlsRight} <= ${metrics.systemLeft}`);
  await assertControlsAligned(1);
  await header(async () => { await staveScale().fill('1'); await page.locator('.header-stave-scale-value', { hasText: '100%' }).waitFor(); });
  await zoomCommitted(1);
  await ready();
  // Desktop header: every control is inline and there is no More toggle.
  // A resize re-renders after the viewport settles; wait for the first system to change width.
  const resizeTo = async (width, height) => {
    const before = await page.evaluate(() => document.querySelector('.score-system').style.width);
    await page.setViewportSize({ width, height });
    await page.waitForFunction(previous => document.querySelector('.score-system')?.style.width !== previous, before, { timeout: 10000 });
    await ready();
  };
  // Just above the mobile breakpoint every control is inline and must still fit, through each inline step (styles.css).
  await page.setViewportSize({ width: breakpoint + 1, height: 800 });
  await page.locator('.header-more-toggle').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.querySelector('.topbar').scrollWidth <= document.querySelector('.topbar').clientWidth), true, `Inline header fits at ${breakpoint + 1}px`);
  await assertHeader(breakpoint + 1, { modeText: ['V', 'E'] });
  for (const [width, modeText] of [[900, ['V', 'E']], [901, ['Vertical', 'Endless']], [1140, ['Vertical', 'Endless']], [1141, ['Vertical', 'Endless']]]) {
    await page.setViewportSize({ width, height: 800 });
    await assertHeader(width, { modeText });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No horizontal page overflow at ${width}px`);
  }
  await page.waitForTimeout(400);
  await ready();
  await resizeTo(1280, 800);
  assert.equal(await moreToggle().count(), 0, 'No More toggle on desktop');
  for (const shown of [staveScale(), page.getByRole('button', { name: 'Track mixer', exact: true }), page.getByRole('button', { name: 'Vertical view', exact: true }), page.locator('.bpm-control input'), page.locator('[aria-label="Bars per line"]')]) assert.ok(await shown.isVisible(), 'Secondary controls are inline on desktop');
  await assertHeader(1280, { modeText: ['Vertical', 'Endless'] });
  const desktop = await staffMetrics();
  assert.ok(Math.abs(desktop.icon - 56) <= 1 && Math.abs(desktop.font - 22) <= .5, `Default desktop controls are double size: ${desktop.icon}px icon, ${desktop.font}px name`);
  await resizeTo(390, 844);
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.locator('.pitch-panel').getByRole('button', { name: 'Transpose up a semitone', exact: true }).click();
  await page.locator('.pitch-panel').getByRole('button', { name: 'Transpose up a semitone', exact: true }).click();
  await page.locator('button[aria-label="Close options"]').click();
  await ready();
  assert.equal(await firstChord(), 'adf', 'Sample transposed +2 engraves D-F#-A once, not twice');
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('button', { name: 'Reset transposition', exact: true }).click();
  await page.locator('button[aria-label="Close options"]').click();
  await ready();
  assert.equal(await firstChord(), 'ceg');
  // Chord playback highlights the whole chord, not one notehead.
  assert.ok(await page.locator('svg .chord.reader-note').count() > 0, 'Chords are the highlight target');
  assert.equal(await page.locator('svg .chord .note.reader-note').count(), 0, 'No single chord notehead is the highlight target');
  await page.getByRole('button', { name: 'Play score', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.chord.is-playing'), { timeout: 20000 }).catch(async error => {
    const state = await page.evaluate(() => ({ contexts: window.__contexts.map(c => ({ state: c.state, time: c.currentTime })), starts: window.__audioStarts, playing: document.querySelectorAll('.is-playing').length, toasts: [...document.querySelectorAll('.ps-toast')].map(t => t.textContent), notice: document.querySelector('.playback-notice')?.textContent ?? null, loading: !!document.querySelector('.audio-loading, [aria-busy=true]') }));
    throw new Error(`No chord highlighted after Play: ${JSON.stringify(state)}; console: ${consoleLines.slice(-10).join(' | ')}`, { cause: error });
  });
  const chordFills = await page.evaluate(() => [...document.querySelector('.chord.is-playing').querySelectorAll('.notehead')].map(head => getComputedStyle(head).fill));
  assert.ok(chordFills.length >= 3, 'Sample chord has three noteheads');
  assert.ok(chordFills.every(fill => fill === 'rgb(184, 114, 24)'), `Every chord notehead highlights: ${chordFills}`);
  await page.getByRole('button', { name: 'Stop playback', exact: true }).click();
  // ABC triplets engrave as MEI tuplets with their written durations.
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('textbox', { name: 'ABC notation' }).fill('X:1\nT:Triplets\nM:4/4\nL:1/8\nK:C\n(3cde (3fga c2 c2 |');
  await page.getByRole('button', { name: 'View notation' }).click();
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Triplets');
  await ready();
  assert.equal(await page.locator('svg .tuplet').count(), 2, 'Two triplet groups engrave');
  assert.equal(await page.locator('svg .tuplet .note').count(), 6, 'Triplet notes sit inside their tuplets');
  assert.deepEqual(await page.locator('svg .tuplet .note').evaluateAll(notes => notes.map(note => note.closest('.tuplet').querySelectorAll('.note').length)), [3, 3, 3, 3, 3, 3]);
  // ABC repeats, volta endings and jumps engrave natively through the MEI adapter.
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('textbox', { name: 'ABC notation' }).fill('X:1\nT:Repeats\nM:4/4\nL:1/4\nK:C\n|:C4|[1D4:|[2E4||!segno!F4|"^Fine"G4|"^D.S. al Fine"A4|]');
  await page.getByRole('button', { name: 'View notation' }).click();
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Repeats');
  await ready();
  // Verovio draws each <ending> as a system milestone plus one spanning bracket.
  assert.equal(await page.locator('svg g.ending.systemMilestone').count(), 2, 'First and second endings engrave');
  // Verovio draws a bracket in the milestone or, at some system breaks, in a spanning group; either way one per ending.
  const brackets = await page.evaluate(() => {
    const drawn = [...document.querySelectorAll('svg g.ending.spanning, svg g.ending.systemMilestone')].filter(ending => ending.getBoundingClientRect().width > 0);
    const widest = Math.max(...[...document.querySelectorAll('svg g.measure')].map(measure => measure.getBoundingClientRect().width));
    return drawn.map(ending => ending.getBoundingClientRect().width / widest);
  });
  assert.equal(brackets.length, 2, 'Each ending draws one bracket');
  assert.ok(brackets.every(ratio => ratio <= 1.05), `Each ending bracket spans only its own measure: ${brackets.map(ratio => ratio.toFixed(2))}`);
  assert.equal(await page.locator('svg g.repeatMark').count(), 1, 'Segno engraves');
  assert.deepEqual((await page.locator('svg g.dir').allTextContents()).map(text => text.trim()), ['Fine', 'D.S. al Fine'], 'Fine and D.S. engrave');
  const fixture = resolve(root, 'validation/fixtures/ensemble.musicxml');
  await page.locator('input[type=file]').setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Migration ensemble');
  await ready();
  assert.equal(await page.locator('.part-control').count(), 5);
  assert.equal(await page.locator('svg .note').count(), 160, 'Every source pitch survives direct MusicXML import');
  await assertControlsAligned(5);
  assert.ok(await page.locator('svg .dynam').count() >= 5, 'Source dynamics render natively');
  assert.ok(await page.locator('svg .artic').count() >= 40, 'Source articulations survive');
  assert.ok(await page.locator('svg .verse').count() > 0, 'MusicXML lyrics survive');
  await header(() => page.locator('[aria-label="Bars per line"]').selectOption('4'));
  await ready();
  assert.equal(await page.locator('.score-system').count(), 2, 'Exactly four measures per system');
  assert.equal(await page.evaluate(() => { const v = document.querySelector('.score-viewport'); return v.scrollWidth <= v.clientWidth + 1; }), true, 'Portrait fits viewport');
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('switch', { name: 'Note names', exact: true }).click();
  await page.getByRole('switch', { name: 'Beat counts', exact: true }).click();
  await ready();
  assert.ok(await page.locator('.note-label').count() > 0);
  assert.ok(await page.locator('.count-label').count() > 0);
  await page.getByRole('button', { name: 'Petaluma', exact: true }).click();
  await ready();
  // Re-selecting the current notation font changes nothing, so no loading overlay may linger.
  await page.getByRole('button', { name: 'Petaluma', exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.score-loading').count(), 0, 'Re-selecting the current font leaves no loading overlay');
  await page.getByRole('button', { name: 'Mono', exact: true }).click();
  await ready();
  assert.match(await page.locator('.note-label').first().evaluate(e => getComputedStyle(e).fontFamily), /monospace/);
  await page.locator('button[aria-label="Close options"]').click();
  await openMore();
  await page.getByRole('button', { name: 'Track mixer', exact: true }).click();
  assert.equal(await page.locator('.mixer-track').count(), 5);
  await page.locator('[aria-label="Volume for Track 1"]').fill('42');
  await page.getByRole('button', { name: 'Voice for Track 1', exact: true }).click();
  assert.equal(await page.locator('.instrument-picker-grid button').count(), 16);
  await page.locator('.instrument-picker-grid button').nth(1).click();
  await page.getByRole('button', { name: 'Close track mixer', exact: true }).click();
  await page.getByRole('button', { name: 'Hide Track 2', exact: true }).click();
  await ready();
  assert.equal(await page.locator('.part-control').count(), 4);
  assert.equal(await page.locator('svg .note').count(), 128);
  assert.equal(await page.evaluate(() => document.querySelector('.score-system svg g.measure').querySelectorAll(':scope > g.staff').length), 4, 'Hidden staff is removed from the engraving');
  assert.deepEqual(await page.locator('.part-control .part-name').allTextContents(), ['Track 1', 'Track 3', 'Track 4', 'Track 5']);
  await assertControlsAligned(4);
  // Per-score memory: an explicit stave scale is saved with the file and restored when it is reopened.
  // A default below the usual minimum becomes the slider's min, so pick the step value nearest 0.8 (the commit rounds it to 0.8).
  await header(async () => { await staveScale().fill(await onStep(staveScale(), .8)); await page.locator('.header-stave-scale-value', { hasText: '80%' }).waitFor(); });
  await zoomCommitted(0.8);
  await ready();
  await page.locator('input[type=file]').setInputFiles(fixture);
  await ready();
  assert.equal(await page.locator('.part-control').count(), 4, 'Old staff identities preserve hidden state');
  await header(async () => assert.equal(await staveScale().inputValue(), '0.8', 'Reopening a file restores its stave scale'));
  await openMore();
  await page.getByRole('button', { name: 'Track mixer', exact: true }).click();
  assert.equal(await page.locator('[aria-label="Volume for Track 1"]').inputValue(), '42');
  await page.getByRole('button', { name: 'Close track mixer', exact: true }).click();
  await page.getByRole('button', { name: 'Show Track 2', exact: true }).click();
  await ready();
  await page.getByRole('button', { name: 'Endless view', exact: true }).click();
  await ready();
  assert.equal(await page.locator('svg .note').count(), 160);
  assert.equal(await page.locator('.score-system').count(), 1, 'Endless view is one unbroken system');
  assert.equal(await page.locator('.score-system svg g.system').count(), 1, 'Endless view engraves a single system');
  assert.equal(await page.locator('.score-system svg g.clef').count(), 5, 'System-start clefs are not repeated');
  await assertControlsAligned(5);
  await page.getByRole('button', { name: 'Play score', exact: true }).click();
  // Devices without a usable audio output (e.g. CI runners) fall back to silent playback, which must say so.
  // The playhead can show at the bar start a frame before the first note highlights, so wait for both.
  await page.waitForFunction(() => document.querySelector('.playback-line') && document.querySelector('.is-playing') && (window.__audioStarts > 0 || document.querySelector('.playback-notice')));
  assert.ok(await page.locator('.is-playing').count() > 0);
  if (await page.locator('.playback-notice').count() === 0) {
    assert.ok(await page.evaluate(() => window.__audioStarts) > 0, 'Audible playback starts audio sources');
    // Silent runs (no audio output) return before loading any pack, so only audible playback reads them.
    assert.ok(assetPaths.includes('/pack.json'), 'Playback reads pack.json from the asset base');
    assert.ok(assetPaths.includes('/soundfonts/fluidr3/acoustic_grand_piano.json'), `The sample's piano comes from the pack: ${assetPaths.filter(path => path.startsWith('/soundfonts')).join(', ')}`);
  } else console.log(`${engine}: audio unavailable, reader playback ran silently`);
  await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
  const stopped = await page.evaluate(() => window.__audioStarts);
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => window.__audioStarts), stopped, 'Pause cancels future scheduling');
  await page.getByRole('button', { name: 'Stop playback', exact: true }).click();
  await page.getByRole('button', { name: 'Vertical view', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  await ready();
  assert.equal(await page.evaluate(() => document.querySelector('.topbar').scrollWidth <= document.querySelector('.topbar').clientWidth), true);
  await assertHeader(320, { modeText: ['V', 'E'], minTarget: 34 });
  await openMore();
  assert.equal(await page.evaluate(() => { const panel = document.querySelector('.header-secondary-panel').getBoundingClientRect(); return panel.left >= 0 && panel.right <= innerWidth; }), true, 'More panel fits a 320px viewport');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 320), true, 'No horizontal page overflow at 320px with More open');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.header-secondary-panel > .header-control')].filter(row => row.scrollWidth > row.clientWidth + 1 || [...row.querySelectorAll('*')].some(child => child.getBoundingClientRect().right > row.getBoundingClientRect().right + 1)).map(row => row.dataset.headerControl)), [], 'Every More panel row fits at 320px');
  await closeMore();
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.xml', mimeType: 'application/xml', buffer: Buffer.from('<broken') });
  await page.getByRole('alert').waitFor();
  assert.equal(await page.locator('svg .note').count(), 160, 'Invalid import preserves previous score');
  assert.deepEqual(errors, []);
  assert.deepEqual(remote, [], 'Scores and resources stay local');
  console.log(`${engine}: reader import, engraving, layout, annotations, fonts, mixer, persistence and playback passed`);

  // Vertical default: the largest stave scale at which four bars (or every bar of a shorter score) fit the first
  // system beside the staff controls, so Auto shows four per line. On compact devices the default is never below a
  // 40px staff (fewer bars per line instead). A user zoom replaces it (even below the floor); Endless keeps its default.
  const twoBars = `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Two bars</work-title></work><part-list><score-part id="P1"><part-name>Solo</part-name></score-part></part-list><part id="P1">${[1, 2].map(number => `<measure number="${number}">${number === 1 ? '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' : ''}${['C', 'D', 'E', 'F'].map(step => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`).join('')}</measure>`).join('')}</part></score-partwise>`;
  const fourEnsembleXml = await readFile(resolve(root, 'validation/fixtures/ensemble.musicxml'));
  const READABLE_STAFF = 40;
  for (const [width, height, endlessDefault] of [[1280, 800, '0.75'], [390, 844, '1'], [320, 640, '1']]) {
    const compact = width < 851;
    const fourContext = await browser.newContext({ viewport: { width, height } });
    const four = await fourContext.newPage();
    const fourErrors = [];
    four.on('pageerror', e => fourErrors.push(e.message));
    const fourReady = () => four.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg') && !document.querySelector('.score-content').getAnimations().length, { timeout: 30000 });
    const fourZoom = () => four.evaluate(() => document.querySelector('.score-content').dataset.staveScale);
    const fourHeader = async action => {
      const toggle = four.getByRole('button', { name: 'More controls', exact: true });
      if (await toggle.count() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      await action();
      if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'true') await four.keyboard.press('Escape');
    };
    // Bars per system, whether any system overflows the canvas, and the rendered staff of each system.
    const fourLayout = () => four.evaluate(() => {
      const canvas = document.querySelector('.score-staves').getBoundingClientRect();
      const view = document.querySelector('.score-viewport');
      const zoom = Number(document.querySelector('.score-content').dataset.staveScale);
      const systems = [...document.querySelectorAll('.score-system')].map(system => {
        const lines = [...system.querySelector('svg g.measure > g.staff').querySelectorAll(':scope > path')].slice(0, 5).map(line => line.getBoundingClientRect());
        return { bars: system.querySelectorAll('svg g.measure').length, overflow: system.getBoundingClientRect().right > canvas.right + 1 || system.getBoundingClientRect().left < canvas.left - 1, staff: Math.max(...lines.map(line => line.bottom)) - Math.min(...lines.map(line => line.top)) };
      });
      return { zoom, systems, scrolls: view.scrollWidth > view.clientWidth + 1 };
    });
    // Engines measure staff-line boxes slightly differently (Firefox includes more line thickness), so allow 3%.
    const drawnAt = (system, zoom) => Math.abs(system.staff - 72 * zoom) <= Math.max(1.5, 72 * zoom * .03);
    const label = `${width}px`;
    const fits = layout => layout.systems.every(system => !system.overflow) && !layout.scrolls;
    await four.goto(url);
    await fourReady();
    const sample = await fourLayout();
    assert.ok(sample.systems.length > 2, `${label}: the sample has several systems`);
    assert.ok(fits(sample), `${label}: default systems fit the viewport width (${JSON.stringify(sample)})`);
    assert.equal(await four.evaluate(() => [...document.querySelectorAll('.score-system')].every(system => system.querySelectorAll('svg g.system').length === 1)), true, `${label}: every sample line is one engraved system`);
    assert.ok(sample.systems.every(system => drawnAt(system, sample.zoom)), `${label}: every system is drawn at the default scale, none width-fitted (${JSON.stringify(sample)})`);
    if (compact) {
      assert.ok(sample.systems.every(system => system.staff >= READABLE_STAFF - .5 && system.bars <= 4), `${label}: the compact default keeps a readable staff, with up to four bars per line (${JSON.stringify(sample)})`);
    } else {
      assert.deepEqual(sample.systems.map(system => system.bars), sample.systems.map(() => 4), `${label}: the default shows four bars on every system (zoom ${sample.zoom})`);
    }
    // Endless keeps its device default; back in Vertical the Vertical default is re-resolved.
    await four.getByRole('button', { name: 'Endless view', exact: true }).click();
    await fourReady();
    assert.equal(await fourZoom(), endlessDefault, `${label}: Endless default stave scale is unchanged`);
    await four.getByRole('button', { name: 'Vertical view', exact: true }).click();
    await fourReady();
    assert.equal(Number(await fourZoom()), sample.zoom, `${label}: returning to Vertical restores the default`);
    // A user zoom replaces the default (on phones even below the readable floor), persists and is restored on reload.
    const chosen = sample.zoom > 1 ? .9 : .3;
    await fourHeader(async () => {
      const slider = four.getByRole('slider', { name: 'Stave scale', exact: true });
      await slider.fill(await onStep(slider, chosen));
    });
    await four.waitForFunction(value => document.querySelector('.score-content').dataset.staveScale === String(value), chosen, { timeout: 8000 });
    await fourReady();
    await four.reload();
    await fourReady();
    assert.equal(await fourZoom(), String(chosen), `${label}: a user stave scale is restored instead of the default`);
    // The default stave size depends on the viewport, not the score length: a two-bar score is drawn at the same scale
    // as the sample, on one shorter line (not stretched to fill the viewport).
    await four.locator('input[type=file]').setInputFiles({ name: 'two-bars.musicxml', mimeType: 'application/xml', buffer: Buffer.from(twoBars) });
    await four.waitForFunction(() => document.querySelector('h1')?.textContent === 'Two bars');
    await fourReady();
    const short = await fourLayout();
    const shortLines = await four.evaluate(() => ({ wrapped: [...document.querySelectorAll('.score-system')].some(system => system.querySelectorAll('svg g.system').length !== 1), width: document.querySelector('.score-system').getBoundingClientRect().width, canvas: document.querySelector('.score-staves').getBoundingClientRect().width }));
    assert.equal(short.zoom, sample.zoom, `${label}: a two-bar score defaults to the same stave scale as the sample`);
    assert.ok(fits(short), `${label}: the two-bar system fits the viewport width (${JSON.stringify(short)})`);
    // Every line is one engraved system (Verovio never wraps inside a line); on phones the 40px floor may leave one bar per line.
    assert.equal(shortLines.wrapped, false, `${label}: no line wraps inside its system (${JSON.stringify(short)})`);
    if (!compact) assert.deepEqual(short.systems.map(system => system.bars), [2], `${label}: a two-bar score shows both bars on one line (${JSON.stringify(short)})`);
    assert.ok(short.systems.every(system => drawnAt(system, short.zoom)), `${label}: the two-bar line is drawn at the default scale (${JSON.stringify(short)})`);
    if (!compact) assert.ok(shortLines.width < shortLines.canvas * .8, `${label}: the two-bar line is shorter than a full line (${JSON.stringify(shortLines)})`);
    // Five staves with lyrics: phones keep the readable floor (the stack scrolls); desktop fits four bars or the height.
    await four.locator('input[type=file]').setInputFiles({ name: 'ensemble.musicxml', mimeType: 'application/xml', buffer: fourEnsembleXml });
    await four.waitForFunction(() => document.querySelector('h1')?.textContent === 'Migration ensemble');
    await fourReady();
    const ensemble = await fourLayout();
    assert.ok(fits(ensemble), `${label}: ensemble systems fit the viewport width (${JSON.stringify(ensemble)})`);
    if (compact) {
      assert.ok(ensemble.zoom >= READABLE_STAFF / 72 - .001, `${label}: the ensemble default is not below the readable floor (${ensemble.zoom})`);
      // The first system beside the staff controls is still width-fitted when a single lyric bar cannot fit there.
      assert.ok(ensemble.systems.slice(1).every(system => system.staff >= READABLE_STAFF - .5), `${label}: later ensemble systems keep a readable staff (${JSON.stringify(ensemble)})`);
    } else assert.ok(ensemble.systems.every(system => system.bars <= 4), `${label}: the ensemble shows at most four bars per line (${JSON.stringify(ensemble)})`);
    assert.deepEqual(fourErrors, []);
    await fourContext.close();
  }
  console.log(`${engine}: four-bar Vertical default, compact readable floor, Endless default and user-zoom restore passed`);

  // Stave scale reflow (desktop): zoom is an absolute stave size, Verovio reflows at (width - gutter) / zoom.
  const deskContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const desk = await deskContext.newPage();
  const deskErrors = [];
  desk.on('pageerror', e => deskErrors.push(e.message));
  const deskReady = async () => {
    await desk.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg') && !document.querySelector('.score-content').getAnimations().length, { timeout: 30000 });
    assert.equal(await desk.locator('.ps-toast').count(), 0, await desk.locator('.ps-toast').allTextContents());
  };
  const deskSlider = () => desk.getByRole('slider', { name: 'Stave scale', exact: true });
  const deskCommitted = async zoom => { await desk.waitForFunction(value => document.querySelector('.score-content')?.dataset.staveScale === String(value), zoom, { timeout: 8000 }); await deskReady(); };
  const deskZoom = async zoom => { await deskSlider().fill(String(zoom)); await deskCommitted(zoom); };
  const deskStaff = () => desk.evaluate(() => {
    const lines = [...document.querySelector('.score-system:first-child svg g.measure > g.staff').querySelectorAll(':scope > path')].slice(0, 5).map(line => line.getBoundingClientRect());
    return Math.max(...lines.map(line => line.bottom)) - Math.min(...lines.map(line => line.top));
  });
  // Width, bar count and side gaps of each system, relative to the score canvas and the first system's gutter.
  const systemLayout = () => desk.evaluate(() => {
    const canvas = document.querySelector('.score-staves').getBoundingClientRect();
    const gutter = parseFloat(getComputedStyle(document.querySelector('.score-stage')).getPropertyValue('--control-gutter')) || 0;
    return [...document.querySelectorAll('.score-system')].map((system, index) => {
      const rect = system.getBoundingClientRect();
      const usable = canvas.width - (index === 0 ? gutter : 0);
      return { bars: system.querySelectorAll('svg g.measure').length, width: rect.width, usable, left: rect.left - canvas.left - (index === 0 ? gutter : 0), right: canvas.right - rect.right };
    });
  });
  await desk.goto(url);
  await deskReady();
  // The default stave scale is the four-bar fit (see the four-bar block below); the stave is drawn at that scale.
  const deskDefaultZoom = Number(await desk.evaluate(() => document.querySelector('.score-content').dataset.staveScale));
  const deskDefaultStaff = await deskStaff();
  assert.ok(Math.abs(deskDefaultStaff - 72 * deskDefaultZoom) <= Math.max(1.5, 72 * deskDefaultZoom * .03), `Desktop default stave is drawn at its stave scale ${deskDefaultZoom}: ${deskDefaultStaff}`);
  // Auto bars reflow: 50% fits more bars per line than 100%, and full systems fill the usable width.
  await deskZoom(1);
  const atFull = await systemLayout();
  await deskZoom(.5);
  const atHalf = await systemLayout();
  assert.ok(atHalf[1].bars > atFull[1].bars, `50% shows more bars per line than 100%: ${atHalf[1].bars} > ${atFull[1].bars}`);
  for (const layout of [atFull, atHalf]) for (const system of layout.slice(0, -1)) assert.ok(system.width >= system.usable * .9, `Systems fill the usable width: ${system.width.toFixed(0)} of ${system.usable.toFixed(0)}`);
  // Explicit bar counts keep their count and centre narrower systems.
  await desk.locator('[aria-label="Bars per line"]').selectOption('1');
  await deskReady();
  const explicit = await systemLayout();
  assert.ok(explicit.every(system => system.bars === 1), 'Explicit one bar per line');
  for (const system of explicit.slice(1)) {
    assert.ok(system.width < system.usable - 20, `Explicit systems are narrower than the viewport at 50%: ${system.width}`);
    assert.ok(Math.abs(system.left - system.right) <= 2, `Explicit systems are centred: ${system.left.toFixed(1)} vs ${system.right.toFixed(1)}`);
  }
  await desk.locator('[aria-label="Bars per line"]').selectOption('auto');
  await deskReady();
  await deskZoom(1);
  // The measure under the viewport centre, with its rendered rect.
  const centreMeasure = () => desk.evaluate(() => {
    const view = document.querySelector('.score-viewport').getBoundingClientRect();
    const cx = view.left + view.width / 2, cy = view.top + view.height / 2;
    const measures = [...document.querySelectorAll('.score-system svg g.measure')];
    const rects = measures.map(measure => measure.getBoundingClientRect());
    const distance = rect => Math.hypot(Math.max(rect.left - cx, 0, cx - rect.right), Math.max(rect.top - cy, 0, cy - rect.bottom));
    let index = 0;
    rects.forEach((rect, i) => { if (distance(rect) < distance(rects[index])) index = i; });
    return { index, cx, cy, rect: rects[index].toJSON() };
  });
  const anchorAfter = index => desk.evaluate(i => {
    const view = document.querySelector('.score-viewport').getBoundingClientRect();
    return { cx: view.left + view.width / 2, cy: view.top + view.height / 2, rect: document.querySelectorAll('.score-system svg g.measure')[i].getBoundingClientRect().toJSON() };
  }, index);
  // Watch for any loading overlay, paint reveal or score-content animation from here on.
  const watchPaint = () => desk.evaluate(() => {
    window.__sawPaint = [];
    const content = document.querySelector('.score-content');
    const check = () => {
      if (document.querySelector('.score-loading')) window.__sawPaint.push('loading');
      if (content.classList.contains('is-painting')) window.__sawPaint.push('is-painting');
      if (content.getAnimations().length) window.__sawPaint.push('animation');
    };
    window.__paintObserver?.disconnect();
    window.__paintObserver = new MutationObserver(check);
    window.__paintObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    const frame = () => { check(); window.__paintFrame = requestAnimationFrame(frame); };
    frame();
  });
  const sawPaint = () => desk.evaluate(() => { cancelAnimationFrame(window.__paintFrame); window.__paintObserver.disconnect(); return [...new Set(window.__sawPaint)]; });
  // Drag the slider: a live transform preview with no re-render until release, then a quiet in-place commit.
  await desk.locator('.score-viewport').evaluate(view => view.scrollTo({ top: view.scrollHeight / 2 - view.clientHeight / 2 }));
  await desk.waitForTimeout(100);
  const before = await centreMeasure();
  await desk.evaluate(() => { document.querySelector('.score-system svg').__marker = true; });
  await watchPaint();
  const track = await deskSlider().boundingBox();
  const ratio = value => (value - .2) / (4 - .2);
  const thumbX = value => track.x + 8 + ratio(value) * (track.width - 16);
  // Log slider pointer/input/change events so a drag failure explains itself.
  await desk.evaluate(() => {
    window.__sliderEvents = [];
    const input = document.querySelector('.header-stave-scale-input');
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture', 'mousedown', 'mouseup', 'input', 'change']) {
      document.addEventListener(type, event => {
        if (event.target !== input) return;
        const last = window.__sliderEvents.at(-1);
        const entry = `${type}:${input.value}`;
        if (type === 'pointermove' && last?.startsWith('pointermove')) window.__sliderEvents[window.__sliderEvents.length - 1] = entry; else window.__sliderEvents.push(entry);
      }, true);
    }
  });
  const sliderState = () => desk.evaluate(() => ({ value: document.querySelector('.header-stave-scale-input').value, label: document.querySelector('.header-stave-scale-value').textContent, committed: document.querySelector('.score-content').dataset.staveScale, transform: getComputedStyle(document.querySelector('.score-content')).transform, events: window.__sliderEvents }));
  await desk.mouse.move(thumbX(1), track.y + track.height / 2);
  await desk.mouse.down();
  for (let step = 1; step <= 6; step++) await desk.mouse.move(thumbX(1) + step * 4, track.y + track.height / 2);
  await desk.waitForTimeout(400);
  const dragging = await desk.evaluate(() => ({ transform: getComputedStyle(document.querySelector('.score-content')).transform, same: !!document.querySelector('.score-system svg').__marker, label: document.querySelector('.header-stave-scale-value').textContent, committed: document.querySelector('.score-content').dataset.staveScale }));
  const dragDiagnostics = `track ${JSON.stringify(track)}; ${JSON.stringify(await sliderState())}`;
  assert.notEqual(dragging.transform, 'none', `Dragging previews with a transform: ${dragDiagnostics}`);
  assert.equal(dragging.same, true, `No re-render while dragging: ${dragDiagnostics}`);
  assert.equal(dragging.committed, '1', `Zoom is not committed while dragging: ${dragDiagnostics}`);
  assert.notEqual(dragging.label, '100%', `The label follows the drag: ${dragDiagnostics}`);
  await desk.mouse.up();
  const released = Number(await deskSlider().inputValue());
  assert.ok(released > 1, `Drag raised the stave scale: ${released}; ${JSON.stringify(await sliderState())}`);
  await deskCommitted(released);
  assert.equal(await desk.evaluate(() => !!document.querySelector('.score-system svg').__marker), false, 'Release re-renders');
  assert.equal(await desk.evaluate(() => getComputedStyle(document.querySelector('.score-content')).transform), 'none', 'The preview transform is cleared after the commit');
  assert.deepEqual(await sawPaint(), [], 'A zoom commit shows no loading overlay and no paint reveal');
  const after = await anchorAfter(before.index);
  assert.ok(Math.abs(after.cy - (after.rect.top + after.rect.bottom) / 2) <= after.rect.height / 2 + 4, `Vertical: the anchor measure stays at the viewport centre (${JSON.stringify(after)})`);
  // Endless: the anchor bar stays within half a bar of the viewport centre.
  await desk.getByRole('button', { name: 'Endless view', exact: true }).click();
  await deskReady();
  await desk.locator('.score-viewport').evaluate(view => view.scrollTo({ left: view.scrollWidth / 2 - view.clientWidth / 2 }));
  await desk.waitForTimeout(100);
  const endlessBefore = await centreMeasure();
  await watchPaint();
  await deskZoom(.6);
  assert.deepEqual(await sawPaint(), [], 'Endless zoom commit shows no paint reveal');
  const endlessAfter = await anchorAfter(endlessBefore.index);
  assert.ok(Math.abs(endlessAfter.cx - (endlessAfter.rect.left + endlessAfter.rect.right) / 2) <= endlessAfter.rect.width, `Endless: the anchor bar stays within half a bar of the centre (${JSON.stringify(endlessAfter)})`);
  await desk.getByRole('button', { name: 'Vertical view', exact: true }).click();
  await deskReady();
  // Reloading the sample restores its zoom, even straight after the change (inside the write debounce);
  // a desktop zoom is not applied on a phone.
  await deskZoom(1.5);
  await desk.reload();
  await deskReady();
  assert.equal(await deskSlider().inputValue(), '1.5', 'Reloading the sample restores its stave scale');
  assert.ok(Math.abs(await deskStaff() - 72 * 1.5) <= 2, 'The restored scale is applied before paint');
  // A transposition is restored after an immediate reload too.
  await desk.getByRole('button', { name: 'Options', exact: true }).click();
  await desk.locator('.pitch-panel').getByRole('button', { name: 'Transpose up a semitone', exact: true }).click();
  await desk.locator('.semitone-control output', { hasText: '+1 semitones' }).waitFor();
  await desk.reload();
  await deskReady();
  assert.equal(await desk.locator('.semitone-control output').textContent(), '+1 semitones', 'An immediate reload restores the transposition');
  assert.equal(await deskSlider().inputValue(), '1.5', 'and keeps the stave scale');
  await desk.getByRole('button', { name: 'Options', exact: true }).click();
  await desk.getByRole('button', { name: 'Reset transposition', exact: true }).click();
  await desk.locator('button[aria-label="Close options"]').click();
  await deskReady();
  // Header transpose and key flip (secondary tier, inline on desktop) share the drawer's per-score settings.
  const headerReadout = desk.locator('.topbar .header-transpose-readout');
  const headerFlip = desk.locator('.topbar .header-key-flip-button');
  const drawerReadout = desk.locator('.pitch-panel .pitch-key-readout');
  const drawerFlip = desk.locator('.pitch-panel .pitch-key-flip');
  const flipState = async target => ({ label: await target.getAttribute('aria-label'), disabled: await target.getAttribute('aria-disabled'), text: await target.evaluate(button => [...button.querySelectorAll('span')].filter(span => span.getClientRects().length).map(span => span.textContent).join(' ')) });
  const deskChord = () => desk.evaluate(() => [...document.querySelector('.score-system svg .chord').querySelectorAll('.note')].map(note => note.getAttribute('data-pname')).sort().join(''));
  const headerBoxes = () => desk.evaluate(() => Object.fromEntries(['.stop-button', '.play-button', '.header-open-file', '.mode-toggle', '.header-transpose', '.header-key-flip-button', '.header-bars-setting', '.header-stave-scale', '.mixer-trigger'].map(selector => { const rect = document.querySelector(selector).getBoundingClientRect(); return [selector, [rect.left, rect.top, rect.width, rect.height].map(value => Math.round(value * 10) / 10)]; })));
  assert.equal(await headerReadout.textContent(), '0 · C', 'Header readout shows the untransposed key');
  assert.deepEqual(await flipState(headerFlip), { label: 'No enharmonic key to flip to', disabled: 'true', text: '⇄ C' }, 'The flip is disabled for C major');
  const boxesAtC = await headerBoxes();
  await headerFlip.click({ force: true });
  await desk.waitForTimeout(100);
  assert.equal(await headerReadout.textContent(), '0 · C', 'A disabled flip does nothing');
  await desk.locator('.topbar').getByRole('button', { name: 'Transpose up a semitone', exact: true }).click();
  await headerReadout.filter({ hasText: '+1 · Db' }).waitFor();
  await deskReady();
  assert.equal(await drawerReadout.textContent(), '+1 · Db', 'The drawer readout matches the header');
  assert.equal(await desk.locator('.semitone-control output').textContent(), '+1 semitones', 'The drawer transposition follows the header');
  assert.equal(await deskChord(), 'adf', 'Header + engraves Db-F-Ab');
  assert.deepEqual(await flipState(headerFlip), { label: 'Spell in C sharp major', disabled: 'false', text: '⇄ Db ↔ C#' }, 'The flip offers the enharmonic key');
  assert.deepEqual(await headerBoxes(), boxesAtC, 'A new readout and flip label do not move the header');
  await headerFlip.click();
  await headerReadout.filter({ hasText: '+1 · C#' }).waitFor();
  await deskReady();
  assert.deepEqual(await flipState(headerFlip), { label: 'Spell in D flat major', disabled: 'false', text: '⇄ C# ↔ Db' }, 'The flip offers the way back');
  assert.equal(await drawerReadout.textContent(), '+1 · C#', 'The drawer readout follows the flip');
  assert.equal(await drawerFlip.getAttribute('aria-label'), 'Spell in D flat major', 'The drawer flip matches the header');
  assert.deepEqual(await headerBoxes(), boxesAtC, 'Flipping does not move the header');
  assert.equal(await deskChord(), 'ceg', 'The flipped key engraves C#-E#-G#');
  // The flip is a per-score setting: it survives an immediate reload.
  await desk.reload();
  await deskReady();
  assert.equal(await headerReadout.textContent(), '+1 · C#', 'An immediate reload restores the key flip');
  assert.equal(await deskChord(), 'ceg', 'and engraves the flipped key');
  // The drawer flips back and transposes down, synced with the header.
  await desk.getByRole('button', { name: 'Options', exact: true }).click();
  await drawerFlip.click();
  await headerReadout.filter({ hasText: '+1 · Db' }).waitFor();
  await desk.locator('.pitch-panel').getByRole('button', { name: 'Transpose down a semitone', exact: true }).click();
  await headerReadout.filter({ hasText: '0 · C' }).waitFor();
  assert.equal(await drawerReadout.textContent(), '0 · C');
  await desk.locator('button[aria-label="Close options"]').click();
  await deskReady();
  const phone = await deskContext.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(url);
  await phone.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg') && !document.querySelector('.score-content').getAnimations().length, { timeout: 30000 });
  assert.notEqual(await phone.evaluate(() => document.querySelector('.score-content').dataset.staveScale), '1.5', 'A desktop-saved zoom is not applied at 390px');
  assert.ok(Math.abs(Number(await phone.evaluate(() => document.querySelector('.score-content').dataset.staveScale)) - 40 / 72) < .01, 'The phone uses its own readable default');
  await phone.close();
  assert.deepEqual(deskErrors, []);
  await deskContext.close();
  console.log(`${engine}: stave scale reflow, quiet zoom commits, anchoring and per-score memory passed`);

  // Rotation with many staves: a default (fit) zoom re-fits, a user zoom stays, and every staff stays reachable.
  const manyStaves = (() => {
    const parts = Array.from({ length: 12 }, (_, index) => `P${index + 1}`);
    const measures = number => `<measure number="${number}">${number === 1 ? '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' : ''}${['C', 'E', 'G', 'C'].map((step, beat) => `<note><pitch><step>${step}</step><octave>${beat === 3 ? 5 : 4}</octave></pitch><duration>1</duration><type>quarter</type></note>`).join('')}</measure>`;
    return `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Twelve staves</work-title></work><part-list>${parts.map(id => `<score-part id="${id}"><part-name>Staff ${id.slice(1)}</part-name></score-part>`).join('')}</part-list>${parts.map(id => `<part id="${id}">${Array.from({ length: 8 }, (_, index) => measures(index + 1)).join('')}</part>`).join('')}</score-partwise>`;
  })();
  const rotateContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: engine !== 'firefox' });
  const rot = await rotateContext.newPage();
  const rotErrors = [];
  rot.on('pageerror', e => rotErrors.push(e.message));
  const rotReady = () => rot.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg') && !document.querySelector('.score-content').getAnimations().length, { timeout: 30000 });
  const rotZoom = () => rot.evaluate(() => document.querySelector('.score-content').dataset.staveScale);
  const rotHeader = async action => {
    const toggle = rot.getByRole('button', { name: 'More controls', exact: true });
    if (await toggle.count() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await action();
    if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'true') await rot.keyboard.press('Escape');
  };
  // A rotation re-renders: wait for the engraved SVG to be replaced.
  const rotateTo = async (width, height) => {
    await rot.evaluate(() => { document.querySelector('.score-system svg').__beforeRotation = true; });
    await rot.setViewportSize({ width, height });
    await rot.waitForFunction(() => document.querySelector('.score-system svg') && !document.querySelector('.score-system svg').__beforeRotation, null, { timeout: 10000 });
    await rotReady();
  };
  // Every staff is inside the scrollable area: at scroll origin the first staff's top line is below the viewport top.
  const reachable = () => rot.evaluate(() => {
    const view = document.querySelector('.score-viewport');
    view.scrollTo({ top: 0, left: 0 });
    const staffTop = Math.min(...[...document.querySelector('.score-system svg g.measure > g.staff').querySelectorAll(':scope > path')].slice(0, 5).map(line => line.getBoundingClientRect().top));
    const title = document.querySelector('.score-meta h1')?.getBoundingClientRect();
    return { staffTop, viewTop: view.getBoundingClientRect().top, titleBottom: title?.bottom ?? -Infinity, titleTop: title?.top ?? Infinity, stack: document.querySelector('.score-system').getBoundingClientRect().height, viewHeight: view.clientHeight };
  });
  await rot.goto(url);
  await rotReady();
  await rot.locator('input[type=file]').setInputFiles({ name: 'twelve.musicxml', mimeType: 'application/xml', buffer: Buffer.from(manyStaves) });
  await rot.waitForFunction(() => document.querySelector('h1')?.textContent === 'Twelve staves' && document.querySelectorAll('.part-control').length === 12);
  await rotReady();
  await rot.getByRole('button', { name: 'Endless view', exact: true }).click();
  await rotReady();
  const portraitFit = await rotZoom();
  await rotateTo(844, 390);
  const landscapeFit = await rotZoom();
  assert.ok(Number(landscapeFit) < Number(portraitFit), `A default (fit) zoom re-fits on rotation: ${portraitFit} -> ${landscapeFit}`);
  const fitted = await reachable();
  assert.ok(fitted.staffTop >= fitted.viewTop, `Rotated default fit: every staff is reachable (${JSON.stringify(fitted)})`);
  assert.ok(fitted.stack <= fitted.viewHeight + 1, `Rotated default fit: the stack fits the viewport height (${JSON.stringify(fitted)})`);
  // The slider can show a fit below its usual minimum without clamping it up.
  const slider = await rot.evaluate(() => { const input = document.querySelector('.header-stave-scale-input'); return input && { min: Number(input.min), label: document.querySelector('.header-stave-scale-value').textContent }; });
  if (slider) {
    assert.ok(slider.min <= Number(landscapeFit) + 1e-9, `Slider minimum covers the fit: ${slider.min} <= ${landscapeFit}`);
    assert.equal(slider.label, `${Math.round(Number(landscapeFit) * 100)}%`, 'Slider label shows the fitted scale');
  }
  // A user zoom stays fixed through rotation, and a stack taller than the viewport is top-aligned, not cut off.
  await rotateTo(390, 844);
  await rotHeader(async () => { await rot.getByRole('slider', { name: 'Stave scale', exact: true }).fill('0.5'); await rot.waitForFunction(() => document.querySelector('.score-content').dataset.staveScale === '0.5', null, { timeout: 8000 }); });
  await rotReady();
  await rotateTo(844, 390);
  assert.equal(await rotZoom(), '0.5', 'A user zoom stays fixed on rotation');
  const tall = await reachable();
  assert.ok(tall.stack > tall.viewHeight, `The user zoom makes the stack taller than the viewport (${JSON.stringify(tall)})`);
  assert.ok(tall.staffTop >= tall.viewTop, `Tall Endless stack is top-aligned so the first staff is reachable (${JSON.stringify(tall)})`);
  assert.ok(tall.titleBottom <= tall.staffTop + 1, `The title does not overlap the first staff (${JSON.stringify(tall)})`);
  // Vertical keeps the same guarantee.
  await rot.getByRole('button', { name: 'Vertical view', exact: true }).click();
  await rotReady();
  const vertical = await reachable();
  assert.ok(vertical.staffTop >= vertical.viewTop, `Tall Vertical stack is reachable (${JSON.stringify(vertical)})`);
  assert.deepEqual(rotErrors, []);
  await rotateContext.close();
  console.log(`${engine}: rotation re-fits default zoom, keeps user zoom and keeps tall stacks reachable passed`);

  // System paging (Vertical): pages hold whole systems, overhang repeats systems only when a new one still fits,
  // and playback follows in page jumps without ping-pong.
  const pagingContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: engine !== 'firefox' });
  const pager = await pagingContext.newPage();
  const pagingErrors = [];
  pager.on('pageerror', e => pagingErrors.push(e.message));
  // Silent, wall-clock playback: an AudioContext that never resumes (same path as devices without audio).
  await pager.addInitScript(() => {
    Object.defineProperty(AudioContext.prototype, 'state', { configurable: true, get: () => 'suspended' });
    AudioContext.prototype.resume = () => new Promise(() => {});
  });
  const pagerReady = async () => {
    await pager.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg') && !document.querySelector('.score-content').getAnimations().length, { timeout: 30000 });
    assert.equal(await pager.locator('.ps-toast').count(), 0, await pager.locator('.ps-toast').allTextContents());
  };
  const pagerHeader = async action => {
    const toggle = pager.getByRole('button', { name: 'More controls', exact: true });
    if (await toggle.count() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await action();
    if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'true') await pager.keyboard.press('Escape');
  };
  const setOverhang = async value => {
    await pager.getByRole('button', { name: 'Options', exact: true }).click();
    await pager.locator('.drawer-panel input.ps-range').fill(String(value));
    const label = await pager.locator('.drawer-panel .field-label span').textContent();
    await pager.locator('button[aria-label="Close options"]').click();
    return label;
  };
  // Wait until the viewport has not scrolled for several frames.
  const settle = () => pager.evaluate(() => new Promise(resolve => {
    const view = document.querySelector('.score-viewport');
    let last = view.scrollTop, still = 0;
    const frame = () => { if (Math.abs(view.scrollTop - last) < .5) still++; else { still = 0; last = view.scrollTop; } if (still >= 8) resolve(view.scrollTop); else requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  }));
  const pageView = () => pager.evaluate(() => {
    const view = document.querySelector('.score-viewport');
    const rect = view.getBoundingClientRect();
    const top = rect.top + view.clientTop, bottom = top + view.clientHeight;
    return { scrollTop: view.scrollTop, height: view.clientHeight, systems: [...document.querySelectorAll('.score-system')].map(system => { const box = system.getBoundingClientRect(); return { top: box.top - top, bottom: box.bottom - top }; }) };
  });
  // What a page shows: whole systems, at most a blank sliver of the previous one on top and one cut-off system below.
  const PAD = 8;
  const checkPage = (view, label) => {
    const whole = [];
    let cut = 0;
    view.systems.forEach((system, index) => {
      if (system.bottom <= 0 || system.top >= view.height) return;
      if (system.top < -1) assert.ok(system.bottom <= PAD + 1, `${label}: no system is cut at the top (${index}: ${JSON.stringify(system)})`);
      else if (system.bottom > view.height + 1) cut++;
      else whole.push(index);
    });
    assert.ok(cut <= 1, `${label}: at most the next system is cut off at the bottom`);
    return whole;
  };
  // Page down to the end, checking every page; then page up back through the same starts.
  const walkPages = async label => {
    await pager.locator('.score-viewport').evaluate(view => view.scrollTo({ top: 0 }));
    await settle();
    const pages = [];
    for (let guard = 0; guard < 60; guard++) {
      const view = await pageView();
      const whole = checkPage(view, `${label} page ${pages.length + 1}`);
      if (pages.length) {
        assert.ok(whole.length > 0, `${label} page ${pages.length + 1} shows a whole system`);
        const top = view.systems[whole[0]].top;
        assert.ok(top >= 0 && top <= PAD + 1, `${label} page ${pages.length + 1}: the viewport top aligns to a system top (${top.toFixed(1)})`);
      }
      pages.push({ scrollTop: view.scrollTop, whole, systems: view.systems, height: view.height });
      await pager.keyboard.press('PageDown');
      const next = await settle();
      if (Math.abs(next - view.scrollTop) < 1) break;
      assert.ok(next > view.scrollTop, `${label}: page down moves down`);
    }
    const last = pages.at(-1);
    assert.ok(last.whole.includes(last.systems.length - 1), `${label}: paging reaches the last system`);
    for (let index = pages.length - 2; index >= 0; index--) {
      await pager.keyboard.press('PageUp');
      const top = await settle();
      assert.ok(Math.abs(top - pages[index].scrollTop) <= 1.5, `${label}: page up returns to the previous page start (${top} vs ${pages[index].scrollTop})`);
    }
    return pages;
  };
  // Overhang: consecutive pages repeat the previous page's last system when a new whole system still fits after it.
  const overhangs = (pages, overlap) => pages.slice(1).map((page, index) => {
    const previous = pages[index];
    const repeated = page.whole[0] === previous.whole.at(-1);
    const systems = page.systems;
    if (repeated) assert.ok(page.whole.at(-1) > previous.whole.at(-1), 'An overhang page still shows a new whole system');
    else {
      assert.equal(page.whole[0], previous.whole.at(-1) + 1, 'Without overhang the next page starts at the next system');
      const repeat = previous.whole.at(-1), next = page.whole[0];
      if (overlap > 0) assert.ok(systems[next].bottom - (systems[repeat].top - PAD) > page.height, 'Overhang is dropped only when no new system would fit');
    }
    return repeated;
  });
  const twelve = (() => {
    const parts = Array.from({ length: 12 }, (_, index) => `P${index + 1}`);
    const measure = number => `<measure number="${number}">${number === 1 ? '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' : ''}${['C', 'E', 'G', 'C'].map((step, beat) => `<note><pitch><step>${step}</step><octave>${beat === 3 ? 5 : 4}</octave></pitch><duration>1</duration><type>quarter</type></note>`).join('')}</measure>`;
    return `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Twelve paged staves</work-title></work><part-list>${parts.map(id => `<score-part id="${id}"><part-name>Staff ${id.slice(1)}</part-name></score-part>`).join('')}</part-list>${parts.map(id => `<part id="${id}">${Array.from({ length: 16 }, (_, index) => measure(index + 1)).join('')}</part>`).join('')}</score-partwise>`;
  })();
  await pager.goto(url);
  await pagerReady();
  assert.equal(await setOverhang(1), '1 system', 'Vertical overhang is counted in systems');
  assert.equal(await setOverhang(2), '2 systems');
  await pager.getByRole('button', { name: 'Endless view', exact: true }).click();
  await pagerReady();
  assert.equal(await setOverhang(1), '1 bar', 'Endless overhang stays in bars');
  await pager.getByRole('button', { name: 'Vertical view', exact: true }).click();
  await pagerReady();
  // Twelve staves at 25%: one system nearly fills the viewport, so overhang is always dropped.
  await pager.locator('input[type=file]').setInputFiles({ name: 'twelve-paged.musicxml', mimeType: 'application/xml', buffer: Buffer.from(twelve) });
  await pager.waitForFunction(() => document.querySelector('h1')?.textContent === 'Twelve paged staves' && document.querySelectorAll('.part-control').length === 12);
  await pagerHeader(() => pager.locator('[aria-label="Bars per line"]').selectOption('2'));
  await pagerReady();
  await pagerHeader(async () => { await pager.getByRole('slider', { name: 'Stave scale', exact: true }).fill('0.25'); await pager.waitForFunction(() => document.querySelector('.score-content').dataset.staveScale === '0.25', null, { timeout: 8000 }); });
  await pagerReady();
  const twelvePages = await walkPages('Twelve staves');
  assert.ok(twelvePages.length >= 4, `Twelve staves spans several pages (${twelvePages.length})`);
  assert.ok(twelvePages.slice(1).every(page => page.systems[page.whole[0]].bottom - page.systems[page.whole[0]].top > page.height / 2), 'One twelve-staff system nearly fills a page');
  assert.ok(overhangs(twelvePages, 1).every(repeated => !repeated), 'Overhang is dropped when no new system would fit');
  // Ensemble at a zoom where two systems fit: overhang 1 repeats the previous page's last system.
  await pager.locator('input[type=file]').setInputFiles(resolve(root, 'validation/fixtures/ensemble.musicxml'));
  await pager.waitForFunction(() => document.querySelector('h1')?.textContent === 'Migration ensemble');
  await pagerReady();
  await pagerHeader(async () => { await pager.getByRole('slider', { name: 'Stave scale', exact: true }).fill('0.35'); await pager.waitForFunction(() => document.querySelector('.score-content').dataset.staveScale === '0.35', null, { timeout: 8000 }); });
  await pagerReady();
  // One bar per line gives eight short systems, so playback turns a page every bar or two.
  await pagerHeader(() => pager.locator('[aria-label="Bars per line"]').selectOption('1'));
  await pagerReady();
  const ensemblePages = await walkPages('Ensemble overhang 1');
  assert.ok(ensemblePages.slice(1).some(page => page.whole.length >= 2), 'Two ensemble systems fit a page at this zoom');
  assert.ok(overhangs(ensemblePages, 1).some(repeated => repeated), 'Overhang 1 repeats the previous page’s last system');
  await setOverhang(0);
  assert.ok(overhangs(await walkPages('Ensemble overhang 0'), 0).every(repeated => !repeated), 'Overhang 0 never repeats a system');
  await setOverhang(1);
  // Manual scrolling between page starts: next is the first page start below, previous the last one above.
  await pager.locator('.score-viewport').evaluate((view, top) => view.scrollTo({ top }), (ensemblePages[1].scrollTop + ensemblePages[2].scrollTop) / 2);
  await settle();
  await pager.keyboard.press('PageDown');
  assert.ok(Math.abs(await settle() - ensemblePages[2].scrollTop) <= 1.5, 'From between pages, next goes to the page start below');
  await pager.locator('.score-viewport').evaluate((view, top) => view.scrollTo({ top }), (ensemblePages[1].scrollTop + ensemblePages[2].scrollTop) / 2);
  await settle();
  await pager.keyboard.press('PageUp');
  assert.ok(Math.abs(await settle() - ensemblePages[1].scrollTop) <= 1.5, 'From between pages, previous goes to the page start above');
  // A turn that has landed is no longer in flight: scrolling away straight after it (here within the 900 ms a smooth
  // scroll may take) and turning again starts from where the reader is, not from where the earlier turn went.
  await pager.keyboard.press('PageUp');
  assert.ok(Math.abs(await settle() - ensemblePages[0].scrollTop) <= 1.5, 'Page up from the second page returns to the first');
  await pager.locator('.score-viewport').evaluate((view, top) => view.scrollTo({ top }), (ensemblePages[1].scrollTop + ensemblePages[2].scrollTop) / 2);
  await pager.keyboard.press('PageDown');
  const afterLanded = await settle();
  assert.ok(Math.abs(afterLanded - ensemblePages[2].scrollTop) <= 1.5, `Right after a landed turn, next still goes to the page start below the reader (${afterLanded} vs ${ensemblePages[2].scrollTop}; starts ${ensemblePages.map(page => page.scrollTop)})`);
  // Playback follow: sample every frame; the view only moves forward between page starts, and the line stays in view.
  const followPlayback = async (label, starts, seconds) => {
    await pager.locator('.score-viewport').evaluate(view => view.scrollTo({ top: 0 }));
    await settle();
    await pager.evaluate(() => {
      window.__follow = [];
      const view = document.querySelector('.score-viewport');
      const frame = () => {
        const rect = view.getBoundingClientRect(), top = rect.top + view.clientTop, bottom = top + view.clientHeight;
        const line = document.querySelector('.playback-line')?.getBoundingClientRect();
        window.__follow.push({ t: performance.now(), top: view.scrollTop, line: !!line, visible: !!line && line.top >= top - 1 && line.bottom <= bottom + 1 });
        window.__followFrame = requestAnimationFrame(frame);
      };
      frame();
    });
    await pager.getByRole('button', { name: 'Play score', exact: true }).click();
    await pager.waitForTimeout(seconds * 1000);
    const samples = await pager.evaluate(() => { cancelAnimationFrame(window.__followFrame); return window.__follow.filter(sample => sample.line); });
    await pager.getByRole('button', { name: 'Stop playback', exact: true }).click();
    assert.ok(samples.length > seconds * 20, `${label}: sampled playback frames (${samples.length})`);
    for (let index = 1; index < samples.length; index++) assert.ok(samples[index].top >= samples[index - 1].top - .5, `${label}: scroll only moves forward (${samples[index - 1].top} -> ${samples[index].top})`);
    // Settled positions (held for 5+ frames) are page starts, one per page traversed.
    const settled = [];
    for (let index = 0, run = 0; index < samples.length; index++) {
      run = index && Math.abs(samples[index].top - samples[index - 1].top) < .5 ? run + 1 : 0;
      if (run === 4 && !settled.some(top => Math.abs(top - samples[index].top) < 2)) settled.push(samples[index].top);
    }
    for (const top of settled) assert.ok(starts.some(start => Math.abs(start - top) <= 1.5), `${label}: playback rests on page starts (${top} not in ${starts})`);
    const traversed = starts.filter(start => start >= settled[0] - 1.5 && start <= settled.at(-1) + 1.5).length;
    assert.ok(settled.length >= 3, `${label}: playback turned pages (${settled})`);
    assert.ok(settled.length <= traversed + 1, `${label}: no extra scroll positions (${settled.length} for ${traversed} pages: ${settled} vs ${starts})`);
    // The line leaves the view only while a page turn scrolls, never for long.
    let longest = 0;
    for (let index = 0, since = null; index < samples.length; index++) {
      if (samples[index].visible) since = null; else { since ??= samples[index].t; longest = Math.max(longest, samples[index].t - since); }
    }
    assert.ok(longest < 1200, `${label}: the playback line is out of view only during a page turn (${longest.toFixed(0)}ms)`);
    assert.ok(samples.filter(sample => sample.visible).length >= samples.length * .8, `${label}: the playback line stays in view`);
  };
  await pagerHeader(() => pager.locator('.bpm-control input').fill('240'));
  await followPlayback('Ensemble playback', ensemblePages.map(page => page.scrollTop), 6);
  await pager.locator('input[type=file]').setInputFiles({ name: 'twelve-paged.musicxml', mimeType: 'application/xml', buffer: Buffer.from(twelve) });
  await pager.waitForFunction(() => document.querySelector('h1')?.textContent === 'Twelve paged staves');
  await pagerReady();
  await pagerHeader(() => pager.locator('.bpm-control input').fill('240'));
  await followPlayback('Twelve-staff playback', twelvePages.map(page => page.scrollTop), 7);
  // A reader who scrolls during playback keeps their view; follow resumes afterwards.
  await pager.getByRole('button', { name: 'Play score', exact: true }).click();
  await pager.waitForFunction(() => document.querySelector('.score-viewport').scrollTop > 0, null, { timeout: 15000 });
  await settle();
  const box = await pager.locator('.score-viewport').boundingBox();
  await pager.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pager.mouse.wheel(0, -120);
  const scrolled = await settle();
  await pager.waitForTimeout(1200);
  assert.ok(Math.abs(await pager.evaluate(() => document.querySelector('.score-viewport').scrollTop) - scrolled) <= 1, 'Follow waits after a manual scroll');
  await pager.waitForFunction(() => {
    const view = document.querySelector('.score-viewport'), line = document.querySelector('.playback-line')?.getBoundingClientRect(), rect = view.getBoundingClientRect();
    return line && line.top >= rect.top + view.clientTop - 1 && line.bottom <= rect.top + view.clientTop + view.clientHeight + 1;
  }, null, { timeout: 6000 });
  await pager.getByRole('button', { name: 'Stop playback', exact: true }).click();
  // At the phone default (a readable 40px staff) a twelve-staff system is taller than the viewport, as with Cielito:
  // turns step through it, overlapping a little, then continue at the next system's top, so all of every system is shown.
  await pager.locator('input[type=file]').setInputFiles({ name: 'twelve-tall.musicxml', mimeType: 'application/xml', buffer: Buffer.from(twelve.replace('Twelve paged staves', 'Twelve tall staves')) });
  await pager.waitForFunction(() => document.querySelector('h1')?.textContent === 'Twelve tall staves');
  await pagerReady();
  await pager.locator('.score-viewport').evaluate(view => view.scrollTo({ top: 0 }));
  await settle();
  const tallViews = [await pageView()];
  assert.ok(tallViews[0].systems[0].bottom - tallViews[0].systems[0].top > tallViews[0].height, 'A twelve-staff system at the phone default is taller than the viewport');
  for (let guard = 0; guard < 80; guard++) {
    await pager.keyboard.press('PageDown');
    const top = await settle();
    if (Math.abs(top - tallViews.at(-1).scrollTop) < 1) break;
    tallViews.push(await pageView());
  }
  const tallSystems = tallViews[0].systems.map(system => ({ top: system.top + tallViews[0].scrollTop, bottom: system.bottom + tallViews[0].scrollTop }));
  for (let index = 1; index < tallViews.length; index++) {
    const [previous, view] = [tallViews[index - 1], tallViews[index]];
    assert.ok(view.scrollTop - previous.scrollTop < view.height - 8, `Tall paging overlaps consecutive views (${previous.scrollTop} -> ${view.scrollTop})`);
    const containing = tallSystems.findIndex(system => system.top < view.scrollTop - 1 && system.bottom > view.scrollTop + 1);
    const aligned = tallSystems.some(system => system.top - view.scrollTop >= 0 && system.top - view.scrollTop <= PAD + 1);
    assert.ok(aligned || containing >= 0, `Each tall page starts at a system top or inside a tall system (${view.scrollTop})`);
  }
  // Every system top is shown at a page top, and every system bottom is shown in some view.
  for (const system of tallSystems) {
    assert.ok(tallViews.some(view => system.top - view.scrollTop >= -1 && system.top - view.scrollTop <= PAD + 1), `Tall paging stops at each system top (${system.top})`);
    assert.ok(tallViews.some(view => system.bottom - view.scrollTop <= view.height + 1 && system.bottom - view.scrollTop > 0), `Tall paging shows each system bottom (${system.bottom})`);
  }
  // Tall playback: the view pages forward only, and some of the playback line is always in view but for a page turn.
  await pager.locator('.score-viewport').evaluate(view => view.scrollTo({ top: 0 }));
  await settle();
  await pager.evaluate(() => {
    window.__tall = [];
    const view = document.querySelector('.score-viewport');
    const frame = () => {
      const rect = view.getBoundingClientRect(), top = rect.top + view.clientTop, bottom = top + view.clientHeight;
      const line = document.querySelector('.playback-line')?.getBoundingClientRect();
      if (line) window.__tall.push({ t: performance.now(), top: view.scrollTop, visible: line.bottom > top + 1 && line.top < bottom - 1 });
      window.__tallFrame = requestAnimationFrame(frame);
    };
    frame();
  });
  await pager.getByRole('button', { name: 'Play score', exact: true }).click();
  await pager.waitForTimeout(7000);
  const tallSamples = await pager.evaluate(() => { cancelAnimationFrame(window.__tallFrame); return window.__tall; });
  await pager.getByRole('button', { name: 'Stop playback', exact: true }).click();
  assert.ok(tallSamples.at(-1).top > tallSamples[0].top, 'Tall playback pages on to later systems');
  for (let index = 1; index < tallSamples.length; index++) assert.ok(tallSamples[index].top >= tallSamples[index - 1].top - .5, `Tall playback only scrolls forward (${tallSamples[index - 1].top} -> ${tallSamples[index].top})`);
  let tallGap = 0;
  for (let index = 0, since = null; index < tallSamples.length; index++) {
    if (tallSamples[index].visible) since = null; else { since ??= tallSamples[index].t; tallGap = Math.max(tallGap, tallSamples[index].t - since); }
  }
  assert.ok(tallGap < 1200, `Tall playback keeps the line in view but for a page turn (${tallGap.toFixed(0)}ms)`);
  // Endless follow only moves forward too.
  await pager.getByRole('button', { name: 'Endless view', exact: true }).click();
  await pagerReady();
  await pager.evaluate(() => {
    window.__lefts = [];
    const view = document.querySelector('.score-viewport');
    const frame = () => { if (document.querySelector('.playback-line')) window.__lefts.push(view.scrollLeft); window.__leftFrame = requestAnimationFrame(frame); };
    frame();
  });
  await pager.getByRole('button', { name: 'Play score', exact: true }).click();
  await pager.waitForTimeout(6000);
  const lefts = await pager.evaluate(() => { cancelAnimationFrame(window.__leftFrame); return window.__lefts; });
  await pager.getByRole('button', { name: 'Stop playback', exact: true }).click();
  assert.ok(lefts.at(-1) > lefts[0], 'Endless playback scrolls along');
  for (let index = 1; index < lefts.length; index++) assert.ok(lefts[index] >= lefts[index - 1] - .5, `Endless follow only moves forward (${lefts[index - 1]} -> ${lefts[index]})`);
  assert.deepEqual(pagingErrors, []);
  await pagingContext.close();
  console.log(`${engine}: system paging, overhang and page-jump playback follow passed`);

  // Silent fallback: an AudioContext that never resumes must not hang playback.
  const silentContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const silent = await silentContext.newPage();
  const silentErrors = [];
  silent.on('pageerror', e => silentErrors.push(e.message));
  await silent.addInitScript(() => {
    window.__audioStarts = 0;
    Object.defineProperty(AudioContext.prototype, 'state', { configurable: true, get: () => 'suspended' });
    AudioContext.prototype.resume = () => new Promise(() => {});
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) { window.__audioStarts++; return start.apply(this, args); };
  });
  await silent.goto(url);
  await silent.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg') && !document.querySelector('.score-content').getAnimations().length, { timeout: 30000 });
  const lineLeft = () => silent.evaluate(() => parseFloat(document.querySelector('.playback-line')?.style.left ?? 'NaN'));
  await silent.getByRole('button', { name: 'Play score', exact: true }).click();
  await silent.locator('.playback-notice').waitFor({ timeout: 5000 });
  assert.match(await silent.locator('.playback-notice').textContent(), /playing silently/);
  assert.equal(await silent.locator('.ps-toast').count(), 0, 'Silent fallback is a notice, not an error toast');
  await silent.waitForFunction(() => document.querySelector('.is-playing') && document.querySelector('.playback-line'), { timeout: 5000 });
  const firstLeft = await lineLeft();
  await silent.waitForFunction(first => parseFloat(document.querySelector('.playback-line')?.style.left ?? 'NaN') > first, firstLeft, { timeout: 5000 });
  await silent.getByRole('button', { name: 'Pause playback', exact: true }).click();
  await silent.getByRole('button', { name: 'Play score', exact: true }).waitFor();
  const pausedLeft = await lineLeft();
  await silent.waitForTimeout(800);
  assert.equal(await lineLeft(), pausedLeft, 'Pause freezes the silent playhead');
  await silent.getByRole('button', { name: 'Play score', exact: true }).click();
  await silent.waitForFunction(paused => parseFloat(document.querySelector('.playback-line')?.style.left ?? 'NaN') > paused, pausedLeft, { timeout: 5000 });
  await silent.getByRole('button', { name: 'Stop playback', exact: true }).click();
  await silent.getByRole('button', { name: 'Play score', exact: true }).waitFor();
  assert.equal(await silent.locator('.playback-line').count(), 0, 'Stop clears the silent playhead');
  assert.equal(await silent.locator('.is-playing').count(), 0, 'Stop clears silent highlights');
  assert.equal(await silent.evaluate(() => window.__audioStarts), 0, 'Silent playback schedules no audio');
  assert.deepEqual(silentErrors, []);
  await silentContext.close();
  console.log(`${engine}: silent playback fallback passed`);

  // Real-world exports (e.g. Sibelius) carry no note IDs and open with a multi-measure rest whose first bar holds
  // only directions and second only a <forward>. Every source measure must engrave, every event must map to its
  // engraved note, and the playhead must move through the empty intro before highlighting the first note.
  // TimGM6mb fallback: with a pack.json that lists no FluidR3 sounds, every melodic part plays through the SF2, and
  // parts on different programs share one download and parse of it.
  const sf2Context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const sf2 = await sf2Context.newPage();
  const sf2Errors = [], sf2Requests = [];
  sf2.on('pageerror', e => sf2Errors.push(e.message));
  sf2.on('request', r => sf2Requests.push(new URL(r.url()).pathname));
  await sf2.route('**/pack.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ pack: 'core', fluidr3: [] }) }));
  await sf2.addInitScript(() => {
    window.__audioStarts = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) { window.__audioStarts++; return start.apply(this, args); };
    // Every read of the soundfont bytes, including re-reads through a blob: URL, which the request listener can miss.
    window.__sf2Reads = 0;
    const fetchNative = window.fetch;
    window.fetch = function (input, ...rest) { const href = String(input instanceof Request ? input.url : input); if (href.endsWith('.sf2') || href.startsWith('blob:')) window.__sf2Reads++; return fetchNative.call(this, input, ...rest); };
  });
  const sf2Part = (id, name, program) => ({ list: `<score-part id="${id}"><part-name>${name}</part-name><midi-instrument id="${id}-I1"><midi-channel>${id === 'P1' ? 1 : 2}</midi-channel><midi-program>${program}</midi-program></midi-instrument></score-part>`, body: `<part id="${id}"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${['C', 'E', 'G', 'C'].map(step => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`).join('')}</measure></part>` });
  const sf2Parts = [sf2Part('P1', 'Oboe', 69), sf2Part('P2', 'Horn', 61)];
  const sf2Score = `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Fallback duet</work-title></work><part-list>${sf2Parts.map(part => part.list).join('')}</part-list>${sf2Parts.map(part => part.body).join('')}</score-partwise>`;
  await sf2.goto(url);
  await sf2.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg'), undefined, { timeout: 30000 });
  await sf2.locator('input[type=file]').setInputFiles({ name: 'fallback-duet.musicxml', mimeType: 'application/xml', buffer: Buffer.from(sf2Score) });
  await sf2.waitForFunction(() => document.querySelector('h1')?.textContent === 'Fallback duet');
  await sf2.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg'), undefined, { timeout: 30000 });
  await sf2.getByRole('button', { name: 'Play score', exact: true }).click();
  await sf2.waitForFunction(() => window.__audioStarts > 0 || document.querySelector('.playback-notice') || document.querySelector('.ps-toast'), undefined, { timeout: 30000 });
  assert.equal(await sf2.locator('.ps-toast').count(), 0, await sf2.locator('.ps-toast').allTextContents());
  if (await sf2.locator('.playback-notice').count() === 0) {
    assert.ok(await sf2.evaluate(() => window.__audioStarts) > 0, 'TimGM6mb fallback parts start audio sources');
    assert.equal(sf2Requests.filter(path => path === '/soundfonts/TimGM6mb.sf2').length, 1, 'Two TimGM6mb parts on different programs download the soundfont once');
    assert.equal(await sf2.evaluate(() => window.__sf2Reads), 1, 'Two TimGM6mb parts read (and parse) the soundfont bytes once');
    assert.ok(!sf2Requests.some(path => path.startsWith('/soundfonts/fluidr3/')), `No FluidR3 pack is loaded when pack.json lists none: ${sf2Requests.filter(path => path.startsWith('/soundfonts/')).join(', ')}`);
    console.log(`${engine}: TimGM6mb fallback shares one soundfont download passed`);
  } else console.log(`${engine}: audio unavailable, TimGM6mb fallback check skipped`);
  assert.deepEqual(sf2Errors, []);
  await sf2Context.close();

  const idlessContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const idless = await idlessContext.newPage();
  const idlessErrors = [];
  idless.on('pageerror', e => idlessErrors.push(e.message));
  // Silent wall-clock playback: deterministic timing without loading soundfonts.
  await idless.addInitScript(() => {
    Object.defineProperty(AudioContext.prototype, 'state', { configurable: true, get: () => 'suspended' });
    AudioContext.prototype.resume = () => new Promise(() => {});
  });
  await idless.goto(url);
  await idless.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg') && !document.querySelector('.score-content').getAnimations().length, undefined, { timeout: 30000 });
  await idless.locator('input[type=file]').setInputFiles(resolve(root, 'validation/fixtures/idless-sibelius.musicxml'));
  await idless.waitForFunction(() => document.querySelector('h1')?.textContent === 'ID-less export');
  await idless.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg') && !document.querySelector('.score-content').getAnimations().length, undefined, { timeout: 30000 });
  assert.equal(await idless.locator('.ps-toast').count(), 0, await idless.locator('.ps-toast').allTextContents());
  assert.equal(await idless.locator('svg g.measure').count(), 5, 'Each source measure engraves, including both bars of the multi-measure rest');
  assert.equal(await idless.locator('svg .multiRest').count(), 0, 'Multi-measure rests are expanded to one bar per source measure');
  // 9 events: C3, E3, G3 (tied) | G3, A2+E3 chord, rest, C2 (voice 2) | grace E2, F2.
  assert.equal(await idless.locator('svg .reader-note').count(), 9, 'Every source event maps to its engraved note');
  assert.equal(await idless.locator('svg .chord.reader-note').count(), 1, 'The chord maps as one event');
  assert.deepEqual(await idless.evaluate(() => [...document.querySelectorAll('svg .reader-note')].map(note => note.closest('g.measure') && [...document.querySelectorAll('svg g.measure')].indexOf(note.closest('g.measure')))), [2, 2, 2, 3, 3, 3, 3, 4, 4], 'Notes map into their own source measures after the intro rest');
  // Record the playhead and the first highlight as they happen.
  await idless.evaluate(() => {
    window.__idless = { linesBeforeNote: [], firstPlaying: null };
    new MutationObserver(() => {
      const playing = document.querySelector('.reader-note.is-playing');
      if (playing && !window.__idless.firstPlaying) window.__idless.firstPlaying = { noteId: playing.getAttribute('data-note-id'), id: playing.id, pname: playing.getAttribute('data-pname'), oct: playing.getAttribute('data-oct') };
      const line = document.querySelector('.playback-line');
      if (line && !window.__idless.firstPlaying) window.__idless.linesBeforeNote.push(parseFloat(line.style.left));
    }).observe(document.querySelector('.score-content'), { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  });
  await idless.getByRole('button', { name: 'Play score', exact: true }).click();
  await idless.waitForFunction(() => document.querySelector('.playback-line') && !document.querySelector('.is-playing'), undefined, { timeout: 5000 });
  const introLeft = await idless.evaluate(() => parseFloat(document.querySelector('.playback-line').style.left));
  await idless.waitForFunction(first => !document.querySelector('.is-playing') && parseFloat(document.querySelector('.playback-line')?.style.left ?? 'NaN') > first, introLeft, { timeout: 5000 });
  await idless.waitForFunction(() => window.__idless.firstPlaying, undefined, { timeout: 10000 });
  const { linesBeforeNote, firstPlaying } = await idless.evaluate(() => window.__idless);
  assert.ok(new Set(linesBeforeNote).size > 2, `The playhead moves through the empty intro: ${linesBeforeNote.length} positions`);
  // The timeline's first sounding event is the first note of source bar 3 (C3); its engraved element keeps the ID injected into the engraving copy.
  assert.deepEqual(firstPlaying, { noteId: 'P1-1-2-0', id: 'mx_p1_m3_n1', pname: 'c', oct: '3' }, 'The first highlight lands on the first sounding note');
  await idless.getByRole('button', { name: 'Stop playback', exact: true }).click();
  await idless.getByRole('button', { name: 'Play score', exact: true }).waitFor();
  assert.equal(await idless.locator('.playback-line').count(), 0, 'Stop clears the playhead');
  assert.deepEqual(idlessErrors, []);
  await idlessContext.close();
  console.log(`${engine}: ID-less MusicXML with a multi-measure rest intro passed`);

  // Open dialog: outlined header button, format guide, pasted ABC, dropped files and folders.
  const openContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const opener = await openContext.newPage();
  const openErrors = [];
  opener.on('pageerror', e => openErrors.push(e.message));
  const openReady = async () => {
    await opener.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg') && !document.querySelector('.score-content').getAnimations().length, { timeout: 30000 });
    assert.equal(await opener.locator('.ps-toast').count(), 0, await opener.locator('.ps-toast').allTextContents());
  };
  const openButton = () => opener.locator('.header-open-file');
  const dialog = () => opener.getByRole('dialog', { name: 'Open a score' });
  // Simulates a drop with File and Directory Entries API mocks; nodes are { name, text } files or { name, children } folders.
  const dropIntoDialog = (nodes, types = ['dragenter', 'dragover', 'drop']) => opener.evaluate(({ nodes, types }) => {
    const makeFile = node => new File([node.text], node.name);
    const toEntry = (node, parent) => {
      const fullPath = `${parent}/${node.name}`;
      if (!node.children) return { isFile: true, isDirectory: false, name: node.name, fullPath, file: ok => setTimeout(() => ok(makeFile(node))) };
      return { isFile: false, isDirectory: true, name: node.name, fullPath, createReader() { let done = false; return { readEntries(ok) { const out = done ? [] : node.children.map(child => toEntry(child, fullPath)); done = true; setTimeout(() => ok(out)); } }; } };
    };
    const entries = nodes.map(node => toEntry(node, ''));
    const dataTransfer = { types: ['Files'], items: entries.map(entry => ({ kind: 'file', webkitGetAsEntry: () => entry })), files: nodes.filter(node => !node.children).map(makeFile), dropEffect: 'none' };
    const target = document.querySelector('.open-dialog-abc-input');
    for (const type of types) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      target.dispatchEvent(event);
    }
  }, { nodes, types });
  await opener.goto(url);
  await openReady();
  const outline = await openButton().evaluate(button => { const style = getComputedStyle(button); return { width: style.borderTopWidth, style: style.borderTopStyle, color: style.borderTopColor }; });
  assert.ok(outline.width === '1px' && outline.style === 'solid' && !/rgba\(0, 0, 0, 0\)|transparent/.test(outline.color), `Open button has a visible outline: ${JSON.stringify(outline)}`);
  assert.equal(await openButton().getAttribute('aria-label'), 'Open score file');
  assert.equal(await openButton().innerText(), 'Open', 'Open button shows its text on desktop');
  await openButton().click();
  await dialog().waitFor();
  assert.equal(await dialog().getAttribute('aria-modal'), 'true');
  assert.deepEqual(await opener.locator('.open-dialog-format-name').allTextContents(), ['MusicXML', 'MIDI', 'MEI', 'ABC notation'], 'Dialog lists the four formats');
  assert.match(await opener.locator('.open-dialog-formats').textContent(), /\.musicxml.*\.xml.*\.mxl.*\.mid.*\.midi.*\.mei.*\.abc.*\.txt/s);
  assert.match(await opener.locator('.open-dialog-tip').textContent(), /Paste ABC notation here, or drop a score file or a folder of scores/);
  assert.equal(await dialog().getByRole('button', { name: /choose folder/i }).count(), 0, 'No Choose folder button (folders can still be dropped)');
  assert.equal(await dialog().locator('input[webkitdirectory]').count(), 0);
  assert.equal(await opener.evaluate(() => document.activeElement?.classList.contains('open-dialog-abc-input')), true, 'Entry box is focused on open');
  assert.equal(await opener.locator('.open-dialog-open-abc').isDisabled(), true, 'Open ABC waits for text');
  // Page-turn keys stay inert while the dialog is open.
  await opener.locator('.open-dialog-close').focus();
  const scrollBefore = await opener.evaluate(() => document.querySelector('.score-viewport').scrollTop);
  await opener.keyboard.press('PageDown');
  await opener.waitForTimeout(300);
  assert.equal(await opener.evaluate(() => document.querySelector('.score-viewport').scrollTop), scrollBefore, 'Page turns are ignored under the dialog');
  await opener.keyboard.press('Escape');
  await dialog().waitFor({ state: 'detached' });
  assert.equal(await opener.evaluate(() => document.activeElement?.classList.contains('header-open-file')), true, 'Escape returns focus to the open button');
  // Pasted ABC: a non-ABC hint first, then Ctrl+Enter opens it through the reader's ABC path.
  await openButton().click();
  await opener.locator('.open-dialog-abc-input').fill('just some words');
  await opener.locator('.open-dialog-open-abc').click();
  assert.match(await opener.locator('.open-dialog-message').textContent(), /K: \(key\) line/, 'Non-ABC text gets an inline hint');
  await opener.locator('.open-dialog-abc-input').fill('X:1\nT:Pasted tune\nM:4/4\nL:1/4\nK:G\nG A B c | d4 |]');
  await opener.locator('.open-dialog-abc-input').press('Control+Enter');
  await dialog().waitFor({ state: 'detached' });
  await opener.waitForFunction(() => document.querySelector('h1')?.textContent === 'Pasted tune');
  await openReady();
  // An unsupported dropped file is reported inline and nothing else changes.
  await openButton().click();
  await dropIntoDialog([{ name: 'photo.png', text: 'png' }]);
  await opener.locator('.open-dialog-message.is-error').waitFor();
  assert.match(await opener.locator('.open-dialog-message').textContent(), /“photo\.png” isn’t a supported score/);
  assert.equal(await dialog().count(), 1, 'Dialog stays open for an unsupported file');
  // Drag-over styling while files hover the dialog.
  // React renders dragenter/dragleave updates at continuous priority, in a scheduler task after the event returns
  // (only drop is flushed synchronously), so wait for the class to change instead of reading it straight away.
  const dragOverIs = count => opener.waitForFunction(count => document.querySelectorAll('.open-dialog-dropzone.is-drag-over').length === count, count, { timeout: 5000 }).then(() => true, () => false);
  await dropIntoDialog([{ name: 'a.abc', text: 'K:C' }], ['dragenter', 'dragover']);
  assert.ok(await dragOverIs(1), 'Drop zone highlights on drag-over');
  await dropIntoDialog([{ name: 'a.abc', text: 'K:C' }], ['dragleave']);
  assert.ok(await dragOverIs(0), 'Drag-over clears on leave');
  // A dropped folder with two scores (plus files to skip) offers a picker; choosing one opens it.
  const ensembleXml = await readFile(resolve(root, 'validation/fixtures/ensemble.musicxml'), 'utf8');
  await dropIntoDialog([{ name: 'Set list', children: [
    { name: 'README.md', text: '# notes' },
    { name: 'notes.txt', text: 'Rehearsal at eight.' },
    { name: 'Ensemble.musicxml', text: ensembleXml },
    { name: 'Tunes', children: [{ name: 'reel.abc', text: 'X:1\nT:Folder reel\nM:4/4\nL:1/8\nK:D\nDEFG ABcd | d8 |]' }] },
  ] }]);
  await opener.locator('.open-dialog-choice').first().waitFor();
  const listed = await opener.locator('.open-dialog-choice').evaluateAll(choices => choices.map(choice => [choice.querySelector('.open-dialog-choice-name').textContent, choice.querySelector('.open-dialog-choice-path').textContent, choice.querySelector('.open-dialog-choice-format').textContent]));
  assert.deepEqual(listed, [['Ensemble.musicxml', 'Set list/Ensemble.musicxml', 'MusicXML'], ['reel.abc', 'Set list/Tunes/reel.abc', 'ABC']], 'Folder picker lists only the scores, with paths and formats');
  await opener.getByRole('button', { name: /reel\.abc/ }).click();
  await dialog().waitFor({ state: 'detached' });
  await opener.waitForFunction(() => document.querySelector('h1')?.textContent === 'Folder reel');
  await openReady();
  // A folder holding exactly one score opens it directly.
  await openButton().click();
  await dropIntoDialog([{ name: 'One', children: [{ name: 'ensemble.musicxml', text: ensembleXml }, { name: 'cover.jpg', text: 'x' }] }]);
  await dialog().waitFor({ state: 'detached' });
  await opener.waitForFunction(() => document.querySelector('h1')?.textContent === 'Migration ensemble');
  await openReady();
  assert.equal(await opener.locator('.part-control').count(), 5, 'Single score in a folder opens directly');
  assert.equal(await opener.locator('input[type=file]').count(), 1, 'Only one file input while the dialog is closed');
  // Phone widths: the dialog fits without horizontal overflow.
  for (const width of [320, 390]) {
    await opener.setViewportSize({ width, height: 700 });
    await openButton().click();
    await dialog().waitFor();
    const fit = await opener.evaluate(() => { const panel = document.querySelector('.open-dialog'); const rect = panel.getBoundingClientRect(); return { left: rect.left, right: rect.right, page: document.documentElement.scrollWidth <= innerWidth, panel: panel.scrollWidth <= panel.clientWidth + 1, width: innerWidth }; });
    assert.ok(fit.left >= 0 && fit.right <= fit.width && fit.page && fit.panel, `Open dialog fits ${width}px: ${JSON.stringify(fit)}`);
    await opener.keyboard.press('Escape');
    await dialog().waitFor({ state: 'detached' });
  }
  assert.deepEqual(openErrors, []);
  await openContext.close();
  console.log(`${engine}: open dialog passed`);

  // A public score link opens on load: `?score=<url>` downloads it (cross-origin, so CORS applies) and opens it like a file.
  const linkContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const linkXml = await readFile(resolve(root, 'validation/fixtures/ensemble.musicxml'));
  const linkRequests = [];
  await linkContext.route('https://scores.example/**', route => {
    const path = new URL(route.request().url()).pathname;
    linkRequests.push(path);
    const cors = { 'access-control-allow-origin': '*' };
    if (path === '/ensemble.musicxml') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/octet-stream' }, body: linkXml });
    if (path === '/download') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/vnd.recordare.musicxml+xml' }, body: linkXml });
    // A CORS refusal reaches the page as a failed fetch (Playwright's fulfilled responses skip the CORS check itself).
    if (path === '/unreachable.musicxml') return route.abort('failed');
    return route.fulfill({ status: 404, headers: cors, body: 'missing' });
  });
  const link = await linkContext.newPage();
  const linkErrors = [];
  link.on('pageerror', error => linkErrors.push(error.message));
  const linked = async target => {
    await link.goto(`${url}/?score=${encodeURIComponent(target)}`);
    await link.waitForFunction(() => document.querySelector('h1')?.textContent === 'Migration ensemble', null, { timeout: 30000 });
    assert.equal(await link.locator('.part-control').count(), 5, `${target} opens the linked score`);
    assert.equal(await link.locator('.reopen-banner').count(), 0, 'No reopen offer when a score is linked');
  };
  await linked('https://scores.example/ensemble.musicxml');
  await linked('https://scores.example/download');
  for (const [target, message] of [['https://scores.example/missing.musicxml', /404/], ['https://scores.example/unreachable.musicxml', /CORS/], ['javascript:alert(1)', /http or https/]]) {
    await link.goto(`${url}/?score=${encodeURIComponent(target)}`);
    await link.getByRole('alert').first().waitFor();
    assert.match(await link.getByRole('alert').first().textContent(), message, `${target} explains why it can't open`);
  }
  assert.deepEqual(linkRequests, ['/ensemble.musicxml', '/download', '/missing.musicxml', '/unreachable.musicxml']);
  assert.deepEqual(linkErrors, []);
  await linkContext.close();
  console.log(`${engine}: score link passed`);

  // Focus: a stave's focus button hides every other stave; the mixer's eye buttons reveal hidden staves again.
  const focusContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const focus = await focusContext.newPage();
  const focusErrors = [];
  focus.on('pageerror', error => focusErrors.push(error.message));
  const focusReady = () => focus.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg'), null, { timeout: 30000 });
  const staves = () => focus.locator('.part-control .part-name').allTextContents();
  await focus.goto(url);
  await focus.locator('input[type=file]').setInputFiles(resolve(root, 'validation/fixtures/ensemble.musicxml'));
  await focus.waitForFunction(() => document.querySelector('h1')?.textContent === 'Migration ensemble');
  await focusReady();
  assert.equal(await focus.locator('.staff-focus').count(), 5, 'Every stave of a multi-stave score has a focus button');
  await focus.getByRole('button', { name: 'Focus on Track 3', exact: true }).click();
  await focus.waitForFunction(() => document.querySelectorAll('.part-control').length === 1);
  await focusReady();
  assert.deepEqual(await staves(), ['Track 3'], 'Focus hides every other stave');
  assert.equal(await focus.evaluate(() => document.querySelector('.score-system svg g.measure').querySelectorAll(':scope > g.staff').length), 1);
  assert.equal(await focus.locator('.staff-focus').getAttribute('aria-pressed'), 'true');
  // The mixer reveals hidden staves, and cannot hide the last visible one.
  await focus.locator('.header-more-toggle').isVisible().then(more => more && focus.locator('.header-more-toggle').click());
  await focus.getByRole('button', { name: 'Track mixer', exact: true }).click();
  const mixerPanel = focus.getByRole('dialog', { name: 'Track mixer' });
  assert.equal(await focus.locator('.mixer-visibility-button').count(), 5);
  assert.equal(await mixerPanel.getByRole('button', { name: 'Hide Track 3', exact: true }).isDisabled(), true, 'The last visible stave cannot be hidden');
  await mixerPanel.getByRole('button', { name: 'Show Track 5', exact: true }).click();
  await mixerPanel.getByRole('button', { name: 'Hide Track 5', exact: true }).waitFor();
  await focus.getByRole('button', { name: 'Close track mixer', exact: true }).click();
  await focus.waitForFunction(() => document.querySelectorAll('.part-control').length === 2);
  await focusReady();
  assert.deepEqual(await staves(), ['Track 3', 'Track 5'], 'The mixer reveals a hidden stave');
  // Focusing a stave again isolates it; focusing the focused stave shows them all.
  await focus.getByRole('button', { name: 'Focus on Track 5', exact: true }).click();
  await focus.waitForFunction(() => document.querySelectorAll('.part-control').length === 1);
  await focus.getByRole('button', { name: 'Show all staves', exact: true }).click();
  await focus.waitForFunction(() => document.querySelectorAll('.part-control').length === 5);
  await focusReady();
  assert.deepEqual(focusErrors, []);
  await focusContext.close();
  console.log(`${engine}: stave focus passed`);

  // Options drawer: the cards use the width (side by side on desktop, one column on a phone), and every text add-on
  // has an xs-xl size (regular by default, today's size) that the engraving follows and the reader remembers.
  {
    const settle = target => target.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg') && !document.querySelector('.score-content').getAnimations().length, null, { timeout: 60000 });
    const drawerLayout = target => target.evaluate(() => {
      const grid = document.querySelector('.drawer-grid'); const drawer = document.querySelector('.bottom-drawer');
      const cards = [...grid.querySelectorAll(':scope > .drawer-panel')].map(card => card.getBoundingClientRect());
      return { columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, rows: new Set(cards.map(card => Math.round(card.top))).size, cards: cards.length, scrolls: drawer.scrollHeight > drawer.clientHeight + 1 };
    });
    const fontOf = (target, selector) => target.evaluate(selector => { const text = document.querySelector(`.score-system svg ${selector}`); return text ? getComputedStyle(text).fontSize : null; }, selector);
    const sizeContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const wide = await sizeContext.newPage();
    await wide.goto(url); await settle(wide);
    await wide.getByRole('button', { name: 'Options', exact: true }).click();
    const desktop = await drawerLayout(wide);
    assert.ok(desktop.columns >= 2, `The drawer shows at least two columns at 1440px (${JSON.stringify(desktop)})`);
    assert.equal(desktop.rows, 1, `All drawer cards sit side by side at 1440px (${JSON.stringify(desktop)})`);
    assert.equal(desktop.scrolls, false, 'The drawer does not scroll at 1440px');
    assert.equal(await wide.getByRole('group', { name: 'Note names size' }).count(), 0, 'A size control is hidden while its add-on is off');
    await wide.getByRole('switch', { name: 'Note names', exact: true }).click();
    await wide.getByRole('switch', { name: 'Beat counts', exact: true }).click();
    await settle(wide);
    const sizes = wide.getByRole('group', { name: 'Note names size' });
    assert.deepEqual(await sizes.getByRole('button').allTextContents(), ['xs', 'sm', 'md', 'rg', 'lg', 'xl'], 'Six size steps, smallest first');
    assert.equal(await sizes.getByRole('button', { name: 'rg', exact: true }).getAttribute('aria-pressed'), 'true', 'Regular is the default size');
    assert.equal(await fontOf(wide, '.note-label'), '15px', 'Regular note names keep their size');
    assert.equal(await fontOf(wide, '.count-label'), '13px', 'Regular counts keep their size');
    const laneGap = () => wide.evaluate(() => {
      const svg = document.querySelector('.score-system svg'); const x = svg.querySelector('.note-label').getAttribute('x');
      const at = selector => [...svg.querySelectorAll(selector)].filter(text => text.getAttribute('x') === x).map(text => text.getBoundingClientRect());
      const names = at('.note-label'); const count = at('.count-label')[0];
      return count.top - Math.max(...names.map(rect => rect.bottom));
    });
    const regularGap = await laneGap();
    await sizes.getByRole('button', { name: 'xl', exact: true }).click();
    await settle(wide);
    assert.equal(await fontOf(wide, '.note-label'), '21.75px', 'Extra large note names are 1.45 times regular');
    assert.equal(await fontOf(wide, '.count-label'), '13px', 'Counts keep their own size');
    // Text boxes include the font's line gap, so regular rows already overlap slightly; an extra large row keeps that spacing.
    const largeGap = await laneGap();
    assert.ok(largeGap >= regularGap - 1, `Extra large note names keep clear of the count row (gap ${regularGap} -> ${largeGap})`);
    await wide.getByRole('group', { name: 'Beat counts size' }).getByRole('button', { name: 'xs', exact: true }).click();
    await settle(wide);
    assert.equal(await fontOf(wide, '.count-label'), '9.1px', 'Extra small counts are 0.7 times regular');
    // Source chord symbols are sized by Verovio (MEI rend fontsize), so it keeps them clear of the notes.
    await wide.locator('input[type=file]').setInputFiles(resolve(root, 'validation/fixtures/expressive.musicxml'));
    await settle(wide);
    await wide.getByRole('button', { name: 'Options', exact: true }).click();
    if (await wide.getByRole('switch', { name: 'Chord symbols', exact: true }).getAttribute('aria-checked') !== 'true') await wide.getByRole('switch', { name: 'Chord symbols', exact: true }).click();
    await wide.waitForFunction(() => document.querySelector('.score-system svg .harm'), null, { timeout: 30000 }); await settle(wide);
    const harmSize = () => wide.evaluate(() => Number.parseFloat([...document.querySelectorAll('.score-system svg .harm tspan[font-size]')].at(-1).getAttribute('font-size')));
    const regularHarm = await harmSize();
    await wide.getByRole('group', { name: 'Chord symbols size' }).getByRole('button', { name: 'xl', exact: true }).click();
    await wide.waitForFunction(regular => Number.parseFloat([...document.querySelectorAll('.score-system svg .harm tspan[font-size]')].at(-1)?.getAttribute('font-size')) > regular * 1.3, regularHarm, { timeout: 30000 });
    const largeHarm = await harmSize();
    assert.ok(Math.abs(largeHarm / regularHarm - 1.45) < .02, `Extra large source chord symbols are 1.45 times regular (${regularHarm} -> ${largeHarm})`);
    // Sizes are remembered (global prefs and the score's record).
    await wide.waitForTimeout(800);
    await wide.reload(); await settle(wide);
    await wide.getByRole('button', { name: 'Options', exact: true }).click();
    assert.equal(await wide.getByRole('group', { name: 'Note names size' }).getByRole('button', { name: 'xl', exact: true }).getAttribute('aria-pressed'), 'true', 'The note name size survives a reload');
    assert.equal(await wide.getByRole('group', { name: 'Beat counts size' }).getByRole('button', { name: 'xs', exact: true }).getAttribute('aria-pressed'), 'true', 'The count size survives a reload');
    await sizeContext.close();
    const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const phone = await phoneContext.newPage();
    await phone.goto(url); await settle(phone);
    await phone.getByRole('button', { name: 'Options', exact: true }).click();
    const mobile = await drawerLayout(phone);
    assert.equal(mobile.columns, 1, `The drawer stacks to one column at 390px (${JSON.stringify(mobile)})`);
    assert.equal(mobile.rows, mobile.cards, 'Every card has its own row at 390px');
    await phoneContext.close();
    console.log(`${engine}: options drawer layout and annotation sizes passed`);
  }

  // Endless with real (non-overlay) scrollbars: a vertical scrollbar appearing must not narrow the viewport, or the
  // width change re-engraves, the scrollbar goes, and the score re-engraves forever. Headless Chromium hides
  // scrollbars by default, so this needs its own browser.
  if (engine === 'chromium') {
    const scrolling = await chromium.launch({ headless: true, args: ['--no-sandbox'], ignoreDefaultArgs: ['--hide-scrollbars'] });
    try {
      for (const [width, height] of [[1920, 1080], [1366, 768], [820, 1180]]) {
        const loopContext = await scrolling.newContext({ viewport: { width, height } });
        await loopContext.addInitScript(() => {
          localStorage.setItem('scoreflow-prefs', JSON.stringify({ mode: 'landscape' }));
          window.__loadingShown = 0;
          let shown = false;
          new MutationObserver(() => { const now = !!document.querySelector('.score-loading'); if (now && !shown) window.__loadingShown++; shown = now; }).observe(document, { subtree: true, childList: true });
        });
        const loop = await loopContext.newPage();
        await loop.goto(url);
        await loop.locator('input[type=file]').setInputFiles(resolve(root, 'validation/fixtures/ensemble.musicxml'));
        await loop.waitForFunction(() => document.querySelector('h1')?.textContent === 'Migration ensemble' && !document.querySelector('.score-loading') && document.querySelector('.score-system svg'), null, { timeout: 30000 });
        const settled = await loop.evaluate(() => window.__loadingShown);
        await loop.waitForTimeout(4000);
        const after = await loop.evaluate(() => ({ shown: window.__loadingShown, gutter: getComputedStyle(document.querySelector('.score-viewport')).scrollbarGutter }));
        assert.equal(after.shown, settled, `Endless at ${width}x${height} settles instead of re-engraving (${JSON.stringify(after)})`);
        await loopContext.close();
      }
    } finally { await scrolling.close(); }
    console.log(`${engine}: endless with scrollbars passed`);
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
