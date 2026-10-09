// Table-driven tests of the enharmonic speller (packages/pepperscore/src/lib/spelling.ts), run in Node (the module is pure TypeScript with
// type-only imports, so Node's type stripping loads it directly), including a probe that runs every planned Verovio
// transpose interval through Verovio 6.3.0 and checks the key signature and tonic spelling it produces.
import assert from 'node:assert/strict';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import {
  chooseKey, enharmonicFlip, keyFromFifths, keyFromTonic, planTranspose, transposeInterval, spellPitch, spellChordSymbol,
  spellingProfileFor, INSTRUMENT_SPELLING, INSTRUMENT_FAMILY, pitchClassOf,
} from '../packages/pepperscore/src/lib/spelling.ts';

let checks = 0;
const eq = (actual, expected, message) => { checks++; assert.deepEqual(actual, expected, message); };
const name = pitch => `${pitch.step}${pitch.alter > 0 ? '#'.repeat(pitch.alter) : pitch.alter < 0 ? 'b'.repeat(-pitch.alter) : ''}`;
const nameOct = pitch => `${name(pitch)}${pitch.octave}`;

// --- Key choice: every pitch class x major/minor x default/flip x profile ---------------------------------------
const MAJOR = { default: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'], sharp: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] };
const MAJOR_FLIP = { default: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'Cb'], sharp: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'Cb'] };
const MINOR = { default: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'], sharp: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] };
const MINOR_FLIP = { default: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'A#', 'B'], sharp: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] };
for (const profile of ['default', 'sharp']) for (let pc = 0; pc < 12; pc++) {
  const family = profile === 'sharp' ? 'sharp' : undefined;
  eq(chooseKey(pc, 'major', { family }).tonic, MAJOR[profile][pc], `major pc ${pc} ${profile}`);
  eq(chooseKey(pc, 'major', { family, flip: true }).tonic, MAJOR_FLIP[profile][pc], `major pc ${pc} ${profile} flipped`);
  eq(chooseKey(pc, 'minor', { family }).tonic, MINOR[profile][pc], `minor pc ${pc} ${profile}`);
  eq(chooseKey(pc, 'minor', { family, flip: true }).tonic, MINOR_FLIP[profile][pc], `minor pc ${pc} ${profile} flipped`);
  for (const mode of ['major', 'minor']) for (const flip of [false, true]) {
    const key = chooseKey(pc, mode, { family, flip });
    eq(pitchClassOf(key.tonic), pc, `${key.tonic} ${mode} is pitch class ${pc}`);
    assert.ok(Math.abs(key.fifths) <= 7, `${key.tonic} ${mode} has at most 7 accidentals`);
    assert.ok(!['D#', 'A#', 'G#', 'Fb', 'E#'].includes(key.tonic) || mode === 'minor', `${key.tonic} major is never chosen`);
  }
}
// Minor keys follow the relative major: Eb minor / D# minor tie (6 each) and resolve to F# major's relative, D# minor.
eq(chooseKey(3, 'minor').fifths, 6, 'D# minor shares F# major\'s 6 sharps');
eq(chooseKey(3, 'minor', { flip: true }).fifths, -6, 'Eb minor on flip');
eq(chooseKey(10, 'minor').fifths, -5, 'Bb minor (relative of Db)');
eq(chooseKey(10, 'minor', { family: 'sharp' }).fifths, 7, 'A# minor for sharp-leaning parts (relative of C#)');
eq(chooseKey(8, 'minor').fifths, 5, 'G# minor (relative of B)');

// --- Enharmonic flip: only spellings with at most 7 accidentals, never parenthesized keys ------------------------
const flips = [['Db', 'C#'], ['C#', 'Db'], ['F#', 'Gb'], ['Gb', 'F#'], ['B', 'Cb'], ['Cb', 'B'], ['C', null], ['Eb', null], ['Ab', null], ['E', null], ['F', null], ['Bb', null], ['G', null], ['D', null], ['A', null]];
for (const [from, to] of flips) eq(enharmonicFlip(keyFromTonic(from, 'major'))?.tonic ?? null, to, `flip ${from} major`);
const minorFlips = [['Bb', 'A#'], ['A#', 'Bb'], ['D#', 'Eb'], ['Eb', 'D#'], ['G#', 'Ab'], ['Ab', 'G#'], ['C#', null], ['F#', null], ['C', null], ['A', null], ['B', null]];
for (const [from, to] of minorFlips) eq(enharmonicFlip(keyFromTonic(from, 'minor'))?.tonic ?? null, to, `flip ${from} minor`);
eq(enharmonicFlip(keyFromFifths(6, 'major')), keyFromFifths(-6, 'major'), 'flip keeps the mode and sets fifths');

