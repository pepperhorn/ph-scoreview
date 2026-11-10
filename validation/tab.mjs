// Guitar TAB view (docs/specs/guitar-tab.md). Part 1 runs the pipeline in a page served by a private Vite server
// (validation/tab-harness.ts, as validation/transpose.mjs): an imported TAB staff is flagged and never performed (the
// timeline has the notation notes once), the Notation / TAB / Both views engrave the right staves, a notation-only
// guitar score gets one generated tabGrp per note or chord, transposing replaces imported TAB with regenerated frets,
// chord symbols survive the TAB-only view, chunked engraving keeps fingerings, and settings survive a saved record.
// Part 2 drives the built demo reader (apps/reader/dist; run `npm run build` first): the switch shows for guitar and
// hides for piano scores, flips the engraving, lists the guitar once, follows transposition, persists per score and sits in the
// More panel on a phone. BROWSER=chromium|firefox|webkit for part 2 (part 1 always runs on Chromium).
import assert from 'node:assert/strict';
import { startVite } from './lib/ports.mjs';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, firefox, webkit } from 'playwright-core';
import { serveDist } from './serve-dist.mjs';

const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const fixturePath = name => new URL(`./fixtures/${name}`, import.meta.url).pathname;
const STAVES = fixture('guitar-tab-staves.musicxml'), PARTS = fixture('guitar-tab-parts.musicxml'), NOTATION = fixture('guitar-notation.musicxml'), ENSEMBLE = fixture('ensemble.musicxml');
const OCTAVE = fixture('guitar-octave-tab.musicxml'), CLARINET = fixture('guitar-tab-clarinet.musicxml'), VOICES = fixture('guitar-voices.musicxml'), TAB_ONLY = fixture('guitar-tab-only.musicxml'), REPEAT = fixture('guitar-repeat-fermata.musicxml');
const UNISON = fixture('guitar-unison.musicxml');
const DRUMS = '<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Drums</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>percussion</sign></clef></attributes><note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';
const TUNING = [40, 45, 50, 55, 59, 64];
/** A TAB note's sounding pitch (course 1 is the highest string). */
const pitchOf = (note, tuning = TUNING, capo = 0) => tuning[tuning.length - note.course] + capo + note.fret;
const sorted = list => [...list].sort((a, b) => a - b);
const engine = process.env.BROWSER || 'chromium';
const launcher = { chromium, firefox, webkit }[engine];
if (!launcher) throw new Error(`BROWSER must be chromium, firefox or webkit (got "${engine}")`);

