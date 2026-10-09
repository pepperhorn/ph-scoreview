// In-page harness for validation/transpose.mjs: engraves a MusicXML score through the same pipeline the Verovio worker
// uses for a transposed or key-flipped view (convert to an MEI baseline, Verovio interval transposition, the spelling
// pass, the view MEI, an untransposed load) and checks what Verovio would draw against the spelling policy of
// docs/specs/transpose-and-spelling.md with rules written out independently of packages/pepperscore/src/lib/spelling.ts.
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { parseAbc, parseMei, parseMidi, parseMusicXml } from '../packages/pepperscore/src/lib/import';
import { buildViewMei, scanBaseline } from '../packages/pepperscore/src/lib/notation/mei-view';
import { spellBaseline } from '../packages/pepperscore/src/lib/notation/mei-spelling';
import { indexMusicXml, sliceMusicXml } from '../packages/pepperscore/src/lib/notation/musicxml-chunks';
import { staffNumbers } from '../packages/pepperscore/src/lib/render';
import { scoreForView, spellingSpecFor, type ScorePitchView } from '../packages/pepperscore/src/lib/transpose';
import { buildBaseTimeline, materializeTimeline } from '../packages/pepperscore/src/lib/playback/timeline';
import type { Score } from '../packages/pepperscore/src/lib/score';

type Toolkit = InstanceType<typeof VerovioToolkit>;
let toolkit: Promise<Toolkit> | undefined;
const verovio = () => toolkit ??= createVerovioModule().then(module => new VerovioToolkit(module));
function load(target: Toolkit, data: string, options: Record<string, unknown>) {
  target.resetOptions(); target.setOptions(options);
  if (!target.loadData(data)) throw new Error('Verovio could not load the document');
}
async function convert(text: string): Promise<string> { const target = await verovio(); load(target, text, { breaks: 'none', inputFrom: 'auto', xmlIdChecksum: true }); return target.getMEI(); }
const transposer = async (mei: string, options: { transpose: string; transposeToSoundingPitch: boolean }) => {
  const target = await verovio(); load(target, mei, { breaks: 'none', xmlIdChecksum: true, ...options }); return target.getMEI();
};

