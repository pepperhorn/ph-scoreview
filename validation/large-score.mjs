// Large-score reading (docs/specs/large-score-performance.md, Phase 1): a generated ~5 MB, 30-part orchestral
// MusicXML paints its first system within budget, keeps only the systems near the viewport drawn, draws the last
// system and releases the first when scrolled to the end, and highlights playback in a system drawn on demand.
// Runs against the built dist (npm run build). BROWSER=chromium|firefox|webkit (memory is checked on Chromium).
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
if (!existsSync(resolve(dist, 'index.html'))) throw new Error('dist/index.html is missing: run `npm run build` before validation/large-score.mjs');
/**
 * Budgets: first paint measured at 6.9-9.9 s locally (desktop Chromium, 12-core WSL2), x 1.5. Shared CI runners are
 * slower, so CI doubles it; LARGE_SCORE_BUDGET_SCALE overrides.
 */
const budgetScale = Number(process.env.LARGE_SCORE_BUDGET_SCALE || (process.env.CI ? 2 : 1));
const FIRST_PAINT_MS = 15000 * budgetScale;
const MAX_DRAWN_SYSTEMS = 8;
const MAX_HEAP_MB = 400;

/** An orchestral-shaped score like Finale/Sibelius exports: 30 parts, varied rhythms, chords, rests, dynamics, slurs. */
function orchestral(partCount, measureCount) {
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const names = ['Piccolo', 'Flute 1', 'Flute 2', 'Oboe 1', 'Oboe 2', 'English Horn', 'Clarinet in Bb 1', 'Clarinet in Bb 2', 'Bass Clarinet', 'Bassoon 1', 'Bassoon 2', 'Contrabassoon', 'Horn in F 1', 'Horn in F 2', 'Horn in F 3', 'Horn in F 4', 'Trumpet in Bb 1', 'Trumpet in Bb 2', 'Trombone 1', 'Trombone 2', 'Bass Trombone', 'Tuba', 'Timpani', 'Harp', 'Violin I', 'Violin II', 'Viola', 'Violoncello', 'Contrabass', 'Percussion'];
  const bass = new Set(['Bassoon 1', 'Bassoon 2', 'Contrabassoon', 'Trombone 1', 'Trombone 2', 'Bass Trombone', 'Tuba', 'Timpani', 'Violoncello', 'Contrabass']);
  const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const L = ['<?xml version="1.0" encoding="UTF-8" standalone="no"?>', '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">', '<score-partwise version="4.0">', '  <work>', '    <work-title>Synthetic Symphony</work-title>', '    </work>', '  <part-list>'];
  for (let p = 0; p < partCount; p++) {
    const name = names[p % names.length];
    L.push(`    <score-part id="P${p + 1}">`, `      <part-name>${name}</part-name>`, `      <score-instrument id="P${p + 1}-I1">`, `        <instrument-name>${name}</instrument-name>`, '        </score-instrument>', `      <midi-instrument id="P${p + 1}-I1">`, `        <midi-channel>${(p % 15) + 1}</midi-channel>`, `        <midi-program>${(p * 3) % 128 + 1}</midi-program>`, '        </midi-instrument>', '      </score-part>');
  }
  L.push('    </part-list>');
  const durations = [[24, 'quarter'], [12, 'eighth'], [6, '16th'], [48, 'half']];
  for (let p = 0; p < partCount; p++) {
    const name = names[p % names.length];
    const low = bass.has(name);
    L.push(`  <part id="P${p + 1}">`);
    for (let m = 0; m < measureCount; m++) {
      L.push(`    <measure number="${m + 1}" width="${(180 + rnd() * 120).toFixed(2)}">`);
      if (m === 0) L.push('      <attributes>', '        <divisions>24</divisions>', '        <key><fifths>-1</fifths></key>', '        <time><beats>4</beats><beat-type>4</beat-type></time>', `        <clef><sign>${low ? 'F' : 'G'}</sign><line>${low ? 4 : 2}</line></clef>`, '        </attributes>');
      if (m === 0 && p === 0) L.push('      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>96</per-minute></metronome></direction-type><sound tempo="96"/></direction>');
      if (m % 16 === 0) L.push(`      <direction placement="below"><direction-type><dynamics><${['p', 'mf', 'f', 'pp', 'ff'][Math.floor(rnd() * 5)]}/></dynamics></direction-type></direction>`);
      let beat = 0;
      if (rnd() < 0.18) L.push('      <note>', '        <rest measure="yes"/>', '        <duration>96</duration>', '        <voice>1</voice>', '        </note>');
      else while (beat < 96) {
        let [duration, type] = durations[Math.floor(rnd() * (p >= 24 ? 3 : 4))];
        if (beat + duration > 96) { duration = 96 - beat; type = duration === 48 ? 'half' : duration === 24 ? 'quarter' : duration === 12 ? 'eighth' : '16th'; }
        const rest = rnd() < 0.08;
        const chord = !rest && rnd() < (name === 'Harp' || p >= 24 ? 0.25 : 0.05) ? 2 : 1;
        for (let c = 0; c < chord; c++) {
          const s = Math.floor(rnd() * 7); const octave = (low ? 3 : 4 + (p < 3 ? 1 : 0)) + (rnd() < 0.2 ? 1 : 0); const alter = rnd() < 0.1 ? (rnd() < .5 ? 1 : -1) : 0;
          L.push('      <note>');
          if (c) L.push('        <chord/>');
          if (rest) L.push('        <rest/>');
          else L.push(`        <pitch><step>${steps[s]}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`);
          L.push(`        <duration>${duration}</duration>`, '        <voice>1</voice>', `        <type>${type}</type>`);
          if (alter && !rest) L.push(`        <accidental>${alter > 0 ? 'sharp' : 'flat'}</accidental>`);
          if (!rest) L.push(`        <stem>${s > 3 ? 'down' : 'up'}</stem>`);
          if (!rest && c === 0 && rnd() < 0.15) L.push(`        <notations><articulations><${rnd() < .5 ? 'staccato' : 'accent'}/></articulations></notations>`);
          L.push('        </note>');
        }
        beat += duration;
      }
      if (m === measureCount - 1) L.push('      <barline location="right"><bar-style>light-heavy</bar-style></barline>');
      L.push('      </measure>');
    }
    L.push('    </part>');
  }
  L.push('  </score-partwise>');
  return L.join('\n');
}

