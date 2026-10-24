/**
 * The spelling pass over a (Verovio-transposed) MEI baseline, run in the Verovio worker before the view MEI is built
 * (docs/specs/transpose-and-spelling.md, option A). Verovio transposes by the planned interval with quality; this
 * pass then applies what Verovio won't:
 *
 * - every staff's key is chosen from the key table (part profile in the written view, flip), per staff and per key
 *   area, so a scoreDef-wide key becomes per-staff keys (a violin in C# beside a piano in Db);
 * - notes are respelled key-relatively (spelling.ts `spellPitch`): no E#/B# outside the signature except minor raised
 *   degrees, Fb/Cb only as passing notes in keys of 6+ flats, flats-only/sharps-only per key, no double accidentals;
 * - accidentals are re-shown or cancelled within each measure to match the new spellings (@accid / @accid.ges);
 * - chord symbols (`<harm>`) are respelled for their staff's key;
 * - percussion staves never get a key signature or key change (in every view, transposed or not);
 * - an instrument-switched staff (instrument-view.ts) moves by its own `shift`, takes the target's clef (the source's
 *   clef changes are dropped), and notes an octave move names (`octaves`) move by an octave, before accidentals are
 *   re-evaluated.
 *
 * Keys are rewritten from a per-staff timeline (the spec's Score keys, else the MEI's): every key signature is removed
 * from the score definitions and each staff's keys are written where they start or change.
 *
 * String-level like mei-view.ts (the worker has no DOMParser); the input is Verovio's own `getMEI` output.
 */
import type { InstrumentClef } from '../instrument-model';
import { keyFromFifths, spellChordSymbol, type KeyMode, type SpellingKey, type SpellingProfile } from '../spelling';
import { generatedPitchIdOf } from './document';
import { attributeOf, scan } from './mei-view';
import { accidentalDisplay, fifthsOf, intervalFifths, moveChordSymbol, parseInterval, transposeSpelled, respellLine, sigOf, viewKey, type LineNote, type SpelledPitch, type StaffSpelling } from './respell';

export type SpellingSpec = {
  /** The Verovio `transpose` interval the baseline was moved by ('' for none). */
  interval: string;
  /** Semitones of the global transposition (the interval's size, signed). */
  semitones: number;
  /** Written parts are shown at sounding pitch (the staves' `shift`). */
  concert: boolean;
  /** Spell in the enharmonic equivalent key. */
  flip: boolean;
  /** Per staff `@n`. Staves not listed are neutral and move only with the transposition. */
  staves: Record<string, StaffSpec>;
};
export type StaffSpec = StaffSpelling & {
  percussion?: boolean;
  /**
   * The staff's keys in this view before the global transposition and flip: [measure index, fifths, mode] where the
   * key starts or changes (from the Score). They replace the MEI's keys, which Verovio's MusicXML import can get wrong
   * (it writes a mid-score key change of the first part for every staff, so a transposing part loses its own key).
   */
  keys?: [number, number, KeyMode][];
  /**
   * Concert view of a transposing part: the interval [letter steps, semitones] from written to sounding pitch. The
   * pass moves the staff's notes and chord symbols itself (Verovio's transposeToSoundingPitch picks its own key and
   * spellings, e.g. a B♭ trumpet in Ab sounding in F# with C double sharps), the way the Score view does.
   */
  shift?: [number, number];
  /** Octave moves of notes (instrument switch, range fit or the reader's): semitones by MEI note xml:id. */
  octaves?: Record<string, 12 | -12>;
  /** The staff's clef replaced by an instrument switch: set on its staff definitions, its clef changes removed. */
  clef?: InstrumentClef;
};

