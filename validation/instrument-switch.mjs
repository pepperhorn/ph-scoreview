// Import facts the instrument switch keys on: every staff of a MusicXML part shares its <score-part id> as
// Part.sourcePartId, the last note of a slurred phrase carries slurStop, and loading a file twice yields identical
// ScoreNote ids and MEI xml:ids (so a saved octave move can key on ScoreNote.id).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const port = 43992;
const server = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
let browser;
try {
  let baseUrl;
  for (let attempt = 0; attempt < 50 && !baseUrl; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/validation/performance.html`)).ok) baseUrl = `http://127.0.0.1:${port}`; } catch { /* startup */ }
    if (!baseUrl) await delay(200);
  }
  assert.ok(baseUrl, 'Vite dev server started');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${baseUrl}/validation/performance.html`);
  // The first import of the harness makes Vite optimize new dependencies and reload the page: import until it is stable.
  for (let attempt = 0; ; attempt++) {
    try { await page.evaluate(() => import('/validation/instrument-switch-harness.ts')); await delay(1500); await page.evaluate(() => import('/validation/instrument-switch-harness.ts')); break; }
    catch (error) { if (attempt > 5) throw error; await page.waitForLoadState('load'); }
  }
  const facts = xml => page.evaluate(async xml => (await import('/validation/instrument-switch-harness.ts')).importFacts(xml), xml);

  const piano = await facts(fixture('instrument-switch-piano.musicxml'));
  assert.equal(piano.parts.length, 2, 'A two-staff piano part imports as two parts');
  assert.deepEqual(piano.parts.map(part => part.sourcePartId), ['PPiano', 'PPiano'], 'Both staves share the score-part id');
  assert.notEqual(piano.parts[0].id, piano.parts[1].id, 'The staves keep distinct part ids');
  assert.deepEqual(piano.parts.map(part => part.sourcePart), ['PPiano', 'PPiano'], 'sourcePartOf returns the shared id');
  console.log('Instrument switch: both piano staves share sourcePartId passed');

  const slur = await facts(fixture('instrument-switch-slur.musicxml'));
  assert.deepEqual(slur.slurStops, [false, false, true, false], 'slurStop marks the note where the slur ends');
  console.log('Instrument switch: slurStop marks the last note of a slurred phrase passed');

  for (const name of ['instrument-switch-piano.musicxml', 'instrument-switch-slur.musicxml', 'ensemble.musicxml']) {
    const first = await facts(fixture(name)); const second = await facts(fixture(name));
    assert.ok(first.noteIds.length > 0 && first.meiIds.length > 0, `${name}: ids were read`);
    assert.deepEqual(second.noteIds, first.noteIds, `${name}: ScoreNote ids are stable across loads`);
    assert.deepEqual(second.meiIds, first.meiIds, `${name}: MEI xml:ids are stable across loads`);
    assert.equal(new Set(first.noteIds).size, first.noteIds.length, `${name}: ScoreNote ids are unique`);
  }
  console.log('Instrument switch: ScoreNote ids and MEI xml:ids are stable across loads passed');
  assert.deepEqual(errors, [], 'No page errors');
} finally {
  await browser?.close();
  server.kill();
}