// --- Instrument registry ------------------------------------------------------------------------------------------
eq(INSTRUMENT_SPELLING.Strings, 'sharp', 'strings are sharp-leaning');
eq(INSTRUMENT_SPELLING.Guitar, 'sharp', 'guitars are sharp-leaning');
for (const family of ['Keyboard', 'Voice', 'Percussion', 'Drums', 'Woodwinds', 'Brass', 'FX / Other']) eq(INSTRUMENT_SPELLING[family], 'neutral', `${family} is neutral`);
for (const [instrument, profile] of [['violin', 'sharp'], ['viola', 'sharp'], ['cello', 'sharp'], ['double-bass', 'sharp'], ['guitar', 'sharp'], ['bassguitar', 'sharp'], ['piano', 'neutral'], ['trumpet', 'neutral'], ['flute', 'neutral'], ['alto-saxophone', 'neutral'], ['microphone', 'neutral'], ['drum-kit', 'neutral']]) {
  eq(spellingProfileFor({ instrument }), profile, `${instrument} profile`);
}
eq(Object.keys(INSTRUMENT_FAMILY).length, 16, 'every instrument id has a family');
eq(spellingProfileFor({ instrument: 'piano', family: 'Strings' }), 'sharp', 'a GM family (from the part\'s program) wins over the icon id');
eq(chooseKey(1, 'major', { family: spellingProfileFor({ instrument: 'violin' }) }).tonic, 'C#', 'violin pitch class 1 is C#');
eq(chooseKey(8, 'major', { family: spellingProfileFor({ instrument: 'guitar' }) }).tonic, 'Ab', 'Ab for every instrument');

// --- Transposition plans and Verovio intervals --------------------------------------------------------------------
const fromC = {
  1: ['Db', '+m2'], 2: ['D', '+M2'], 3: ['Eb', '+m3'], 4: ['E', '+M3'], 5: ['F', '+P4'], 6: ['F#', '+A4'], 7: ['G', '+P5'], 8: ['Ab', '+m6'], 9: ['A', '+M6'], 10: ['Bb', '+m7'], 11: ['B', '+M7'], 12: ['C', '+P8'],
  '-1': ['B', '-m2'], '-2': ['Bb', '-M2'], '-3': ['A', '-m3'], '-4': ['Ab', '-M3'], '-5': ['G', '-P4'], '-6': ['F#', '-d5'], '-7': ['F', '-P5'], '-8': ['E', '-m6'], '-9': ['Eb', '-M6'], '-10': ['D', '-m7'], '-11': ['Db', '-M7'], '-12': ['C', '-P8'],
};
const C = keyFromTonic('C', 'major');
for (const [semitones, [tonic, interval]] of Object.entries(fromC)) {
  const plan = planTranspose(C, Number(semitones));
  eq([plan.key.tonic, plan.interval], [tonic, interval], `C ${semitones > 0 ? '+' : ''}${semitones}`);
}
eq(planTranspose(C, 0), { key: C, interval: '' }, 'no transposition and no flip leaves the source key');
eq(planTranspose(C, 6, { flip: true }).interval, '+d5', 'C -> Gb is +d5');
eq(planTranspose(C, -6, { flip: true }).interval, '-A4', 'C -> Gb below is -A4');
eq(planTranspose(C, 13).interval, '+m9', 'octave wrap: +13 is a minor ninth');
eq(planTranspose(C, -14).interval, '-M9', 'octave wrap: -14 is a major ninth down');
eq(planTranspose(keyFromTonic('Db', 'major'), 0, { flip: true }), { key: keyFromTonic('C#', 'major'), interval: '-d2' }, 'flip Db -> C# with no transposition');
eq(planTranspose(keyFromTonic('Gb', 'major'), 0, { flip: true }).interval, '-d2', 'flip Gb -> F#');
eq(planTranspose(keyFromTonic('F#', 'major'), 0, { flip: true }).interval, '+d2', 'flip F# -> Gb');
eq(planTranspose(keyFromTonic('B', 'major'), 0, { flip: true }).interval, '+d2', 'flip B -> Cb');
eq(planTranspose(keyFromTonic('Gb', 'major'), 0).interval, '', 'a source key is kept when nothing changes');
eq(planTranspose(C, 1, { family: 'sharp' }).interval, '+A1', 'C -> C# for strings is an augmented unison');
eq(transposeInterval('E', 'Ab', 4), '+d4', 'E -> Ab up is a diminished fourth');
eq(transposeInterval('C', 'C', 0), '', 'unison');