const MEASURES = 150;
const xml = orchestral(30, MEASURES);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const path = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!path.startsWith(`${dist}${sep}`)) { response.writeHead(403).end(); return; }
  try { response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' }).end(await readFile(path)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await launcher.launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox', '--enable-precise-memory-info'] } : {}) });
const started = Date.now();
try {
  // A short desktop viewport keeps "near the viewport" to a few systems; one bar per line makes later systems
  // reachable by playback within seconds. Playback is silent and wall-clock (an AudioContext that never resumes).
  const context = await browser.newContext({ viewport: { width: 1280, height: 640 } });
  await context.route(/poppins/i, route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('scoreflow-prefs', JSON.stringify({ barsPerLine: 1 }));
    Object.defineProperty(AudioContext.prototype, 'state', { configurable: true, get: () => 'suspended' });
    AudioContext.prototype.resume = () => new Promise(() => {});
  });
  const settled = () => page.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg') && !document.querySelector('.score-content').getAnimations().length, null, { timeout: 120000 });
  await page.goto(url);
  await settled();

  const t0 = Date.now();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'synthetic-symphony.musicxml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.waitForFunction(() => document.querySelector('.score-meta h1')?.textContent === 'Synthetic Symphony' && !document.querySelector('.score-loading') && document.querySelector('.score-system svg'), null, { timeout: 120000 });
  const firstPaint = Date.now() - t0;
  await settled();
  const state = () => page.evaluate(() => {
    const systems = [...document.querySelectorAll('.score-staves > .score-system')];
    const view = document.querySelector('.score-viewport');
    return { systems: systems.length, drawn: systems.flatMap((system, index) => system.querySelector(':scope > svg') ? [index] : []), scrollTop: view.scrollTop, scrollHeight: view.scrollHeight, clientHeight: view.clientHeight,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null };
  });
  const initial = await state();
  console.log(`${engine}: ${(xml.length / 1e6).toFixed(1)} MB, ${MEASURES} measures x 30 parts: first paint ${firstPaint} ms, ${initial.systems} systems, drawn ${JSON.stringify(initial.drawn)}, heap ${initial.heapMB} MB`);
  assert.ok(firstPaint <= FIRST_PAINT_MS, `First system paints within ${FIRST_PAINT_MS} ms (took ${firstPaint} ms)`);
  assert.equal(initial.systems, MEASURES, 'One placeholder or system block per line (one bar per line)');
  assert.ok(initial.drawn.includes(0), 'The first system is drawn');
  assert.ok(initial.drawn.length <= MAX_DRAWN_SYSTEMS, `Only systems near the viewport are drawn (${initial.drawn.length})`);
  if (initial.heapMB !== null) assert.ok(initial.heapMB <= MAX_HEAP_MB, `JS heap stays under ${MAX_HEAP_MB} MB (${initial.heapMB} MB)`);
  const blankPlaceholders = await page.evaluate(() => [...document.querySelectorAll('.score-system.is-pending')].every(block => parseFloat(block.style.height) > 0 && parseFloat(block.style.width) > 0));
  assert.ok(blankPlaceholders, 'Placeholders reserve the laid-out size of their systems');

  // Scroll to the end: the last system is drawn and the first is released.
  await page.evaluate(() => { const view = document.querySelector('.score-viewport'); view.scrollTop = view.scrollHeight; });
  await page.waitForFunction(() => { const systems = document.querySelectorAll('.score-staves > .score-system'); return systems[systems.length - 1].querySelector(':scope > svg') && !systems[0].querySelector(':scope > svg'); }, null, { timeout: 120000 });
  const end = await state();
  assert.ok(end.drawn.includes(end.systems - 1), 'The last system is drawn at the end');
  assert.ok(!end.drawn.includes(0), 'The first system is released far from the viewport');
  assert.ok(end.drawn.length <= MAX_DRAWN_SYSTEMS, `Drawn systems stay bounded after scrolling (${end.drawn.length})`);
  // The last system's notes are mapped (geometry is computed for systems as they are drawn).
  assert.ok(await page.evaluate(() => { const systems = document.querySelectorAll('.score-staves > .score-system'); return systems[systems.length - 1].querySelectorAll('.reader-note').length > 0; }), 'Notes of a system drawn on demand are mapped');

  // Back at the top, play fast: the playhead reaches a system that was not drawn at first paint and highlights it.
  await page.evaluate(() => { document.querySelector('.score-viewport').scrollTop = 0; });
  await page.waitForFunction(() => document.querySelector('.score-staves > .score-system:first-child > svg'), null, { timeout: 60000 });
  await page.locator('.bpm-control input').fill('240');
  const target = Math.max(...initial.drawn) + 1;
  await page.getByRole('button', { name: 'Play score', exact: true }).click();
  await page.waitForFunction(index => document.querySelector(`.score-staves > .score-system[data-system="${index}"] .reader-note.is-playing`), target, { timeout: 60000 });
  const highlighted = await page.evaluate(index => ({ line: !!document.querySelector(`.score-staves > .score-system[data-system="${index}"] .playback-line`), playing: document.querySelectorAll('.reader-note.is-playing').length }), target);
  assert.ok(highlighted.playing > 0, 'A note is highlighted in a system drawn on demand');
  await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
  assert.deepEqual(errors, []);
  await context.close();
  console.log(`${engine}: large score virtualized systems, on-demand drawing, release and playback highlight passed (${((Date.now() - started) / 1000).toFixed(1)} s)`);
} finally {
  await browser.close();
  server.close();
}