// --- Part 1: the pipeline -------------------------------------------------------------------------------------------
const { port, server: vite } = await startVite();
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
  // The first import makes Vite optimize new dependencies and reload the page: import until it is stable.
  for (let attempt = 0; ; attempt++) {
    try { await page.evaluate(() => import('/validation/tab-harness.ts')); await delay(1500); await page.evaluate(() => import('/validation/tab-harness.ts')); break; }
    catch (error) { if (attempt > 5) throw error; await page.waitForLoadState('load'); }
  }
  const call = (name, ...args) => page.evaluate(async ([name, args]) => (await import('/validation/tab-harness.ts'))[name](...args), [name, args]);

  // 1. Parser: an imported TAB staff (or part) doubles the notation part, is flagged, and is performed once.
  const notation = await call('parts', NOTATION);
  for (const [name, xml, tabId, partnerId] of [['TAB staff', STAVES, 'P1-2', 'P1-1'], ['TAB part', PARTS, 'P2-1', 'P1-1']]) {
    const read = await call('parts', xml);
    const tab = read.parts.find(part => part.id === tabId);
    assert.ok(tab?.tab && tab.clef === 'tab', `${name}: the TAB staff is flagged (${JSON.stringify(read.parts)})`);
    assert.equal(tab.tabOf, partnerId, `${name}: the TAB staff doubles the notation part`);
    assert.deepEqual(read.timelineParts, [partnerId], `${name}: only the notation part is performed`);
    assert.equal(read.timelineNotes, notation.timelineNotes, `${name}: the timeline has the notation notes once (${read.timelineNotes} == ${notation.timelineNotes})`);
    assert.equal(read.pitches[partnerId], read.pitches[tabId], `${name}: the TAB staff holds the same notes`);
  }
  assert.equal((await call('parts', NOTATION)).parts.every(part => !part.tab), true, 'A notation-only score has no TAB parts');
  assert.equal(notation.canShowTab, true, 'A guitar score can show TAB');
  assert.equal((await call('parts', ENSEMBLE)).canShowTab, false, 'A piano score has no TAB option');
  assert.equal((await call('parts', DRUMS)).canShowTab, false, 'A drums-only score cannot show TAB');
  console.log(`TAB: an imported TAB staff or part is flagged, linked to its notation part and performed once (${notation.timelineNotes} notes) passed`);

  // 2. Imported TAB: Notation hides it, TAB shows it alone, Both shows both; chord symbols move onto it in TAB view.
  const imported = { notation: await call('engraveTab', STAVES, { view: 'notation' }), tab: await call('engraveTab', STAVES, { view: 'tab' }), both: await call('engraveTab', STAVES, { view: 'both' }) };
  assert.deepEqual(imported.notation.staves, ['1'], 'Imported TAB, Notation view: the notation staff only');
  assert.deepEqual(imported.tab.staves, ['2'], 'Imported TAB, TAB view: the imported TAB staff only');
  assert.deepEqual(imported.both.staves, ['1', '2'], 'Imported TAB, Both view: notation and TAB');
  for (const view of ['tab', 'both']) assert.deepEqual(imported[view].generate, [], `Imported TAB, ${view}: nothing is generated`);
  assert.ok(imported.tab.harm.length === 4 && imported.tab.harm.every(staff => staff === '2') && imported.tab.drawnHarm === 4, `Imported TAB, TAB view: chord symbols move to the TAB staff (${imported.tab.harm})`);
  assert.equal(imported.both.harm.every(staff => staff === '1'), true, 'Both view: chord symbols stay on the notation staff');
  console.log('TAB: imported TAB staff shows in TAB and Both views only, with chord symbols in TAB view passed');

  // 3. Generated TAB for a notation-only guitar score: one tabGrp per note or chord, every pitch fingered.
  const generated = { notation: await call('engraveTab', NOTATION, { view: 'notation' }), tab: await call('engraveTab', NOTATION, { view: 'tab' }), both: await call('engraveTab', NOTATION, { view: 'both' }) };
  const events = notation.timelineNotes;
  assert.deepEqual(generated.notation.staves, ['1']); assert.equal(generated.notation.tabGroups, 0, 'Notation view: no TAB');
  assert.deepEqual(generated.tab.staves, ['101'], 'TAB view: the generated TAB staff (100 + n) replaces the notation staff');
  assert.deepEqual(generated.both.staves, ['1', '101'], 'Both view: the TAB staff follows the notation staff');
  // 4 bars: 5 + 4 + 4 + 3 notes or chords, less none (a tied note keeps its tabGrp, without a fret).
  assert.equal(generated.tab.tabGroups, 15, `One tabGrp per note or chord (${generated.tab.tabGroups})`);
  assert.equal(generated.tab.svgTabGroups, generated.tab.tabGroups, 'Every tabGrp is drawn');
  assert.equal(generated.tab.tabNotes.length, notation.pitches['P1-1'], `Every sounding pitch has a fret (${generated.tab.tabNotes.length} of ${notation.pitches['P1-1']})`);
  // Plus the tied-into note of bar 3, drawn invisibly so its tabGrp keeps its stem.
  assert.equal(generated.tab.notesByStaff['101'], notation.pitches['P1-1'] + 1, 'Every fret is drawn on the TAB staff');
  assert.equal(generated.both.tabNotes.length, generated.tab.tabNotes.length, 'Both view draws the same TAB');
  assert.ok(generated.tab.harm.every(staff => staff === '101') && generated.tab.drawnHarm === 4, `Chord symbols survive the TAB-only view (${generated.tab.harm})`);
  // The C chord of bar 1 is the open shape: x32010.
  const firstChord = generated.tab.tabNotes.slice(0, 5).map(note => `${note.course}:${note.fret}`).sort();
  assert.deepEqual(firstChord, ['1:0', '2:1', '3:0', '4:2', '5:3'], `Open C chord (${firstChord})`);
  const basePitches = sorted(generated.tab.tabNotes.map(note => pitchOf(note)));
  console.log(`TAB: a notation-only guitar score gets ${generated.tab.tabGroups} tabGrps and ${generated.tab.tabNotes.length} frets in TAB and Both views passed`);

  // 4. Transposition: generated frets follow the transposed pitches; imported TAB (stale frets) is replaced by generated TAB.
  // Down a minor third the six-note G chord becomes E G# B E G# E: G#2 has no string of its own, so the solver drops
  // that inner voice (unplayable) rather than fail; every other note sounds its transposed pitch.
  const within = (actual, expected, drops, message) => {
    const left = [...expected];
    for (const pitch of actual) { const at = left.indexOf(pitch); assert.ok(at >= 0, `${message}: ${pitch} is not a transposed note`); left.splice(at, 1); }
    assert.ok(left.length <= drops, `${message}: ${left.length} notes unfingered (${left})`);
  };
  for (const [semitones, drops] of [[2, 0], [-3, 1]]) {
    const moved = await call('engraveTab', NOTATION, { view: 'tab', semitones });
    within(moved.tabNotes.map(note => pitchOf(note)), basePitches.map(pitch => pitch + semitones), drops, `${semitones > 0 ? '+' : ''}${semitones}: frets sound the transposed pitches`);
    const movedImported = await call('engraveTab', STAVES, { view: 'both', semitones });
    assert.deepEqual(movedImported.staves, ['1', '101'], `${semitones}: imported TAB is hidden and TAB is generated`);
    assert.ok(movedImported.hiddenStaves.includes('2'), 'The stale imported TAB staff is hidden');
    within(movedImported.tabNotes.map(note => pitchOf(note)), basePitches.map(pitch => pitch + semitones), drops, `${semitones}: regenerated frets match the transposed notes`);
  }
  console.log('TAB: transposed views regenerate frets (imported TAB replaced) passed');

  // 5. Tuning and capo: frets are relative to the capo and sound the written pitches; MusicXML string/fret are kept.
  const capo = await call('engraveTab', NOTATION, { view: 'tab', capo: 2 });
  // With a capo at 2 the open strings rise a tone: the full G chord's D3 has no string left, so it is dropped.
  within(capo.tabNotes.map(note => pitchOf(note, TUNING, 2)), basePitches, 1, 'Capo 2: frets relative to the capo');
  assert.ok(capo.tabNotes.some(note => note.fret === 0) && capo.tabNotes.every(note => note.fret <= 12), 'Capo 2: open strings are the capo fret');
  const dropD = [38, 45, 50, 55, 59, 64];
  const dropped = await call('engraveTab', NOTATION, { view: 'tab', tuning: dropD });
  assert.deepEqual(sorted(dropped.tabNotes.map(note => pitchOf(note, dropD))), basePitches, 'Drop D: frets for the tuning');
  // MusicXML <technical> string/fret on a notation note (a "preprocessed" score) is a fixed fingering: C3 on string 6.
  const fixedXml = NOTATION.replace('<note id="g1-6"><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type></note>',
    '<note id="g1-6"><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><notations><technical><string>6</string><fret>8</fret></technical></notations></note>');
  assert.notEqual(fixedXml, NOTATION, 'The fixture note to fix was found');
  const fixedNote = (await call('engraveTab', fixedXml, { view: 'tab' })).tabNotes.find(note => note.id === 'g1-6-tabn');
  assert.deepEqual(fixedNote && [fixedNote.course, fixedNote.fret], [6, 8], 'A MusicXML string/fret is kept as a fixed fingering');
  const movedFixed = (await call('engraveTab', fixedXml, { view: 'tab', semitones: 2 })).tabNotes.find(note => note.id === 'g1-6-tabn');
  assert.ok(movedFixed && movedFixed.course !== 6, `Transposed: the stale fingering is not forced (${JSON.stringify(movedFixed)})`);
  console.log('TAB: capo, tuning and fixed MusicXML fingerings passed');

  // 6. Chunked engraving: three-bar chunks with one bar of overlap keep the whole score's fingerings per note.
  const chunked = await call('engraveTab', NOTATION, { view: 'tab', slices: 3 });
  assert.deepEqual(chunked.chunks.tabNotes.filter(note => note.id.endsWith('(changed)')), [], 'A note keeps its fret in every chunk that draws it');
  const chunkIds = new Set(chunked.chunks.tabNotes.map(note => note.id));
  assert.deepEqual(generated.tab.tabNotes.filter(note => !chunkIds.has(note.id)), [], 'Chunks finger every note');
  // A tie continued from before a chunk shows its fret there (it has no start in that document); nothing else is extra.
  assert.ok(chunked.chunks.tabNotes.length - generated.tab.tabNotes.length <= 1, 'Only the tied note at a chunk start is extra');
  console.log('TAB: chunked engraving keeps fingerings across chunks passed');

  // 7. Non-string scores never get generated TAB.
  const piano = await call('engraveTab', ENSEMBLE, { view: 'both' });
  assert.deepEqual(piano.generate, []);
  assert.equal(piano.tabGroups, 0);
  const report = name => readFileSync(new URL('../docs/handoffs/assets/2026-11-10-octave-clef-tab/cases/' + name, import.meta.url), 'utf8');
  const bassTuning = [28, 33, 38, 43];
  const bass = await call('engraveTab', report('h-bass-sounding.musicxml'), { view: 'both' });
  assert.equal(bass.staffLines['101'], 4, 'Bass defaults to four strings');
  assert.equal(bass.drawnLines['101'], 4, 'Four bass lines are engraved');
  assert.deepEqual(bass.tabNotes.map(note => pitchOf(note, bassTuning)),
    [36,40,43,45,31,35,38,41], 'Bass notes retain sounding pitch');
  for (const name of ['e-guitar.abc', 'e-guitar.musicxml', 'e2-guitar-sounding.musicxml']) {
    const data = report(name);
    const source = name.endsWith('.abc') ? { abc: data } : data;
    for (const switches of [undefined, ...(name.endsWith('.abc') ? [{ 0: { instrument: 'guitar', level: 'advanced', autoRange: false, octaves: {} } }] : [])]) {
      const guitar = await call('engraveTab', source, { view: 'both', switches });
      assert.deepEqual(guitar.tabNotes.slice(0, 8).map(note => note.fret), [0,2,0,5,3,0,2,3], name + ': octave-clef run frets preserved');
    }
  }
  for (const [name, strings] of [['Ukulele',4], ['Tenor Ukulele',4], ['Baritone Ukulele',4], ['Bass Ukulele',4]]) {
    const xml = NOTATION.replaceAll('Guitar', name);
    const result = await call('engraveTab', xml, { view: 'both' });
    assert.equal(result.staffLines['101'], strings, name + ': staff count');
    assert.equal(result.drawnLines['101'], strings, name + ': drawn lines');
  }
  for (const name of ['a-piano-grand.abc', 'c-cello.abc']) {
    const abc = readFileSync(new URL('../docs/handoffs/assets/2026-11-09-abc-import-spike/cases/' + name, import.meta.url), 'utf8');
    assert.equal((await call('parts', { abc })).canShowTab, false, name + ': no TAB option');
    assert.equal((await call('engraveTab', { abc }, { view: 'both' })).tabGroups, 0, name + ': no generated TAB');
  }
  console.log('TAB: non-string exclusion, bass and ukulele defaults, octave-clef regressions passed');

  // 8. Settings: host settings map to prefs, survive a saved per-score record, and bad or missing values get defaults.
  const round = await call('settingsRoundTrip', { tabView: 'both', tabTuning: dropD, capo: 3, bpm: 120.4, keyFlip: true }, NOTATION);
  assert.deepEqual(round.mapped, { tabView: 'both', tabTuning: dropD, capo: 3, bpm: 120, keyFlip: true }, 'Settings map to prefs');
  assert.deepEqual(round.read, { tabView: 'both', tabTuning: dropD, capo: 3, bpm: 120, keyFlip: true }, 'A saved record reads back the TAB settings, BPM and key flip');
  assert.deepEqual(round.legacyKeys, [], 'A record without TAB settings reads without them');
  const current = { tabView: 'both', tabTuning: dropD, capo: 5 };
  assert.deepEqual(round.legacy, current, 'A record without TAB settings keeps the current TAB settings');
  assert.deepEqual(round.invalid, { ...current, capo: 12 }, 'Unusable TAB settings keep the current ones (an out-of-range capo is clamped)');
  assert.equal(round.fractional, 3, 'A fractional saved capo is rounded');
  assert.deepEqual(round.sanitized, { tabView: 'notation', tabTuning: TUNING, capo: 0, bpm: 240 }, 'Saved global prefs are repaired');
  assert.equal(round.sanitizedCapo, 3, 'A fractional saved global capo is rounded');
  assert.deepEqual(round.sanitizedTunings, [6, 4, 7, 6], 'A TAB tuning has 4 to 8 strings');
  const clamped = await call('settingsRoundTrip', { tabView: 'lute', capo: 40, bpm: 5, tabTuning: [] }, NOTATION);
  assert.deepEqual(clamped.mapped, { capo: 12, bpm: 30 }, 'Out-of-range settings are clamped or ignored');
  assert.equal((await call('settingsRoundTrip', { capo: 2.5 }, NOTATION)).mapped.capo, 3, 'A fractional host capo is rounded');
  console.log('TAB: settings round trip (prefs, saved record, legacy record, repair) passed');

  // 9. Transposing guitars: an octave-transposing guitar (written an octave above sounding) and its TAB part.
  const octaveParts = await call('parts', OCTAVE);
  assert.equal(octaveParts.parts.find(part => part.id === 'P2-1')?.tabOf, 'P1-1', `A TAB part at sounding pitch doubles the octave-transposing guitar (${JSON.stringify(octaveParts.parts)})`);
  assert.deepEqual(octaveParts.timelineParts, ['P1-1'], 'The transposing guitar and its TAB part play once');
  for (const view of ['tab', 'both']) {
    const both = await call('engraveTab', OCTAVE, { view });
    assert.deepEqual(both.generate, [], `Octave guitar, ${view}: the imported TAB part is used, nothing is generated`);
  }
  const octaveOnly = OCTAVE.replace(/<score-part id="P2">[\s\S]*?<\/score-part>/, '').replace(/<part id="P2">[\s\S]*?<\/part>/, '');
  for (const pitch of ['written', 'concert']) {
    const generated = await call('engraveTab', octaveOnly, { view: 'tab', pitch });
    assert.deepEqual(generated.tabNotes.map(note => pitchOf(note)), [40, 45, 55, 64], `Octave guitar, ${pitch} view: frets sound the guitar's pitches`);
  }
  // A transposing part elsewhere in the score (a clarinet in the concert view) does not make the guitar's TAB stale.
  const clarinet = await call('engraveTab', CLARINET, { view: 'both', pitch: 'concert' });
  assert.deepEqual(clarinet.generate, [], 'Concert view of another part: the imported TAB is kept');
  assert.ok(clarinet.staves.includes('2'), `Concert view of another part: the imported TAB staff shows (${clarinet.staves})`);
  console.log('TAB: an octave-transposing guitar gets frets at sounding pitch and keeps its TAB part passed');

  // A piano switched to guitar (written an octave above sounding): the written view's TAB frets sound the piano's
  // pitches (RH C5 E5, LH C3), not the octave above, in the written and concert views.
  const switchPiano = fixture('instrument-switch-piano.musicxml');
  const toGuitar = { instrument: 'guitar', level: 'advanced', autoRange: true, octaves: {} };
  for (const pitch of ['written', 'concert']) {
    const switched = await call('engraveTab', switchPiano, { view: 'tab', pitch, switches: { 0: toGuitar, 1: toGuitar } });
    assert.deepEqual(switched.generate.length, 2, `Piano as guitar, ${pitch} view: both staves get generated TAB`);
    assert.deepEqual(sorted(switched.tabNotes.map(note => pitchOf(note))), [48, 72, 76], `Piano as guitar, ${pitch} view: frets sound the piano's pitches (${JSON.stringify(switched.tabNotes)})`);
  }
  // Both view: every staff of the grand staff switched to guitar keeps its notation and gets its own TAB staff (the
  // left hand too, not only the first staff), each fretting its own notes: RH C5 E5 (B string 13, high E 12), LH C3
  // (A string 3).
  for (const pitch of ['written', 'concert']) {
    const both = await call('engraveTab', switchPiano, { view: 'both', pitch, switches: { 0: toGuitar, 1: toGuitar } });
    assert.deepEqual(both.generate, ['1', '2'], `Piano as guitar, Both ${pitch} view: both staves get generated TAB`);
    assert.deepEqual(both.staves, ['1', '101', '2', '102'], `Piano as guitar, Both ${pitch} view: each notation staff is followed by its TAB staff`);
    const frets = n => (both.staffNotes[n] ?? []).map(note => [note.course, note.fret, pitchOf(note)]);
    assert.deepEqual(frets('101'), [[2, 13, 72], [1, 12, 76]], `Piano as guitar, Both ${pitch} view: the right hand's TAB frets C5 E5`);
    assert.deepEqual(frets('102'), [[5, 3, 48]], `Piano as guitar, Both ${pitch} view: the left hand's TAB frets C3`);
  }
  // With a transposition and a capo: frets (relative to the capo) sound the piano's pitches moved by the semitones.
  for (const pitch of ['written', 'concert']) for (const [semitones, capo] of [[2, 2], [-3, 4]]) {
    const switched = await call('engraveTab', switchPiano, { view: 'tab', pitch, semitones, capo, switches: { 0: toGuitar, 1: toGuitar } });
    assert.deepEqual(switched.generate.length, 2, `Piano as guitar ${semitones > 0 ? '+' : ''}${semitones}, capo ${capo}, ${pitch} view: both staves get generated TAB`);
    assert.deepEqual(sorted(switched.tabNotes.map(note => pitchOf(note, TUNING, capo))), [48, 72, 76].map(midi => midi + semitones), `Piano as guitar ${semitones > 0 ? '+' : ''}${semitones}, capo ${capo}, ${pitch} view: frets sound the transposed pitches (${JSON.stringify(switched.tabNotes)})`);
    assert.ok(switched.tabNotes.every(note => note.fret >= 0), `Piano as guitar, capo ${capo}: no fret below the capo`);
  }
  console.log('TAB: a part switched to guitar gets frets at its sounding pitch (with transposition and capo) passed');

  // 10. Capo and tuning at the TAB boundary: a fractional capo is rounded; the TAB staff has one line per string.
  const fractionalCapo = await call('engraveTab', NOTATION, { view: 'tab', capo: 2.5 });
  within(fractionalCapo.tabNotes.map(note => pitchOf(note, TUNING, 3)), basePitches, 1, 'Capo 2.5 is a capo at 3');
  for (const tuning of [[35, 40, 45, 50, 55, 59, 64], [28, 33, 38, 43]]) {
    const strings = await call('engraveTab', NOTATION, { view: 'tab', tuning });
    assert.equal(strings.staffLines['101'], tuning.length, `${tuning.length} strings: the TAB staffDef has ${tuning.length} lines`);
    assert.equal(strings.drawnLines['101'], tuning.length, `${tuning.length} strings: ${tuning.length} lines are drawn (${strings.drawnLines['101']})`);
    assert.ok(strings.tabNotes.every(note => note.course >= 1 && note.course <= tuning.length), `${tuning.length} strings: every course is a string`);
  }
  console.log('TAB: fractional capo and 4- and 7-string tunings passed');

  // 11. Voices: a note held in voice 2 keeps its string while voice 1 moves (events are fingered in time order).
  const voices = await call('engraveTab', VOICES, { view: 'tab' });
  const held = voices.tabNotes.find(note => note.id === 'v2-1-tabn');
  assert.ok(held, 'The held note is fingered');
  for (const note of voices.tabNotes.filter(note => note.id.startsWith('v1-'))) assert.notEqual(note.course, held.course, `${note.id} is not on the held note's string (${JSON.stringify(voices.tabNotes)})`);
  // Notes starting together in two voices are one chord (different strings); a unison across voices is one string,
  // held as long as the longer note, and a tie continuation in either voice keeps that fingering.
  const voiceNote = id => voices.tabNotes.find(note => note.id === `${id}-tabn`);
  assert.notEqual(voiceNote('v1-1').course, held.course, 'Notes starting together in two voices are on different strings');
  const unison = await call('engraveTab', UNISON, { view: 'tab' });
  const u = id => unison.tabNotes.find(note => note.id === `${id}-tabn`);
  assert.ok(u('a1') && u('b1'), `Both unison notes are drawn (${JSON.stringify(unison.tabNotes)})`);
  assert.deepEqual([u('b1').course, u('b1').fret], [u('a1').course, u('a1').fret], 'A unison across voices has one string and fret');
  assert.notEqual(u('a2').course, u('a1').course, 'G4 avoids the string of the unison E4 still held in voice 2');
  assert.deepEqual([u('d1').course, u('d1').fret], [u('c1').course, u('c1').fret], 'A unison whose voice 1 note is tied: one string and fret');
  const heldD = unison.staffNotes['101'].filter(note => !note.visible);
  assert.deepEqual(heldD.map(note => [note.course, note.fret]), [[u('c1').course, u('c1').fret]], 'The tie continuation of the unison is held on its string');
  for (const note of unison.tabNotes) assert.equal(pitchOf(note), { a1: 64, a2: 67, a3: 69, b1: 64, b2: 45, c1: 62, c3: 67, d1: 62, d2: 59, d3: 43 }[note.id.replace(/-tabn$/, '')], `${note.id} sounds its pitch`);
  // MEI tab.course without tab.fret on a notation note (a string-only fingering) fixes the string, not the fret.
  const stringOnly = await call('injectTabMei', '<mei><music><body><mdiv><score><scoreDef><staffGrp><staffDef n="1" lines="5"/></staffGrp></scoreDef><section><measure n="1"><staff n="1"><layer n="1"><note xml:id="s1" pname="e" oct="4" dur="4" tab.course="3"/><note xml:id="s2" pname="e" oct="4" dur="4"/></layer></staff></measure></section></score></mdiv></body></music></mei>', { generate: ['1'], retarget: {}, tuning: TUNING, capo: 0, fixed: true });
  assert.ok(/<note xml:id="s1-tabn" tab.course="3" tab.fret="9"\/>/.test(stringOnly), `tab.course alone is a string constraint (${stringOnly.match(/<note xml:id="s1-tabn"[^>]*>/)?.[0]})`);
  console.log('TAB: voices are fingered in time order, same-onset voices are one chord, unisons share a string passed');

  // 12. A TAB-only score (no notation partner): transposed, its frets are re-fingered to sound the transposed pitches.
  const tabOnly = { plain: await call('engraveTab', TAB_ONLY, { view: 'notation' }), moved: await call('engraveTab', TAB_ONLY, { view: 'notation', semitones: 2 }) };
  const onlyPitches = tabOnly.plain.staffNotes['1'].map(note => pitchOf(note));
  assert.equal(onlyPitches.length, (await call('parts', TAB_ONLY)).pitches['P2-1'] + 1, 'TAB only: every note has a fret (the tied note twice)');
  assert.deepEqual(tabOnly.moved.staffNotes['1'].map(note => pitchOf(note)), onlyPitches.map(pitch => pitch + 2), 'TAB only, +2: frets sound the transposed pitches');
  console.log('TAB: a transposed TAB-only score is re-fingered passed');

  // 13-15. A tied-into note keeps its rhythm on the TAB staff; measure repeats and fermatas show on TAB.
  assert.ok(generated.tab.stems.includes('g3-1-tab'), `The tied-into note of bar 3 keeps its stem (${generated.tab.stems.length} stems)`);
  assert.ok(generated.tab.staffNotes['101'].some(note => !note.visible), 'The tied-into note has no visible fret');
  const extras = { notation: await call('engraveTab', REPEAT, { view: 'notation' }), tab: await call('engraveTab', REPEAT, { view: 'tab' }), both: await call('engraveTab', REPEAT, { view: 'both' }) };
  assert.equal(extras.notation.repeats, 1, 'The measure repeat is drawn in notation');
  assert.equal(extras.tab.repeats, 1, `TAB view: the measure repeat is drawn on the TAB staff (${extras.tab.repeats})`);
  assert.equal(extras.both.repeats, 2, 'Both view: the measure repeat is drawn on both staves');
  assert.equal(extras.notation.fermatas, 1, 'The fermata is drawn in notation');
  assert.equal(extras.tab.fermatas, 1, `TAB view: the fermata moves to the TAB staff (${extras.tab.fermatas})`);
  console.log('TAB: tie continuations keep their rhythm; measure repeats and fermatas show on TAB passed');

  // 16. Reader parts: with no part mapped to a staff every part shows; a hidden TAB part never hides its guitar.
  const unmapped = await call('unmappedStaffCount', ENSEMBLE);
  assert.equal(unmapped.staffCount, unmapped.parts, `No part mapped: one staff per part (${JSON.stringify(unmapped)})`);
  const restored = {
    tabHidden: await call('restoredHidden', PARTS, { 'P1-1': true, 'P2-1': false }),
    notationHidden: await call('restoredHidden', PARTS, { 'P1-1': false, 'P2-1': true }),
    bothHidden: await call('restoredHidden', PARTS, { 'P1-1': false, 'P2-1': false }),
    oldRecord: await call('restoredHidden', PARTS, { 'P1-1': false }),
  };
  assert.deepEqual(restored.tabHidden.hidden, [], 'A hidden TAB part hides nothing');
  assert.deepEqual(restored.notationHidden.hidden, [], 'Hidden notation with its TAB part shown keeps the guitar');
  assert.deepEqual(restored.bothHidden.hidden, ['P1-1'], 'Hidden notation and TAB hide the guitar');
  assert.deepEqual(restored.oldRecord.hidden, ['P1-1'], 'A hidden guitar stays hidden');
  assert.deepEqual(restored.bothHidden.saved, { 'P1-1': false, 'P2-1': false }, 'A TAB part is saved with its guitar\'s visibility');
  assert.deepEqual(restored.tabHidden.saved, { 'P1-1': true, 'P2-1': true }, 'A shown guitar saves its TAB part shown');
  console.log('TAB: staff count without mapped parts and hidden TAB parts passed');
  assert.deepEqual(errors, [], 'No page errors');
} finally {
  await browser?.close();
  vite.kill();
}

