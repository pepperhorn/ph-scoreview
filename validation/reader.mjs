import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'dist');
const engine = process.env.BROWSER || 'chromium';
const launcher = { chromium, firefox, webkit }[engine];
if (!launcher) throw new Error(`BROWSER must be chromium, firefox or webkit (got "${engine}")`);
if (!process.env.READER_URL && !existsSync(resolve(dist, 'index.html'))) throw new Error('dist/index.html is missing: run `npm run build` before validation/reader.mjs');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: engine !== 'firefox' });
  const errors = [], remote = [], consoleLines = [];
  page.on('console', m => consoleLines.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(url)) remote.push(r.url()); });
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
  // At phone widths secondary header controls live in the "More controls" dropdown.
  const moreToggle = () => page.getByRole('button', { name: 'More controls', exact: true });
  const openMore = async () => { if (await moreToggle().count() && await moreToggle().getAttribute('aria-expanded') !== 'true') await moreToggle().click(); };
  const closeMore = async () => { if (await moreToggle().count() && await moreToggle().getAttribute('aria-expanded') === 'true') await page.keyboard.press('Escape'); };
  const header = async (action) => { await openMore(); await action(); await closeMore(); };
  const staveScale = () => page.getByRole('slider', { name: 'Stave scale', exact: true });
  // Rendered first-system staff height, first control icon size and zoom value text.
  const staffMetrics = () => page.evaluate(() => {
    const lines = [...document.querySelector('.score-system:first-child svg g.measure > g.staff').querySelectorAll(':scope > path')].slice(0, 5).map(line => line.getBoundingClientRect());
    const staff = Math.max(...lines.map(line => line.bottom)) - Math.min(...lines.map(line => line.top));
    const icon = document.querySelector('.part-control .part-icon').getBoundingClientRect().height;
    const font = parseFloat(getComputedStyle(document.querySelector('.part-control .part-name')).fontSize);
    const controlsRight = Math.max(...[...document.querySelectorAll('.part-control')].map(control => control.getBoundingClientRect().right));
    return { staff, icon, font, controlsRight, systemLeft: document.querySelector('.score-system:first-child').getBoundingClientRect().left };
  });
  const ready = async () => {
    await page.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg') && !document.querySelector('.score-content').getAnimations().length, { timeout: 30000 });
    assert.equal(await page.locator('.toast').count(), 0, await page.locator('.toast').allTextContents());
  };
  await page.goto(url);
  await ready();
  // Paint reveal zooms out from an enlarged scale while fading in.
  const reveal = await page.evaluate(() => { const style = getComputedStyle(document.querySelector('.score-content')); return { transition: style.transitionProperty, transform: style.transform }; });
  assert.match(reveal.transition, /transform/, 'Score paint animates scale');
  assert.equal(reveal.transform, 'none', 'Painted score settles at its natural scale');
  assert.ok(await page.locator('svg .note').count() > 0, 'Verovio native notes render');
  assert.ok(await page.locator('svg .notehead use').count() > 0, 'Noteheads retain their glyph references');
  // SMuFL text glyphs (the sample's metronome mark) keep their music font, served by an app-level local @font-face.
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
  for (const hidden of [staveScale(), page.getByRole('button', { name: 'Track mixer', exact: true }), page.getByRole('button', { name: 'Endless view', exact: true }), page.locator('.bpm-control input')]) assert.equal(await hidden.count(), 0, 'Secondary controls are hidden while More is closed');
  await moreToggle().click();
  assert.equal(await moreToggle().getAttribute('aria-expanded'), 'true');
  for (const shown of [staveScale(), page.getByRole('button', { name: 'Track mixer', exact: true }), page.getByRole('button', { name: 'Endless view', exact: true }), page.locator('.bpm-control input')]) assert.ok(await shown.isVisible(), 'Secondary controls are usable in the More panel');
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
  await header(async () => {
    assert.equal(await staveScale().inputValue(), '1');
    await staveScale().fill('1.25');
    await page.locator('.header-stave-scale-value', { hasText: '125%' }).waitFor();
  });
  // The slider commits zoom once the value settles, then re-renders.
  const zoomCommitted = zoom => page.waitForFunction(value => JSON.parse(localStorage.getItem('scoreflow-prefs') || '{}').zoom === value, zoom, { timeout: 5000 });
  await zoomCommitted(1.25);
  await ready();
  const zoomed = await staffMetrics();
  assert.ok(zoomed.staff > atDefault.staff * 1.15, `Stave grows with stave scale: ${atDefault.staff} -> ${zoomed.staff}`);
  for (const key of ['icon', 'font']) assert.ok(Math.abs(zoomed[key] / zoomed.staff - atDefault[key] / atDefault.staff) < .03, `Control ${key} keeps its ratio to the stave: ${(atDefault[key] / atDefault.staff).toFixed(3)} vs ${(zoomed[key] / zoomed.staff).toFixed(3)}`);
  for (const metrics of [atDefault, zoomed]) assert.ok(metrics.controlsRight <= metrics.systemLeft, `Staff controls stay clear of the notation: ${metrics.controlsRight} <= ${metrics.systemLeft}`);
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
  // Just above the mobile breakpoint every control is inline and must still fit.
  await page.setViewportSize({ width: 600, height: 800 });
  await moreToggle().waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.querySelector('.topbar').scrollWidth <= document.querySelector('.topbar').clientWidth), true, 'Inline header fits at 600px');
  await page.waitForTimeout(400);
  await ready();
  await resizeTo(1280, 800);
  assert.equal(await moreToggle().count(), 0, 'No More toggle on desktop');
  for (const shown of [staveScale(), page.getByRole('button', { name: 'Track mixer', exact: true }), page.getByRole('button', { name: 'Vertical view', exact: true }), page.locator('.bpm-control input'), page.locator('[aria-label="Bars per line"]')]) assert.ok(await shown.isVisible(), 'Secondary controls are inline on desktop');
  const desktop = await staffMetrics();
  assert.ok(Math.abs(desktop.icon - 56) <= 1 && Math.abs(desktop.font - 22) <= .5, `Default desktop controls are double size: ${desktop.icon}px icon, ${desktop.font}px name`);
  await resizeTo(390, 844);
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('button', { name: 'Transpose up one semitone', exact: true }).click();
  await page.getByRole('button', { name: 'Transpose up one semitone', exact: true }).click();
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
    const state = await page.evaluate(() => ({ contexts: window.__contexts.map(c => ({ state: c.state, time: c.currentTime })), starts: window.__audioStarts, playing: document.querySelectorAll('.is-playing').length, toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent), notice: document.querySelector('.playback-notice')?.textContent ?? null, loading: !!document.querySelector('.audio-loading, [aria-busy=true]') }));
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
  assert.equal(await page.locator('svg g.ending.spanning').count(), 2, 'Each ending bracket spans only its own measure');
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
  await page.locator('input[type=file]').setInputFiles(fixture);
  await ready();
  assert.equal(await page.locator('.part-control').count(), 4, 'Old staff identities preserve hidden state');
  await openMore();
  await page.getByRole('button', { name: 'Track mixer', exact: true }).click();
  assert.equal(await page.locator('[aria-label="Volume for Track 1"]').inputValue(), '42');
  await page.getByRole('button', { name: 'Close track mixer', exact: true }).click();
  await page.getByRole('button', { name: 'Show Track 2', exact: true }).click();
  await ready();
  await header(() => page.getByRole('button', { name: 'Endless view', exact: true }).click());
  await ready();
  assert.equal(await page.locator('svg .note').count(), 160);
  assert.equal(await page.locator('.score-system').count(), 1, 'Endless view is one unbroken system');
  assert.equal(await page.locator('.score-system svg g.system').count(), 1, 'Endless view engraves a single system');
  assert.equal(await page.locator('.score-system svg g.clef').count(), 5, 'System-start clefs are not repeated');
  await assertControlsAligned(5);
  await page.getByRole('button', { name: 'Play score', exact: true }).click();
  // Devices without a usable audio output (e.g. CI runners) fall back to silent playback, which must say so.
  await page.waitForFunction(() => document.querySelector('.playback-line') && (window.__audioStarts > 0 || document.querySelector('.playback-notice')));
  assert.ok(await page.locator('.is-playing').count() > 0);
  if (await page.locator('.playback-notice').count() === 0) assert.ok(await page.evaluate(() => window.__audioStarts) > 0, 'Audible playback starts audio sources');
  else console.log(`${engine}: audio unavailable, reader playback ran silently`);
  await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
  const stopped = await page.evaluate(() => window.__audioStarts);
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => window.__audioStarts), stopped, 'Pause cancels future scheduling');
  await page.getByRole('button', { name: 'Stop playback', exact: true }).click();
  await header(() => page.getByRole('button', { name: 'Vertical view', exact: true }).click());
  await page.setViewportSize({ width: 320, height: 844 });
  await ready();
  assert.equal(await page.evaluate(() => document.querySelector('.topbar').scrollWidth <= document.querySelector('.topbar').clientWidth), true);
  await openMore();
  assert.equal(await page.evaluate(() => { const panel = document.querySelector('.header-secondary-panel').getBoundingClientRect(); return panel.left >= 0 && panel.right <= innerWidth; }), true, 'More panel fits a 320px viewport');
  await closeMore();
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.xml', mimeType: 'application/xml', buffer: Buffer.from('<broken') });
  await page.getByRole('alert').waitFor();
  assert.equal(await page.locator('svg .note').count(), 160, 'Invalid import preserves previous score');
  assert.deepEqual(errors, []);
  assert.deepEqual(remote, [], 'Scores and resources stay local');
  console.log(`${engine}: reader import, engraving, layout, annotations, fonts, mixer, persistence and playback passed`);

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
  assert.equal(await silent.locator('.toast').count(), 0, 'Silent fallback is a notice, not an error toast');
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
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
