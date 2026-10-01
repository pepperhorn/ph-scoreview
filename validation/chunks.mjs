// Chunked engraving (docs/specs/large-score-performance.md, Phase 3): a score engraved in small chunks must look
// like the same score engraved whole. A 16-bar fixture with a tie, slurs, a hairpin, an octave shift, a pedal and a
// tuplet across chunk boundaries, plus key, clef and meter changes, is drawn twice in the reader (two bars per line):
// whole, and forced into chunks of two systems. Every system must hold the same measures and the same engraved
// elements, notes map 1:1 to the Score, and measure IDs are the stable chunk IDs.
// Runs against the built dist (npm run build). BROWSER=chromium|firefox|webkit.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'dist');
const engine = process.env.BROWSER || 'chromium';
const launcher = { chromium, firefox, webkit }[engine];
if (!launcher) throw new Error(`BROWSER must be chromium, firefox or webkit (got "${engine}")`);
if (!existsSync(resolve(dist, 'index.html'))) throw new Error('dist/index.html is missing: run `npm run build` before validation/chunks.mjs');

const MEASURES = 16;
/** Two bars per line, three staves: a 12 staff-measure budget puts two systems in each chunk (boundaries before bars 5, 9, 13). */
const BUDGET = 12;
const note = (step, octave, duration, type, { id, extra = '', notations = '', staff, voice = '1', chord = false, dot = false } = {}) =>
  `<note${id ? ` id="${id}"` : ''}>${chord ? '<chord/>' : ''}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration>${extra}<voice>${voice}</voice><type>${type}</type>${dot ? '<dot/>' : ''}${staff ? `<staff>${staff}</staff>` : ''}${notations ? `<notations>${notations}</notations>` : ''}</note>`;
const direction = (type, staff) => `<direction placement="below"><direction-type>${type}</direction-type>${staff ? `<staff>${staff}</staff>` : ''}</direction>`;
/** Violin: a tie and a slur across the first chunk boundary, a long slur over two boundaries, a clef change in bar 10. */
function violin(m) {
  const n = m + 1;
  const quarters = (steps, divisions) => steps.map(step => note(step, 5, divisions, 'quarter')).join('');
  const q = 6; // divisions per quarter
  let body = '';
  if (n === 1) body += '<attributes><divisions>6</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';
  if (n === 7) body += '<attributes><key><fifths>2</fifths></key></attributes>';
  if (n === 10) body += '<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>';
  const beats = n >= 10 ? 3 : 4;
  if (n === 2) body += note('C', 5, q, 'quarter', { notations: '<slur type="start" number="2"/>' }) + quarters(['D', 'E', 'F'], q);
  else if (n === 4) body += quarters(['G', 'A'], q) + note('B', 5, q * 2, 'half', { extra: '<tie type="start"/>', notations: '<tied type="start"/><slur type="start" number="1"/>' });
  else if (n === 5) body += note('B', 5, q * 2, 'half', { extra: '<tie type="stop"/>', notations: '<tied type="stop"/>' }) + note('A', 5, q, 'quarter', { notations: '<slur type="stop" number="1"/>' }) + quarters(['G'], q);
  else if (n === 10) body += note('E', 5, q, 'quarter', { notations: '<slur type="stop" number="2"/>' }) + quarters(['D'], q) + '<attributes><clef><sign>C</sign><line>3</line></clef></attributes>' + note('C', 4, q, 'quarter');
  else body += quarters(['C', 'D', 'E', 'F', 'G', 'A', 'B'].slice((n % 3), (n % 3) + beats), q);
  if (n === MEASURES) body += '<barline location="right"><bar-style>light-heavy</bar-style></barline>';
  return `<measure number="${n}">${body}</measure>`;
}
/**
 * Piano: a hairpin, an octave shift and a pedal across the first boundary, a triplet in the chunk's last bar, and in
 * bar 6 a clef change without a staff number (staff 1 only: staff 2 keeps its F clef in later chunks).
 */