// --- Part 2: the reader -----------------------------------------------------------------------------------------
const server = await serveDist();
browser = await launcher.launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/poppins/i, route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const drawn = () => page.evaluate(() => ({
    staves: [...new Set([...document.querySelectorAll('.score-system g.staff')].map(staff => staff.getAttribute('data-n')))].sort(),
    tabGroups: document.querySelectorAll('.score-system g.tabGrp').length,
    parts: [...document.querySelectorAll('.part-control .part-name')].map(name => name.textContent),
    pressed: document.querySelector('.tab-view-toggle-header [aria-pressed="true"]')?.className.match(/tab-view-toggle-(\w+)/)?.[1] ?? null,
  }));
  const settled = async (check, message) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const state = await drawn();
      if (check(state)) return state;
      await delay(250);
    }
    throw new Error(`${message}: ${JSON.stringify(await drawn())}`);
  };
  const choose = view => page.locator(`.tab-view-toggle-header .tab-view-toggle-${view}`).click();
  await page.goto(server.url);
  await page.waitForSelector('.score-system svg', { timeout: 60000 });
  // The built-in sample is piano: no TAB option or generated staff.
  assert.equal(await page.locator('.tab-view-toggle-header').count(), 0, 'Piano has no TAB toggle');
  assert.equal((await drawn()).tabGroups, 0);
  const open = async name => {
    await page.setInputFiles('input[type=file]', fixturePath(name));
    await page.waitForFunction(title => document.querySelector('.pepperscore')?.getAttribute('aria-label')?.includes(title), name === 'guitar-notation.musicxml' ? 'Guitar notation' : 'TAB staves', { timeout: 30000 });
  };
  await open('guitar-tab-staves.musicxml');
  let state = await settled(state => state.staves.join() === '1', 'Imported TAB, notation view');
  assert.deepEqual(state.parts, ['Guitar'], 'The guitar is listed once');
  await page.locator('.mixer-trigger').click();
  assert.equal(await page.locator('.mixer-track').count(), 1, 'The mixer lists the guitar once');
  await page.keyboard.press('Escape'); await page.locator('.mixer-panel button[aria-label="Close track mixer"]').click().catch(() => {});
  await choose('tab');
  state = await settled(state => state.staves.join() === '2', 'Imported TAB, TAB view');
  assert.equal(state.pressed, 'tab', 'The pressed button is the current view');
  await choose('both');
  await settled(state => state.staves.join() === '1,2', 'Imported TAB, Both view');
  // Transposing regenerates TAB: the imported staff gives way to a generated one.
  await page.locator('.header-transpose-up').click();
  await settled(state => state.staves.join() === '1,101', 'Transposed Both view');
  await page.locator('.header-transpose-down').click();
  await settled(state => state.staves.join() === '1,2', 'Back at written pitch');
  await choose('tab');
  await settled(state => state.staves.join() === '2', 'TAB view before reload');
  // The view is saved with the score: reopening it after a reload restores TAB view.
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForSelector('.score-system svg', { timeout: 60000 });
  await open('guitar-tab-staves.musicxml');
  state = await settled(state => state.staves.join() === '2', 'Saved TAB view');
  assert.equal(state.pressed, 'tab');
  // Accessible names start with the visible label (WCAG 2.5.3), at full and condensed widths; captions say TAB.
  const names = () => page.locator('.tab-view-toggle-header button').evaluateAll(buttons => buttons.map(button => ({
    visible: [...button.childNodes].map(node => node.nodeType === 3 ? node.textContent : getComputedStyle(node).display === 'none' ? '' : node.innerText).join('').trim(),
    label: button.getAttribute('aria-label'), hidden: [...button.querySelectorAll('[aria-hidden="true"]')].filter(node => getComputedStyle(node).display !== 'none').length })));
  for (const width of [1500, 1300]) {
    await page.setViewportSize({ width, height: 900 });
    for (const { visible, label, hidden } of await names()) {
      assert.ok(visible && (label === null || label.toLowerCase().startsWith(visible.toLowerCase())), `${width}px: the name of "${visible}" starts with it (${label})`);
      assert.equal(hidden, 0, `${width}px: the visible label of "${visible}" is in the accessible name`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await page.locator('.header-tab-view-caption').textContent(), 'TAB', 'The caption says TAB');
  // Another score without a saved record opens in the host's initial view (notation), not the last score's.
  await open('guitar-notation.musicxml');
  state = await settled(state => state.staves.join() === '1', 'A new score opens in notation view');
  assert.equal(state.pressed, 'notation', 'A new score opens with Notation pressed');
  await open('guitar-tab-staves.musicxml');
  state = await settled(state => state.staves.join() === '2', 'Saved TAB view again');
  await page.screenshot({ path: '/tmp/tab-validation-reader.png' });

  // Phone: the switch sits in the More panel and still works.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: engine !== 'firefox' });
  await phone.route(/poppins/i, route => route.abort());
  const mobile = await phone.newPage();
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(server.url);
  await mobile.waitForSelector('.score-system svg', { timeout: 60000 });
  await mobile.setInputFiles('input[type=file]', fixturePath('guitar-notation.musicxml'));
  await mobile.waitForSelector('.tab-view-toggle-header', { state: 'attached' });
  assert.equal(await mobile.locator('.tab-view-toggle-header').isVisible(), false, 'Phone: the switch is in the More panel');
  await mobile.locator('.header-more-toggle').click();
  await mobile.locator('.tab-view-toggle-header .tab-view-toggle-both').click();
  await mobile.waitForFunction(() => document.querySelectorAll('.score-system g.tabGrp').length > 0, null, { timeout: 30000 });
  assert.equal(await mobile.evaluate(() => document.querySelector('.topbar').scrollWidth <= document.querySelector('.topbar').clientWidth), true, 'Phone: the header still fits');
  await phone.close();

  // Mid width: the full header has no room, so the switch is only in the drawer there.
  const tablet = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  await tablet.route(/poppins/i, route => route.abort());
  const mid = await tablet.newPage();
  mid.on('pageerror', error => errors.push(error.message));
  await mid.goto(server.url);
  await mid.waitForSelector('.score-system svg', { timeout: 60000 });
  await mid.setInputFiles('input[type=file]', fixturePath('guitar-notation.musicxml'));
  await mid.waitForSelector('.tab-view-toggle-drawer', { state: 'attached' });
  assert.equal(await mid.locator('.tab-view-toggle-header').isVisible(), false, 'Mid width: no switch in the header');
  assert.equal(await mid.evaluate(() => document.querySelector('.topbar').scrollWidth <= document.querySelector('.topbar').clientWidth), true, 'Mid width: the header fits');
  await mid.locator('.drawer-handle').click();
  await mid.locator('.tab-view-toggle-drawer .tab-view-toggle-tab').click();
  await mid.waitForFunction(() => document.querySelectorAll('.score-system g.tabGrp').length > 0, null, { timeout: 30000 });
  await tablet.close();

  // Engraving-only and minimal embeds have no switch.
  await page.goto(`${server.url}/embed-test`);
  await page.waitForSelector('.pepperscore.embed-a .score-system svg', { timeout: 60000 });
  assert.equal(await page.locator('.embed-a .tab-view-toggle, .embed-none .tab-view-toggle').count(), 0, 'No switch without controls.tabToggle in minimal or none');
  assert.deepEqual(errors, [], 'No page errors');
  console.log(`TAB: reader switch (piano and guitar, saved view, transposition, phone More panel, drawer at mid width, embeds) on ${engine} passed`);
} finally {
  await browser.close();
  await server.close();
}
