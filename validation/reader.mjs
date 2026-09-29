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
      const controls = [...document.querySelectorAll('.part-control')].map(control => { const rect = control.getBoundingClientRect(); return rect.top + rect.height / 2; });
      return { staves: staves.length, controls: controls.length, offsets: controls.map((center, index) => Math.abs(center - staves[index])) };
    });
    assert.equal(offsets.staves, expected, 'Engraved staff count');
    assert.equal(offsets.controls, expected, 'Staff control count');
    assert.ok(offsets.offsets.every(offset => offset < 4), `Staff controls align with their staves: ${offsets.offsets.map(value => value.toFixed(1))}`);
  };
  const ready = async () => {
    await page.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg'), { timeout: 30000 });
    assert.equal(await page.locator('.toast').count(), 0, await page.locator('.toast').allTextContents());
  };
  await page.goto(url);
  await ready();
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
  // Sample score: Verovio transposes the untouched document exactly once.
  const firstChord = () => page.evaluate(() => [...document.querySelector('.score-system svg .chord').querySelectorAll('.note')].map(note => note.getAttribute('data-pname')).sort().join(''));
  assert.equal(await firstChord(), 'ceg');
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
    const state = await page.evaluate(() => ({ contexts: window.__contexts.map(c => ({ state: c.state, time: c.currentTime })), starts: window.__audioStarts, playing: document.querySelectorAll('.is-playing').length, toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent), loading: !!document.querySelector('.audio-loading, [aria-busy=true]') }));
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
  await page.locator('[aria-label="Bars per line"]').selectOption('4');
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
  await page.getByRole('button', { name: 'Mono', exact: true }).click();
  await ready();
  assert.match(await page.locator('.note-label').first().evaluate(e => getComputedStyle(e).fontFamily), /monospace/);
  await page.locator('button[aria-label="Close options"]').click();
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
  await page.waitForFunction(() => window.__audioStarts > 0 && document.querySelector('.playback-line'));
  assert.ok(await page.locator('.is-playing').count() > 0);
  await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
  const stopped = await page.evaluate(() => window.__audioStarts);
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => window.__audioStarts), stopped, 'Pause cancels future scheduling');
  await page.getByRole('button', { name: 'Stop playback', exact: true }).click();
  await page.getByRole('button', { name: 'Vertical view', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  await ready();
  assert.equal(await page.evaluate(() => document.querySelector('.topbar').scrollWidth <= document.querySelector('.topbar').clientWidth), true);
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.xml', mimeType: 'application/xml', buffer: Buffer.from('<broken') });
  await page.getByRole('alert').waitFor();
  assert.equal(await page.locator('svg .note').count(), 160, 'Invalid import preserves previous score');
  assert.deepEqual(errors, []);
  assert.deepEqual(remote, [], 'Scores and resources stay local');
  console.log(`${engine}: reader import, engraving, layout, annotations, fonts, mixer, persistence and playback passed`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
