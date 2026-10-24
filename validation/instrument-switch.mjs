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

  // --- Engraving the switch (MEI spelling pass) -------------------------------------------------------------------
  const engrave = (xml, test) => page.evaluate(async ([xml, test]) => (await import('/validation/instrument-switch-harness.ts')).engraveSwitch(xml, test), [xml, test]);
  const alto = { instrument: 'alto-saxophone', level: 'intermediate', autoRange: true, octaves: {} };
  const name = note => `${note.pname}${note.alter > 0 ? '#'.repeat(note.alter) : note.alter < 0 ? 'b'.repeat(-note.alter) : ''}${note.oct}`;
  const scoreName = p => `${p.step}${p.alter > 0 ? '#'.repeat(p.alter) : p.alter < 0 ? 'b'.repeat(-p.alter) : ''}${p.octave}`;
  const drawnOf = (result, staff) => result.notes.filter(note => note.staff === staff).map(name);
  /** Every drawn note has the display Score's spelling for its MEI id (engraving and note names agree). */
  const agrees = (result, label) => {
    // A generated MEI's continuation and split pieces (`_cN`, `_sN`) belong to their note (`source`).
    const of = note => result.pitches[note.id] ?? result.pitches[note.source];
    const wrong = result.notes.filter(note => of(note) && name(note) !== scoreName(of(note))).map(note => `${note.id}: ${name(note)} vs ${scoreName(of(note))}`);
    assert.deepEqual(wrong, [], `${label}: engraved pitches match the display Score`);
    assert.ok(result.notes.every(note => of(note)), `${label}: every drawn note has a Score pitch (Pitch.sourceId = MEI id)`);
  };
  const clefOf = (result, staff) => { const clef = result.clefs.find(item => item.staff === staff); return clef && `${clef.shape}${clef.line}${clef.dis ? `/${clef.dis}${clef.disPlace}` : ''}`; };

  const pianoXml = fixture('instrument-switch-piano.musicxml');
  const asWritten = await engrave(pianoXml, { switches: {} });
  assert.deepEqual([drawnOf(asWritten, '1'), drawnOf(asWritten, '2'), clefOf(asWritten, '2')], [['C5', 'E5'], ['C3'], 'F4'], 'As written: the piano engraving is unchanged');
  const pianoAlto = await engrave(pianoXml, { switches: { 0: alto, 1: alto } });
  assert.equal(clefOf(pianoAlto, '1'), 'G2', 'Right hand switched to alto sax: treble clef');
  assert.deepEqual(drawnOf(pianoAlto, '1'), ['A5', 'C#6'], 'Right hand: alto sax written pitch, a major sixth up');
  assert.equal(clefOf(pianoAlto, '2'), 'G2', 'Left hand switched too (grand staff): treble clef');
  // C3 sounds below the alto's range (D♭3): the phrase moves up an octave (C4), written a sixth above (A4).
  assert.deepEqual(drawnOf(pianoAlto, '2'), ['A4'], 'Left hand: the out-of-range phrase is moved up an octave');
  const lowId = pianoAlto.notes.find(note => note.staff === '2').id;
  assert.ok(pianoAlto.moved.includes(pianoAlto.pitches[lowId].note), 'The moved phrase is listed in moved (ps-transposed highlights, Task 6)');
  assert.deepEqual([asWritten.keys['1'], pianoAlto.keys['1'], pianoAlto.keys['2']], [0, 3, 3], 'Piano in C as alto sax: both staves in A major (3 sharps)');
  agrees(pianoAlto, 'Piano as alto sax');
  console.log('Instrument switch: piano as alto sax engraves both staves in treble a sixth up, the low phrase an octave up passed');

  // The reader's octave move (keyed by ScoreNote id): only that note moves, down an octave.
  const firstRight = pianoAlto.pitches[pianoAlto.notes.find(note => note.staff === '1').id].note;
  const moved = await engrave(pianoXml, { switches: { 0: { ...alto, octaves: { [firstRight]: -12 } }, 1: alto } });
  assert.deepEqual(drawnOf(moved, '1'), ['A4', 'C#6'], 'An octave move renders that note an octave down');
  agrees(moved, 'Octave move');
  // An unswitched part with an octave move: only that note moves; the staff keeps its clef and spellings.
  const own = await engrave(pianoXml, { switches: { 0: { level: 'intermediate', autoRange: true, octaves: { [firstRight]: 12 } } } });
  assert.deepEqual([drawnOf(own, '1'), drawnOf(own, '2'), clefOf(own, '1'), clefOf(own, '2')], [['C6', 'E5'], ['C3'], 'G2', 'F4'], 'As written with an octave move: that note an octave up, nothing else changes');
  agrees(own, 'Unswitched octave move');
  console.log('Instrument switch: a reader octave move engraves that note an octave down (switched) or up (as written) passed');

  // ABC (engraved from the MEI the Score generates; its pitches carry no sourceId): octave moves key on the generated
  // ids, and a note split into pieces (5 eighths = half + eighth, the `_s1` piece) moves as one.
  const abc = 'X:1\nT:Switch\nM:4/4\nL:1/8\nK:C\nc5 e3|g2 c2 e4|]\n';
  const abcPlain = await engrave(abc, { switches: {}, format: 'abc' });
  assert.deepEqual(drawnOf(abcPlain, '1'), ['C5', 'C5', 'E5', 'G5', 'C5', 'E5'], 'ABC as written (the first note drawn as two pieces)');
  agrees(abcPlain, 'ABC as written');
  const abcFirst = abcPlain.pitches[abcPlain.notes[0].id].note;
  const abcOwn = await engrave(abc, { switches: { 0: { level: 'intermediate', autoRange: true, octaves: { [abcFirst]: -12 } } }, format: 'abc' });
  assert.ok(abcOwn.moved.includes(abcFirst), 'ABC: the moved note is listed');
  assert.deepEqual(drawnOf(abcOwn, '1'), ['C4', 'C4', 'E5', 'G5', 'C5', 'E5'], 'ABC as written with an octave move: both pieces of the note engrave an octave down');
  agrees(abcOwn, 'ABC unswitched octave move');
  const trumpet = { instrument: 'trumpet', level: 'intermediate', autoRange: true, octaves: { [abcFirst]: -12 } };
  const abcTrumpet = await engrave(abc, { switches: { 0: trumpet }, format: 'abc' });
  assert.deepEqual(drawnOf(abcTrumpet, '1'), ['D4', 'D4', 'F#5', 'A5', 'D5', 'F#5'], 'ABC as trumpet with an octave move: written a tone up, the moved note an octave down');
  agrees(abcTrumpet, 'ABC as trumpet');
  const abcRendered = await page.evaluate(async ([xml, test]) => (await import('/validation/instrument-switch-harness.ts')).renderSwitch(xml, test), [abc, { switches: { 0: trumpet }, format: 'abc' }]);
  assert.deepEqual(abcRendered.notes.map(note => `${note.pname}${note.oct}`), ['D4', 'D4', 'F5', 'A5', 'D5', 'F5'], 'ABC as trumpet: the reader\'s render draws the switch and the octave move');
  console.log('Instrument switch: ABC octave moves and switches engrave (generated MEI ids, split notes) passed');

  // Concert view: the switched staff is shown at sounding pitch (no written shift), clef and range move still apply.
  const concert = await engrave(pianoXml, { switches: { 0: alto, 1: alto }, view: 'concert' });
  assert.deepEqual([drawnOf(concert, '1'), drawnOf(concert, '2'), clefOf(concert, '2')], [['C5', 'E5'], ['C4'], 'G2'], 'Concert view: alto at sounding pitch, low phrase an octave up, treble clef');
  agrees(concert, 'Concert view');
  // Transposed score: the switch is fitted and engraved after the transposition.
  const up = await engrave(pianoXml, { switches: { 0: alto, 1: alto }, semitones: 2 });
  assert.deepEqual([drawnOf(up, '1'), drawnOf(up, '2')], [['B4', 'D#5'], ['B3']], 'Transposed +2: refitted after the transposition (F#5 is above the alto, D3 in range)');
  agrees(up, 'Transposed +2');
  // Other clefs: viola (alto clef), cello (bass clef).
  const viola = await engrave(pianoXml, { switches: { 0: { ...alto, instrument: 'viola' }, 1: { ...alto, instrument: 'cello' } } });
  assert.deepEqual([clefOf(viola, '1'), clefOf(viola, '2'), drawnOf(viola, '1'), drawnOf(viola, '2')], ['C3', 'F4', ['C5', 'E5'], ['C3']], 'Viola gets the alto clef, cello the bass clef');
  console.log('Instrument switch: concert view, transposed score and alto/bass clefs engrave as the Score passed');

  // A transposing source: B♭ clarinet (written D5 E5 in D = sounding C5 D5 in C) as alto sax shows alto's written
  // pitch from the sounding pitch (A5 B5 in A), and at concert pitch C5 D5: the switch's shift replaces the view's own.
  const clarinetXml = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list><score-part id="PCl"><part-name>Clarinet in Bb</part-name><score-instrument id="PCl-I1"><instrument-name>Clarinet</instrument-name></score-instrument><midi-instrument id="PCl-I1"><midi-program>72</midi-program></midi-instrument></score-part></part-list><part id="PCl"><measure number="1"><attributes><divisions>1</divisions><key><fifths>2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef><transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes><note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><type>half</type></note><note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><type>half</type></note></measure></part></score-partwise>`;
  const clarinet = await engrave(clarinetXml, { switches: { 0: alto } });
  assert.deepEqual(drawnOf(clarinet, '1'), ['A5', 'B5'], 'Clarinet as alto sax: alto written pitch of the sounding pitch');
  assert.equal(clarinet.parts[0].key, 3, 'Clarinet as alto sax: A major');
  assert.equal(clarinet.keys['1'], 3, 'Clarinet as alto sax: engraved in A major');
  agrees(clarinet, 'Clarinet as alto sax');
  const clarinetConcert = await engrave(clarinetXml, { switches: { 0: alto }, view: 'concert' });
  assert.deepEqual(drawnOf(clarinetConcert, '1'), ['C5', 'D5'], 'Clarinet as alto sax, concert view: sounding pitch (shift not added twice)');
  assert.equal(clarinetConcert.keys['1'], 0, 'Clarinet as alto sax, concert view: engraved in C');
  agrees(clarinetConcert, 'Clarinet as alto sax, concert');
  console.log('Instrument switch: a transposing source engraves from its sounding pitch in both views passed');

  // Accidentals after an octave move (as written, one note moved): F#5 F5 F#5 with F#5 moved down shows F#4 F5 F#5
  // (the natural is no longer needed), a chord keeps its other notes, and a courtesy natural elsewhere stays.
  const bar = notes => `<measure number="${bar.n = (bar.n ?? 0) + 1}">${bar.n === 1 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' : ''}${notes}</measure>`;
  const n = (step, octave, { alter, accidental, chord = false } = {}) => `<note>${chord ? '<chord/>' : ''}<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>${accidental ? `<accidental>${accidental}</accidental>` : ''}</note>`;
  const single = (name, measures) => `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>${name}</part-name></score-part></part-list><part id="P1">${measures.join('')}</part></score-partwise>`;
  bar.n = 0;
  const accidentalsXml = single('Flute', [
    bar(n('F', 5, { alter: 1, accidental: 'sharp' }) + n('F', 5, { accidental: 'natural' }) + n('F', 5, { alter: 1, accidental: 'sharp' }) + n('C', 5) + n('E', 5, { chord: true })),
    bar(n('F', 5, { accidental: 'natural' }) + n('G', 5) + n('G', 5) + n('G', 5)),
  ]);
  const accPlain = await engrave(accidentalsXml, { switches: {} });
  const accidentals = result => result.notes.map(note => `${note.pname}${note.oct}${note.written ? `(${note.written})` : ''}`);
  assert.deepEqual(accidentals(accPlain), ['F5(s)', 'F5(n)', 'F5(s)', 'C5', 'E5', 'F5(n)', 'G5', 'G5', 'G5'], 'As written: accidentals and the courtesy natural');
  const firstSharp = accPlain.pitches[accPlain.notes[0].id].note;
  const accMoved = await engrave(accidentalsXml, { switches: { 0: { level: 'intermediate', autoRange: true, octaves: { [firstSharp]: -12 } } } });
  assert.deepEqual(accidentals(accMoved), ['F4(s)', 'F5', 'F5(s)', 'C5', 'E5', 'F5(n)', 'G5', 'G5', 'G5'], 'Octave move: accidentals re-evaluated, the courtesy natural kept');
  agrees(accMoved, 'Accidentals after an octave move');
  const chordMove = await page.evaluate(async xml => (await import('/validation/instrument-switch-harness.ts')).respellOctaves(xml, '1', { 4: 12 }), accidentalsXml);
  assert.deepEqual(chordMove.after.notes.slice(3, 5).map(name), ['C5', 'E6'], 'A chord with one note moved: only that note moves');
  console.log('Instrument switch: octave moves re-evaluate accidentals, keep courtesy accidentals, move single chord notes passed');

  // Chromatic passing notes on a switched staff (flute line in C as alto sax): the engraving matches the Score.
  bar.n = 0;
  const chromaticXml = single('Flute', [
    bar(n('C', 5) + n('C', 5, { alter: 1, accidental: 'sharp' }) + n('D', 5) + n('A', 4, { alter: 1, accidental: 'sharp' })),
    bar(n('D', 5) + n('D', 5, { alter: -1, accidental: 'flat' }) + n('C', 5) + n('B', 4, { alter: -1, accidental: 'flat' })),
  ]);
  const chromatic = await engrave(chromaticXml, { switches: { 0: alto } });
  agrees(chromatic, 'Chromatic line as alto sax');
  assert.deepEqual(chromatic.notes.map(name).slice(0, 3), ['A5', 'A#5', 'B5'], 'Chromatic line as alto sax: a rising passing note is sharpened');
  assert.ok(chromatic.notes.every(note => Math.abs(note.alter ?? 0) < 2), 'No double accidentals');
  console.log(`Instrument switch: chromatic passing notes on a switched staff agree with the Score (${chromatic.notes.map(name).join(' ')}) passed`);

  // A concert-pitch score (MusicXML <concert-score/>, piano + violin in F) with the piano as alto sax in the written
  // view: the reader's own render (renderScore must not view the switched Score again) shows alto's written pitch and key.
  const concertXml = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><defaults><concert-score/></defaults><part-list><score-part id="PPiano"><part-name>Piano</part-name></score-part><score-part id="PVn"><part-name>Violin</part-name></score-part></part-list><part id="PPiano"><measure number="1"><attributes><divisions>1</divisions><key><fifths>-1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><note><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration><type>half</type><staff>1</staff></note><note><pitch><step>A</step><octave>4</octave></pitch><duration>2</duration><type>half</type><staff>1</staff></note><backup><duration>4</duration></backup><note><pitch><step>F</step><octave>3</octave></pitch><duration>4</duration><type>whole</type><staff>2</staff></note></measure></part><part id="PVn"><measure number="1"><attributes><divisions>1</divisions><key><fifths>-1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;
  const concertScore = await page.evaluate(async ([xml, test]) => (await import('/validation/instrument-switch-harness.ts')).renderSwitch(xml, test), [concertXml, { switches: { 0: alto, 1: alto } }]);
  const drawnIn = staff => concertScore.notes.filter(note => note.staff === staff).map(note => `${note.pname}${note.oct}`);
  assert.deepEqual([drawnIn('1'), drawnIn('2'), drawnIn('3')], [['D5', 'F5'], ['D4'], ['C5']], 'Concert-pitch score, piano as alto sax: alto written pitch (F4 A4 -> D5 F#5, F3 -> D4), violin as is');
  assert.deepEqual(concertScore.keys, { 1: 2, 2: 2, 3: -1 }, 'Concert-pitch score, piano as alto sax: D major on the alto staves, F on the violin');
  console.log('Instrument switch: a concert-pitch score renders the switched piano at alto written pitch and key passed');

  // MEI clef mapping (the pass alone): every target clef, including treble 8vb.
  const clefs = {};
  for (const clef of ['treble', 'bass', 'alto', 'tenor', 'treble8vb']) clefs[clef] = clefOf(await page.evaluate(async ([xml, clef]) => (await import('/validation/instrument-switch-harness.ts')).respellClef(xml, '2', clef), [pianoXml, clef]), '2');
  assert.deepEqual(clefs, { treble: 'G2', bass: 'F4', alto: 'C3', tenor: 'C4', treble8vb: 'G2/8below' }, 'MEI clefs of the instrument clefs');
  console.log('Instrument switch: MEI clef mapping (treble, bass, alto, tenor, treble 8vb) passed');

  // A 40-bar cello line with clef changes and ties across every other bar line (low tied pairs move up an octave as one).
  const LONG = 40;
  const longBar = m => {
    const n = m + 1;
    const q = step => `<note><pitch><step>${step}</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>`;
    const rest = '<note><rest/><duration>1</duration><voice>1</voice><type>quarter</type></note>';
    const tied = type => `<note><pitch><step>E</step><octave>2</octave></pitch><duration>2</duration><tie type="${type}"/><voice>1</voice><type>half</type><notations><tied type="${type}"/></notations></note>`;
    let body = n === 1 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>' : '';
    if (n === 11) body += '<attributes><clef><sign>C</sign><line>4</line></clef></attributes>';
    if (n === 21) body += '<attributes><clef><sign>F</sign><line>4</line></clef></attributes>';
    body += n % 2 === 0 ? q('G') + rest + tied('start') : n === 1 ? q('G') + rest + q('G') + q('G') : tied('stop') + rest + q('G');
    return `<measure number="${n}">${body}</measure>`;
  };
  const longXml = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list><score-part id="PVc"><part-name>Cello</part-name><score-instrument id="PVc-I1"><instrument-name>Cello</instrument-name></score-instrument><midi-instrument id="PVc-I1"><midi-program>43</midi-program></midi-instrument></score-part></part-list><part id="PVc">${Array.from({ length: LONG }, (_, m) => longBar(m)).join('')}</part></score-partwise>`;
  // G3 (alto writes E4) stays; the tied E2 pairs sound below the alto (E3 after the move, written C#4).
  const expectLong = note => note.pname === 'E' && note.oct === 4 ? 'G' : note.pname === 'C' && note.alter === 1 && note.oct === 4 ? 'E' : `unexpected ${name(note)}`;
  const slicedPlain = await engrave(longXml, { switches: {}, slices: 4 });
  assert.ok(slicedPlain.inlineClefs.length >= 2, 'As written, the cello line has its clef changes');
  const sliced = await engrave(longXml, { switches: { 0: alto }, slices: 4 });
  assert.ok(sliced.chunks.length > 10, `The long score was engraved in chunks (${sliced.chunks.length})`);
  const wrongSliced = sliced.notes.filter(note => expectLong(note).startsWith('unexpected')).map(note => `bar ${note.measure + 1} ${note.id} ${name(note)}`);
  assert.deepEqual(wrongSliced, [], 'Chunked spelling: both tied notes are moved in every chunk (also a tie end at a chunk start)');
  assert.ok(sliced.chunks.every(chunk => chunk.clefs.every(clef => `${clef.shape}${clef.line}` === 'G2')), 'Every chunk opens in the alto\'s treble clef');
  assert.deepEqual(sliced.inlineClefs, [], 'The cello\'s clef changes are removed from the switched staff');
  const tieStartsAtChunk = sliced.chunks.slice(1).filter(chunk => chunk.from % 2 === 0).length;
  assert.ok(tieStartsAtChunk > 0, 'Some chunk starts with the end of a tie from the chunk before');
  console.log('Instrument switch: chunked spelling moves both tied notes and drops the source clef changes passed');

  // --- The reader: settings, pipeline and playback (Task 6) -------------------------------------------------------
  const mount = (xml, props) => page.evaluate(async ([xml, props]) => (await import('/validation/instrument-switch-harness.ts')).mountReader(xml, props), [xml, props]);
  const playback = (xml, settings, options) => page.evaluate(async ([xml, settings, options]) => (await import('/validation/instrument-switch-harness.ts')).readerPlayback(xml, settings, options), [xml, settings, options]);
  const staffPitches = (result, staff) => result.notes.filter(note => note.staff === staff).map(note => note.pitch);
  const plainReader = await mount(pianoXml, {});
  assert.deepEqual([staffPitches(plainReader, '1'), staffPitches(plainReader, '2'), plainReader.clefs], [['C5', 'E5'], ['C3'], { 1: 'G', 2: 'F' }], 'Reader without instrument settings: the piano as written');
  assert.deepEqual([plainReader.transposed, plainReader.outOfRange], [[], []], 'Nothing is highlighted as written');
  const altoReader = await mount(pianoXml, { settings: { instrument: 'alto-saxophone' }, highlights: [{ ids: [pianoAlto.pitches[lowId].note], className: 'host-mark' }] });
  assert.deepEqual(altoReader.clefs, { 1: 'G', 2: 'G' }, 'settings.instrument alto sax: both piano staves in treble clef');
  assert.deepEqual([staffPitches(altoReader, '1'), staffPitches(altoReader, '2')], [['A5', 'C6'], ['A4']], 'Both staves at the alto sax written pitch (C#6 drawn as C with a sharp), the low phrase an octave up');
  assert.deepEqual(altoReader.transposed, ['2:A4'], 'The moved phrase carries ps-transposed');
  assert.deepEqual(altoReader.host, [['2:A4']], 'Host highlights still apply on top of the internal ones');
  // onReady lists every staff with its source part number and switchability; `instruments` takes either as a key.
  assert.deepEqual(plainReader.ready.parts, [{ id: 'PPiano-1', name: 'Piano', sourcePart: 1, switchable: true }, { id: 'PPiano-2', name: 'Piano · 2', sourcePart: 1, switchable: true }], 'onReady: staff ids, the shared source part number, switchable');
  const byNumber = await mount(pianoXml, { settings: { instruments: { [plainReader.ready.parts[1].sourcePart]: 'alto-saxophone' } } });
  const byStaffId = await mount(pianoXml, { settings: { instruments: { [plainReader.ready.parts[1].id]: 'alto-saxophone' } } });
  assert.deepEqual([staffPitches(byStaffId, '1'), staffPitches(byStaffId, '2'), byStaffId.clefs], [['A5', 'C6'], ['A4'], { 1: 'G', 2: 'G' }], 'instruments keyed by the second staff\'s id switches the whole grand staff');
  assert.deepEqual([byNumber.notes, byNumber.clefs], [byStaffId.notes, byStaffId.clefs], 'instruments keyed by source part number and by part id give the same view');
  const beginner = await mount(pianoXml, { settings: { instrument: 'alto-saxophone', rangeLevel: 'beginner', autoRange: false } });
  // Beginner alto (sounding 49-69): C5 and E5 are above it, C3 below; fit to range off leaves them, flagged.
  assert.deepEqual([staffPitches(beginner, '1'), staffPitches(beginner, '2'), beginner.transposed], [['A5', 'C6'], ['A3'], []], 'Fit to range off: no octave moves');
  assert.deepEqual(beginner.outOfRange.sort(), ['1:A5', '1:C6', '2:A3'], 'Notes outside the level\'s range carry ps-out-of-range');
  assert.equal(beginner.outOfRangeColor, 'rgb(198, 40, 40)', 'ps-out-of-range is drawn in --ps-out-of-range (#c62828)');
  // The render call site: a switched view is never transposed twice, an unswitched one is transposed once as before.
  const transposedPlain = await mount(pianoXml, { settings: { semitones: 2 } });
  assert.deepEqual([staffPitches(transposedPlain, '1'), staffPitches(transposedPlain, '2')], [['D5', 'F5'], ['D3']], 'Unswitched +2: transposed once (D5 F#5 / D3)');
  const transposedAlto = await mount(pianoXml, { settings: { semitones: 2, instrument: 'alto-saxophone' } });
  // +2 sounds D5 F#5 / D3; F#5 is above the alto: the phrase moves down (D4 F#4), written B4 D#5; D3 written B3.
  assert.deepEqual([staffPitches(transposedAlto, '1'), staffPitches(transposedAlto, '2')], [['B4', 'D5'], ['B3']], 'Switched +2: fitted after the transpose, written once');
  // Concert-basis score: unswitched shows concert pitch; a part switched to a transposing instrument shows its written pitch.
  const concertPianoXml = pianoXml.replace('<part-list>', '<defaults><concert-score/></defaults><part-list>');
  assert.deepEqual(staffPitches(await mount(concertPianoXml, {}), '1'), ['C5', 'E5'], 'Concert-basis piano as written');
  assert.deepEqual(staffPitches(await mount(concertPianoXml, { settings: { instrument: 'alto-saxophone' } }), '1'), ['A5', 'C6'], 'Concert-basis score switched to alto sax: written pitch by default');
  assert.deepEqual(staffPitches(await mount(concertPianoXml, { settings: { instrument: 'flute' } }), '1'), ['C5', 'E5'], 'Concert-basis score switched to a concert-pitch instrument stays at concert pitch');
  console.log('Instrument switch: reader settings switch both piano staves (clef, written pitch, ps-transposed / ps-out-of-range, host highlights), no double transposition, concert-basis rule passed');

  const played = await playback(pianoXml, { instrument: 'alto-saxophone' });
  const [rh, lh] = Object.keys(played.midi);
  assert.deepEqual([played.programs[rh], played.programs[lh]], [66, 66], 'Switched staves play the alto sax (GM program 66)');
  assert.deepEqual([played.midi[rh], played.midi[lh]], [[72, 76], [60]], 'Playback sounds the fitted pitches (C5 E5 / C4)');
  const playedUp = await playback(pianoXml, { instrument: 'alto-saxophone' }, { semitones: 2 });
  assert.deepEqual([playedUp.midi[rh], playedUp.midi[lh]], [[62, 66], [50]], 'Transposed +2: playback follows the refit');
  // An unswitched B-flat clarinet beside the switched piano sounds as before in both views (never counted twice).
  const clarinetPart = '<score-part id="PCl"><part-name>Clarinet in Bb</part-name></score-part>';
  const clarinetMusic = '<part id="PCl"><measure number="1"><attributes><divisions>1</divisions><key><fifths>2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef><transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes><note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>';
  const duoXml = pianoXml.replace('</part-list>', `${clarinetPart}</part-list>`).replace('</score-partwise>', `${clarinetMusic}</score-partwise>`);
  for (const scorePitch of ['written', 'concert']) {
    const duo = await playback(duoXml, { instrument: 'alto-saxophone' }, { scorePitch });
    assert.equal(duo.scorePitch, scorePitch);
    const cl = Object.keys(duo.midi)[2];
    assert.deepEqual(duo.midi[cl], [72], `${scorePitch} view: the unswitched clarinet's written D5 sounds C5`);
    assert.deepEqual([duo.midi[rh], duo.midi[lh]], [[72, 76], [60]], `${scorePitch} view: the switched piano sounds its fitted pitches`);
    assert.notEqual(duo.programs[cl], 66, `${scorePitch} view: the unswitched clarinet keeps its own sound`);
  }
  const duoConcert = await mount(duoXml, { settings: { instrument: 'alto-saxophone', concert: true } });
  assert.deepEqual([staffPitches(duoConcert, '1'), staffPitches(duoConcert, '3')], [['C5', 'E5'], ['C5']], 'Concert view: switched piano and clarinet at sounding pitch');
  console.log('Instrument switch: playback plays alto sax program 66 at the fitted sounding pitch; unswitched transposing parts unchanged in both views passed');

  // --- The full reader's picker: Instrument separate from Sound (Task 7) -----------------------------------------
  const live = (xml, props = {}) => page.evaluate(async ([xml, props]) => (await import('/validation/instrument-switch-harness.ts')).mountLive(xml, props), [xml, props]);
  const readLive = () => page.evaluate(async () => (await import('/validation/instrument-switch-harness.ts')).readLive());
  const draws = () => page.evaluate(() => window.__psDraws);
  /** Run `action` and wait for the reader to finish the draw it causes. */
  const redraw = async action => { const before = await draws(); await action(); await page.waitForFunction(count => window.__psDraws > count, before, { timeout: 30000 }); return readLive(); };
  const picker = page.locator('.instrument-picker-panel');
  /** The picker's Instrument / Sound toggle (a group of pressed buttons, like the other font-toggles). */
  const section = name => picker.getByRole('group', { name: 'Instrument or sound', exact: true }).getByRole('button', { name, exact: true });
  const partIcon = () => page.locator('.part-control .part-icon').first().getAttribute('src');
  await live(pianoXml);
  const writtenUi = await readLive();
  assert.deepEqual([staffPitches(writtenUi, '1'), staffPitches(writtenUi, '2'), writtenUi.clefs], [['C5', 'E5'], ['C3'], { 1: 'G', 2: 'F' }], 'Full reader: the piano as written');
  const pianoIcon = await partIcon();
  // The mixer's voice button opens the picker on Sound; its Instrument section switches the part.
  await page.getByRole('button', { name: 'Track mixer', exact: true }).click();
  const pianoVoice = await page.getByRole('button', { name: 'Voice for Piano', exact: true }).first().textContent();
  await page.getByRole('button', { name: 'Voice for Piano', exact: true }).first().click();
  assert.equal(await section('Sound').getAttribute('aria-pressed'), 'true', 'The voice button opens the Sound section');
  assert.match(await picker.locator('.instrument-picker-heading p').textContent(), /Choose a playback sound/, 'Sound keeps its heading');
  await section('Instrument').click();
  const options = await picker.locator('.instrument-chooser-option').allTextContents();
  assert.deepEqual(options, ['As written', 'Piano', 'Guitar', 'Bass Guitar', 'Double Bass', 'Alto Sax', 'Tenor Sax', 'Bari Sax', 'Flute', 'Clarinet', 'Trumpet', 'Trombone', 'Violin', 'Viola', 'Cello', 'Voice'], 'As written, then the 15 model instruments (no drum kit)');
  assert.equal(await picker.locator('.instrument-chooser-as-written').getAttribute('aria-pressed'), 'true', 'As written is selected');
  assert.deepEqual([await picker.locator('.instrument-level .is-selected').textContent(), await picker.locator('.instrument-fit-toggle [role=switch]').getAttribute('aria-checked')], ['Intermediate', 'true'], 'Level Intermediate and Fit to range on by default');
  // Trumpet (B-flat, sounding 54-79 at intermediate): C5 E5 written D5 F#5; C3 is below, moved up to C4, written D4.
  const trumpetUi = await redraw(() => picker.getByRole('button', { name: 'Trumpet', exact: true }).click());
  assert.deepEqual([staffPitches(trumpetUi, '1'), staffPitches(trumpetUi, '2'), trumpetUi.clefs], [['D5', 'F5'], ['D4'], { 1: 'G', 2: 'G' }], 'Trumpet: both staves in treble, a tone up (F#5 drawn as F with a sharp), the low phrase an octave up');
  assert.equal(await picker.getByRole('button', { name: 'Trumpet', exact: true }).getAttribute('aria-pressed'), 'true', 'Trumpet is selected');
  assert.match(await partIcon(), /trumpet/, 'The part icon shows the trumpet');
  assert.match(await page.locator('.mixer-track-icon').first().getAttribute('src'), /trumpet/, 'The mixer track icon shows the trumpet');
  // The staff labels name the switch on both staves ("Piano → Trumpet"); a screen reader hears "Piano as Trumpet".
  const partLabels = () => page.locator('.part-control .part-name').evaluateAll(names => names.map(name => {
    const text = keep => { const copy = name.cloneNode(true); copy.querySelectorAll(keep).forEach(node => node.remove()); return [...copy.children].length ? [...copy.children].map(child => child.textContent.trim()).join(' ') : copy.textContent; };
    return { shown: text('.ps-visually-hidden'), spoken: text('[aria-hidden="true"]').replace(/\s+/g, ' ').trim(), title: name.title };
  }));
  const switchedNames = (await partLabels()).map(label => label.shown);
  assert.equal(switchedNames.length, 2, 'Both staves have a label');
  assert.ok(switchedNames.every(name => / → Trumpet$/.test(name)) && switchedNames[0].startsWith('Piano'), `Trumpet: both staff labels show the switch: ${JSON.stringify(switchedNames)}`);
  const firstLabel = (await partLabels())[0];
  assert.deepEqual([firstLabel.spoken, firstLabel.title], [`${switchedNames[0].replace(' → Trumpet', '')} as Trumpet`, `${switchedNames[0].replace(' → Trumpet', '')}, shown as Trumpet`], 'The label reads "<part> as Trumpet"');
  // A sound pick changes only the sound: the notes and the instrument stay the trumpet's.
  await section('Sound').click();
  assert.match(await picker.locator('.instrument-picker-grid button.is-selected').textContent(), /Trumpet/, 'Choosing the trumpet set its main sound');
  await picker.getByRole('button', { name: 'Strings', exact: true }).click();
  const harpUi = await redraw(() => picker.getByRole('button', { name: 'Orchestral Harp', exact: true }).click());
  assert.deepEqual([staffPitches(harpUi, '1'), staffPitches(harpUi, '2'), harpUi.clefs], [['D5', 'F5'], ['D4'], { 1: 'G', 2: 'G' }], 'Orchestral Harp sound: the notes are unchanged');
  assert.match(await partIcon(), /trumpet/, 'Orchestral Harp sound: the instrument is still the trumpet');
  assert.equal(await page.getByRole('button', { name: 'Voice for Piano', exact: true }).first().textContent(), 'Orchestral Harp', 'The mixer shows the picked sound');
  await page.getByRole('button', { name: 'Voice for Piano', exact: true }).first().click();
  assert.match(await picker.locator('.instrument-picker-grid button.is-selected').textContent(), /Orchestral Harp/, 'The picked sound is selected');
  await section('Instrument').click();
  assert.equal(await picker.getByRole('button', { name: 'Trumpet', exact: true }).getAttribute('aria-pressed'), 'true', 'The instrument is still the trumpet');
  // Level and fit: beginner trumpet (55-72) with fit off leaves E5 (76) and C3 out of range, flagged.
  await redraw(() => picker.getByRole('button', { name: 'Beginner', exact: true }).click());
  const unfitted = await redraw(() => picker.locator('.instrument-fit-toggle [role=switch]').click());
  assert.deepEqual([staffPitches(unfitted, '2'), unfitted.outOfRange.sort()], [['D3'], ['1:F5', '2:D3']], 'Beginner, fit off: no octave moves, out-of-range notes flagged');
  // As written: the original engraving and sound.
  const backUi = await redraw(() => picker.getByRole('button', { name: 'As written', exact: true }).click());
  assert.deepEqual([staffPitches(backUi, '1'), staffPitches(backUi, '2'), backUi.clefs], [['C5', 'E5'], ['C3'], { 1: 'G', 2: 'F' }], 'As written: the original engraving');
  assert.equal(await partIcon(), pianoIcon, 'As written: the piano icon again');
  assert.ok((await partLabels()).every(label => !label.shown.includes('→')), 'As written: the staff labels are the part names again');
  assert.equal(await page.getByRole('button', { name: 'Voice for Piano', exact: true }).first().textContent(), pianoVoice, 'As written: the part\'s own sound again');
  await page.getByRole('button', { name: 'Close voice picker', exact: true }).click();
  await page.getByRole('button', { name: 'Close track mixer', exact: true }).click();
  // The staff's part icon opens the picker on Instrument.
  await page.locator('.part-control .instrument-control').first().click();
  assert.equal(await section('Instrument').getAttribute('aria-pressed'), 'true', 'The part icon opens the Instrument section');
  await page.getByRole('button', { name: 'Close voice picker', exact: true }).click();
  // A Sound pick on an unswitched part never makes it unswitchable: Timpani (pitched, with the drum kit icon).
  await page.getByRole('button', { name: 'Track mixer', exact: true }).click();
  await page.getByRole('button', { name: 'Voice for Piano', exact: true }).first().click();
  await picker.getByRole('button', { name: 'Percussion', exact: true }).click();
  await picker.getByRole('button', { name: 'Timpani', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Voice for Piano', exact: true }).first().textContent(), 'Timpani', 'Timpani sound picked on the unswitched piano');
  await page.getByRole('button', { name: 'Voice for Piano', exact: true }).first().click();
  assert.deepEqual([await picker.locator('.instrument-picker-sections').count(), await section('Instrument').count()], [1, 1], 'Timpani sound: the Instrument section is still offered');
  const timpaniTrumpet = await redraw(async () => { await section('Instrument').click(); await picker.getByRole('button', { name: 'Trumpet', exact: true }).click(); });
  assert.deepEqual([staffPitches(timpaniTrumpet, '1'), timpaniTrumpet.clefs], [['D5', 'F5'], { 1: 'G', 2: 'G' }], 'Timpani sound: the piano still switches to trumpet');
  await redraw(() => picker.getByRole('button', { name: 'As written', exact: true }).click());
  await page.getByRole('button', { name: 'Close voice picker', exact: true }).click();
  await page.getByRole('button', { name: 'Close track mixer', exact: true }).click();
  // The Pitch panel's hint names switched parts' written pitch only in the Transposing view (Concert shows sounding pitch).
  await live(pianoXml, { settings: { instrument: 'alto-saxophone' } });
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  assert.match(await page.locator('.pitch-hint').textContent(), /Switched parts show their instrument's written pitch/, 'Transposing view: the switched-part hint shows');
  await redraw(() => page.getByRole('button', { name: 'Concert', exact: true }).click());
  assert.doesNotMatch(await page.locator('.pitch-hint').textContent(), /Switched parts/, 'Concert view: no switched-part hint');
  // Hidden by the host: only the Sound grid.
  await live(pianoXml, { controls: { instrumentSwitch: false } });
  await page.locator('.part-control .instrument-control').first().click();
  assert.deepEqual([await picker.locator('.instrument-chooser, .instrument-picker-sections').count(), await picker.locator('.instrument-picker-grid button').count()], [0, 16], 'controls.instrumentSwitch false: no Instrument section, the Sound grid as before');
  // A drum kit part shows only Sound.
  const drumXml = '<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Drums</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>percussion</sign></clef></attributes><note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';
  await live(drumXml);
  await page.locator('.part-control .instrument-control').first().click();
  assert.deepEqual([await picker.locator('.instrument-chooser, .instrument-picker-sections').count(), await picker.locator('.instrument-picker-grid button').count() > 0], [0, true], 'Drum kit: Sound only');
  await page.evaluate(async () => (await import('/validation/instrument-switch-harness.ts')).unmountLive());
  console.log('Instrument switch: full reader picker (Instrument and Sound sections, trumpet, harp sound, level and fit, as written, hidden by the host, drum kit) passed');

  // --- The octave tool (Task 9) -----------------------------------------------------------------------------------
  const events = () => page.evaluate(() => window.__psEvents);
  const staffNote = (staff, index) => page.locator(`.instrument-switch-live .score-system svg g.staff[data-n="${staff}"] g.note`).nth(index).locator('.notehead').first();
  /** Wait until the drawn notes carrying ps-octave-selection are `expected` (a selection only re-applies highlights). */
  const selected = async expected => {
    await page.waitForFunction(want => JSON.stringify([...document.querySelectorAll('.instrument-switch-live .score-system svg .ps-octave-selection')].flatMap(el => (el.matches('g.note') ? [el] : [...el.querySelectorAll('g.note')]))
      .map(note => `${note.closest('g.staff')?.getAttribute('data-n')}:${(note.getAttribute('data-pname') || '').toUpperCase()}${note.getAttribute('data-oct')}`)) === JSON.stringify(want), expected, { timeout: 10000 })
      .catch(async () => assert.deepEqual((await readLive()).selection, expected, 'Selection'));
  };
  const toolbar = page.locator('.octave-toolbar');
  const openOctaveTool = async () => {
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    await page.locator('.pitch-panel .octave-tool-toggle').click();
    await toolbar.waitFor();
    await page.waitForFunction(() => document.activeElement?.classList.contains('octave-toolbar'), null, { timeout: 5000 });
    // The drawer slides away (a CSS transition) before notes can be clicked.
    await page.waitForFunction(() => document.querySelector('.bottom-drawer')?.getAnimations().length === 0);
  };
  await live(pianoXml, { listen: true });
  // Tool off: a note click is reported and seeks (the host clock).
  await staffNote('1', 0).click({ force: true });
  assert.ok((await events()).some(event => event.startsWith('click:')) && (await events()).some(event => event.startsWith('seek:')), 'Tool off: a note click reports and seeks');
  await openOctaveTool();
  assert.equal(await page.locator('.pitch-panel .octave-tool-toggle').getAttribute('aria-pressed'), 'true', 'The toggle is pressed while the tool is on');
  assert.equal(await page.locator('.bottom-drawer').getAttribute('aria-hidden'), 'true', 'Turning the tool on closes the drawer so notes can be tapped');
  assert.deepEqual(await toolbar.getByRole('button').allTextContents(), ['8va ↑', '8vb ↓', 'Select phrase', 'Reset', 'Done'], 'The octave toolbar buttons');
  assert.equal(await toolbar.locator('.octave-up').getAttribute('aria-label'), '8va ↑ Move selection up an octave', 'The accessible name starts with the visible text');
  assert.equal(await toolbar.locator('.octave-down').getAttribute('aria-label'), '8vb ↓ Move selection down an octave');
  assert.equal(await toolbar.locator('.octave-up').getAttribute('aria-disabled'), 'true', 'Nothing selected: 8va is unavailable');
  const before = (await events()).length;
  await staffNote('1', 0).click({ force: true });
  await selected(['1:C5']);
  assert.equal((await events()).length, before, 'Tool on: a note click selects; it neither seeks nor reports');
  await staffNote('1', 1).click({ force: true, modifiers: ['Shift'] });
  await selected(['1:C5', '1:E5']);
  assert.match(await toolbar.locator('.octave-toolbar-status').textContent(), /2 notes selected/, 'The toolbar names the selection');
  const upUi = await redraw(() => toolbar.locator('.octave-up').click());
  assert.deepEqual([staffPitches(upUi, '1'), staffPitches(upUi, '2'), upUi.clefs], [['C6', 'E6'], ['C3'], { 1: 'G', 2: 'F' }], '8va: the passage renders an octave up, nothing else changes');
  assert.deepEqual(upUi.transposed, ['1:C6', '1:E6'], 'Moved notes carry ps-transposed');
  await selected(['1:C6', '1:E6']);
  const downUi = await redraw(() => toolbar.locator('.octave-down').click());
  assert.deepEqual([staffPitches(downUi, '1'), downUi.transposed], [['C5', 'E5'], []], '8vb after 8va: back as written');
  // A plain second click selects the passage too; Select phrase; Reset clears the part's moves.
  await staffNote('2', 0).click({ force: true });
  await selected(['2:C3']);
  await staffNote('1', 0).click({ force: true });
  await staffNote('1', 1).click({ force: true });
  await selected(['1:C5', '1:E5']);
  await staffNote('1', 1).click({ force: true });
  await selected(['1:E5']);
  await toolbar.locator('.octave-phrase').click();
  await selected(['1:C5', '1:E5']);
  await redraw(() => toolbar.locator('.octave-down').click());
  const resetUi = await redraw(() => toolbar.locator('.octave-reset').click());
  assert.deepEqual([staffPitches(resetUi, '1'), resetUi.transposed], [['C5', 'E5'], []], 'Reset clears the octave moves');
  // Escape with the drawer open closes the drawer first; the next Escape exits the tool: the selection goes, clicks seek again.
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.bottom-drawer')?.getAttribute('aria-hidden') === 'true');
  assert.equal(await toolbar.count(), 1, 'Escape with the drawer open closes the drawer, the tool stays on');
  await page.keyboard.press('Escape');
  await toolbar.waitFor({ state: 'detached' });
  await selected([]);
  const afterExit = (await events()).length;
  await staffNote('1', 0).click({ force: true });
  assert.ok((await events()).length > afterExit, 'After Escape a note click reports and seeks again');
  // Past the range: the piano as alto sax (intermediate, sounding up to 77), C5 E5 an octave up are out of range.
  await live(pianoXml, { settings: { instrument: 'alto-saxophone' } });
  await openOctaveTool();
  await staffNote('1', 0).click({ force: true });
  await staffNote('1', 1).click({ force: true, modifiers: ['Shift'] });
  await selected(['1:A5', '1:C6']);
  const outUi = await redraw(() => toolbar.locator('.octave-up').click());
  assert.deepEqual(staffPitches(outUi, '1'), ['A6', 'C7'], 'Alto sax 8va: written an octave up');
  assert.deepEqual(outUi.outOfRange.sort(), ['1:A6', '1:C7'], 'Moved past the range: ps-out-of-range');
  await selected(['1:A6', '1:C7']);
  assert.equal((await readLive()).outOfRangeColor, 'rgb(198, 40, 40)', 'Selected out-of-range notes keep their colour (the selection is a halo)');
  assert.match(await toolbar.locator('.octave-toolbar-status').textContent(), /2 notes selected · Piano · 2 out of range/, 'The status counts the selected notes out of range');
  // 8vb on the left hand's auto-raised phrase (C3 below the alto, written A4): as written again (an explicit 0), flagged.
  await staffNote('2', 0).click({ force: true });
  await selected(['2:A4']);
  assert.deepEqual((await readLive()).transposed.filter(id => id.startsWith('2:')), ['2:A4'], 'The low phrase is auto-raised');
  const keptUi = await redraw(() => toolbar.locator('.octave-down').click());
  assert.deepEqual([staffPitches(keptUi, '2'), keptUi.transposed.filter(id => id.startsWith('2:')), keptUi.outOfRange.filter(id => id.startsWith('2:'))], [['A3'], [], ['2:A3']], '8vb on an auto-raised phrase: as written (written A3), out of range');
  const refitUi = await redraw(() => toolbar.locator('.octave-up').click());
  assert.deepEqual([staffPitches(refitUi, '2'), refitUi.transposed.filter(id => id.startsWith('2:'))], [['A4'], ['2:A4']], '8va from there: back to the auto-fit');
  await toolbar.locator('.octave-done').click();
  await toolbar.waitFor({ state: 'detached' });
  assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('pepperscore')), 'Done returns focus to the reader');
  // A transpose changes the auto-fit plan too, so it drops the "as written" pin the plan no longer overrides: +2 puts the
  // low phrase in the alto's range (no auto-raise left to pin against), and back at 0 the auto-raise applies again.
  await live(pianoXml, { settings: { instrument: 'alto-saxophone' } });
  await openOctaveTool();
  await staffNote('2', 0).click({ force: true });
  await selected(['2:A4']);
  const pinnedUi = await redraw(() => toolbar.locator('.octave-down').click());
  assert.deepEqual(staffPitches(pinnedUi, '2'), ['A3'], 'The 8vb pin shows the phrase as written');
  await toolbar.locator('.octave-done').click();
  await toolbar.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  const semitone = direction => page.locator(`.pitch-panel button[aria-label="Transpose ${direction} a semitone"]`);
  await redraw(() => semitone('up').click());
  await redraw(() => semitone('up').click());
  await redraw(() => semitone('down').click());
  const unpinnedUi = await redraw(() => semitone('down').click());
  assert.deepEqual([staffPitches(unpinnedUi, '2'), unpinnedUi.transposed.filter(id => id.startsWith('2:'))], [['A4'], ['2:A4']], 'Transposing away and back: the stale pin is gone and the low phrase is auto-raised again');
  // Saved: an octave move on an unswitched part is restored on reload.
  const persist = `octave-tool-${Date.now()}`;
  await live(pianoXml, { persist });
  await openOctaveTool();
  await staffNote('2', 0).click({ force: true });
  await selected(['2:C3']);
  await redraw(() => toolbar.locator('.octave-up').click());
  const saved = () => page.evaluate(async ns => (await import('/validation/instrument-switch-harness.ts')).savedOctaves(ns), persist);
  for (let attempt = 0; !Object.keys(await saved()).length; attempt++) { assert.ok(attempt < 50, 'The octave move is saved'); await delay(100); }
  assert.deepEqual(Object.values(await saved()).map(octaves => Object.values(octaves)), [[12]], 'The saved record holds the move on the left hand');
  await page.evaluate(async () => (await import('/validation/instrument-switch-harness.ts')).unmountLive());
  await live(pianoXml, { persist });
  const restored = await readLive();
  assert.deepEqual([staffPitches(restored, '1'), staffPitches(restored, '2'), restored.transposed], [['C5', 'E5'], ['C4'], ['2:C4']], 'Reload with persist restores the octave move');
  // Hidden by the host; the embed's instrument menu offers it when the host enables it.
  await live(pianoXml, { controls: { octaveTool: false } });
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  assert.equal(await page.locator('.octave-tool-toggle').count(), 0, 'controls.octaveTool false hides the toggle');
  await live(pianoXml, { chrome: 'minimal', controls: { instrumentSwitch: true } });
  await page.locator('.instrument-switch').click();
  await page.locator('.instrument-menu').waitFor();
  assert.equal(await page.locator('.octave-tool-toggle').count(), 0, 'Minimal chrome: the instrument menu has no octave tool by default');
  await live(pianoXml, { chrome: 'minimal', controls: { instrumentSwitch: true, octaveTool: true } });
  await page.locator('.instrument-switch').click();
  await page.locator('.instrument-menu .octave-tool-toggle').click();
  await toolbar.waitFor();
  assert.equal(await page.locator('.instrument-menu').count(), 0, 'The embed menu closes when the tool turns on');
  await staffNote('1', 0).click({ force: true });
  await selected(['1:C5']);
  const embedUp = await redraw(() => toolbar.locator('.octave-up').click());
  assert.deepEqual(staffPitches(embedUp, '1'), ['C6', 'E5'], 'Embed: 8va moves the selected note');
  // Without the instrument switcher, minimal chrome shows the tool's own compact button (corner; phone toolbar).
  await live(pianoXml, { chrome: 'minimal', controls: { octaveTool: true } });
  assert.equal(await page.locator('.instrument-switch').count(), 0, 'No instrument switcher');
  await page.locator('.ps-corner-controls .octave-tool-toggle-compact').click();
  await toolbar.waitFor();
  assert.equal(await page.locator('.octave-tool-toggle-compact').getAttribute('aria-pressed'), 'true', 'The compact entry is pressed');
  await staffNote('1', 1).click({ force: true });
  await selected(['1:E5']);
  await page.evaluate(async () => (await import('/validation/instrument-switch-harness.ts')).unmountLive());
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phonePage = await phone.newPage();
  phonePage.on('pageerror', error => errors.push(error.message));
  await phonePage.goto(`${baseUrl}/validation/performance.html`);
  for (let attempt = 0; ; attempt++) {
    try { await phonePage.evaluate(async xml => (await import('/validation/instrument-switch-harness.ts')).mountLive(xml, { chrome: 'minimal', controls: { octaveTool: true } }), pianoXml); break; }
    catch (error) { if (attempt > 5) throw error; await phonePage.waitForLoadState('load'); }
  }
  await phonePage.locator('.ps-embed-toolbar .octave-tool-toggle-compact').click();
  await phonePage.locator('.octave-toolbar').waitFor();
  assert.equal(await phonePage.locator('.ps-corner-controls .octave-tool-toggle').count(), 0, 'Phone: the compact entry sits in the bottom toolbar, not the corner');
  await phone.close();
  console.log('Instrument switch: octave tool (select, Shift/second-click passage, phrase, 8va/8vb, out of range, auto-fit kept as written, reset, Escape, focus, saved, hidden, embed menu and compact entry) passed');

  // The reader's own render with forced chunks (the worker's chunk path and its spelling cache).
  const chunkedPage = await browser.newPage();
  chunkedPage.on('pageerror', error => errors.push(error.message));
  await chunkedPage.addInitScript(() => localStorage.setItem('scoreflow-chunking', JSON.stringify({ force: true, budget: 4 })));
  await chunkedPage.goto(`${baseUrl}/validation/performance.html`);
  for (let attempt = 0; ; attempt++) {
    try { await chunkedPage.evaluate(() => import('/validation/instrument-switch-harness.ts')); break; }
    catch (error) { if (attempt > 5) throw error; await chunkedPage.waitForLoadState('load'); }
  }
  const render = test => chunkedPage.evaluate(async ([xml, test]) => (await import('/validation/instrument-switch-harness.ts')).renderSwitch(xml, test), [longXml, test]);
  const plain = await render({ switches: {} });
  assert.ok(plain.chunked && plain.systems >= 20, `The reader engraves the long score in chunks (${plain.systems} systems)`);
  assert.ok(plain.notes.length >= 80 && plain.notes.some(note => note.pname === 'E' && note.oct === 2), 'As written: the cello line is drawn at its own pitch');
  const switched = await render({ switches: { 0: alto } });
  assert.equal(switched.notes.length, plain.notes.length, 'Every note is drawn when switched');
  const wrongRendered = switched.notes.filter(note => expectLong({ ...note, alter: note.pname === 'C' ? 1 : 0 }).startsWith('unexpected')).map(note => `${note.id} ${note.pname}${note.oct}`);
  assert.deepEqual(wrongRendered, [], 'Chunked render: switched notes and both notes of every tie (across chunk boundaries too) are moved');
  // The worker's spelled-MEI caches are keyed by the whole spelling spec, so the switch is never served stale.
  const again = await render({ switches: {} });
  assert.deepEqual(again.notes.map(note => `${note.pname}${note.oct}`), plain.notes.map(note => `${note.pname}${note.oct}`), 'Back to as written: the cached chunks are not reused for the other view');
  const worker = readFileSync(new URL('../packages/pepperscore/src/lib/verovio.worker.ts', import.meta.url), 'utf8');
  assert.match(worker, /const key = JSON\.stringify\(spec\);/, 'Whole-score spelling cache key is the spelling spec');
  assert.match(worker, /const key = `\$\{from\}-\$\{to\}\|\$\{JSON\.stringify\(spec\)\}`;/, 'Chunk spelling cache key includes the spelling spec');
  await chunkedPage.close();
  console.log('Instrument switch: chunked reader render moves tied notes across chunk boundaries; caches keyed by the spec passed');
  assert.deepEqual(errors, [], 'No page errors');
} finally {
  await browser?.close();
  server.kill();
}