/** MEI clef attributes of an instrument clef (none for percussion: a switch never targets it). */
const CLEFS: Partial<Record<InstrumentClef, [string, string, string?]>> = { treble: ['G', '2'], bass: ['F', '4'], alto: ['C', '3'], tenor: ['C', '4'], treble8vb: ['G', '2', '8'] };
const CLEF_ATTRIBUTES = ['clef.shape', 'clef.line', 'clef.dis', 'clef.dis.place'];
/** A `<clef>` element for an instrument clef (keeping the replaced element's xml:id). */
function clefElement(clef: InstrumentClef, id: string | null): string {
  const [shape, line, dis] = CLEFS[clef]!;
  return `<clef${id ? ` xml:id="${id}"` : ''} shape="${shape}" line="${line}"${dis ? ` dis="${dis}" dis.place="below"` : ''}/>`;
}
/** A staffDef tag with its clef attributes replaced by `clef`'s (only where it carries them), or removed (`clef` undefined). */
function withClefAttributes(tag: string, clef: InstrumentClef | undefined): string {
  if (!/\sclef\.shape\s*=/.test(tag)) return tag;
  let out = CLEF_ATTRIBUTES.reduce(removeAttribute, tag);
  if (!clef || !CLEFS[clef]) return out;
  const [shape, line, dis] = CLEFS[clef]!;
  out = setAttribute(setAttribute(out, 'clef.shape', shape), 'clef.line', line);
  return dis ? setAttribute(setAttribute(out, 'clef.dis', dis), 'clef.dis.place', 'below') : out;
}

const LETTERS = 'CDEFGAB';
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const ALTER_OF: Record<string, number> = { s: 1, f: -1, n: 0, x: 2, ss: 2, ff: -2, ts: 3, tf: -3, xs: 3, sx: 3, nf: -1, ns: 1, su: 1, sd: 1, fu: -1, fd: -1, nu: 0, nd: 0 };
const WRITTEN = (alter: number) => ({ 1: 's', [-1]: 'f', 0: 'n', 2: 'x', [-2]: 'ff' } as Record<number, string>)[alter] ?? 'n';
const GESTURAL = (alter: number) => ({ 1: 's', [-1]: 'f', 0: 'n', 2: 'ss', [-2]: 'ff' } as Record<number, string>)[alter] ?? 'n';

/** A key signature's alteration of a letter for any number of fifths (past 7 gives double sharps or flats). */
function fifthsAlter(step: string, fifths: number): number {
  const order = fifths > 0 ? 'FCGDAEB' : 'BEADGCF';
  const index = order.indexOf(step);
  const count = index < Math.abs(fifths) ? Math.floor((Math.abs(fifths) - 1 - index) / 7) + 1 : 0;
  return fifths > 0 ? count : -count;
}

const DURATION: Record<string, number> = { maxima: 32, long: 16, breve: 8, '1': 4, '2': 2, '4': 1, '8': 0.5, '16': 0.25, '32': 0.125, '64': 0.0625, '128': 0.03125, '256': 0.015625 };
function quarters(attributes: string): number {
  if (attributeOf(attributes, 'grace') !== null) return 0;
  const base = DURATION[attributeOf(attributes, 'dur') || ''] ?? 0;
  const dots = Number(attributeOf(attributes, 'dots')) || 0;
  return base * (2 - 1 / 2 ** dots);
}

function setAttribute(tag: string, name: string, value: string): string {
  const pattern = new RegExp(`\\s${name.replace('.', '\\.')}\\s*=\\s*(?:"[^"]*"|'[^']*')`);
  if (pattern.test(tag)) return tag.replace(pattern, ` ${name}="${value}"`);
  return tag.replace(/\s*(\/?)>$/, ` ${name}="${value}"$1>`);
}
function removeAttribute(tag: string, name: string): string {
  return tag.replace(new RegExp(`\\s${name.replace('.', '\\.')}\\s*=\\s*(?:"[^"]*"|'[^']*')`), '');
}
// MEI 5 names the key signature attribute `keysig` (Verovio writes it back that way); older MEI uses `key.sig`.
const KEY_ATTRIBUTES = ['keysig', 'key.sig', 'key.mode', 'key.pname', 'key.accid', 'key.sig.mixed'];
const withoutKeyAttributes = (tag: string) => KEY_ATTRIBUTES.reduce(removeAttribute, tag);
const openTag = (tag: string) => tag.replace(/\s*\/>$/, '>');
const keySigTag = (key: SpellingKey) => `<keySig sig="${sigOf(key.fifths)}"${key.mode === 'minor' ? ' mode="minor"' : ''}/>`;

type Range = { start: number; end: number };
type Edit = Range & { text: string };
type Key = { fifths: number; mode: KeyMode };
type StaffDefRecord = Range & { n: string; tag: string; selfClosing: boolean; clefEnd?: number; clef?: Range & { id: string | null } };
type ScoreDefRecord = Range & { initial: boolean; measure: number; content: boolean; keyRanges: Range[]; tagEdits: Edit[];
  /** Keys this definition sets (MEI values, after Verovio's transposition): '*' for every staff. */
  keys: Map<string, Key> };
