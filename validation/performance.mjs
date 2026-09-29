import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const port = 43981;
const server = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { const response = await fetch(`http://127.0.0.1:${port}/validation/performance.html`); if (response.ok) break; }
    catch { /* wait for Vite */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/validation/performance.html`);
  const result = await page.evaluate(async () => {
    const { buildPerformanceTimeline, positionAtSeconds, eventsFromSeconds } = await import('/src/lib/playback/timeline.ts');
    const note = (id, start, duration, midi, tieStart = false, tieStop = false) => ({ id, start, duration, voice: '1', pitches: [{ midi, step: 'C', octave: 4, alter: 0, tieStart, tieStop }] });
    const measure = (index, notes, directions = []) => ({ index, beats: 4, notes, directions });
    const part = (id, measures, clef = 'treble') => ({ id, name: id, clef, instrument: clef === 'percussion' ? 'drum-kit' : 'piano', measures });
    const base = (parts, tempo = 120) => ({ title: '', source: 'test', tempo, beats: 4, beatType: 4, key: 0, parts });
    const approx = (a, b) => Math.abs(a - b) < 1e-6;
    const tied = base([part('a', [measure(0, [note('a0', 0, 4, 60, true)]), measure(1, [note('a1', 0, 2, 60, false, true), note('a2', 2, 2, 64)])])]);
    const tie = buildPerformanceTimeline(tied, { bpm: 120 });
    if (tie.events.length !== 2 || !approx(tie.events[0].endSeconds, 3) || tie.events[0].visualNoteIds.join() !== 'a0,a1') throw new Error('Tie chain did not sustain without reattack');
    if (positionAtSeconds(tie, 2.5).activeNoteIds.join() !== 'a1') throw new Error('Tie highlighted a future or past segment');
    if (!approx(positionAtSeconds(tie, 3.5).scoreBeat, 7)) throw new Error('Last-measure position interpolation failed');
    const resumed = eventsFromSeconds(tie, 2.5);
    if (!approx(resumed[0].startSeconds, 2.5) || !approx(resumed[0].endSeconds, 3)) throw new Error('Sustain resume clipping failed');

    const changing = base([part('a', [measure(0, [note('t0', 0, 1, 60), note('t1', 2, 1, 62)], [{ start: 2, tempo: 60 }])])]);
    const tempo = buildPerformanceTimeline(changing, { bpm: 180 });
    if (!approx(tempo.events[1].startSeconds, 2 / 3) || !approx(tempo.durationSeconds, 2)) throw new Error('Mid-measure tempo scaling failed');
    if (!approx(positionAtSeconds(tempo, 1 + 1 / 3).scoreBeat, 3)) throw new Error('Tempo-segment cursor failed');

    const repeated = base([part('a', Array.from({ length: 4 }, (_, i) => measure(i, [note(`r${i}`, 0, 1, 60 + i)])))]);
    const xml = `<score-partwise><part id="P1"><measure number="1"><barline location="left"><repeat direction="forward"/></barline></measure><measure number="2"><barline location="left"><ending number="1" type="start"/></barline><barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline></measure><measure number="3"><barline location="left"><ending number="2" type="start"/></barline><barline location="right"><ending number="2" type="stop"/></barline></measure><measure number="4"/></part></score-partwise>`;
    const repeat = buildPerformanceTimeline(repeated, { bpm: 120, musicXml: xml });
    if (repeat.positions.filter(p => p.measureBeat === 0).map(p => p.measureIndex).join() !== '0,1,0,2,3') throw new Error('First/second ending traversal failed');
    const navigationXml = `<score-partwise><part id="P1"><measure number="1"><direction><sound segno="segno"/></direction></measure><measure number="2"><direction><sound fine="yes"/></direction></measure><measure number="3"><direction><sound dalsegno="segno"/></direction></measure><measure number="4"/></part></score-partwise>`;
    const navigation = buildPerformanceTimeline(repeated, { bpm: 120, musicXml: navigationXml });
    if (navigation.positions.filter(p => p.measureBeat === 0).map(p => p.measureIndex).join() !== '0,1,2,0,1') throw new Error('D.S. al Fine traversal failed');
    const nestedXml = `<score-partwise><part id="P1"><measure><barline location="left"><repeat direction="forward"/></barline></measure><measure><barline location="left"><repeat direction="forward"/></barline></measure><measure><barline location="right"><repeat direction="backward"/></barline></measure><measure><barline location="right"><repeat direction="backward"/></barline></measure></part></score-partwise>`;
    const nested = buildPerformanceTimeline(repeated, { bpm: 120, musicXml: nestedXml });
    if (nested.positions.filter(p => p.measureBeat === 0).map(p => p.measureIndex).join() !== '0,1,2,1,2,3,0,1,2,1,2,3') throw new Error('Nested repeat traversal failed');

    const percussion = base([part('drum', [measure(0, [note('kick', 0, 1, 36)])], 'percussion')]);
    if (buildPerformanceTimeline(percussion, { bpm: 120, semitones: 7 }).events[0].midi !== 36) throw new Error('Percussion was transposed');
    const expressive = base([part('a', [measure(0, [note('p', 0, 1, 60), note('f', 1, 1, 62)], [{ start: 0, symbols: ['p'] }, { start: 1, soundDynamics: 100 }])])]);
    const expr = buildPerformanceTimeline(expressive, { bpm: 120 });
    if (expr.events[0].velocity !== 52 || expr.events[1].velocity !== 127) throw new Error('Dynamics precedence failed');
    const { parseMusicXml } = await import('/src/lib/import.ts');
    const expressiveXml = await (await fetch('/validation/fixtures/expressive.musicxml')).text();
    const expressiveScore = parseMusicXml(expressiveXml);
    const performed = buildPerformanceTimeline(expressiveScore, { bpm: 90, musicXml: expressiveXml });
    const g1 = performed.events.find(event => event.pitchId === 'long1');
    const g2 = performed.events.find(event => event.pitchId === 'long2');
    const accented = performed.events.find(event => event.pitchId === 'accent');
    if (!g1 || g2 || !accented || !approx(g1.endSeconds, 4) || !approx(accented.endSeconds - accented.startSeconds, 2)) throw new Error('Real MusicXML tie/articulation fixture failed');
    if (performed.events.filter(event => event.pitchId === 'long1').length !== 2) throw new Error('Repeat occurrences did not replay source note');
    if (!performed.diagnostics.some(message => message.includes('Pedal marks')) || !performed.diagnostics.some(message => message.includes('Ornaments'))) throw new Error('Unsupported source effects were not diagnosed');
    return { cases: 9, eventCounts: [tie.events.length, repeat.events.length, nested.events.length, navigation.events.length, performed.events.length], diagnostics: [...new Set([...tie.diagnostics, ...repeat.diagnostics, ...navigation.diagnostics, ...performed.diagnostics])] };
  });
  assert.equal(result.cases, 9);
  console.log(`Playback timeline: ${result.cases} browser fixtures passed; event counts ${result.eventCounts.join(', ')}.`);
  if (result.diagnostics.length) console.log(`Diagnostics: ${result.diagnostics.join('; ')}`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