// --- The policy, written out on its own --------------------------------------------------------------------------
const LETTERS = 'CDEFGAB';
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const mod = (value: number, base: number) => ((value % base) + base) % base;
const MAJOR_BY_FIFTHS: Record<number, string> = { [-7]: 'Cb', [-6]: 'Gb', [-5]: 'Db', [-4]: 'Ab', [-3]: 'Eb', [-2]: 'Bb', [-1]: 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#' };
const FIFTHS_OF = Object.fromEntries(Object.entries(MAJOR_BY_FIFTHS).map(([fifths, name]) => [name, Number(fifths)]));
/** The spec's key table by major pitch class: default and the sharp-leaning (strings, guitars) profile. */
const TABLE: Record<string, string[]> = {
  neutral: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'],
  sharp: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'],
};
const FLIP: Record<string, string> = { 'C#': 'Db', Db: 'C#', 'F#': 'Gb', Gb: 'F#', B: 'Cb', Cb: 'B' };
/** Expected key signature (fifths, of the relative major for a minor key) of a staff. */
function expectedFifths(sourceFifths: number, semitones: number, moved: boolean, flip: boolean, profile: string): number {
  if (!semitones) {
    // Untransposed: the staff's own (sounding) key, past 7 accidentals as its enharmonic.
    const folded = sourceFifths > 7 ? sourceFifths - 12 : sourceFifths < -7 ? sourceFifths + 12 : sourceFifths;
    const name = MAJOR_BY_FIFTHS[folded];
    return FIFTHS_OF[flip ? FLIP[name] ?? name : name];
  }
  const name = TABLE[profile][mod(7 * sourceFifths + semitones, 12)];
  return FIFTHS_OF[flip ? FLIP[name] ?? name : name];
}
function signatureAlter(fifths: number, step: string): number {
  const order = fifths > 0 ? 'FCGDAEB' : 'BEADGCF';
  const index = order.indexOf(step);
  return index < Math.abs(fifths) ? Math.sign(fifths) * (Math.floor((Math.abs(fifths) - 1 - index) / 7) + 1) : 0;
}
const MINOR_TONIC: Record<number, string> = { [-7]: 'A', [-6]: 'E', [-5]: 'B', [-4]: 'F', [-3]: 'C', [-2]: 'G', [-1]: 'D', 0: 'A', 1: 'E', 2: 'B', 3: 'F', 4: 'C', 5: 'G', 6: 'D', 7: 'A' };
type Spelled = { step: string; alter: number; octave: number };
const nameOf = (pitch: { step: string; alter: number }) => `${pitch.step}${pitch.alter > 0 ? '#'.repeat(pitch.alter) : 'b'.repeat(-pitch.alter)}`;
/** Why a note's spelling breaks the policy in this key, or null. `next` is the next note's MIDI in its voice. */
function spellingFault(pitch: Spelled, midi: number, fifths: number, mode: string, next?: number): string | null {
  if (signatureAlter(fifths, pitch.step) === pitch.alter) return null;
  if (Math.abs(pitch.alter) >= 2) return 'double accidental';
  if (mode === 'minor') {
    const tonic = LETTERS.indexOf(MINOR_TONIC[fifths]);
    for (const degree of [5, 6]) {
      const step = LETTERS[(tonic + degree) % 7];
      if (step === pitch.step && pitch.alter === signatureAlter(fifths, step) + 1) return null;
    }
  }
  if ((pitch.step === 'E' || pitch.step === 'B') && pitch.alter === 1) return 'E#/B# outside the signature';
  if ((pitch.step === 'F' || pitch.step === 'C') && pitch.alter === -1) return fifths <= -6 ? null : 'Fb/Cb outside a 6+ flat key';
  const resolvesUp = next !== undefined && next - midi >= 1 && next - midi <= 2;
  if (pitch.alter === 1 && fifths < 0 && !resolvesUp) return 'sharp in a flat key';
  if (pitch.alter === -1 && fifths > 0 && !resolvesUp) return 'flat in a sharp key';
  if (fifths === 0 && pitch.alter === 1 && mod(midi, 12) !== 6 && !resolvesUp) return 'sharp other than F# in C';
  if (fifths === 0 && pitch.alter === -1 && mod(midi, 12) === 6 && !resolvesUp) return 'Gb in C';
  return null;
}

// --- Reading an MEI document ---------------------------------------------------------------------------------------
const ALTER: Record<string, number> = { s: 1, f: -1, n: 0, x: 2, ss: 2, ff: -2, xs: 3, sx: 3, ts: 3, tf: -3 };
const DURATION: Record<string, number> = { breve: 8, '1': 4, '2': 2, '4': 1, '8': 0.5, '16': 0.25, '32': 0.125, '64': 0.0625 };
type MeiNote = { id: string; staff: string; layer: string; measure: number; onset: number; chord: boolean; step: string; octave: number; alter: number;
  written: number | null; cautionary: boolean; tieEnd: boolean; loc: string | null; midi: number; fifths: number; mode: string };
type MeiKey = { measure: number; fifths: number; mode: string };
type MeiRead = { staves: string[]; percussion: Set<string>; trans: Map<string, { semi: number; diat: number }>; keys: Map<string, MeiKey[]>; notes: MeiNote[]; harms: { measure: number; staff: string; text: string; fifths: number; mode: string }[] };
const sig = (value: string | null) => { const match = /^(\d+)([sf]?)$/.exec(value || ''); return match ? Number(match[1]) * (match[2] === 'f' ? -1 : 1) : null; };

/** `impliedNatural`: a note without accidentals is natural (Verovio's MusicXML import always writes accid.ges otherwise). */
function readMei(text: string, impliedNatural = false): MeiRead {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const all = [...doc.getElementsByTagName('*')];
  const read: MeiRead = { staves: [], percussion: new Set(), trans: new Map(), keys: new Map(), notes: [], harms: [] };
  const ties = new Set([...doc.getElementsByTagName('tie')].map(tie => (tie.getAttribute('endid') || '').replace(/^#/, '')));
  const current = new Map<string, MeiKey>();
  let measure = -1; let initial = true;
  const setKey = (n: string, fifths: number, mode: string) => {
    const key = { measure: Math.max(0, measure + 1), fifths, mode };
    current.set(n, key);
    const list = read.keys.get(n) ?? read.keys.set(n, []).get(n)!;
    if (list.at(-1)?.measure === key.measure) list.pop();
    list.push(key);
  };
  const onsets = new Map<Element, number>();
  for (const layer of doc.getElementsByTagName('layer')) {
    let time = 0;
    const walk = (element: Element, scale: number) => {
      for (const child of element.children) {
        const name = child.localName;
        const length = () => child.hasAttribute('grace') ? 0 : (DURATION[child.getAttribute('dur') || ''] ?? 0) * (2 - 1 / 2 ** (Number(child.getAttribute('dots')) || 0)) * scale;
        if (name === 'chord') { for (const note of child.getElementsByTagName('note')) onsets.set(note, time); time += length(); }
        else if (name === 'note') { onsets.set(child, time); time += length(); }
        else if (name === 'rest' || name === 'space') time += length();
        else if (name === 'tuplet') walk(child, scale * (Number(child.getAttribute('numbase')) || 1) / (Number(child.getAttribute('num')) || 1));
        else walk(child, scale);
      }
    };
    walk(layer, 1);
  }
  for (const element of all) {
    const name = element.localName;
    if (name === 'measure') { measure++; initial = false; continue; }
    const attributeKey = sig(element.getAttribute('keysig') ?? element.getAttribute('key.sig'));
    if (name === 'scoreDef' && attributeKey !== null) for (const n of [...doc.getElementsByTagName('staffDef')].map(def => def.getAttribute('n') || '')) setKey(n, attributeKey, element.getAttribute('key.mode') || 'major');
    if (name === 'staffDef') {
      const n = element.getAttribute('n') || '';
      if (initial && !read.staves.includes(n)) read.staves.push(n);
      if (attributeKey !== null) setKey(n, attributeKey, element.getAttribute('key.mode') || 'major');
      if (element.getAttribute('clef.shape') === 'perc' || [...element.children].some(child => child.localName === 'clef' && child.getAttribute('shape') === 'perc')) read.percussion.add(n);
      if (element.hasAttribute('trans.semi')) read.trans.set(n, { semi: Number(element.getAttribute('trans.semi')), diat: Number(element.getAttribute('trans.diat')) || 0 });
      continue;
    }
    if (name === 'keySig') {
      const fifths = sig(element.getAttribute('sig')) ?? 0;
      const mode = element.getAttribute('mode') || 'major';
      const parent = element.parentElement!;
      if (parent.localName === 'staffDef') setKey(parent.getAttribute('n') || '', fifths, mode);
      else if (parent.localName === 'scoreDef') for (const n of read.staves.length ? read.staves : [...doc.getElementsByTagName('staffDef')].map(def => def.getAttribute('n') || '')) setKey(n, fifths, mode);
      else { const staff = element.closest('staff')?.getAttribute('n'); if (staff) setKey(staff, fifths, mode); }
      continue;
    }
    if (name === 'note') {
      const staff = element.closest('staff')?.getAttribute('n') || '';
      const layer = element.closest('layer')?.getAttribute('n') || '';
      const accids = [...element.children].filter(child => child.localName === 'accid');
      const writtenText = element.getAttribute('accid') ?? accids.find(accid => accid.hasAttribute('accid'))?.getAttribute('accid') ?? null;
      const gesturalText = element.getAttribute('accid.ges') ?? accids.find(accid => accid.hasAttribute('accid.ges'))?.getAttribute('accid.ges') ?? null;
      const step = (element.getAttribute('pname') || '').toUpperCase();
      const key = current.get(staff) ?? { measure: 0, fifths: 0, mode: 'major' };
      read.notes.push({ id: element.getAttribute('xml:id') || '', staff, layer, measure, onset: onsets.get(element) ?? 0, chord: !!element.closest('chord'), step, octave: Number(element.getAttribute('oct')),
        alter: gesturalText !== null ? ALTER[gesturalText] ?? 0 : NaN, written: writtenText !== null ? ALTER[writtenText] ?? 0 : null,
        cautionary: accids.some(accid => accid.hasAttribute('func') || accid.hasAttribute('enclose')),
        tieEnd: ties.has(element.getAttribute('xml:id') || '') || ['t', 'm'].includes(element.getAttribute('tie') || ''), loc: element.getAttribute('loc'), midi: 0, fifths: key.fifths, mode: key.mode });
      continue;
    }
    if (name === 'harm') {
      const staff = (element.getAttribute('staff') || '').split(' ')[0];
      const key = current.get(staff) ?? { measure: 0, fifths: 0, mode: 'major' };
      read.harms.push({ measure, staff, text: (element.textContent || '').trim(), fifths: key.fifths, mode: key.mode });
    }
  }
  // Effective alteration: written, else gestural, else an earlier accidental on the line in the measure, else the key.
  const groups = new Map<string, MeiNote[]>();
  for (const note of read.notes) if (note.step) (groups.get(`${note.staff}|${note.measure}`) ?? groups.set(`${note.staff}|${note.measure}`, []).get(`${note.staff}|${note.measure}`)!).push(note);
  for (const group of groups.values()) {
    const state = new Map<string, number>();
    for (const note of [...group].sort((a, b) => a.onset - b.onset)) {
      const line = `${note.step}${note.octave}`;
      if (note.written !== null) { note.alter = note.written; state.set(line, note.written); }
      else if (Number.isNaN(note.alter)) note.alter = impliedNatural ? 0 : state.get(line) ?? signatureAlter(note.fifths, note.step);
      note.midi = (note.octave + 1) * 12 + NATURAL[LETTERS.indexOf(note.step)] + note.alter;
    }
  }
  return read;
}

const chordRoots = (text: string) => [...text.matchAll(/(?:^|\/)([A-G])([#♯b♭x𝄪𝄫]*)/g)].map(([, step, accidentals]) => ({ step, alter: [...accidentals].reduce((sum, char) => sum + (char === '#' || char === '♯' ? 1 : char === 'x' || char === '𝄪' ? 2 : char === '𝄫' ? -2 : -1), 0) }));

export type ViewCase = { semitones: number; flip: boolean; view: ScorePitchView };
type Engraving = { score: Score; view: Score; spec: ReturnType<typeof spellingSpecFor>; final: string; svg: string };
/** A score source: MusicXML text, or another format the reader imports. */
export type Source = string | { abc: string } | { mei: string } | { midi: number[] };
const baselines = new Map<string, { score: Score; baseline: string }>();

async function prepare(source: Source) {
  const cacheKey = typeof source === 'string' ? source : JSON.stringify(source);
  let entry = baselines.get(cacheKey);
  if (!entry) {
    const score = typeof source === 'string' ? parseMusicXml(source) : 'abc' in source ? await parseAbc(source.abc) : 'mei' in source ? parseMei(source.mei) : await parseMidi(new Uint8Array(source.midi).buffer);
    entry = { score, baseline: await convert(new TextDecoder().decode(score.document!.engravingBytes())) };
    baselines.set(cacheKey, entry);
  }
  return entry;
}

export async function engrave(xml: Source, test: ViewCase, slice?: { from: number; to: number }): Promise<Engraving> {
  const { score, baseline: whole } = await prepare(xml);
  const baseline = slice ? await convert(sliceMusicXml(indexMusicXml(new TextDecoder().decode(score.document!.engravingBytes()))!, slice.from, slice.to)) : whole;
  const staffOf = staffNumbers(scanBaseline(whole), score).byPart;
  const view = scoreForView(score, test.view, test.semitones, test.flip);
  const spec = spellingSpecFor(view, staffOf);
  const spelled = await spellBaseline(baseline, spec, transposer, slice?.from ?? 0);
  const target = await verovio();
  load(target, buildViewMei(spelled, { breakEvery: 0, hiddenStaves: [], chordSymbols: true, spelling: spec }, Infinity, slice?.from ?? 0), { breaks: 'none', xmlIdChecksum: true, pageWidth: 60000, svgAdditionalAttribute: ['staff@n'] });
  return { score, view, spec, final: target.getMEI(), svg: target.renderToSVG(1) };
}

/** Check one view of a score; returns failure messages (empty when the view follows the policy) and counts. */
export async function checkView(xml: Source, test: ViewCase) {
  const failures: string[] = [];
  const fail = (message: string) => { if (failures.length < 40) failures.push(`${test.view} ${test.semitones > 0 ? '+' : ''}${test.semitones}${test.flip ? ' flip' : ''}: ${message}`); };
  const { score, view, spec, final, svg } = await engrave(xml, test);
  const source = readMei((await prepare(xml)).baseline, typeof xml === 'string' || !('mei' in xml));
  const out = readMei(final);
  const sourceNotes = new Map(source.notes.map(note => [note.id, note]));
  const staffInfo = (n: string) => spec.staves[n] ?? { profile: 'neutral', moved: false };
  const shiftOf = (n: string) => staffInfo(n).moved ? source.trans.get(n) ?? { semi: 0, diat: 0 } : { semi: 0, diat: 0 };
  const respelled = (n: string) => !source.percussion.has(n) && (staffInfo(n).moved || test.semitones !== 0 || !!view.pitchView?.flip || !!spec.interval);
  let keyChecks = 0; let noteChecks = 0; let labelChecks = 0; let harmChecks = 0;

  // Key signatures: every staff's keys follow the table; percussion staves have none.
  for (const n of source.staves) {
    const outKeys = (out.keys.get(n) || []).filter((key, index, list) => index === 0 || key.fifths !== list[index - 1].fifths || key.measure !== list[index - 1].measure);
    if (source.percussion.has(n)) {
      if (outKeys.some(key => key.fifths !== 0)) fail(`percussion staff ${n} has a key signature ${JSON.stringify(outKeys)}`);
      // The staff's own drawing: from its group's opening tag to the next staff or measure group.
      const staffGroups = svg.split(/(?=<g [^>]*class="(?:staff|measure|system)")/).filter(part => /^<g [^>]*class="staff"/.test(part) && new RegExp(`^<g [^>]*data-n="${n}"`).test(part));
      if (!staffGroups.length) fail(`percussion staff ${n} is not drawn`);
      if (staffGroups.some(part => /class="keyAccid"/.test(part))) fail(`percussion staff ${n} draws key accidentals`);
      continue;
    }
    // The staff's keys from the Score (Verovio's MusicXML import gives every staff the first part's key changes).
    const keys = spec.staves[n]?.keys ?? [[0, 0, 'major']];
    // A change of mode alone (A minor to C major) is a new key signature too.
    const expected = keys.map(([measure, fifths, mode]) => ({ measure, fifths: expectedFifths(fifths, test.semitones, staffInfo(n).moved, view.pitchView?.flip ?? false, staffInfo(n).profile), mode }))
      .filter((key, index, list) => index === 0 || key.fifths !== list[index - 1].fifths || key.mode !== list[index - 1].mode)
      .map(({ measure, fifths }) => ({ measure, fifths }));
    const got = outKeys.map(key => ({ measure: key.measure, fifths: key.fifths }));
    keyChecks += expected.length;
    if (JSON.stringify(got) !== JSON.stringify(expected)) fail(`staff ${n} keys ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`);
  }

  // Notes: pitch is never changed by spelling, spellings follow the policy, accidentals display correctly.
  const lines = new Map<string, MeiNote[]>();
  for (const note of out.notes) (lines.get(`${note.staff}|${note.layer}`) ?? lines.set(`${note.staff}|${note.layer}`, []).get(`${note.staff}|${note.layer}`)!).push(note);
  for (const note of out.notes) {
    const from = sourceNotes.get(note.id);
    if (!from) { fail(`note ${note.id} is not in the source`); continue; }
    if (source.percussion.has(note.staff)) {
      if (note.loc !== from.loc || note.step) fail(`percussion note ${note.id} moved (${from.loc} -> ${note.loc} ${note.step})`);
      continue;
    }
    const shift = shiftOf(note.staff);
    if (note.midi !== from.midi + shift.semi + test.semitones) fail(`note ${note.id} sounds ${note.midi}, expected ${from.midi + shift.semi + test.semitones}`);
    if (!respelled(note.staff)) continue;
    noteChecks++;
    const line = lines.get(`${note.staff}|${note.layer}`)!;
    const index = line.indexOf(note);
    const next = !note.chord && line[index + 1] && !line[index + 1].chord ? line[index + 1].midi : undefined;
    const fault = note.tieEnd ? null : spellingFault(note, note.midi, note.fifths, note.mode, next);
    if (fault) fail(`note ${note.id} ${nameOf(note)}${note.octave} in ${note.fifths} fifths ${note.mode} (staff ${note.staff}, bar ${note.measure + 1}): ${fault}`);
  }
  const groups = new Map<string, MeiNote[]>();
  for (const note of out.notes) if (note.step && respelled(note.staff)) (groups.get(`${note.staff}|${note.measure}`) ?? groups.set(`${note.staff}|${note.measure}`, []).get(`${note.staff}|${note.measure}`)!).push(note);
  for (const group of groups.values()) {
    const state = new Map<string, number>();
    const sorted = [...group].sort((a, b) => a.onset - b.onset);
    for (let start = 0; start < sorted.length;) {
      let end = start; while (end < sorted.length && sorted[end].onset === sorted[start].onset) end++;
      const updates: [string, number][] = [];
      for (const note of sorted.slice(start, end)) {
        const line = `${note.step}${note.octave}`;
        const inForce = state.get(line) ?? signatureAlter(note.fifths, note.step);
        const shown = note.written !== null;
        const expected = !note.tieEnd && (note.alter !== inForce || note.cautionary);
        if (shown !== expected) fail(`note ${note.id} ${nameOf(note)}${note.octave} (staff ${note.staff}, bar ${note.measure + 1}) ${shown ? 'shows' : 'hides'} its accidental (in force ${inForce})`);
        if (expected) updates.push([line, note.alter]);
      }
      for (const [line, alter] of updates) state.set(line, alter);
      start = end;
    }
  }

  // Every pitched note reads as its pitch: one without a written accidental has the alteration in force (the key
  // signature, or an earlier accidental in the measure on its line).
  const all = new Map<string, MeiNote[]>();
  for (const note of out.notes) if (note.step && !source.percussion.has(note.staff)) (all.get(`${note.staff}|${note.measure}`) ?? all.set(`${note.staff}|${note.measure}`, []).get(`${note.staff}|${note.measure}`)!).push(note);
  for (const group of all.values()) {
    const state = new Map<string, number>();
    for (const note of [...group].sort((a, b) => a.onset - b.onset)) {
      const line = `${note.step}${note.octave}`;
      if (note.written !== null) { state.set(line, note.written); continue; }
      const inForce = state.get(line) ?? signatureAlter(note.fifths, note.step);
      if (!note.tieEnd && note.alter !== inForce) fail(`note ${note.id} ${nameOf(note)}${note.octave} (staff ${note.staff}, bar ${note.measure + 1}) reads as alteration ${inForce} in ${note.fifths} fifths`);
    }
  }

  // Note-name labels (the Score view's pitches) match the engraved spelling.
  const byId = new Map(out.notes.map(note => [note.id, note]));
  for (const part of view.parts) {
    if (part.clef === 'percussion') continue;
    for (const measure of part.measures) for (const event of measure.notes) {
      event.pitches.forEach(pitch => {
        const id = pitch.sourceId ?? (event.pitches.length === 1 ? event.sourceId ?? score.document?.identity?.noteIdToSourceId?.[event.id] : undefined);
        const engraved = id ? byId.get(id) : undefined;
        if (!engraved || pitch.unpitched) return;
        labelChecks++;
        if (engraved.step !== pitch.step || engraved.alter !== pitch.alter || engraved.octave !== pitch.octave) fail(`label ${nameOf(pitch)}${pitch.octave} for note ${id} engraved ${nameOf(engraved)}${engraved.octave}`);
      });
    }
  }

  // Chord symbols: same harmony moved by the transposition, roots and basses spelled by the policy.
  if (source.harms.length !== out.harms.length) fail(`chord symbols ${source.harms.length} -> ${out.harms.length}`);
  source.harms.forEach((harm, index) => {
    const moved = out.harms[index];
    if (!moved) return;
    const before = chordRoots(harm.text); const after = chordRoots(moved.text);
    harmChecks++;
    const shift = shiftOf(harm.staff).semi + test.semitones;
    if (before.length !== after.length || before.some((root, i) => mod(NATURAL[LETTERS.indexOf(root.step)] + root.alter + shift - NATURAL[LETTERS.indexOf(after[i].step)] - after[i].alter, 12) !== 0)) fail(`chord symbol ${harm.text} -> ${moved.text}`);
    if (respelled(harm.staff)) for (const root of after) {
      const fault = spellingFault({ ...root, octave: 4 }, 60 + NATURAL[LETTERS.indexOf(root.step)] + root.alter, moved.fifths, moved.mode);
      if (fault) fail(`chord symbol ${moved.text} in ${moved.fifths} fifths: ${fault}`);
    }
  });

  // Playback: the timeline comes from the source Score, so it cannot depend on the flip; the view's pitches sound
  // exactly the source pitches moved by the view and the transposition.
  const playback = materializeTimeline(buildBaseTimeline(score), 96, test.semitones).events.map(event => event.midi).join(',');
  for (const part of view.parts) {
    const original = score.parts.find(item => item.id === part.id)!;
    part.measures.forEach((measure, m) => measure.notes.forEach((note, n) => note.pitches.forEach((pitch, p) => {
      const was = original.measures[m].notes[n].pitches[p];
      const moved = view.pitchView?.viewMoved.includes(part.id) ? (original.measures[m].transposition ?? original.transposition)?.semitones ?? 0 : 0;
      if (part.clef !== 'percussion' && pitch.midi !== was.midi + moved + test.semitones) fail(`view pitch ${pitch.midi} for ${was.midi} (+${moved}+${test.semitones})`);
    })));
  }
  const modes = Object.fromEntries([...out.keys].map(([n, list]) => [n, list.map(key => key.mode)]));
  return { failures, keyChecks, noteChecks, labelChecks, harmChecks, playback, modes };
}

/**
 * A chunked engraving (slices of `size` measures with one measure of overlap each side, as the worker cuts them)
 * shows the same keys and spellings in every measure as the whole engraving.
 */
export async function checkChunks(xml: string, test: ViewCase, size: number) {
  const failures: string[] = [];
  const keysAt = (read: MeiRead, offset: number) => {
    const result = new Map<string, string>();
    for (const n of read.staves) {
      const list = read.keys.get(n) || [];
      const measures = new Set(read.notes.map(note => note.measure));
      for (const measure of measures) {
        const key = [...list].reverse().find(item => item.measure <= measure);
        result.set(`${n}|${measure + offset}`, key ? String(key.fifths) : 'none');
      }
    }
    return result;
  };
  const spellings = (read: MeiRead, offset: number) => {
    const ordinal = new Map<string, number>();
    const result = new Map<string, string>();
    for (const note of read.notes) {
      const key = `${note.staff}|${note.layer}|${note.measure + offset}`;
      const index = ordinal.get(key) ?? 0; ordinal.set(key, index + 1);
      result.set(`${key}|${index}`, note.step ? `${nameOf(note)}${note.octave}${note.written !== null ? '!' : ''}` : `loc${note.loc}`);
    }
    return result;
  };
  const whole = readMei((await engrave(xml, test)).final);
  const wholeKeys = keysAt(whole, 0); const wholeNotes = spellings(whole, 0);
  const total = indexMusicXml(new TextDecoder().decode((await prepare(xml)).score.document!.engravingBytes()))!.measureCount;
  let compared = 0;
  for (let from = 0; from < total; from += size) {
    const start = Math.max(0, from - 1); const end = Math.min(total, from + size + 1);
    const chunk = readMei((await engrave(xml, test, { from: start, to: end })).final);
    const keys = keysAt(chunk, start); const notes = spellings(chunk, start);
    for (const [key, value] of keys) {
      const measure = Number(key.split('|')[1]);
      if (measure < from || measure >= from + size) continue;
      compared++;
      if (wholeKeys.get(key) !== value && failures.length < 20) failures.push(`chunk ${start}-${end} staff/bar ${key}: key ${value}, whole ${wholeKeys.get(key)}`);
    }
    for (const [key, value] of notes) {
      const measure = Number(key.split('|')[2]);
      if (measure < from || measure >= from + size) continue;
      compared++;
      if (wholeNotes.get(key) !== value && failures.length < 20) failures.push(`chunk ${start}-${end} note ${key}: ${value}, whole ${wholeNotes.get(key)}`);
    }
  }
  return { failures, compared };
}
