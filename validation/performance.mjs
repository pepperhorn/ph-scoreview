import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import toneMidi from '@tonejs/midi';

// A MIDI note crossing the barline (beat 3 → 5) must become tied pieces, not a stretched bar.
const midiFile = new toneMidi.Midi();
midiFile.header.setTempo(120);
const midiTrack = midiFile.addTrack();
midiTrack.addNote({ midi: 60, ticks: 0, durationTicks: midiFile.header.ppq * 3 });
midiTrack.addNote({ midi: 62, ticks: midiFile.header.ppq * 3, durationTicks: midiFile.header.ppq * 2 });
midiTrack.addNote({ midi: 64, ticks: midiFile.header.ppq * 5, durationTicks: midiFile.header.ppq * 3 });
const midiBytes = Array.from(midiFile.toArray());

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
    // <sound dynamics> is a percentage of forte (velocity 90).
    if (expr.events[0].velocity !== 52 || expr.events[1].velocity !== 90) throw new Error('Dynamics precedence failed');
    const { parseMusicXml } = await import('/src/lib/import.ts');
    const expressiveXml = await (await fetch('/validation/fixtures/expressive.musicxml')).text();
    const expressiveScore = parseMusicXml(expressiveXml);
    const performed = buildPerformanceTimeline(expressiveScore, { bpm: 90, musicXml: expressiveXml });
    const g1 = performed.events.find(event => event.pitchId === 'long1');
    const g2 = performed.events.find(event => event.pitchId === 'long2');
    const accented = performed.events.find(event => event.pitchId === 'accent');
    if (!g1 || g2 || !accented || !approx(g1.endSeconds, 4) || !approx(accented.endSeconds - accented.startSeconds, 2)) throw new Error('Real MusicXML tie/articulation fixture failed');
    if (performed.events.filter(event => event.pitchId === 'long1').length !== 2) throw new Error('Repeat occurrences did not replay source note');
    if (performed.diagnostics.some(message => message.includes('Pedal')) || !performed.diagnostics.some(message => message.includes('Ornaments'))) throw new Error('Source effect diagnostics are wrong (pedal is now synthesized; ornaments are not)');
    // The fixture pedals measure 2: the tied G released at beat 2 rings to the lift; its highlight does not.
    if (!approx(g1.soundEndSeconds, performed.events.find(event => event.pitchId === 'accent').endSeconds) || !approx(g1.endSeconds, 4)) throw new Error('Fixture pedal did not sustain the released tie');
    return { cases: 9, eventCounts: [tie.events.length, repeat.events.length, nested.events.length, navigation.events.length, performed.events.length], diagnostics: [...new Set([...tie.diagnostics, ...repeat.diagnostics, ...navigation.diagnostics, ...performed.diagnostics])] };
  });
  assert.equal(result.cases, 9);
  const review = await page.evaluate(async ({ midiBytes }) => {
    const { buildPerformanceTimeline, positionAtSeconds, eventsFromSeconds } = await import('/src/lib/playback/timeline.ts');
    const { parseMusicXml, parseMidi, parseAbc } = await import('/src/lib/import.ts');
    const failures = [];
    const check = (condition, message, detail) => { if (!condition) failures.push(`${message}: ${JSON.stringify(detail)}`); };
    const approx = (a, b) => Math.abs(a - b) < 1e-6;
    const order = t => t.positions.filter(p => p.measureBeat === 0).map(p => p.measureIndex).join();
    const attrs = '<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';
    const one = (step, oct, dur, extra = '', type = 'quarter') => `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${dur}</duration><voice>1</voice><type>${type}</type>${extra}</note>`;
    const grace = (step, oct) => `<note><grace/><pitch><step>${step}</step><octave>${oct}</octave></pitch><voice>1</voice><type>16th</type></note>`;
    const whole = (step, extra = '') => one(step, 4, 16, extra, 'whole');
    const score = (partList, parts) => `<?xml version="1.0"?><score-partwise version="4.0"><part-list>${partList}</part-list>${parts}</score-partwise>`;
    const single = measures => score('<score-part id="P1"><part-name>A</part-name></score-part>', `<part id="P1">${measures.map((body, i) => `<measure number="${i + 1}">${i === 0 ? attrs : ''}${body}</measure>`).join('')}</part>`);
    const words = text => `<direction><direction-type><words>${text}</words></direction-type></direction>`;
    const playOrder = (measures, bpm = 120) => order(buildPerformanceTimeline(parseMusicXml(single(measures)), { bpm }));

    // H1: unanchored words and "Coda" substrings no longer drive navigation.
    check(playOrder([whole('C'), words('both hands') + whole('D'), whole('E'), whole('F')]) === '0,1,2,3', 'H1 "both hands" triggered D.S.', null);
    check(playOrder([whole('C'), whole('D'), words('Winds') + whole('E'), whole('F')]) === '0,1,2,3', 'H1 "Winds" triggered D.S.', null);
    const dsWords = playOrder([words('Segno') + whole('C'), words('To Coda') + whole('D'), words('D.S. al Coda') + whole('E'), words('Coda') + whole('F'), whole('G')]);
    check(dsWords === '0,1,2,0,1,3,4', 'H1 D.S. al Coda (words)', dsWords);
    const dsSound = playOrder([
      '<direction><direction-type><segno/></direction-type><sound segno="s"/></direction>' + whole('C'),
      '<direction><direction-type><words>To Coda</words></direction-type><sound tocoda="c"/></direction>' + whole('D'),
      '<direction><direction-type><words>D.S. al Coda</words></direction-type><sound dalsegno="s"/></direction>' + whole('E'),
      '<direction><direction-type><coda/></direction-type><sound coda="c"/></direction>' + whole('F'), whole('G')]);
    check(dsSound === '0,1,2,0,1,3,4', 'H1 D.S. al Coda (sound)', dsSound);
    const glyphs = playOrder(['<direction><direction-type><segno/></direction-type></direction>' + whole('C'), '<direction><direction-type><words>To</words><coda/></direction-type></direction>' + whole('D'), words('D.S. al Coda') + whole('E'), '<direction><direction-type><coda/></direction-type></direction>' + whole('F')]);
    check(glyphs === '0,1,2,0,1,3', 'H1 segno/coda glyphs', glyphs);

    // H3: the identified engraving text supplies IDs (articulations) and partwise repeats.
    const staccato = buildPerformanceTimeline(parseMusicXml(single([one('C', 4, 4, '<notations><articulations><staccato/></articulations></notations>') + one('D', 4, 4) + one('E', 4, 8, '', 'half')])), { bpm: 60 });
    check(approx(staccato.events[0].endSeconds - staccato.events[0].startSeconds, .5), 'H3 staccato without source IDs', staccato.events[0]);
    const timewise = `<?xml version="1.0"?><score-timewise version="4.0"><part-list><score-part id="P1"><part-name>A</part-name></score-part></part-list>${[0, 1, 2].map(i => `<measure number="${i + 1}"><part id="P1">${i === 0 ? attrs : ''}${whole('CDE'[i])}${i === 1 ? '<barline location="right"><repeat direction="backward"/></barline>' : ''}</part></measure>`).join('')}</score-timewise>`;
    check(order(buildPerformanceTimeline(parseMusicXml(timewise), { bpm: 120 })) === '0,1,0,1,2', 'H3 timewise repeat', null);

    // H4: MIDI barline crossings stay nominal and sustain through the tie.
    const midi = await parseMidi(new Uint8Array(midiBytes).buffer);
    const midiTimeline = buildPerformanceTimeline(midi, { bpm: 120 });
    check(midi.parts[0].measures.map(m => m.beats).join() === '4,4', 'H4 MIDI measures stretched', midi.parts[0].measures.map(m => m.beats));
    check(midiTimeline.events.map(e => `${e.midi}@${e.startSeconds}-${e.endSeconds}`).join() === '60@0-1.5,62@1.5-2.5,64@2.5-4', 'H4 MIDI tie sustain', midiTimeline.events.map(e => `${e.midi}@${e.startSeconds}-${e.endSeconds}`));

    // M1: several grace notes are staggered, in order, within a bounded steal.
    const graces = buildPerformanceTimeline(parseMusicXml(single([one('C', 4, 4) + grace('D', 5) + grace('E', 5) + grace('F', 5) + one('G', 4, 4) + one('A', 4, 8, '', 'half')])), { bpm: 60 }).events;
    const graceStarts = graces.filter(e => [74, 76, 77].includes(e.midi)).map(e => e.startSeconds);
    check(graceStarts.length === 3 && graceStarts[0] < graceStarts[1] && graceStarts[1] < graceStarts[2] && graceStarts[0] >= 1 - .25 - 1e-6 && graces.find(e => e.midi === 67).startSeconds === 1, 'M1 grace stagger', graceStarts);
    const opening = buildPerformanceTimeline(parseMusicXml(single([grace('D', 5) + grace('E', 5) + one('G', 4, 16, '', 'whole')])), { bpm: 60 }).events;
    check(opening[0].startSeconds === 0 && opening[1].startSeconds > 0 && approx(opening[2].startSeconds, .25), 'M1 opening graces delay principal', opening.map(e => e.startSeconds));

    // M2: explicit <sound dynamics> wins over the symbol; piano staves share dynamics.
    const piano = score('<score-part id="P1"><part-name>Piano</part-name></score-part>', `<part id="P1"><measure number="1">${attrs.replace('</time>', '</time><staves>2</staves>').replace('<clef>', '<clef number="1">')}<clef number="2"><sign>F</sign><line>4</line></clef>
      <direction><direction-type><dynamics><f/></dynamics></direction-type><staff>1</staff><sound dynamics="30"/></direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <direction><direction-type><words>sub.</words></direction-type><staff>1</staff><sound dynamics="120"/></direction>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note></measure></part>`);
    const pianoScore = parseMusicXml(piano);
    const dyn = buildPerformanceTimeline(pianoScore, { bpm: 120 }).events.map(e => `${e.midi}:${e.velocity}`).join();
    check(dyn === '72:27,48:27,74:108', 'M2 dynamics precedence/scope', dyn);
    const leftOnly = buildPerformanceTimeline({ ...pianoScore, parts: pianoScore.parts.slice(1) }, { bpm: 120, fullScore: pianoScore }).events.map(e => e.velocity).join();
    check(leftOnly === '27', 'M2 hidden right hand still scopes left hand dynamics', leftOnly);

    // M3: hiding the part that carries the tempo change keeps the tempo map.
    const tempoXml = score('<score-part id="P1"><part-name>Mel</part-name></score-part><score-part id="P2"><part-name>Bass</part-name></score-part>',
      `<part id="P1"><measure number="1">${attrs}<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>${whole('C')}</measure><measure number="2"><direction><direction-type><words>Slow</words></direction-type><sound tempo="60"/></direction>${whole('D')}</measure></part>` +
      `<part id="P2"><measure number="1">${attrs}${whole('C')}</measure><measure number="2">${whole('D')}</measure></part>`);
    const tempoScore = parseMusicXml(tempoXml);
    const hidden = buildPerformanceTimeline({ ...tempoScore, parts: tempoScore.parts.slice(1) }, { bpm: 120, fullScore: tempoScore });
    check(approx(hidden.durationSeconds, 6), 'M3 hidden part lost tempo change', hidden.durationSeconds);

    // M5 + M6: a tie into ending 2 sustains; after D.C. only the final ending plays.
    const tieRepeat = single([
      '<barline location="left"><repeat direction="forward"/></barline>' + whole('C', '<tie type="start"/>'),
      '<barline location="left"><ending number="1" type="start"/></barline>' + whole('C', '<tie type="stop"/>') + '<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>',
      '<barline location="left"><ending number="2" type="start"/></barline>' + whole('C', '<tie type="stop"/>') + '<barline location="right"><ending number="2" type="stop"/></barline>']);
    const tied = buildPerformanceTimeline(parseMusicXml(tieRepeat), { bpm: 60 });
    check(tied.events.map(e => `${e.startSeconds}-${e.endSeconds}`).join() === '0-8,8-16' && !tied.diagnostics.some(d => d.includes('Unmatched')), 'M5 tie into second ending re-attacked', tied.events.map(e => `${e.startSeconds}-${e.endSeconds}`));
    const dcEndings = playOrder([whole('C'),
      '<barline location="left"><ending number="1" type="start"/></barline>' + whole('D') + '<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>',
      '<barline location="left"><ending number="2" type="start"/></barline>' + whole('E') + '<barline location="right"><ending number="2" type="discontinue"/></barline>',
      '<direction><direction-type><words>D.C.</words></direction-type><sound dacapo="yes"/></direction>' + whole('F')]);
    check(dcEndings === '0,1,0,2,3,0,2,3', 'M6 endings after D.C.', dcEndings);

    // L1: a final fermata extends the piece; a mid-piece fermata holds instead of overlapping.
    const fermata = '<notations><fermata/></notations>';
    const finalHold = buildPerformanceTimeline(parseMusicXml(single([one('C', 4, 8, '', 'half') + one('D', 4, 8, fermata, 'half')])), { bpm: 60 });
    check(approx(finalHold.durationSeconds, 5) && approx(finalHold.events[1].endSeconds, 5), 'L1 final fermata tail cut off', [finalHold.durationSeconds, finalHold.events[1].endSeconds]);
    const midHold = buildPerformanceTimeline(parseMusicXml(single([one('C', 4, 4, fermata) + one('D', 4, 4) + one('E', 4, 8, '', 'half')])), { bpm: 60 });
    check(approx(midHold.events[0].endSeconds, 1.5) && approx(midHold.events[1].startSeconds, 1.5) && approx(midHold.durationSeconds, 4.5), 'L1 mid-piece fermata overlap', midHold.events.map(e => [e.startSeconds, e.endSeconds]));

    // L2: cue notes are silent; unpitched notes without midi-unpitched use drum-kit positions.
    const cue = buildPerformanceTimeline(parseMusicXml(single(['<note><cue/><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>'])), { bpm: 60 });
    check(cue.events.length === 0, 'L2 cue note sounded', cue.events.length);
    const drums = score('<score-part id="P1"><part-name>Drumset</part-name></score-part>', `<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>percussion</sign></clef></attributes>${['F4', 'C5', 'G5'].map(p => `<note><unpitched><display-step>${p[0]}</display-step><display-octave>${p[1]}</display-octave></unpitched><duration>1</duration><voice>1</voice><type>quarter</type></note>`).join('')}</measure></part>`);
    const drumMidi = buildPerformanceTimeline(parseMusicXml(drums), { bpm: 120, semitones: 3 }).events.map(e => e.midi).join();
    check(drumMidi === '36,38,42', 'L2 unpitched default drum mapping', drumMidi);

    // L3: ABC triplets and ties.
    const abc = await parseAbc('X:1\nM:2/4\nL:1/8\nK:C\n(3CDE F2|G2-G2|c4|]');
    const abcTimeline = buildPerformanceTimeline(abc, { bpm: 60 });
    check(abc.parts[0].measures.map(m => m.beats).join() === '2,2,2', 'L3 ABC triplet stretched the bar', abc.parts[0].measures.map(m => m.beats));
    const abcEvents = abcTimeline.events.map(e => `${e.midi}@${e.startSeconds.toFixed(2)}-${e.endSeconds.toFixed(2)}`).join();
    check(abcEvents === '60@0.00-0.33,62@0.33-0.67,64@0.67-1.00,65@1.00-2.00,67@2.00-4.00,72@4.00-6.00', 'L3 ABC triplet/tie timing', abcEvents);

    // P: damper pedal sustains released notes in audio only (soundEndSeconds), scoped to the source part.
    const rest = (dur = 4, type = 'quarter', staff = '') => `<note><rest/><duration>${dur}</duration><voice>1</voice><type>${type}</type>${staff}</note>`;
    const pedal = type => `<direction><direction-type><pedal type="${type}" line="yes"/></direction-type></direction>`;
    const ends = t => t.events.map(e => `${e.midi}:${e.startSeconds}-${e.endSeconds}/${e.soundEndSeconds}`).join();
    const sustained = buildPerformanceTimeline(parseMusicXml(single([pedal('start') + one('C', 4, 4) + one('D', 4, 4) + rest() + pedal('stop') + one('E', 4, 4)])), { bpm: 60 });
    check(ends(sustained) === '60:0-1/3,62:1-2/3,64:3-4/4', 'P1 pedal start/stop extends released notes', ends(sustained));
    check(positionAtSeconds(sustained, 2.5).activeNoteIds.length === 0, 'P1 pedal tail extended highlighting', positionAtSeconds(sustained, 2.5).activeNoteIds);
    const resumedTail = eventsFromSeconds(sustained, 2.5).map(e => `${e.midi}:${e.startSeconds}-${e.soundEndSeconds}`).join();
    check(resumedTail === '60:2.5-3,62:2.5-3,64:3-4', 'P1 resume clips sustained tails', resumedTail);
    check(!sustained.diagnostics.some(d => d.includes('edal')), 'P1 pedal still diagnosed', sustained.diagnostics);
    const soundPedal = buildPerformanceTimeline(parseMusicXml(single(['<direction><direction-type><words>Ped.</words></direction-type><sound damper-pedal="yes"/></direction>' + one('C', 4, 4) + rest() + '<direction><direction-type><words>*</words></direction-type><sound damper-pedal="no"/></direction>' + rest(8, 'half')])), { bpm: 60 });
    check(ends(soundPedal) === '60:0-1/2', 'P1 <sound damper-pedal> sustain', ends(soundPedal));
    const changed = buildPerformanceTimeline(parseMusicXml(single([pedal('start') + one('C', 4, 4) + one('D', 4, 4) + pedal('change') + one('E', 4, 4) + rest() + pedal('stop')])), { bpm: 60 });
    check(ends(changed) === '60:0-1/2,62:1-2/2,64:2-3/4', 'P2 pedal change splits sustain', ends(changed));
    const restruck = buildPerformanceTimeline(parseMusicXml(single([pedal('start') + one('C', 4, 4) + one('D', 4, 4) + one('C', 4, 4) + rest() + pedal('stop')])), { bpm: 60 });
    check(ends(restruck) === '60:0-1/2,62:1-2/4,60:2-3/4', 'P3 same-pitch re-attack truncates sustain', ends(restruck));
    const pedalRepeat = buildPerformanceTimeline(parseMusicXml(single([
      '<barline location="left"><repeat direction="forward"/></barline>' + pedal('start') + one('C', 4, 4) + rest(12, 'half'),
      one('D', 4, 4) + rest() + pedal('stop') + rest(8, 'half') + '<barline location="right"><repeat direction="backward"/></barline>'])), { bpm: 60 });
    check(ends(pedalRepeat) === '60:0-1/6,62:4-5/6,60:8-9/14,62:12-13/14' && approx(pedalRepeat.durationSeconds, 16), 'P4 pedal per repeat occurrence', ends(pedalRepeat));
    const pianoPedal = score('<score-part id="P1"><part-name>Piano</part-name></score-part><score-part id="P2"><part-name>Violin</part-name></score-part>',
      `<part id="P1"><measure number="1">${attrs.replace('</time>', '</time><staves>2</staves>').replace('<clef>', '<clef number="1">')}<clef number="2"><sign>F</sign><line>4</line></clef>
      <direction placement="below"><direction-type><pedal type="start" line="yes"/></direction-type><staff>1</staff></direction>
      ${one('C', 5, 4, '<staff>1</staff>')}${rest(4, 'quarter', '<staff>1</staff>')}${rest(4, 'quarter', '<staff>1</staff>')}
      <direction placement="below"><direction-type><pedal type="stop" line="yes"/></direction-type><staff>1</staff></direction>${rest(4, 'quarter', '<staff>1</staff>')}
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>quarter</type><staff>2</staff></note><note><rest/><duration>12</duration><voice>5</voice><type>half</type><dot/><staff>2</staff></note></measure></part>` +
      `<part id="P2"><measure number="1">${attrs}${one('G', 4, 4)}${rest(12, 'half')}</measure></part>`);
    const pianoTimeline = buildPerformanceTimeline(parseMusicXml(pianoPedal), { bpm: 60 });
    const soundEnd = midiValue => pianoTimeline.events.find(e => e.midi === midiValue)?.soundEndSeconds;
    check(soundEnd(72) === 3 && soundEnd(48) === 3, 'P5 staff-1 pedal sustains staff 2 of the same part', ends(pianoTimeline));
    check(soundEnd(67) === 1, 'P6 pedal leaked into another part', ends(pianoTimeline));
    const sost = buildPerformanceTimeline(parseMusicXml(single([pedal('sostenuto') + whole('C')])), { bpm: 60 });
    check(sost.diagnostics.some(d => d.includes('Sostenuto')) && sost.events[0].soundEndSeconds === 4, 'P7 sostenuto diagnosed, not synthesized', sost.diagnostics);
    return { failures, checks: 33 };
  }, { midiBytes });
  assert.deepEqual(review.failures, []);
  console.log(`Playback timeline: ${result.cases} browser fixtures and ${review.checks} review regressions passed; event counts ${result.eventCounts.join(', ')}.`);
  if (result.diagnostics.length) console.log(`Diagnostics: ${result.diagnostics.join('; ')}`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
