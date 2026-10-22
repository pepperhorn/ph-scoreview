// Engraving tests for transposition, the key flip and the spelling policy (docs/specs/transpose-and-spelling.md).
// Fixtures and a generated chromatic score (flute, B♭ clarinet, violin, two-staff piano with chord symbols, drums;
// key changes through major and minor keys with raised degrees, ties, a source double sharp) are engraved through
// the worker's pipeline (validation/transpose-harness.ts) at every transposition from -12 to +12, with and without
// the flip, in the written and concert views. Every rendered key signature must follow the key table, no note may
// use a spelling the policy forbids, accidentals must display correctly within each measure, note-name labels must
// equal the engraved spelling, percussion keeps no key signature and never moves, chord symbols are respelled, and
// a chunked engraving shows the same keys and spellings across chunk boundaries. Playback pitches never depend on the flip.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import toneMidi from '@tonejs/midi';

// --- The generated chromatic score ---------------------------------------------------------------------------------
const LETTERS = 'CDEFGAB';
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const sigAlter = (fifths, step) => { const order = fifths > 0 ? 'FCGDAEB' : 'BEADGCF'; return order.indexOf(step) < Math.abs(fifths) && order.indexOf(step) >= 0 ? Math.sign(fifths) : 0; };
const parse = name => { const [, step, accidentals, octave] = /^([A-G])([#b]*|x)(\d)$/.exec(name); return { step, alter: accidentals === 'x' ? 2 : accidentals.split('').reduce((sum, char) => sum + (char === '#' ? 1 : -1), 0), octave: Number(octave) }; };
/** Concert sections: key (fifths, mode), eight eighths per bar, a chord symbol and a left-hand triad per bar. */
const SECTIONS = [
  { fifths: 0, bars: [['C4 C#4 D4 D#4 E4 F4 F#4 G4', 'C', 'C3 E3 G3'], ['G#4 A4 A#4 B4 C5 B4 Bb4 A4', 'Am7', 'A2 C3 E3'], ['Ab4 G4 Gb4 F4 E4 Eb4 D4 Db4', 'F/A', 'A2 C3 F3']] },
  { fifths: -1, mode: 'minor', bars: [['D4 E4 F4 G4 A4 B4 C#5 D5', 'Dm', 'D3 F3 A3'], ['D5 C5 Bb4 A4 G4 F4 E4 C#4', 'A7', 'A2 C#3 E3']] },
  { fifths: -3, bars: [['Eb4 F4 G4 Ab4 Bb4 B4 C5 D5', 'Eb', 'Eb3 G3 Bb3'], ['Eb5 D5 Db5 C5 Bb4 A4 Ab4 G4', 'Ab/C', 'C3 Eb3 Ab3']] },
  { fifths: 4, mode: 'minor', bars: [['C#4 D#4 E4 F#4 G#4 A4 B#4 C#5', 'C#m', 'C#3 E3 G#3'], ['C#5 B4 A4 G#4 F#4 E4 D#4 C#4', 'G#7', 'G#2 B#2 D#3']] },
  { fifths: -6, bars: [['Gb4 Ab4 Bb4 Cb5 Db5 Eb5 F5 Gb5', 'Gb', 'Gb3 Bb3 Db4'], ['Gb5 F5 Fb5 Eb5 Db5 Cb5 Bb4 Ab4', 'Cb', 'Cb3 Eb3 Gb3']] },
  { fifths: 5, mode: 'minor', bars: [['G#4 A#4 B4 C#5 D#5 E5 Fx5 G#5', 'G#m', 'G#3 B3 D#4']] },
  { fifths: 2, bars: [['D4 E4 F#4 G4 A4 B4 C#5 D5', 'D', 'D3 F#3 A3'], ['D5 C5 B4 A#4 B4 G4 F4 E4', 'Bm/D', 'D3 F#3 B3']] },
];
function chromaticScore() {
  const parts = [
    { id: 'P1', name: 'Flute', program: 74 },
    { id: 'P2', name: 'Clarinet in Bb', program: 72, transpose: { diatonic: -1, chromatic: -2 } },
    { id: 'P3', name: 'Violin', program: 41 },
    { id: 'P4', name: 'Piano', program: 1, staves: 2 },
    { id: 'P5', name: 'Drums', drums: true },
  ];
  const written = (name, part) => {
    const pitch = parse(name);
    if (!part.transpose) return pitch;
    // Written = concert raised a major second (the inverse of the clarinet's sounding transposition).
    const index = LETTERS.indexOf(pitch.step) + 1;
    const step = LETTERS[index % 7]; const octave = pitch.octave + Math.floor(index / 7);
    const midi = (pitch.octave + 1) * 12 + NATURAL[LETTERS.indexOf(pitch.step)] + pitch.alter + 2;
    return { step, octave, alter: midi - ((octave + 1) * 12 + NATURAL[LETTERS.indexOf(step)]) };
  };
  let id = 0;
  const noteXml = (pitch, duration, type, { staff, voice = '1', chord = false, state, fifths, tie } = {}) => {
    const line = `${pitch.step}${pitch.octave}`;
    const inForce = state.get(line) ?? sigAlter(fifths, pitch.step);
    const accidental = pitch.alter !== inForce ? ({ 2: 'double-sharp', 1: 'sharp', 0: 'natural', [-1]: 'flat' })[pitch.alter] : null;
    if (accidental) state.set(line, pitch.alter);
    return `<note id="n${++id}">${chord ? '<chord/>' : ''}<pitch><step>${pitch.step}</step>${pitch.alter ? `<alter>${pitch.alter}</alter>` : ''}<octave>${pitch.octave}</octave></pitch><duration>${duration}</duration>${tie ? `<tie type="${tie}"/>` : ''}<voice>${voice}</voice><type>${type}</type>${accidental ? `<accidental>${accidental}</accidental>` : ''}${staff ? `<staff>${staff}</staff>` : ''}${tie ? `<notations><tied type="${tie}"/></notations>` : ''}</note>`;
  };
  const bars = SECTIONS.flatMap(section => section.bars.map((bar, index) => ({ ...section, bar, first: index === 0 })));
  const partXml = part => {
    let previous;
    return bars.map((entry, m) => {
      const [line, symbol, triad] = entry.bar;
      const fifths = entry.fifths + (part.transpose ? 2 : 0);
      let body = '';
      if (m === 0 || entry.first) {
        body += '<attributes>';
        if (m === 0) body += '<divisions>2</divisions>';
        body += `<key><fifths>${fifths}</fifths>${entry.mode ? `<mode>${entry.mode}</mode>` : ''}</key>`;
        if (m === 0) {
          body += '<time><beats>4</beats><beat-type>4</beat-type></time>';
          if (part.staves) body += '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>';
          else body += part.drums ? '<clef><sign>percussion</sign></clef>' : '<clef><sign>G</sign><line>2</line></clef>';
          if (part.transpose) body += `<transpose><diatonic>${part.transpose.diatonic}</diatonic><chromatic>${part.transpose.chromatic}</chromatic></transpose>`;
        }
        body += '</attributes>';
      }
      if (part.drums) {
        body += [0, 1, 2, 3].map(beat => `<note id="n${++id}"><unpitched><display-step>${beat % 2 ? 'C' : 'F'}</display-step><display-octave>${beat % 2 ? 5 : 4}</display-octave></unpitched><duration>2</duration><instrument id="P5-I${beat % 2 ? 39 : 36}"/><voice>1</voice><type>quarter</type></note>`).join('');
        return `<measure number="${m + 1}">${body}</measure>`;
      }
      const state = new Map();
      if (part.staves) body += `<harmony><root><root-step>${symbol[0]}</root-step>${symbol[1] === '#' ? '<root-alter>1</root-alter>' : symbol[1] === 'b' ? '<root-alter>-1</root-alter>' : ''}</root><kind text="${symbol.replace(/^[A-G][#b]?/, '').replace(/\/.*/, '')}">${/m(?!aj)/.test(symbol.replace(/^[A-G][#b]?/, '')) ? 'minor' : symbol.includes('7') ? 'dominant' : 'major'}</kind>${symbol.includes('/') ? `<bass><bass-step>${symbol.split('/')[1][0]}</bass-step>${symbol.split('/')[1][1] === 'b' ? '<bass-alter>-1</bass-alter>' : symbol.split('/')[1][1] === '#' ? '<bass-alter>1</bass-alter>' : ''}</bass>` : ''}</harmony>`;
      const names = line.split(' ');
      names.forEach((name, index) => {
        const pitch = written(name, part);
        // A tie across the bar line from the last eighth into the next bar's first note when they are the same pitch.
        const next = bars[m + 1]?.bar[0].split(' ')[0];
        const tie = index === names.length - 1 && next === name ? 'start' : index === 0 && previous === name ? 'stop' : undefined;
        body += noteXml(pitch, 1, 'eighth', { staff: part.staves ? 1 : undefined, state, fifths, tie });
      });
      previous = names.at(-1);
      if (part.staves) {
        body += '<backup><duration>8</duration></backup>';
        const lowState = new Map();
        triad.split(' ').forEach((name, index) => { body += noteXml(parse(name), 8, 'whole', { staff: 2, voice: '5', chord: index > 0, state: lowState, fifths }); });
      }
      return `<measure number="${m + 1}">${body}</measure>`;
    }).join('');
  };
  const list = parts.map(part => `<score-part id="${part.id}"><part-name>${part.name}</part-name>${part.drums ? '<score-instrument id="P5-I36"><instrument-name>Kick</instrument-name></score-instrument><score-instrument id="P5-I39"><instrument-name>Snare</instrument-name></score-instrument><midi-instrument id="P5-I36"><midi-channel>10</midi-channel><midi-unpitched>36</midi-unpitched></midi-instrument><midi-instrument id="P5-I39"><midi-channel>10</midi-channel><midi-unpitched>39</midi-unpitched></midi-instrument>' : `<midi-instrument id="${part.id}-I1"><midi-program>${part.program}</midi-program></midi-instrument>`}</score-part>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>Chromatic Keys</work-title></work><part-list>${list}</part-list>${parts.map(part => `<part id="${part.id}">${partXml(part)}</part>`).join('')}</score-partwise>`;
}

/** One-part-per-staff score from bars of note names (quarter notes) with per-bar keys: [fifths, mode?] or null. */
function simpleScore(title, parts) {
  let id = 0;
  const list = parts.map((part, index) => `<score-part id="P${index + 1}"><part-name>${part.name}</part-name><midi-instrument id="P${index + 1}-I1"><midi-program>${part.program}</midi-program></midi-instrument></score-part>`).join('');
  const body = parts.map((part, index) => `<part id="P${index + 1}">${part.bars.map(([key, line], m) => {
    let attributes = '';
    if (m === 0 || key) attributes = `<attributes>${m === 0 ? '<divisions>1</divisions>' : ''}${key ? `<key><fifths>${key[0]}</fifths>${key[1] ? `<mode>${key[1]}</mode>` : ''}</key>` : ''}${m === 0 ? `<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef>${part.transpose ? `<transpose><diatonic>${part.transpose[0]}</diatonic><chromatic>${part.transpose[1]}</chromatic></transpose>` : ''}` : ''}</attributes>`;
    const fifths = part.bars.slice(0, m + 1).reverse().find(([k]) => k)[0][0];
    const state = new Map();
    const notes = line.split(' ').map(name => {
      const pitch = parse(name);
      const lineKey = `${pitch.step}${pitch.octave}`;
      const inForce = state.get(lineKey) ?? sigAlter(fifths, pitch.step);
      const accidental = pitch.alter !== inForce ? ({ 1: 'sharp', 0: 'natural', [-1]: 'flat' })[pitch.alter] : null;
      if (accidental) state.set(lineKey, pitch.alter);
      return `<note id="${title.replace(/\W/g, '')}${++id}"><pitch><step>${pitch.step}</step>${pitch.alter ? `<alter>${pitch.alter}</alter>` : ''}<octave>${pitch.octave}</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>${accidental ? `<accidental>${accidental}</accidental>` : ''}</note>`;
    }).join('');
    return `<measure number="${m + 1}">${attributes}${notes}</measure>`;
  }).join('')}</part>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>${title}</work-title></work><part-list>${list}</part-list>${body}</score-partwise>`;
}
/** A B♭ trumpet written in Ab (sounding Gb) beside a piano in Gb: the concert view keeps one key for both. */
const trumpetAndPiano = () => simpleScore('Trumpet and Piano', [
  { name: 'Trumpet in Bb', program: 57, transpose: [-1, -2], bars: [[[-4], 'Ab4 Bb4 C5 Db5'], [null, 'Eb5 F5 G5 Ab5'], [null, 'G5 F5 E5 F5']] },
  { name: 'Piano', program: 1, bars: [[[-6], 'Gb4 Ab4 Bb4 Cb5'], [null, 'Db5 Eb5 F5 Gb5'], [null, 'F5 Eb5 D5 Eb5']] },
]);
/** A minor, then C major written without <mode> (a key change back to major). */
const minorToMajor = () => simpleScore('Minor to Major', [
  { name: 'Piano', program: 1, bars: [[[0, 'minor'], 'A4 B4 G#4 A4'], [[0], 'C5 Ab4 G4 C5'], [null, 'E4 F4 G#4 A4']] },
]);
const minorToMajorMei = `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0"><meiHead><fileDesc><titleStmt><title>Modes</title></titleStmt><pubStmt/></fileDesc></meiHead><music><body><mdiv><score><scoreDef key.sig="0" key.mode="minor" meter.count="4" meter.unit="4"><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef><section>`
  + `<measure n="1"><staff n="1"><layer n="1"><note xml:id="m1" dur="4" pname="a" oct="4"/><note xml:id="m2" dur="4" pname="b" oct="4"/><note xml:id="m3" dur="4" pname="g" oct="4" accid="s" accid.ges="s"/><note xml:id="m4" dur="4" pname="a" oct="4"/></layer></staff></measure>`
  + `<scoreDef key.sig="1s"/><measure n="2"><staff n="1"><layer n="1"><note xml:id="m5" dur="4" pname="g" oct="4"/><note xml:id="m6" dur="4" pname="e" oct="4" accid="f" accid.ges="f"/><note xml:id="m7" dur="4" pname="d" oct="4"/><note xml:id="m8" dur="4" pname="g" oct="4"/></layer></staff></measure></section></score></mdiv></body></music></mei>`;

// --- Run in a page served by a private Vite server (as validation/document.mjs) -------------------------------
const port = 43991;
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
    try { await page.evaluate(() => import('/validation/transpose-harness.ts')); await delay(1500); await page.evaluate(() => import('/validation/transpose-harness.ts')); break; }
    catch (error) { if (attempt > 5) throw error; await page.waitForLoadState('load'); }
  }
  const started = Date.now();
  const cases = [];
  for (let semitones = -12; semitones <= 12; semitones++) for (const flip of [false, true]) for (const view of ['written', 'concert']) cases.push({ semitones, flip, view });
  const fixtures = [['generated chromatic score', chromaticScore()], ['B♭ trumpet in Ab beside a piano in Gb', trumpetAndPiano()], ['A minor to C major', minorToMajor()], ...readdirSync(new URL('./fixtures/', import.meta.url)).filter(name => name.endsWith('.musicxml') && name !== 'guitar-tab-only.musicxml' /* no noteheads to spell */).map(name => [name, readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')])];
  for (const [name, xml] of fixtures) {
    const result = await page.evaluate(async ({ xml, cases }) => {
      const { checkView } = await import('/validation/transpose-harness.ts');
      const failures = []; const totals = { keyChecks: 0, noteChecks: 0, labelChecks: 0, harmChecks: 0 };
      const playback = new Map();
      for (const test of cases) {
        const result = await checkView(xml, test);
        failures.push(...result.failures);
        for (const key of Object.keys(totals)) totals[key] += result[key];
        // Playback is identical with and without the flip.
        const key = `${test.view}|${test.semitones}`;
        if (playback.has(key) && playback.get(key) !== result.playback) failures.push(`${key}: playback differs with the flip`);
        playback.set(key, result.playback);
      }
      return { failures, totals };
    }, { xml, cases });
    assert.deepEqual(result.failures.slice(0, 25), [], `${name}: every view follows the spelling policy`);
    assert.ok(result.totals.keyChecks > 0 && result.totals.noteChecks > 0, `${name}: keys and notes were checked`);
    if (name.startsWith('generated')) {
      assert.ok(result.totals.labelChecks > 1000, `${name}: labels were compared (${result.totals.labelChecks})`);
      assert.ok(result.totals.harmChecks > 100, `${name}: chord symbols were checked (${result.totals.harmChecks})`);
    }
    console.log(`Transpose: ${name}: ${cases.length} views, ${result.totals.keyChecks} keys, ${result.totals.noteChecks} notes, ${result.totals.labelChecks} labels, ${result.totals.harmChecks} chord symbols follow the spelling policy passed`);
  }
  // A key change back to major is major (MusicXML without <mode>, MEI without a mode on the new key).
  const modes = await page.evaluate(async sources => {
    const { checkView } = await import('/validation/transpose-harness.ts');
    const out = [];
    for (const source of sources) for (const semitones of [0, 2]) { const result = await checkView(source, { semitones, flip: false, view: 'written' }); out.push({ modes: result.modes['1'], failures: result.failures }); }
    return out;
  }, [minorToMajor(), { mei: minorToMajorMei }]);
  for (const { modes: list, failures } of modes) {
    assert.deepEqual(failures, [], 'Minor to major: views follow the policy');
    assert.deepEqual(list, ['minor', 'major'], `A minor key change back to major is engraved major (${JSON.stringify(list)})`);
  }
  // Concert view, untransposed: the trumpet's sounding key is the piano's key (Gb, not the table's F#), and the piano is
  // engraved exactly as written.
  const concert = await page.evaluate(async xml => {
    const { checkView, engrave } = await import('/validation/transpose-harness.ts');
    const result = await checkView(xml, { semitones: 0, flip: false, view: 'concert' });
    const engraved = await engrave(xml, { semitones: 0, flip: false, view: 'concert' });
    return { failures: result.failures, interval: engraved.spec.interval, keys: [...engraved.final.matchAll(/<keySig\b[^>]*\ssig="([^"]+)"/g)].map(match => match[1]) };
  }, trumpetAndPiano());
  assert.deepEqual(concert.failures, [], 'Concert view of a transposing part beside a concert-pitch part follows the policy');
  assert.equal(concert.interval, '', 'An untransposed concert view moves nothing but the transposing parts');
  assert.deepEqual([...new Set(concert.keys)], ['6f'], `Both staves are in Gb at concert pitch (${concert.keys})`);
  console.log('Transpose: key changes back to major, and an untransposed concert view keeps one key for transposing and concert parts passed');
  // Every format: ABC and MIDI drum parts (unpitched in the generated MEI) and an MEI score whose key changes are
  // scoreDef-wide never show a key signature on the percussion staff, and their notes never move.
  const midi = new toneMidi.Midi();
  const kit = midi.addTrack(); kit.channel = 9; kit.name = 'Kit';
  for (const [time, note] of [[0, 36], [0, 42], [0.5, 38], [1, 49], [1.5, 42]]) kit.addNote({ midi: note, time, duration: 0.25 });
  const lead = midi.addTrack(); lead.name = 'Lead';
  [62, 64, 66, 67, 69, 71, 73, 74].forEach((note, index) => lead.addNote({ midi: note, time: index * 0.25, duration: 0.25 }));
  const mei = `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0"><meiHead><fileDesc><titleStmt><title>Keys</title></titleStmt><pubStmt/></fileDesc></meiHead><music><body><mdiv><score><scoreDef key.sig="2s" meter.count="4" meter.unit="4"><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/><staffDef n="2" lines="5" clef.shape="perc"/></staffGrp></scoreDef><section>`
    + `<measure n="1"><staff n="1"><layer n="1"><note xml:id="a1" dur="4" pname="d" oct="4"/><note xml:id="a2" dur="4" pname="f" oct="4" accid.ges="s"/><note xml:id="a3" dur="4" pname="c" oct="5" accid.ges="s"/><note xml:id="a4" dur="4" pname="d" oct="5"/></layer></staff><staff n="2"><layer n="1"><note xml:id="d1" dur="2" loc="1"/><note xml:id="d2" dur="2" loc="5"/></layer></staff></measure>`
    + `<scoreDef key.sig="3f"/><measure n="2"><staff n="1"><layer n="1"><note xml:id="b1" dur="4" pname="e" oct="4" accid.ges="f"/><note xml:id="b2" dur="4" pname="g" oct="4"/><note xml:id="b3" dur="4" pname="b" oct="4" accid.ges="f"/><note xml:id="b4" dur="4" pname="e" oct="5" accid.ges="f"/></layer></staff><staff n="2"><layer n="1"><note xml:id="d3" dur="1" loc="5"/></layer></staff></measure></section></score></mdiv></body></music></mei>`;
  const formats = [
    ['ABC', { abc: 'X:1\nT:Kit\nM:4/4\nL:1/8\nV:1 clef=perc name="Drums"\nV:2 clef=treble name="Tune"\nK:D\n[V:1] F2 c2 [Fg]2 ^c2|F2 c2 F2 c2|\n[V:2] D E F G A B c d|K:Bb\nB, C D E F G A B|\n' }],
    ['MIDI', { midi: Array.from(midi.toArray()) }],
    ['MEI', { mei }],
  ];
  for (const [name, source] of formats) {
    const result = await page.evaluate(async source => {
      const { checkView } = await import('/validation/transpose-harness.ts');
      const failures = []; let keys = 0; let notes = 0;
      for (const semitones of [-7, -1, 0, 3, 6]) for (const flip of [false, true]) {
        const result = await checkView(source, { semitones, flip, view: 'written' });
        failures.push(...result.failures); keys += result.keyChecks; notes += result.noteChecks;
      }
      return { failures, keys, notes };
    }, source);
    assert.deepEqual(result.failures.slice(0, 20), [], `${name}: keys, spellings and percussion follow the policy`);
    assert.ok(result.keys > 0 && result.notes > 0, `${name}: keys and notes were checked`);
    console.log(`Transpose: ${name} source: percussion has no key signature and never moves; ${result.keys} keys and ${result.notes} notes follow the policy passed`);
  }
  // Chunked engraving: slices of three bars (one bar of overlap) keep the whole engraving's keys and spellings.
  const chunked = await page.evaluate(async xml => {
    const { checkChunks } = await import('/validation/transpose-harness.ts');
    const failures = []; let compared = 0;
    for (const test of [{ semitones: 6, flip: false, view: 'written' }, { semitones: 6, flip: true, view: 'written' }, { semitones: -5, flip: false, view: 'concert' }, { semitones: 1, flip: true, view: 'concert' }]) {
      const result = await checkChunks(xml, test, 3);
      failures.push(...result.failures.map(failure => `${JSON.stringify(test)} ${failure}`)); compared += result.compared;
    }
    return { failures, compared };
  }, chromaticScore());
  assert.deepEqual(chunked.failures.slice(0, 20), [], 'Chunked engraving keeps keys and spellings across chunk boundaries');
  assert.ok(chunked.compared > 500, `Chunks were compared (${chunked.compared})`);
  console.log(`Transpose: chunked engraving keeps keys and spellings across chunk boundaries (${chunked.compared} comparisons) passed`);
  assert.deepEqual(errors, [], 'No page errors');
  console.log(`Transpose: engraving validation passed (${((Date.now() - started) / 1000).toFixed(1)} s)`);
} finally {
  await browser?.close();
  server.kill();
}