type AccidRecord = Range & { attributes: string };
type NoteRecord = Range & {
  tag: string; selfClosing: boolean; id: string; staff: string; layer: string; measure: number; onset: number; chord: boolean;
  pname: string; oct: number; written: number | null; gestural: number | null; accids: AccidRecord[]; tieEnd: boolean; cautionary: boolean };
type HarmRecord = { textStart: number; textEnd: number; staff: string; measure: number; nested: boolean };

const modeOf = (value: string | null): KeyMode | null => value === 'minor' ? 'minor' : value === 'major' ? 'major' : null;
/** Attributes of a staffDef that only name it or carry a key (a definition with nothing else can be dropped). */
const KEY_ONLY_STAFF_DEF = /^(?:\s+(?:n|xml:id|keysig|key\.[\w.]+)\s*=\s*(?:"[^"]*"|'[^']*'))*\s*$/;

/** Does this spec change anything for this MEI (a transposition, a flip, or a percussion staff with keys to strip)? */
export function spellingNeeded(mei: string, spec: SpellingSpec | undefined): boolean {
  if (!spec) return false;
  // Key changes are rewritten from the Score too: Verovio's MusicXML import gives every staff the first part's key change.
  return !!spec.interval || spec.concert || spec.flip || spec.semitones !== 0 || /\b(?:clef\.)?shape="perc"/.test(mei)
    || Object.values(spec.staves).some(staff => staff.percussion || (staff.keys?.length ?? 0) > 1 || !!staff.clef || !!staff.shift?.[1] || !!staff.shift?.[0]
      || Object.keys(staff.octaves ?? {}).length > 0);
}

/** Verovio's transposition of an MEI document (load with these options, then `getMEI`). */
export type Transposer = (mei: string, options: { transpose: string; transposeToSoundingPitch: boolean }) => Promise<string> | string;

/**
 * A baseline (or chunk) moved and spelled for a view: Verovio transposes it by the planned interval (and to sounding
 * pitch for the concert view), then `respellMei` applies the policy. The view built from it is loaded untransposed.
 * `measureOffset` is the Score index of the document's first measure (a chunk of a long score).
 */
export async function spellBaseline(mei: string, spec: SpellingSpec | undefined, transpose: Transposer, measureOffset = 0): Promise<string> {
  if (!spec || !spellingNeeded(mei, spec)) return mei;
  // Verovio moves every staff by the interval; the concert view's written-to-sounding shift is the pass's own.
  const moved = spec.interval ? await transpose(mei, { transpose: spec.interval, transposeToSoundingPitch: false }) : mei;
  return respellMei(moved, spec, measureOffset);
}

/** Apply the spelling policy to a transposed baseline (see the module comment). */
export function respellMei(mei: string, spec: SpellingSpec, measureOffset = 0): string {
  if (!spellingNeeded(mei, spec)) return mei;
  const shift = intervalFifths(parseInterval(spec.interval));
  // Ties: the end note of a tie takes its start note's spelling and never shows an accidental.
  const tiedFrom = new Map<string, string>();
  scan(mei, ({ closing, name, attributes }) => {
    if (closing || name !== 'tie') return;
    const start = attributeOf(attributes, 'startid')?.replace(/^#/, ''); const end = attributeOf(attributes, 'endid')?.replace(/^#/, '');
    if (start && end) tiedFrom.set(end, start);
  });

  const scoreDefs: ScoreDefRecord[] = [];
  const initialStaffDefs: StaffDefRecord[] = [];
  const measureStarts: number[] = [];
  const notes: NoteRecord[] = [];
  const harms: HarmRecord[] = [];
  const layerKeySigs: (Range & { staff: string; measure: number; key: Key | null })[] = [];
  const percussion = new Set(Object.entries(spec.staves).filter(([, staff]) => staff.percussion).map(([n]) => n));
  const staffSpec = (n: string): StaffSpec => spec.staves[n] ?? { profile: 'neutral' as SpellingProfile, moved: spec.semitones !== 0 };
  const viewShift = (n: string) => { const value = staffSpec(n).shift; return value && (value[0] || value[1]) ? { diatonic: value[0], chromatic: value[1] } : undefined; };
  // Any staff Verovio moved (an interval moves every staff) is respelled, as is every staff of a flipped view and a
  // staff with its own shift. A staff with octave moves only keeps its spellings (its notes are read to move them).
  const respelled = (n: string) => !percussion.has(n) && (staffSpec(n).moved || spec.semitones !== 0 || spec.flip || !!spec.interval || !!viewShift(n));
  // A generated MEI (ABC, MIDI) draws a note's continuations and split pieces as notes of their own (`_cN`, `_sN`):
  // they move with the note.
  const octaveOf = (n: string, id: string) => {
    const octaves = percussion.has(n) ? undefined : staffSpec(n).octaves;
    if (!octaves) return 0;
    const base = octaves[id] === undefined ? generatedPitchIdOf(id) : null;
    return (octaves[id] ?? (base ? octaves[base] : undefined) ?? 0) / 12;
  };
  const octaveMoves = (n: string) => !percussion.has(n) && Object.keys(staffSpec(n).octaves ?? {}).length > 0;
  /** Clefs of switched staves: the opening clef replaced, clef changes in the staff (layers, later definitions) removed. */
  const clefOf = (n: string) => { const clef = percussion.has(n) ? undefined : staffSpec(n).clef; return clef && CLEFS[clef] ? clef : undefined; };
  const clefEdits: Edit[] = [];
  const staves: string[] = [];

  const stack: string[] = [];
  let scoreDef: ScoreDefRecord | undefined; let staffDef: StaffDefRecord | undefined; let keySig: Range | undefined; let keySigDepth = 0;
  let measure = -1; let staff = ''; let layer = '';
  let time = 0; const tuplets: number[] = []; let chordOnset = -1; let chordDepth = 0; let chordDuration = 0;
  let note: NoteRecord | undefined; let harm: HarmRecord | undefined;
  const scale = () => tuplets.reduce((value, ratio) => value * ratio, 1);
  const keyFrom = (attributes: string, sigName: string, modeName: string): Key | null => {
    const fifths = fifthsOf(attributeOf(attributes, sigName)) ?? (sigName === 'key.sig' ? fifthsOf(attributeOf(attributes, 'keysig')) : null);
    return fifths === null ? null : { fifths, mode: modeOf(attributeOf(attributes, modeName)) ?? 'major' };
  };
  scan(mei, ({ closing, name, attributes, selfClosing, index, length }) => {
    const tag = mei.slice(index, index + length);
    if (closing) {
      stack.pop();
      if (keySig) { if (--keySigDepth === 0) { keySig.end = index + length; keySig = undefined; } return; }
      if (name === 'staffDef' && staffDef) { staffDef.end = index + length; staffDef = undefined; }
      else if (name === 'scoreDef' && scoreDef) { scoreDef.end = index + length; scoreDef = undefined; }
      else if (name === 'note' && note) { note.end = index + length; note = undefined; }
      else if (name === 'chord') { chordDepth--; time += chordDuration * scale(); }
      else if (name === 'tuplet') tuplets.pop();
      else if (name === 'harm' && harm) { harm.textEnd = index; harm = undefined; }
      else if (name === 'layer') layer = '';
      else if (name === 'staff') staff = '';
      return;
    }
    if (!selfClosing) stack.push(name);
    if (keySig) { if (!selfClosing) keySigDepth++; return; }
    if (harm) harm.nested = true;
    if (name === 'scoreDef') {
      const record: ScoreDefRecord = { start: index, end: index + length, initial: !scoreDefs.length, measure: measure + 1, content: false, keyRanges: [], tagEdits: [], keys: new Map() };
      const key = keyFrom(attributes, 'key.sig', 'key.mode');
      if (key) record.keys.set('*', key);
      const stripped = withoutKeyAttributes(tag);
      if (stripped !== tag) record.tagEdits.push({ start: index, end: index + length, text: selfClosing ? stripped : stripped });
      if (/\s(?!xml:id)[\w.:-]+\s*=/.test(stripped.replace(/^<[\w:]+/, '').replace(/\sxml:id\s*=\s*"[^"]*"/, ''))) record.content = true;
      scoreDefs.push(record);
      if (!selfClosing) scoreDef = record;
      return;
    }
    if (scoreDef && name === 'staffGrp') { if (scoreDef.initial) return; if (!KEY_ONLY_STAFF_DEF.test(attributes)) scoreDef.content = true; return; }
    if (name === 'staffDef') {
      const n = attributeOf(attributes, 'n') || '';
      const record: StaffDefRecord = { start: index, end: index + length, n, tag, selfClosing };
      if (attributeOf(attributes, 'clef.shape') === 'perc') percussion.add(n);
      if (scoreDef) {
        const key = keyFrom(attributes, 'key.sig', 'key.mode');
        if (key) scoreDef.keys.set(n, key);
        // A switched staff: its opening clef is the target's, a later definition's clef is dropped.
        const stripped = clefOf(n) ? withClefAttributes(withoutKeyAttributes(tag), scoreDef.initial ? clefOf(n) : undefined) : withoutKeyAttributes(tag);
        if (stripped !== tag) scoreDef.tagEdits.push({ start: index, end: index + length, text: stripped });
        if (!KEY_ONLY_STAFF_DEF.test(attributes)) scoreDef.content = true;
        if (scoreDef.initial) { initialStaffDefs.push(record); if (n && !staves.includes(n)) staves.push(n); }
      }
      if (!selfClosing) staffDef = record;
      return;
    }
    if (name === 'clef' && staffDef) {
      if (attributeOf(attributes, 'shape') === 'perc') percussion.add(staffDef.n);
      if (selfClosing) { staffDef.clefEnd = index + length; staffDef.clef = { start: index, end: index + length, id: attributeOf(attributes, 'xml:id') }; }
      if (scoreDef) scoreDef.content = true;
      // A later definition's clef in a switched staff goes (the opening one is replaced below).
      if (selfClosing && scoreDef && !scoreDef.initial && clefOf(staffDef.n)) clefEdits.push({ start: index, end: index + length, text: '' });
      return;
    }
    if (name === 'keySig') {
      const range: Range = { start: index, end: index + length };
      if (!selfClosing) { keySig = range; keySigDepth = 1; }
      const key = keyFrom(attributes, 'sig', 'mode');
      if (scoreDef) {
        scoreDef.keyRanges.push(range);
        if (key) scoreDef.keys.set(staffDef ? staffDef.n : '*', key);
      } else if (staff) layerKeySigs.push(Object.assign(range, { staff, measure, key }));
      return;
    }
    if (scoreDef) { scoreDef.content = true; return; }
    if (name === 'measure') { measure++; measureStarts.push(index); return; }
    if (name === 'staff') { staff = attributeOf(attributes, 'n') || ''; return; }
    if (name === 'layer') { layer = attributeOf(attributes, 'n') || '1'; time = 0; tuplets.length = 0; chordDepth = 0; return; }
    if (!staff || !layer) {
      if (name === 'harm' && !selfClosing) {
        harm = { textStart: index + length, textEnd: index + length, staff: (attributeOf(attributes, 'staff') || '').split(/\s+/)[0], measure, nested: false };
        harms.push(harm);
      }
      return;
    }
    if (name === 'clef') { if (clefOf(staff) && selfClosing) clefEdits.push({ start: index, end: index + length, text: '' }); return; }
    if (name === 'tuplet') {
      const num = Number(attributeOf(attributes, 'num')) || 1; const numbase = Number(attributeOf(attributes, 'numbase')) || 1;
      if (!selfClosing) tuplets.push(numbase / num);
      return;
    }
    if (name === 'chord') {
      chordOnset = time; chordDuration = quarters(attributes);
      if (!selfClosing) chordDepth++; else time += chordDuration * scale();
      return;
    }
    if (name === 'note') {
      const inChord = chordDepth > 0;
      const onset = inChord ? chordOnset : time;
      if (!inChord) time += quarters(attributes) * scale();
      const pname = (attributeOf(attributes, 'pname') || '').toUpperCase();
      const oct = Number(attributeOf(attributes, 'oct'));
      if (!pname || !LETTERS.includes(pname) || !Number.isFinite(oct) || !(respelled(staff) || octaveMoves(staff))) return;
      const id = attributeOf(attributes, 'xml:id') || '';
      const tie = attributeOf(attributes, 'tie');
      const written = attributeOf(attributes, 'accid'); const gestural = attributeOf(attributes, 'accid.ges');
      note = { start: index, end: index + length, tag, selfClosing, id, staff, layer, measure, onset, chord: inChord, pname, oct,
        written: written !== null ? ALTER_OF[written] ?? null : null, gestural: gestural !== null ? ALTER_OF[gestural] ?? null : null, accids: [],
        tieEnd: tiedFrom.has(id) || tie === 't' || tie === 'm', cautionary: false };
      notes.push(note);
      if (selfClosing) note = undefined;
      return;
    }
    if (name === 'accid' && note) {
      const value = attributeOf(attributes, 'accid'); const gesturalValue = attributeOf(attributes, 'accid.ges');
      if (value !== null && ALTER_OF[value] !== undefined) note.written = ALTER_OF[value];
      if (gesturalValue !== null && ALTER_OF[gesturalValue] !== undefined) note.gestural = ALTER_OF[gesturalValue];
      if (attributeOf(attributes, 'func') !== null || attributeOf(attributes, 'enclose') !== null) note.cautionary = value !== null;
      note.accids.push({ start: index, end: index + length, attributes });
      return;
    }
    if (['rest', 'space', 'mRest', 'mSpace', 'multiRest'].includes(name) && chordDepth === 0) time += (name.startsWith('m') ? 1000 : quarters(attributes)) * scale();
  });
  for (const n of percussion) if (!staves.includes(n)) staves.push(n);
  const measureCount = measureStarts.length;

  // Each staff's key timeline (local measure index -> key before the global transposition): the spec's Score keys,
  // else the MEI's (Verovio transposed those by the interval, so the interval's fifths are taken back off).
  const timeline = new Map<string, (Key | undefined)[]>();
  for (const n of staves) {
    if (percussion.has(n)) continue;
    const keys: (Key | undefined)[] = new Array(Math.max(1, measureCount)).fill(undefined);
    const fromSpec = staffSpec(n).keys;
    if (fromSpec?.length) {
      for (let local = 0; local < keys.length; local++) {
        const entry = [...fromSpec].reverse().find(([at]) => at <= local + measureOffset) ?? fromSpec[0];
        keys[local] = { fifths: entry[1], mode: entry[2] };
      }
    } else {
      let current: Key = { fifths: 0, mode: 'major' };
      const changes = new Map<number, Key>();
      for (const record of scoreDefs) {
        const key = record.keys.get(n) ?? record.keys.get('*');
        if (key) changes.set(Math.min(record.measure, keys.length - 1), { fifths: key.fifths - shift, mode: key.mode });
      }
      for (const sig of layerKeySigs) if (sig.staff === n && sig.key) changes.set(Math.min(sig.measure + 1, keys.length - 1), { fifths: sig.key.fifths - shift, mode: sig.key.mode });
      for (let local = 0; local < keys.length; local++) { current = changes.get(local) ?? current; keys[local] = current; }
    }
    timeline.set(n, keys);
  }
  const shownCache = new Map<string, SpellingKey>();
  const shownKey = (n: string, local: number): SpellingKey => {
    const key = timeline.get(n)?.[Math.max(0, Math.min(local, measureCount - 1))] ?? { fifths: 0, mode: 'major' as KeyMode };
    const cacheKey = `${n}|${key.fifths}|${key.mode}`;
    let shown = shownCache.get(cacheKey);
    if (!shown) { shown = viewKey(key.fifths, spec.semitones, key.mode, staffSpec(n), spec.flip); shownCache.set(cacheKey, shown); }
    return shown;
  };
  // The MEI's key: the view key moved by the interval, less the staff's own sounding shift (its notes are written).
  const sourceFifths = (n: string, local: number) => {
    const own = viewShift(n);
    return (timeline.get(n)?.[Math.max(0, Math.min(local, measureCount - 1))]?.fifths ?? 0) + shift - (own ? intervalFifths(own) : 0);
  };

  // Source alterations (written > gestural > earlier accidental in the measure > key signature), per staff-measure.
  const groups = new Map<string, NoteRecord[]>();
  for (const item of notes) { const key = `${item.staff}|${item.measure}`; (groups.get(key) ?? groups.set(key, []).get(key)!).push(item); }
  const sourceAlter = new Map<NoteRecord, number>();
  for (const group of groups.values()) {
    const state = new Map<string, number>();
    for (const item of [...group].sort((a, b) => a.onset - b.onset)) {
      const line = `${item.pname}${item.oct}`;
      sourceAlter.set(item, item.written ?? item.gestural ?? state.get(line) ?? fifthsAlter(item.pname, sourceFifths(item.staff, item.measure)));
      if (item.written !== null) state.set(line, item.written);
    }
  }

  // Respell each voice (staff + layer) as a line across measures.
  const lines = new Map<string, NoteRecord[]>();
  for (const item of notes) { const key = `${item.staff}|${item.layer}`; (lines.get(key) ?? lines.set(key, []).get(key)!).push(item); }
  const spelled = new Map<NoteRecord, SpelledPitch>();
  const midiOf = (pitch: SpelledPitch) => (pitch.octave + 1) * 12 + NATURAL_PC[LETTERS.indexOf(pitch.step)] + pitch.alter;
  for (const line of lines.values()) {
    const indexById = new Map(line.map((item, index) => [item.id, index]));
    const input: LineNote[] = line.map(item => {
      const own = viewShift(item.staff);
      const read = { step: item.pname, octave: item.oct, alter: sourceAlter.get(item) ?? 0 };
      const shifted = own ? transposeSpelled(read, own) : read;
      // An octave move after the staff's shift: same spelling, an octave higher or lower.
      const source = { ...shifted, octave: shifted.octave + octaveOf(item.staff, item.id) };
      const from = tiedFrom.get(item.id);
      return { midi: midiOf(source), source, key: shownKey(item.staff, item.measure), chord: item.chord, tiedFrom: from !== undefined ? indexById.get(from) : undefined };
    });
    // A staff that is not respelled (octave moves only) keeps its spellings.
    if (!respelled(line[0].staff)) { input.forEach((note, index) => spelled.set(line[index], note.source)); continue; }
    respellLine(input).forEach((pitch, index) => spelled.set(line[index], pitch));
  }
  // A tie from another voice keeps the start's spelling too.
  const byId = new Map(notes.map(item => [item.id, item]));
  for (const item of notes) {
    const from = byId.get(tiedFrom.get(item.id) || '');
    if (from && spelled.has(from) && midiOf(spelled.get(from)!) === midiOf(spelled.get(item)!)) spelled.set(item, spelled.get(from)!);
  }
  // Courtesy accidentals of switched and octave-moved staves: a written accidental the source did not need (in its
  // own key and measure) stays shown after the move, as one marked cautionary does.
  const courtesy = new Set<NoteRecord>();
  const sourceKey = (n: string, local: number) => ({ ...keyFromFifths(0), scale: LETTERS.split('').map(step => ({ step, alter: fifthsAlter(step, sourceFifths(n, local)) })) });
  for (const group of groups.values()) {
    const n = group[0].staff;
    if (!clefOf(n) && !octaveMoves(n)) continue;
    const needed = accidentalDisplay(group.map(item => ({ pitch: { step: item.pname as SpelledPitch['step'], octave: item.oct, alter: sourceAlter.get(item) ?? 0 }, onset: item.onset, key: sourceKey(item.staff, item.measure), tieEnd: item.tieEnd })));
    group.forEach((item, index) => { if (item.written !== null && !item.tieEnd && !needed[index]) courtesy.add(item); });
  }
  // Accidental display per staff-measure.
  const shown = new Map<NoteRecord, boolean>();
  for (const group of groups.values()) {
    const flags = accidentalDisplay(group.map(item => ({ pitch: spelled.get(item)!, onset: item.onset, key: shownKey(item.staff, item.measure), tieEnd: item.tieEnd, cautionary: item.cautionary || courtesy.has(item) })));
    group.forEach((item, index) => shown.set(item, flags[index]));
  }

  const edits: Edit[] = [];
  for (const item of notes) {
    const pitch = spelled.get(item)!;
    const written = shown.get(item)!;
    let tag = removeAttribute(removeAttribute(item.tag, 'accid'), 'accid.ges');
    tag = setAttribute(setAttribute(tag, 'pname', pitch.step.toLowerCase()), 'oct', String(pitch.octave));
    // A sounding octave (under an octave line) moves with the written one.
    const gesturalOctave = Number(attributeOf(item.tag, 'oct.ges') ?? NaN);
    if (Number.isFinite(gesturalOctave) && pitch.octave !== item.oct) tag = setAttribute(tag, 'oct.ges', String(gesturalOctave + pitch.octave - item.oct));
    // Gestural accidentals are always explicit, naturals included, so the pitch never depends on the key signature.
    if (!written) tag = setAttribute(tag, 'accid.ges', GESTURAL(pitch.alter));
    const old = item.accids.find(accid => attributeOf(accid.attributes, 'accid') !== null) ?? item.accids[0];
    const id = old ? attributeOf(old.attributes, 'xml:id') : null;
    const keep = old && written ? ['func', 'enclose', 'place'].map(name => [name, attributeOf(old.attributes, name)]).filter(([, value]) => value !== null).map(([name, value]) => ` ${name}="${value}"`).join('') : '';
    const child = written ? `<accid${id ? ` xml:id="${id}"` : ''} accid="${WRITTEN(pitch.alter)}"${keep}/>` : '';
    if (item.selfClosing) edits.push({ start: item.start, end: item.end, text: child ? `${openTag(tag)}${child}</note>` : tag });
    else {
      edits.push({ start: item.start, end: item.start + item.tag.length, text: tag + child });
      for (const accid of item.accids) edits.push({ start: accid.start, end: accid.end, text: '' });
    }
  }
  for (const record of harms) {
    if (!respelled(record.staff) || record.nested || record.textEnd <= record.textStart) continue;
    const text = mei.slice(record.textStart, record.textEnd);
    const [, lead, body, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
    const own = viewShift(record.staff);
    const next = spellChordSymbol(own ? moveChordSymbol(body, [own]) : body, shownKey(record.staff, Math.max(0, record.measure)));
    if (next !== body) edits.push({ start: record.textStart, end: record.textEnd, text: lead + next + trail });
  }
  // Keys: every encoded key signature is removed (a definition holding nothing else goes entirely) and each pitched
  // staff's keys are written where they start or change. Percussion staves get none.
  for (const sig of layerKeySigs) edits.push({ start: sig.start, end: sig.end, text: '' });
  for (const record of scoreDefs) {
    if (!record.initial && !record.content) { edits.push({ start: record.start, end: record.end, text: '' }); continue; }
    edits.push(...record.tagEdits);
    for (const range of record.keyRanges) edits.push({ start: range.start, end: range.end, text: '' });
  }
  const pitched = staves.filter(n => !percussion.has(n));
  edits.push(...clefEdits);
  for (const def of initialStaffDefs) {
    if (percussion.has(def.n) || !pitched.includes(def.n)) continue;
    const sig = keySigTag(shownKey(def.n, 0));
    const clef = clefOf(def.n);
    const tag = clef ? withClefAttributes(withoutKeyAttributes(def.tag), clef) : withoutKeyAttributes(def.tag);
    // A switched staff's opening clef: its <clef> replaced, else (no clef attributes either) one added.
    const clefChild = clef && !def.clef && !/\sclef\.shape\s*=/.test(def.tag) ? clefElement(clef, null) : '';
    if (clef && def.clef) edits.push({ start: def.clef.start, end: def.clef.end, text: clefElement(clef, def.clef.id) });
    if (def.selfClosing) {
      // Replaces the tag edit recorded for this staffDef, if any.
      const at = edits.findIndex(edit => edit.start === def.start && edit.end === def.end);
      if (at >= 0) edits.splice(at, 1);
      edits.push({ start: def.start, end: def.end, text: `${openTag(tag)}${clefChild}${sig}</staffDef>` });
    } else {
      const at = def.clefEnd ?? def.start + def.tag.length;
      edits.push({ start: at, end: at, text: clefChild + sig });
    }
  }
  for (let local = 1; local < measureCount; local++) {
    const changed = pitched.filter(n => {
      const before = shownKey(n, local - 1); const after = shownKey(n, local);
      return before.fifths !== after.fifths || before.mode !== after.mode;
    });
    if (!changed.length) continue;
    const at = measureStarts[local];
    edits.push({ start: at, end: at, text: `<scoreDef><staffGrp>${changed.map(n => `<staffDef n="${n}">${keySigTag(shownKey(n, local))}</staffDef>`).join('')}</staffGrp></scoreDef>` });
  }
  if (!edits.length) return mei;
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  const out: string[] = [];
  let last = 0;
  for (const edit of edits) {
    if (edit.start < last) continue; // nested inside a removed range (a dropped scoreDef)
    out.push(mei.slice(last, edit.start), edit.text);
    last = edit.end;
  }
  out.push(mei.slice(last));
  return out.join('');
}