// Source keys from the task: C, F, Bb, D major and A minor, over -12..+12; checked against a real Verovio run below.
const sources = [['C', 'major'], ['F', 'major'], ['Bb', 'major'], ['D', 'major'], ['A', 'minor']];
const plans = [];
for (const [tonic, mode] of sources) {
  const source = keyFromTonic(tonic, mode);
  for (let semitones = -12; semitones <= 12; semitones++) for (const flip of [false, true]) for (const family of [undefined, 'sharp']) {
    const plan = planTranspose(source, semitones, { flip, family });
    if (!semitones && !flip) continue;
    eq(pitchClassOf(plan.key.tonic), (pitchClassOf(tonic) + semitones + 120) % 12, `${tonic} ${mode} ${semitones} pitch class`);
    if (!flip) eq(plan.key.tonic, chooseKey((pitchClassOf(tonic) + semitones + 120) % 12, mode, { family }).tonic, `${tonic} ${mode} ${semitones} follows the table`);
    plans.push({ source, semitones, plan, label: `${tonic} ${mode} ${semitones >= 0 ? '+' : ''}${semitones}${flip ? ' flip' : ''}${family ? ' sharp' : ''}` });
  }
}

// --- Note spelling --------------------------------------------------------------------------------------------------
const key = (tonic, mode = 'major') => keyFromTonic(tonic, mode);
const spell = (midi, k, context) => nameOct(spellPitch(midi, k, context));
// Flat keys: flats and naturals only.
eq([61, 63, 66, 68, 71, 64, 70].map(m => spell(m, key('F'))), ['Db4', 'Eb4', 'Gb4', 'Ab4', 'B4', 'E4', 'Bb4'], 'F major: flats and naturals');
eq([61, 62, 64, 66, 69, 71].map(m => spell(m, key('Eb'))), ['Db4', 'D4', 'E4', 'Gb4', 'A4', 'B4'], 'Eb major: flats and naturals');
// Sharp keys: sharps and naturals only.
eq([63, 68, 70, 65, 60, 61].map(m => spell(m, key('D'))), ['D#4', 'G#4', 'A#4', 'F4', 'C4', 'C#4'], 'D major: sharps and naturals');
eq([61, 63, 70, 65, 72].map(m => spell(m, key('E'))), ['C#4', 'D#4', 'A#4', 'F4', 'C5'], 'E major: sharps and naturals (no E#/B#)');
// C major / A minor: the key table's spelling for chromatic pitch classes.
eq([61, 63, 66, 68, 70].map(m => spell(m, key('C'))), ['Db4', 'Eb4', 'F#4', 'Ab4', 'Bb4'], 'C major chromatics');
// Minor raised 6th and 7th are exempt from flats-only.
eq(spell(61, key('D', 'minor')), 'C#4', 'D minor raised 7th is C#');
eq(spell(71, key('D', 'minor')), 'B4', 'D minor raised 6th is B natural');
eq(spell(68, key('D', 'minor')), 'Ab4', 'D minor: other chromatics stay flat');
eq([71, 69].map(m => spell(m, key('C', 'minor'))), ['B4', 'A4'], 'C minor raised 7th and 6th');
eq([68, 66].map(m => spell(m, key('A', 'minor'))), ['G#4', 'F#4'], 'A minor raised 7th and 6th');
eq([62, 60].map(m => spell(m, key('Eb', 'minor'))), ['D4', 'C4'], 'Eb minor raised 7th and 6th');
eq(spell(64, key('G', 'minor')), 'E4', 'G minor raised 6th');
eq(spell(66, key('G', 'minor')), 'F#4', 'G minor raised 7th is F# in a flat key');
// Upward-resolving chromatic notes keep the source spelling; others follow the key.
eq(spell(61, key('F'), { source: { step: 'C', alter: 1 }, next: 62 }), 'C#4', 'F major: C# resolving up to D keeps the sharp');
eq(spell(61, key('F'), { source: { step: 'C', alter: 1 }, next: 60 }), 'Db4', 'F major: C# falling to C becomes Db');
eq(spell(61, key('F'), { source: { step: 'C', alter: 1 } }), 'Db4', 'F major: C# with no next note becomes Db');
eq(spell(66, key('Bb'), { source: { step: 'F', alter: 1 }, next: 67 }), 'F#4', 'Bb major: F# resolving to G');
eq(spell(70, key('D'), { source: { step: 'B', alter: -1 }, next: 71 }), 'Bb4', 'D major: Bb resolving up to B keeps the flat');
eq(spell(70, key('D'), { source: { step: 'B', alter: -1 }, next: 69 }), 'A#4', 'D major: Bb falling becomes A#');
eq(spell(61, key('F'), { source: { step: 'D', alter: -1 }, next: 62 }), 'Db4', 'source spelling is kept as written');
// E#/B# become F/C everywhere outside the key signature (including the exemptions above).
eq(spell(65, key('D'), { source: { step: 'E', alter: 1 }, next: 66 }), 'F4', 'D major: E# resolving to F# becomes F');
eq(spell(72, key('E'), { source: { step: 'B', alter: 1 }, next: 73 }), 'C5', 'E major: B# resolving to C# becomes C');
// Decision 5: minor raised 6th/7th are exempt from E#->F and B#->C.
eq(spell(72, key('C#', 'minor')), 'B#4', 'C# minor raised 7th is B#');
eq(spell(65, key('F#', 'minor')), 'E#4', 'F# minor raised 7th is E#');
eq(spell(65, key('G#', 'minor')), 'E#4', 'G# minor raised 6th is E#');
eq(spell(65, key('F#', 'minor'), { source: { step: 'E', alter: 1 }, next: 66, transposed: true }), 'E#4', 'F# minor E# resolving up stays E#');
eq(spell(65, key('D'), { source: { step: 'E', alter: 1 }, next: 66 }), 'F4', 'outside a minor raised degree E# still becomes F');
// Decision 6: double accidentals are avoided even as raised degrees.
eq(spell(62, key('D#', 'minor')), 'D4', 'D# minor raised 7th C## is D');
eq(spell(67, key('A#', 'minor')), 'G4', 'A# minor raised 6th F## is G');
eq(spell(69, key('A#', 'minor')), 'A4', 'A# minor raised 7th G## is A');
eq([67, 69].map(m => spell(m, key('Bb', 'minor'))), ['G4', 'A4'], 'Bb minor raised 6th and 7th');
eq(spell(62, key('C'), { source: { step: 'E', alter: -2 }, transposed: true }), 'D4', 'a transposed Ebb is D');
eq(spell(61, key('E'), { source: { step: 'B', alter: 2 }, transposed: true }), 'C#4', 'a transposed Bx is C#');
// Notes in the key signature keep the signature's spelling.
eq([65, 71].map(m => spell(m, key('F#'))), ['E#4', 'B4'], 'F# major: E# is diatonic');
eq([60, 65].map(m => spell(m, key('C#'))), ['B#3', 'E#4'], 'C# major: B# and E# are diatonic');
eq(spell(71, key('Gb')), 'Cb5', 'Gb major: Cb is diatonic');
eq(spell(64, key('Cb')), 'Fb4', 'Cb major: Fb is diatonic');
eq(spell(71, key('Eb', 'minor')), 'Cb5', 'Eb minor: Cb is diatonic');
// Fb/Cb only as a stepwise passing note in keys with 6+ flats; else E/B.
eq(spell(64, key('Gb')), 'E4', 'Gb major: Fb alone is E');
eq(spell(64, key('Gb'), { prev: 66, next: 63 }), 'Fb4', 'Gb major: Gb-Fb-Eb passing');
eq(spell(64, key('Gb'), { prev: 63, next: 66 }), 'Fb4', 'Gb major: Eb-Fb-Gb passing');
eq(spell(64, key('Gb'), { prev: 66, next: 66 }), 'E4', 'Gb major: a neighbour note is E');
eq(spell(64, key('Gb'), { prev: 61, next: 63 }), 'E4', 'Gb major: a leap in is E');
eq(spell(64, key('Eb', 'minor'), { prev: 66, next: 63 }), 'Fb4', 'Eb minor (6 flats): passing Fb');
eq(spell(64, key('Ab'), { prev: 66, next: 63 }), 'E4', 'Ab major (4 flats): no Fb');
eq(spell(71, key('Db'), { prev: 72, next: 70 }), 'B4', 'Db major (5 flats): C-Cb-Bb is B');
// Double accidentals: respelled, unless the source wrote them and there is no transposition.
eq(spell(67, key('G#', 'minor')), 'G4', 'G# minor raised 7th F## is respelled');
eq(spell(67, key('G#', 'minor'), { source: { step: 'F', alter: 2 }, transposed: true }), 'G4', 'a transposed Fx is respelled');
eq(spell(67, key('G#', 'minor'), { source: { step: 'F', alter: 2 } }), 'F##4', 'an untransposed source Fx is kept');
eq(spell(69, key('F'), { source: { step: 'B', alter: -2 }, transposed: true }), 'A4', 'a transposed Bbb is respelled');
eq(spell(69, key('F'), { source: { step: 'B', alter: -2 } }), 'Bbb4', 'an untransposed source Bbb is kept');
eq(spell(62, key('Eb'), { source: { step: 'E', alter: -2 }, transposed: true, next: 63 }), 'D4', 'an upward-resolving double flat is still respelled');
// Octaves follow the letter (B#3 is MIDI 60, Cb5 is MIDI 71).
eq(spellPitch(60, key('C#')), { step: 'B', alter: 1, octave: 3 }, 'B#3 octave');
eq(spellPitch(71, key('Gb')), { step: 'C', alter: -1, octave: 5 }, 'Cb5 octave');
// Every MIDI pitch in every chosen key: a correct pitch, the key's own accidental direction, no E#/B#/Fb/Cb or doubles
// outside the key signature.
const semis = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
for (let pc = 0; pc < 12; pc++) for (const mode of ['major', 'minor']) for (const flip of [false, true]) for (const family of [undefined, 'sharp']) {
  const k = chooseKey(pc, mode, { family, flip });
  for (let midi = 48; midi < 84; midi++) {
    const p = spellPitch(midi, k);
    eq((p.octave + 1) * 12 + semis[p.step] + p.alter, midi, `${k.tonic} ${mode} ${midi} sounds right`);
    const signature = keyFromFifths(k.fifths, 'major').scale.find(s => s.step === p.step);
    if (p.alter === signature.alter) continue;
    assert.ok(Math.abs(p.alter) <= 1, `${k.tonic} ${mode} ${midi}: ${name(p)} has no double accidental`);
    const raised = mode === 'minor' && [(pc + 9) % 12, (pc + 11) % 12].includes(midi % 12);
    assert.ok(!['Fb', 'Cb'].includes(name(p)) && (raised || !['E#', 'B#'].includes(name(p))), `${k.tonic} ${mode} ${midi}: ${name(p)} is not Fb/Cb, nor E#/B# outside a raised degree`);
    if (k.fifths < 0 && !raised) assert.ok(p.alter <= 0, `${k.tonic} ${mode} ${midi}: ${name(p)} is flat or natural`);
    if (k.fifths > 0) assert.ok(p.alter >= 0, `${k.tonic} ${mode} ${midi}: ${name(p)} is sharp or natural`);
    checks += 2;
  }
}

