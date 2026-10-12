// Clock contract (ivories spec section 4.3): note onsets of validation/fixtures/clock-contract.musicxml (a pickup bar, tempo 120 → 60
// → 180 mid-bar), read through the real MusicXML import and performance timeline, must match
// validation/fixtures/clock-contract.expected.json within its tolerance (1 ms). ivories asserts the same file against its
// own tempo map. Clock mode maps a time to the score through playbackPositionAt at the score's own tempo, so each onset
// must also land on its note.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const fixture = readFileSync(new URL('./fixtures/clock-contract.musicxml', import.meta.url), 'utf8');
const expected = JSON.parse(readFileSync(new URL('./fixtures/clock-contract.expected.json', import.meta.url), 'utf8'));
const port = 43986;
const server = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0', '--port', String(port), '--strictPort'], { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
let browser;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const response = await fetch(`http://127.0.0.1:${port}/validation/performance.html`); if (response.ok) break; }
    catch { /* wait for Vite */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/validation/performance.html`);
  const actual = await page.evaluate(async xml => {
    const { parseMusicXml } = await import('/packages/pepperscore/src/lib/import.ts');
    const { buildBaseTimeline, playbackPositionAt } = await import('/packages/pepperscore/src/lib/playback/timeline.ts');
    const { noteOnsetSeconds } = await import('/packages/pepperscore/src/lib/playback/clock-time.ts');
    const timeline = buildBaseTimeline(parseMusicXml(xml));
    const onsets = noteOnsetSeconds(timeline);
    const landed = onsets.map(onset => playbackPositionAt(timeline, onset.seconds + 1e-4, timeline.initialBpm).activeNoteIds.includes(onset.noteId));
    // The BPM preference never enters clock mode: the same clock time maps to the same note at the score tempo only.
    const atScoreTempo = playbackPositionAt(timeline, 7.7, timeline.initialBpm).activeNoteIds;
    return { initialBpm: timeline.initialBpm, onsets, landed, atScoreTempo, d5: onsets.find(onset => onset.midi === 74)?.noteId, diagnostics: timeline.diagnostics };
  }, fixture);
  assert.equal(actual.initialBpm, 120, 'the opening tempo is the fixture\'s 120');
  assert.equal(actual.onsets.length, expected.onsets.length, `onset count (${actual.onsets.map(onset => onset.seconds).join(', ')})`);
  expected.onsets.forEach((want, index) => {
    const got = actual.onsets[index];
    assert.equal(got.midi, want.midi, `onset ${index} pitch`);
    assert.equal(got.measureIndex, want.measureIndex, `onset ${index} measure`);
    assert.ok(Math.abs(got.seconds - want.seconds) < expected.tolerance, `onset ${index} (midi ${want.midi}): ${got.seconds} s, expected ${want.seconds} s ± ${expected.tolerance}`);
  });
  assert.ok(actual.landed.every(Boolean), `every onset maps back to its own note through playbackPositionAt: ${actual.landed}`);
  assert.deepEqual(actual.atScoreTempo, [actual.d5], '7.7 s is inside D5 (7.666667–7.833333 s)');
  console.log(`Clock contract: ${actual.onsets.length} onsets within ${expected.tolerance * 1000} ms (pickup, tempo 120 → 60 → 180 mid-bar) passed`);
  if (actual.diagnostics.length) console.log(`Diagnostics: ${actual.diagnostics.join('; ')}`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
