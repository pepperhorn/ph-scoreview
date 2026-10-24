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
    const wrong = result.notes.filter(note => result.pitches[note.id] && name(note) !== scoreName(result.pitches[note.id])).map(note => `${note.id}: ${name(note)} vs ${scoreName(result.pitches[note.id])}`);
    assert.deepEqual(wrong, [], `${label}: engraved pitches match the display Score`);
    assert.ok(result.notes.every(note => result.pitches[note.id]), `${label}: every drawn note has a Score pitch (Pitch.sourceId = MEI id)`);
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