// --- Chord symbols -------------------------------------------------------------------------------------------------
const chords = [
  ['A#m7', 'F', 'major', 'Bbm7'], ['Bb7/Ab', 'D', 'major', 'A#7/G#'], ['C#maj7/D#', 'Eb', 'major', 'Dbmaj7/Eb'], ['E#', 'D', 'major', 'F'],
  ['C#dim7', 'D', 'minor', 'C#dim7'], ['F♯m/C♯', 'F', 'major', 'G♭m/D♭'], ['N.C.', 'F', 'major', 'N.C.'], ['Cb', 'Gb', 'major', 'Cb'],
  ['Gbmaj7/Bb', 'E', 'major', 'F#maj7/A#'], ['Fx7', 'C', 'major', 'G7'], ['Ebbm', 'C', 'major', 'Dm'], ['B#7(b9)/D#', 'E', 'major', 'C7(b9)/D#'],
  ['C7(#11)/E', 'Ab', 'major', 'C7(#11)/E'], ['Dbm/Fb', 'Gb', 'major', 'Dbm/E'], ['', 'C', 'major', ''],
];
for (const [symbol, tonic, mode, expected] of chords) eq(spellChordSymbol(symbol, key(tonic, mode)), expected, `chord ${symbol} in ${tonic} ${mode}`);
console.log('Speller: key choice, flip, instrument registry, intervals, note and chord-symbol spelling passed');