function piano(m) {
  const n = m + 1;
  const beats = n >= 10 ? 3 : 4;
  let body = '';
  if (n === 1) body += '<attributes><divisions>6</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>';
  if (n === 7) body += '<attributes><key><fifths>2</fifths></key></attributes>';
  if (n === 10) body += '<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>';
  if (n === 6) body += '<attributes><clef><sign>C</sign><line>3</line></clef></attributes>';
  if (n === 4) body += direction('<wedge type="crescendo" number="1"/>', 1) + direction('<octave-shift type="down" size="8" number="1"/>', 2) + direction('<pedal type="start" line="yes"/>', 2);
  if (n === 6) body += direction('<wedge type="stop" number="1"/>', 1) + direction('<octave-shift type="stop" size="8" number="1"/>', 2) + direction('<pedal type="stop" line="yes"/>', 2);
  // Staff 1: a triplet in bar 4, quarters elsewhere.
  if (n === 4) {
    body += ['E', 'F', 'G'].map((step, index) => note(step, 4, 4, 'eighth', { staff: 1, extra: '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>', notations: index === 0 ? '<tuplet type="start" bracket="yes"/>' : index === 2 ? '<tuplet type="stop"/>' : '' })).join('');
    body += ['A', 'B', 'C'].map(step => note(step, step === 'C' ? 5 : 4, 6, 'quarter', { staff: 1 })).join('');
  } else body += Array.from({ length: beats }, (_, index) => note(['C', 'E', 'G', 'B'][index], 4, 6, 'quarter', { staff: 1 })).join('');
  body += `<backup><duration>${beats * 6}</duration></backup>`;
  body += note('C', 3, beats * 6, beats === 4 ? 'whole' : 'half', { staff: 2, voice: '5', dot: beats === 3 });
  if (n === MEASURES) body += '<barline location="right"><bar-style>light-heavy</bar-style></barline>';
  return `<measure number="${n}">${body}</measure>`;
}
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><work><work-title>Chunk Boundaries</work-title></work>
<part-list><score-part id="P1"><part-name>Violin</part-name></score-part><score-part id="P2"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">${Array.from({ length: MEASURES }, (_, m) => violin(m)).join('\n')}</part>
<part id="P2">${Array.from({ length: MEASURES }, (_, m) => piano(m)).join('\n')}</part>
</score-partwise>`;
const xmlPath = join(mkdtempSync(join(tmpdir(), 'chunks-')), 'chunk-boundaries.musicxml');
writeFileSync(xmlPath, xml);

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
const browser = await launcher.launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}) });
const started = Date.now();

/**
 * Open the fixture and read every system's measures, notes and engraved elements. `chunking` is the diagnostics
 * setting (`scoreflow-chunking`): forced chunks, and/or a tiny worker-recycle threshold.
 */
async function engrave(chunking) {
  const chunked = !!chunking?.force;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/poppins/i, route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(chunking => {
    localStorage.setItem('scoreflow-prefs', JSON.stringify({ barsPerLine: 2 }));
    if (chunking) localStorage.setItem('scoreflow-chunking', JSON.stringify(chunking));
  }, chunking || null);
  await page.goto(url);
  const ready = () => page.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg') && !document.querySelector('.score-content').getAnimations().length, null, { timeout: 120000 });
  await ready();
  await page.locator('input[type=file]').first().setInputFiles(xmlPath);
  await page.waitForFunction(() => document.querySelector('.score-meta h1')?.textContent === 'Chunk Boundaries', null, { timeout: 120000 });
  await ready();
  // A small score draws every system before the first paint; wait until none is pending.
  await page.waitForFunction(() => document.querySelectorAll('.score-staves > .score-system').length > 0 && !document.querySelector('.score-staves > .score-system.is-pending'), null, { timeout: 60000 });
  const systems = await page.evaluate(() => [...document.querySelectorAll('.score-staves > .score-system')].map(block => {
    const svg = block.querySelector(':scope > svg');
    const count = selector => svg.querySelectorAll(selector).length;
    return {
      firstMeasure: Number(block.dataset.firstMeasure),
      measureIds: [...svg.querySelectorAll('g.measure')].map(measure => measure.id),
      notes: [...svg.querySelectorAll('.reader-note')].map(element => element.getAttribute('data-note-id')),
      clefs: [...svg.querySelectorAll('g.clef use')].map(use => (use.getAttribute('xlink:href') || use.getAttribute('href') || '').replace(/-.*$/, '')),
      elements: { slur: count('g.slur'), tie: count('g.tie'), hairpin: count('g.hairpin'), octave: count('g.octave'), pedal: count('g.pedal'), tuplet: count('g.tuplet'),
        keySig: count('g.keySig'), meterSig: count('g.meterSig'), clef: count('g.clef'), barLine: count('g.barLine'), noteheads: count('g.note') },
    };
  }));
  const alert = await page.evaluate(() => document.querySelector('[role=alert]')?.textContent || null);
  await context.close();
  assert.deepEqual(errors, [], `No page errors (${JSON.stringify(chunking)})`);
  assert.equal(alert, null, `No error shown (${JSON.stringify(chunking)})`);
  return systems;
}

try {
  const whole = await engrave(null);
  const chunked = await engrave({ force: true, budget: BUDGET });
  console.log(`${engine}: whole ${whole.length} systems, chunked ${chunked.length} systems`);
  assert.equal(whole.length, MEASURES / 2, 'Two bars per line');
  assert.equal(chunked.length, whole.length, 'Chunked engraving has as many systems');
  chunked.forEach((system, index) => {
    const reference = whole[index];
    assert.equal(system.firstMeasure, reference.firstMeasure, `System ${index + 1} starts at the same bar`);
    assert.equal(system.measureIds.length, reference.measureIds.length, `System ${index + 1} holds the same number of bars`);
    assert.deepEqual(system.notes, reference.notes, `System ${index + 1} maps the same Score notes`);
    assert.deepEqual(system.clefs, reference.clefs, `System ${index + 1} draws the same clefs (whole ${JSON.stringify(reference.clefs)}, chunked ${JSON.stringify(system.clefs)})`);
    assert.deepEqual(system.elements, reference.elements, `System ${index + 1} engraves the same elements (whole ${JSON.stringify(reference.elements)}, chunked ${JSON.stringify(system.elements)})`);
  });
  // Measure IDs of a chunked score are stable, one per Score measure, in order.
  assert.deepEqual(chunked.flatMap(system => system.measureIds), Array.from({ length: MEASURES }, (_, index) => `reader-m${index + 1}`), 'Chunked measure IDs map 1:1 to Score measures');
  // Notes map 1:1: every Score note once.
  const notes = chunked.flatMap(system => system.notes);
  assert.equal(new Set(notes).size, notes.length, 'No note is mapped twice across chunks');
  assert.equal(notes.length, whole.flatMap(system => system.notes).length, 'Every note is mapped');
  // The spans that cross the first chunk boundary (after bar 4, between systems 2 and 3) are drawn on both sides.
  for (const kind of ['slur', 'tie', 'hairpin', 'octave', 'pedal']) {
    assert.ok(chunked[1].elements[kind] > 0 && chunked[2].elements[kind] > 0, `A ${kind} crossing the chunk boundary is drawn before and after it (${chunked[1].elements[kind]}, ${chunked[2].elements[kind]})`);
  }
  assert.ok(chunked[1].elements.tuplet > 0, 'The triplet in the last bar of a chunk is drawn');
  // The carried meter is not reprinted at a chunk start (only the real change in bar 10, system 5, prints one).
  assert.deepEqual(chunked.map(system => system.elements.meterSig > 0), whole.map(system => system.elements.meterSig > 0), 'Meters print where the whole score prints them');
  // A worker whose heap passes the recycle threshold is recycled only when that cannot strand the score: right after a
  // whole-document import (the render that needs it follows) it must still render, and chunked scores re-import cheaply.
  for (const chunking of [{ recycleHeapBytes: 1 }, { force: true, budget: BUDGET, recycleHeapBytes: 1 }]) {
    const recycled = await engrave(chunking);
    assert.deepEqual(recycled.map(system => system.notes), whole.map(system => system.notes), `A tiny recycle threshold still renders every system (${JSON.stringify(chunking)})`);
  }
  console.log(`${engine}: chunked engraving matches the whole engraving across chunk boundaries passed (${((Date.now() - started) / 1000).toFixed(1)} s)`);
} finally {
  await browser.close();
  server.close();
}