// --- Verovio probe: the planned interval really produces the planned key and spelling ------------------------------
const toolkit = new VerovioToolkit(await createVerovioModule());
toolkit.setOptions({ xmlIdChecksum: false });
const meiFor = (source) => {
  const sig = source.fifths ? `${Math.abs(source.fifths)}${source.fifths > 0 ? 's' : 'f'}` : '0';
  const tonic = source.scale.find(s => s.step === source.tonic[0]);
  const notes = source.scale.map((s, i) => `<note xml:id="d${i}" pname="${s.step.toLowerCase()}" oct="4" dur="8"${s.alter ? ` accid.ges="${s.alter > 0 ? 's' : 'f'}"` : ''}/>`).join('');
  return { tonic, text: `<?xml version="1.0"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0"><meiHead><fileDesc><titleStmt><title>Probe</title></titleStmt><pubStmt/></fileDesc></meiHead><music><body><mdiv><score><scoreDef meter.count="4" meter.unit="4" key.sig="${sig}"${source.mode === 'minor' ? ' key.mode="minor"' : ''}><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef><section><measure n="1"><staff n="1"><layer n="1"><note xml:id="t" pname="${tonic.step.toLowerCase()}" oct="4" dur="4"${tonic.alter ? ` accid.ges="${tonic.alter > 0 ? 's' : 'f'}"` : ''}/>${notes}</layer></staff><harm staff="1" tstamp="1">${source.tonic}${source.mode === 'minor' ? 'm' : ''}</harm></measure></section></score></mdiv></body></music></mei>` };
};
const attr = (tag, nameOf) => (new RegExp(`\\s${nameOf.replace('.', '\\.')}="([^"]*)"`).exec(tag) || [])[1];
const accidValue = { s: 1, f: -1, n: 0, ss: 2, x: 2, ff: -2 };
let probed = 0;
const failures = [];
for (const { source, semitones, plan, label } of plans) {
  const { tonic, text } = meiFor(source);
  toolkit.setOptions({ transpose: plan.interval });
  toolkit.loadData(text);
  const out = toolkit.getMEI();
  const sigText = attr(/<scoreDef[^>]*>/.exec(out)[0], 'keysig') ?? attr(/<scoreDef[^>]*>/.exec(out)[0], 'key.sig') ?? '0';
  const fifths = sigText === '0' ? 0 : Number(sigText.slice(0, -1)) * (sigText.endsWith('s') ? 1 : -1);
  const tag = /<note xml:id="t"[^>]*>/.exec(out)[0];
  const step = attr(tag, 'pname').toUpperCase();
  const signature = Math.abs(fifths) <= 7 ? keyFromFifths(fifths, 'major').scale.find(s => s.step === step).alter : NaN;
  const alter = accidValue[attr(tag, 'accid') ?? attr(tag, 'accid.ges') ?? ''] ?? signature;
  const octave = Number(attr(tag, 'oct'));
  const midi = (octave + 1) * 12 + semis[step] + alter;
  const expectedMidi = (4 + 1) * 12 + semis[tonic.step] + tonic.alter + semitones;
  const harm = (/<harm[^>]*>(.*?)<\/harm>/s.exec(out) || [])[1]?.replace(/<[^>]+>/g, '').replace(/♯/g, '#').replace(/♭/g, 'b');
  const got = { fifths, tonic: `${step}${alter > 0 ? '#' : alter < 0 ? 'b' : ''}`, midi, harm };
  const want = { fifths: plan.key.fifths, tonic: plan.key.tonic, midi: expectedMidi, harm: `${plan.key.tonic}${source.mode === 'minor' ? 'm' : ''}` };
  if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${label} (${plan.interval}): got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  probed++;
}
assert.deepEqual(failures, [], `Verovio transposition differs from the plan in ${failures.length}/${probed} cases`);
checks += probed;
console.log(`Speller: ${probed} planned intervals verified against Verovio 6.3.0 (key signature, tonic spelling, octave, chord symbol) passed`);
console.log(`Speller: ${checks} checks passed`);
