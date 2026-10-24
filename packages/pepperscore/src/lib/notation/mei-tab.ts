/**
 * Guitar TAB staves for the engraving view (docs/specs/guitar-tab.md, "Generation"). String-level like mei-view.ts:
 * the Verovio worker has no DOMParser and the input is Verovio's own `getMEI` output, already spelled and transposed,
 * so frets follow the pitches the reader shows.
 *
 * For every notation staff `n` in `TabSpec.generate`, a `tab.guitar` staff `100 + n` is added right after it (its
 * staffDef after the notation staffDef, its staff after the notation staff in every measure). Each layer is cloned:
 * a note or chord becomes a `tabGrp` (same duration) with a `tabDurSym` and one `note tab.course tab.fret` per pitch;
 * beams, tuplets and rests are kept; grace notes, lyrics, clefs and everything else are dropped. IDs get a `-tab`
 * suffix (`${note}-tabn` for the TAB note of a single note, whose `tabGrp` takes `${note}-tab`), so the reader finds
 * the TAB event of a Score note by its source ID. Tie continuations keep their rhythm (the `tabGrp` and its stem) and
 * show no fret: their TAB note, on the string of the note they continue, is invisible. Measure and beat repeats are
 * copied, so the repeat sign shows on the TAB staff too.
 *
 * Frets come from the fingering solver (tab/fret-assign.ts), run over each staff's whole document in time order (all
 * layers) so it sees the passage, not one measure. `tab.course`/`tab.fret` already on notation notes (MusicXML
 * `<technical>` string/fret) are fixed constraints. `retarget` moves staff-bound text (chord symbols, tempo,
 * directions, fermatas) of a notation staff that the view hides onto its TAB staff; an event attached to a note
 * (`startid`) is attached to that note's TAB event.
 *
 * `refret` re-fingers imported TAB staves that double no notation staff (a TAB-only score) when the view transposes:
 * their notes' sounding pitches (the staff's `<tuning>` plus fret) move by the given semitones and are solved again.
 */
import { assignNoteFrets, STANDARD_TUNING, type FretFixed, type FretNote, type FretPos, type FretResult } from '../tab/fret-assign';
import { attributeOf, scan } from './mei-view';

export type TabSpec = {
  /** Notation staff numbers (`@n`) that get a generated TAB staff `100 + n`. */
  generate: string[];
  /** Staff-bound control events of a hidden notation staff move to this TAB staff (`n` → TAB `n`). */
  retarget: Record<string, string>;
  /** Open-string MIDI pitches, low to high. */
  tuning: number[];
  /** Capo fret; frets are relative to it. */
  capo: number;
  /** Use `tab.course`/`tab.fret` already on notation notes as fixed fingerings (false when the view moved pitches). */
  fixed: boolean;
  /** Generated staves whose `tab.course`/`tab.fret` do not apply even when `fixed` (an instrument view moved their notes). */
  unfixed?: string[];
  /**
   * Generated staves whose notes are already at sounding pitch (the concert view of a transposing part): their
   * `trans.semi` was applied by spelling and must not be applied again.
   */
  sounding?: string[];
  /** Imported TAB staves (no notation partner) to re-finger, by staff `@n`: the semitones their pitches move. */
  refret?: Record<string, number>;
};

/** Fingerings by notation note `xml:id`, kept across chunk documents so a note keeps its fret wherever it is drawn. */
export type FretMemory = Map<string, FretPos>;

const STEP_PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const ALTER: Record<string, number> = { s: 1, f: -1, n: 0, x: 2, ss: 2, ff: -2, ts: 3, tf: -3, xs: 3, sx: 3, nf: -1, ns: 1, su: 1, sd: 1, fu: -1, fd: -1, nu: 0, nd: 0 };
const DUR_QUARTERS: Record<string, number> = { maxima: 32, long: 16, breve: 8, '1': 4, '2': 2, '4': 1, '8': .5, '16': .25, '32': .125, '64': .0625, '128': .03125, '256': .015625 };
/** Elements of a layer whose subtree is replaced: notes and chords become tabGrps, rests are copied bare. */
const RESTS = new Set(['rest', 'space', 'mRest', 'mSpace', 'multiRest']);
/** Containers kept around the TAB events. */
const KEPT_CONTAINERS = new Set(['beam', 'tuplet']);
/** Containers whose wrapper is dropped but whose events are kept. */
const UNWRAPPED = new Set(['bTrem', 'fTrem', 'ligature', 'choice', 'orig', 'reg', 'sic', 'corr', 'supplied', 'add', 'subst']);
/** Control events that move to the TAB staff when their notation staff is hidden. */
const RETARGETED = new Set(['harm', 'tempo', 'dir', 'repeatMark', 'fermata']);
/** Measure and beat repeats: copied onto the TAB staff (a whole-measure one fills its measure like a measure rest). */
const MEASURE_REPEATS = new Set(['mRpt', 'mRpt2', 'multiRpt']);
const REPEATS = new Set([...MEASURE_REPEATS, 'beatRpt', 'halfmRpt']);

const PITCH_NAMES: [string, string?][] = [['c'], ['c', 's'], ['d'], ['e', 'f'], ['e'], ['f'], ['f', 's'], ['g'], ['a', 'f'], ['a'], ['b', 'f'], ['b']];
const escapeId = (id: string) => id.replace(/[&<>"]/g, '');
const idAttr = (id: string, suffix: string) => id ? ` xml:id="${escapeId(id)}${suffix}"` : '';

type NoteRec = { id: string; midi: number | null; fixed?: FretFixed; continuation: boolean; tieStart: boolean; dur: number;
  /** A tie continuation's fingering: the string and fret of the note it continues (drawn invisibly). */
  held?: FretResult };
type EventRec = { onset: number; dur: number; notes: NoteRec[] };
/** `courses`: an imported TAB staff's open-string pitches by course number (course 1 is the highest). */
type StaffInfo = { ppq?: number; semi: number; courses?: Map<number, number> };

function durationOf(attributes: string, ppq: number | undefined, tuplets: number[]): number {
  const ppqValue = Number(attributeOf(attributes, 'dur.ppq'));
  if (ppq && Number.isFinite(ppqValue) && attributeOf(attributes, 'dur.ppq') !== null) return ppqValue / ppq;
  const base = DUR_QUARTERS[attributeOf(attributes, 'dur') || ''];
  if (base === undefined) return 0;
  const dots = Number(attributeOf(attributes, 'dots')) || 0;
  return base * (2 - 1 / 2 ** dots) * tuplets.reduce((product, ratio) => product * ratio, 1);
}

const midiOf = (attributes: string, childAccid: { written?: string; gestural?: string }, semi: number): number | null => {
  const pname = (attributeOf(attributes, 'pname') || '').toLowerCase();
  const oct = Number(attributeOf(attributes, 'oct'));
  if (!(pname in STEP_PC) || !Number.isFinite(oct) || attributeOf(attributes, 'oct') === null) return null;
  const accid = attributeOf(attributes, 'accid.ges') ?? childAccid.gestural ?? attributeOf(attributes, 'accid') ?? childAccid.written ?? '';
  return 12 * (oct + 1) + STEP_PC[pname] + (ALTER[accid] ?? 0) + semi;
};

/** A capo as a whole fret 0-24, and a tuning of 1 to 31 strings (the solver's limit); others give standard tuning. */
const capoOf = (capo: unknown) => typeof capo === 'number' && Number.isFinite(capo) ? Math.max(0, Math.min(24, Math.round(capo))) : 0;
const tuningOf = (tuning: unknown) => Array.isArray(tuning) && tuning.length >= 1 && tuning.length <= 31 && tuning.every(pitch => Number.isInteger(pitch) && pitch >= 0 && pitch <= 127) ? tuning as number[] : STANDARD_TUNING;
/** A course's open-string tuning, low to high, from a staff's `<course>`s (course 1 is the highest). */
const tuningFromCourses = (courses: Map<number, number>) => {
  if (!courses.size) return null;
  const count = Math.max(...courses.keys());
  const tuning = Array.from({ length: count }, (_, index) => courses.get(count - index));
  return tuning.every((pitch): pitch is number => pitch !== undefined) ? tuning : null;
};

/** Course pitches for a tuning (course 1 = the highest string), as MEI `<course>`s. */
function tuningXml(tuning: number[], capo: number): string {
  return `<tuning>${[...tuning].reverse().map((midi, index) => {
    const pitch = midi + capo;
    const [pname, accid] = PITCH_NAMES[((pitch % 12) + 12) % 12];
    return `<course n="${index + 1}" pname="${pname}" oct="${Math.floor(pitch / 12) - 1}"${accid ? ` accid="${accid}"` : ''}/>`;
  }).join('')}</tuning>`;
}

/**
 * Pass 1: each collected staff's events in document order, onsets in quarter notes from the document start (measure
 * lengths from their layers, an empty or measure-rest measure from the meter). Notation staves (`generate`) read
 * pitches from `pname`/`oct` (plus `trans.semi` unless already sounding); imported TAB staves (`refret`) from their
 * tuning and frets, moved by the view's semitones. `ids` are the notes and chords a TAB clone exists for.
 */
function collect(mei: string, spec: TabSpec): { staves: Map<string, EventRec[]>; tieStarts: Set<string>; tieEnds: Set<string>; info: Map<string, StaffInfo>; ids: Set<string> } {
  const generate = new Set(spec.generate), refret = spec.refret ?? {}, sounding = new Set(spec.sounding ?? []);
  const collected = new Set([...generate, ...Object.keys(refret)]);
  const staves = new Map<string, EventRec[]>([...collected].map(n => [n, []]));
  const info = new Map<string, StaffInfo>();
  const tieStarts = new Set<string>();
  const tieEnds = new Set<string>();
  const ids = new Set<string>();
  let meter = 4;
  let meterCount = 4, meterUnit = 4;
  const setMeter = (attributes: string, prefix: string) => {
    const count = Number(attributeOf(attributes, `${prefix}count`)), unit = Number(attributeOf(attributes, `${prefix}unit`));
    if (count > 0) meterCount = count;
    if (unit > 0) meterUnit = unit;
    meter = meterCount * 4 / meterUnit;
  };
  let measureStart = 0, measureLength = 0, measureRest = false, inMeasure = false;
  let staff: string | null = null; let staffDepth = 0;
  /** The imported TAB staffDef whose `<course>`s are being read. */
  let reading: { entry: StaffInfo; courses: Map<number, number> } | null = null;
  let cursor = 0;
  const tuplets: number[] = [];
  let chord: EventRec | null = null; let chordGrace = false;
  let note: { rec: NoteRec; attributes: string; written?: string; gestural?: string; event: EventRec; inChord: boolean } | null = null;
  let graceDepth = 0;
  const finishNote = () => {
    if (!note) return;
    const staffInfo = info.get(staff!);
    if (staff! in refret) {
      const course = Number(attributeOf(note.attributes, 'tab.course')), fret = Number(attributeOf(note.attributes, 'tab.fret'));
      const open = staffInfo?.courses?.get(course);
      note.rec.midi = open !== undefined && Number.isInteger(fret) && fret >= 0 && attributeOf(note.attributes, 'tab.fret') !== null ? open + fret + refret[staff!] : null;
    } else note.rec.midi = midiOf(note.attributes, note, staffInfo?.semi ?? 0);
    note = null;
  };
  scan(mei, ({ closing, name, attributes, selfClosing }) => {
    if (closing) {
      if (name === 'staffDef') { if (reading?.courses.size) reading.entry.courses = reading.courses; reading = null; return; }
      if (name === 'measure') {
        inMeasure = false;
        measureStart += measureLength > 0 && !measureRest ? measureLength : Math.max(measureLength, meter);
        return;
      }
      if (!staff) return;
      if (graceDepth) { graceDepth--; return; }
      if (name === 'note') finishNote();
      else if (name === 'chord' || name === 'tabGrp') { if (chord && !chordGrace) cursor += chord.dur; chord = null; }
      else if (name === 'tuplet') tuplets.pop();
      else if (name === 'layer') measureLength = Math.max(measureLength, cursor);
      else if (name === 'staff' && --staffDepth === 0) staff = null;
      return;
    }
    if (name === 'scoreDef') { setMeter(attributes, 'meter.'); return; }
    if (name === 'meterSig') { setMeter(attributes, ''); return; }
    if (name === 'staffDef') {
      setMeter(attributes, 'meter.');
      const n = attributeOf(attributes, 'n') || '';
      if (collected.has(n)) {
        const previous = info.get(n);
        const ppq = Number(attributeOf(attributes, 'ppq'));
        const semi = attributeOf(attributes, 'trans.semi');
        // A staff spelled at sounding pitch (concert view) already applied its transposition.
        const entry: StaffInfo = { ppq: ppq > 0 ? ppq : previous?.ppq, semi: sounding.has(n) ? 0 : semi !== null ? Number(semi) || 0 : previous?.semi ?? 0, courses: previous?.courses };
        info.set(n, entry);
        if (n in refret && !selfClosing) reading = { entry, courses: new Map() };
      }
      return;
    }
    if (name === 'course' && reading) {
      const course = Number(attributeOf(attributes, 'n'));
      const midi = midiOf(attributes, {}, 0);
      if (course >= 1 && midi !== null) reading.courses.set(course, midi);
      return;
    }
    if (name === 'measure') { inMeasure = true; measureLength = 0; measureRest = false; return; }
    if (name === 'tie' && inMeasure) {
      const start = (attributeOf(attributes, 'startid') || '').replace(/^#/, ''), end = (attributeOf(attributes, 'endid') || '').replace(/^#/, '');
      if (start && end) { tieStarts.add(start); tieEnds.add(end); }
      return;
    }
    if (name === 'staff' && !staff) {
      const n = attributeOf(attributes, 'n') || '';
      if (collected.has(n) && !selfClosing) { staff = n; staffDepth = 1; }
      return;
    }
    if (!staff) return;
    if (graceDepth) { if (!selfClosing) graceDepth++; return; }
    if (!selfClosing && name === 'staff') { staffDepth++; return; }
    const events = staves.get(staff)!;
    const ppq = info.get(staff)?.ppq;
    if (name === 'layer') { cursor = 0; return; }
    if (name === 'graceGrp') { if (!selfClosing) graceDepth = 1; return; }
    if (name === 'tuplet') {
      const num = Number(attributeOf(attributes, 'num')) || 1, numbase = Number(attributeOf(attributes, 'numbase')) || 1;
      if (!selfClosing) tuplets.push(numbase / num);
      return;
    }
    if (name === 'chord' || name === 'tabGrp') {
      chordGrace = attributeOf(attributes, 'grace') !== null;
      if (chordGrace) { if (!selfClosing) graceDepth = 1; return; }
      chord = { onset: measureStart + cursor, dur: durationOf(attributes, ppq, tuplets), notes: [] };
      events.push(chord);
      const id = attributeOf(attributes, 'xml:id');
      if (id && generate.has(staff)) ids.add(id);
      if (selfClosing) { cursor += chord.dur; chord = null; }
      return;
    }
    if (name === 'note') {
      if (!chord && attributeOf(attributes, 'grace') !== null) { if (!selfClosing) graceDepth = 1; return; }
      let event = chord;
      if (!event) {
        event = { onset: measureStart + cursor, dur: durationOf(attributes, ppq, tuplets), notes: [] };
        events.push(event);
        cursor += event.dur;
      }
      const id = attributeOf(attributes, 'xml:id') || '';
      if (id && generate.has(staff)) ids.add(id);
      const tie = attributeOf(attributes, 'tie') || '';
      const course = Number(attributeOf(attributes, 'tab.course')), fret = Number(attributeOf(attributes, 'tab.fret'));
      // `tab.course` alone (a string number without a fret) fixes the string; the solver picks the fret.
      const hasFret = Number.isInteger(fret) && attributeOf(attributes, 'tab.fret') !== null;
      const fixed = spec.fixed && generate.has(staff) && !spec.unfixed?.includes(staff) && Number.isInteger(course) && course >= 1 ? (hasFret ? { string: course, fret } : { string: course }) : undefined;
      const rec: NoteRec = { id, midi: null, fixed, continuation: /[mt]/.test(tie), tieStart: /[im]/.test(tie), dur: event.dur };
      event.notes.push(rec);
      note = { rec, attributes, event, inChord: !!chord };
      if (selfClosing) finishNote();
      return;
    }
    if (name === 'accid' && note) {
      const written = attributeOf(attributes, 'accid'), gestural = attributeOf(attributes, 'accid.ges');
      if (written !== null) note.written = written;
      if (gestural !== null) note.gestural = gestural;
      return;
    }
    if (RESTS.has(name) || REPEATS.has(name)) {
      if (name === 'mRest' || name === 'mSpace' || name === 'multiRest' || MEASURE_REPEATS.has(name)) measureRest = true;
      else if (name === 'halfmRpt') cursor += meter / 2;
      else if (name === 'beatRpt') cursor += 4 / meterUnit;
      else cursor += durationOf(attributes, ppq, tuplets);
    }
  });
  return { staves, tieStarts, tieEnds, info, ids };
}

/**
 * Pass 2: solve each staff with the solver's note-level helper (tab/fret-assign.ts assignNoteFrets, shared with
 * scripts/tab-bake.mjs): every layer together in time order, notes starting together in any layer one event, a unison
 * across layers one string, tie continuations extending the note they continue (and not fingered again).
 */
function solve(staves: Map<string, EventRec[]>, tieStarts: Set<string>, tieEnds: Set<string>, info: Map<string, StaffInfo>, spec: TabSpec, memory: FretMemory | undefined): Map<string, FretResult> {
  const frets = new Map<string, FretResult>();
  const tuning = tuningOf(spec.tuning), capo = capoOf(spec.capo);
  for (const [n, events] of staves) {
    const recs: NoteRec[] = [];
    const notes: FretNote[] = [];
    for (const event of events) for (const rec of event.notes) {
      recs.push(rec);
      notes.push({ onset: event.onset, duration: rec.dur, pitch: rec.midi, tieStart: rec.tieStart || tieStarts.has(rec.id), tieStop: rec.continuation || tieEnds.has(rec.id), fixed: memory?.get(rec.id) ?? rec.fixed });
    }
    // An imported TAB staff keeps its own tuning (no capo); generated staves use the view's.
    const own = n in (spec.refret ?? {}) && info.get(n)?.courses ? tuningFromCourses(info.get(n)!.courses!) : null;
    const results = assignNoteFrets(notes, own ? { tuning: own, capo: 0 } : { tuning, capo });
    results.forEach(({ result, continuation }, index) => {
      const rec = recs[index];
      rec.continuation = continuation;
      if (!result) return;
      // A continuation is drawn with the fingering of the note it continues.
      if (continuation) { rec.held = result; return; }
      frets.set(rec.id, result);
      if (memory && rec.id && 'string' in result && !memory.has(rec.id)) memory.set(rec.id, { string: result.string, fret: result.fret });
    });
  }
  return frets;
}

const durAttributes = (attributes: string) => ['dur', 'dots', 'dur.ppq'].map(name => { const value = attributeOf(attributes, name); return value !== null ? ` ${name}="${value}"` : ''; }).join('');
const tabNote = (id: string, result: FretResult | undefined) => result && 'string' in result ? `<note${idAttr(id, '')} tab.course="${result.string}" tab.fret="${result.fret}"/>` : '';
/** A tie continuation's TAB note: on the string it continues, invisible, so its tabGrp keeps its stem. */
const heldNote = (result: FretResult | undefined) => result && 'string' in result ? `<note tab.course="${result.string}" tab.fret="${result.fret}" visible="false"/>` : '';
/** Replace (or add) an attribute on a start tag. */
const withAttribute = (tag: string, name: string, value: string) => {
  const pattern = new RegExp(`(\\s${name.replace('.', '\\.')}\\s*=\\s*)(?:"[^"]*"|'[^']*')`);
  return pattern.test(tag) ? tag.replace(pattern, `$1"${value}"`) : tag.replace(/\s*(\/?)>$/, ` ${name}="${value}"$1>`);
};

/**
 * Add the TAB staves of `spec` to `mei`, re-finger its `refret` staves and retarget hidden staves' control events.
 * `memory` (optional) keeps fingerings by note ID across calls: a remembered note is fixed for the solver and new
 * results are added to it.
 */
export function injectTab(mei: string, spec: TabSpec, memory?: FretMemory): string {
  const generate = new Set(spec.generate);
  const refret = spec.refret ?? {};
  const retarget = spec.retarget;
  const retargeting = Object.keys(retarget).length > 0;
  if (!generate.size && !retargeting && !Object.keys(refret).length) return mei;
  const collected = generate.size || Object.keys(refret).length;
  const { staves, tieStarts, tieEnds, info, ids } = collected ? collect(mei, spec) : { staves: new Map<string, EventRec[]>(), tieStarts: new Set<string>(), tieEnds: new Set<string>(), info: new Map<string, StaffInfo>(), ids: new Set<string>() };
  const frets = collected ? solve(staves, tieStarts, tieEnds, info, spec, memory) : new Map<string, FretResult>();
  /** Tie continuations, with the fingering of the note each continues. */
  const continuations = new Map<string, FretResult | undefined>();
  for (const events of staves.values()) for (const event of events) for (const rec of event.notes) if (rec.continuation) continuations.set(rec.id, rec.held);
  const tuning = tuningOf(spec.tuning), capo = capoOf(spec.capo);
  const tuningElement = tuningXml(tuning, capo);
  /** Generated TAB staff numbers (an event moved onto one is attached to the TAB clone of its note). */
  const generatedTabs = new Set([...generate].map(n => String(100 + Number(n))));

  const out: string[] = [];
  let last = 0;
  // The first score definition gets the TAB staffDefs.
  let scoreDefDepth = -1; let scoreDefDone = false; let depth = 0;
  let staffDef: { n: string; id: string; meterSig: string; depth: number } | null = null;
  // The TAB clone of the generated staff being read.
  let clone: string[] | null = null; let cloneDepth = 0; let skip = 0;
  /** The open chord's TAB group: whether it drew a fret, and the first continuation's fingering otherwise. */
  let chordOpen: { frets: number; held?: FretResult } | null = null;
  /** The depth of the imported TAB staff being re-fingered. */
  let refretDepth = -1;
  const staffDefXml = (n: string, id: string, meterSig: string) => {
    const ppq = info.get(n)?.ppq;
    return `<staffDef${idAttr(id, '-tab')} n="${100 + Number(n)}" lines="${tuning.length}" notationtype="tab.guitar" keysig="0"${ppq ? ` ppq="${ppq}"` : ''}><clef shape="TAB" line="${tuning.length - 1}"/>${tuningElement}${meterSig}</staffDef>`;
  };
  scan(mei, ({ closing, name, attributes, selfClosing, index, length }) => {
    out.push(mei.slice(last, index));
    last = index + length;
    let tag = mei.slice(index, index + length);
    if (closing) depth--;
    else if (!selfClosing) depth++;

    if (!closing && RETARGETED.has(name) && retargeting) {
      const staffAttr = attributeOf(attributes, 'staff');
      if (staffAttr !== null) {
        const moved = staffAttr.split(/\s+/).filter(Boolean).map(token => retarget[token] ?? token).join(' ');
        if (moved !== staffAttr) {
          tag = withAttribute(tag, 'staff', moved);
          // Attached to a note of the hidden staff: attach it to that note's TAB event instead.
          const startid = attributeOf(attributes, 'startid');
          const start = startid?.replace(/^#/, '') ?? '';
          if (start && ids.has(start) && moved.split(' ').every(token => generatedTabs.has(token))) tag = withAttribute(tag, 'startid', `#${start}-tab`);
        }
      }
    }
    // An imported TAB staff re-fingered for the view: its notes take their new string and fret.
    if (refretDepth < 0 && name === 'staff' && !closing && !selfClosing && (attributeOf(attributes, 'n') || '') in refret) refretDepth = depth;
    else if (refretDepth >= 0 && closing && name === 'staff' && depth === refretDepth - 1) refretDepth = -1;
    else if (refretDepth >= 0 && name === 'note' && !closing) {
      const id = attributeOf(attributes, 'xml:id') || '';
      const result = continuations.has(id) ? continuations.get(id) : frets.get(id);
      if (result && 'string' in result) tag = withAttribute(withAttribute(tag, 'tab.course', String(result.string)), 'tab.fret', String(result.fret));
      else if (result) tag = withAttribute(tag, 'visible', 'false');
    }
    out.push(tag);

    // Score definition: a TAB staffDef after each generated notation staffDef of the first scoreDef.
    if (name === 'scoreDef' && !closing && !scoreDefDone && scoreDefDepth < 0) { if (selfClosing) scoreDefDone = true; else scoreDefDepth = depth; return; }
    if (name === 'scoreDef' && closing && scoreDefDepth >= 0 && depth === scoreDefDepth - 1) { scoreDefDepth = -1; scoreDefDone = true; return; }
    if (scoreDefDepth >= 0) {
      if (name === 'staffDef' && !closing) {
        const n = attributeOf(attributes, 'n') || '';
        if (!generate.has(n)) return;
        const id = attributeOf(attributes, 'xml:id') || '';
        if (selfClosing) { out.push(staffDefXml(n, id, '')); return; }
        staffDef = { n, id, meterSig: '', depth };
        return;
      }
      if (staffDef && name === 'meterSig' && !closing) { staffDef.meterSig = tag.replace(/\sxml:id\s*=\s*"[^"]*"/, '').replace(/\s*\/?>$/, '/>'); return; }
      if (staffDef && name === 'staffDef' && closing && depth === staffDef.depth - 1) { out.push(staffDefXml(staffDef.n, staffDef.id, staffDef.meterSig)); staffDef = null; }
      return;
    }

    if (!clone) {
      if (name === 'staff' && !closing && !selfClosing && generate.has(attributeOf(attributes, 'n') || '')) {
        const n = attributeOf(attributes, 'n')!;
        clone = [`<staff${idAttr(attributeOf(attributes, 'xml:id') || '', '-tab')} n="${100 + Number(n)}">`];
        cloneDepth = depth; skip = 0; chordOpen = null;
      }
      return;
    }
    // Inside a generated staff: build its TAB clone.
    if (closing && name === 'staff' && depth === cloneDepth - 1) {
      clone.push('</staff>');
      out.push(clone.join(''));
      clone = null;
      return;
    }
    if (skip) { if (closing) skip--; else if (!selfClosing) skip++; return; }
    const id = attributeOf(attributes, 'xml:id') || '';
    if (closing) {
      if (name === 'layer' || KEPT_CONTAINERS.has(name)) clone.push(`</${name}>`);
      else if (name === 'chord' && chordOpen) {
        // A chord of tie continuations only: one invisible note keeps its stem.
        if (!chordOpen.frets) clone.push(heldNote(chordOpen.held));
        clone.push('</tabGrp>'); chordOpen = null;
      }
      return;
    }
    if (name === 'layer' || KEPT_CONTAINERS.has(name)) {
      const kept = ['n', 'num', 'numbase', 'num.visible', 'bracket.visible', 'num.format', 'bracket.place', 'num.place'].map(key => { const value = attributeOf(attributes, key); return value !== null ? ` ${key}="${value}"` : ''; }).join('');
      clone.push(`<${name}${idAttr(id, '-tab')}${kept}${selfClosing ? '/>' : '>'}`);
      return;
    }
    if (UNWRAPPED.has(name)) return;
    if (name === 'chord') {
      if (attributeOf(attributes, 'grace') !== null) { if (!selfClosing) skip = 1; return; }
      clone.push(`<tabGrp${idAttr(id, '-tab')}${durAttributes(attributes)}><tabDurSym/>`);
      if (selfClosing) clone.push('</tabGrp>'); else chordOpen = { frets: 0 };
      return;
    }
    if (name === 'note') {
      if (!selfClosing) skip = 1;
      if (chordOpen) {
        if (continuations.has(id)) { if (!chordOpen.held) chordOpen.held = continuations.get(id); return; }
        const drawn = tabNote(id ? `${id}-tab` : '', frets.get(id));
        if (drawn) chordOpen.frets++;
        clone.push(drawn);
        return;
      }
      if (attributeOf(attributes, 'grace') !== null) return;
      clone.push(`<tabGrp${idAttr(id, '-tab')}${durAttributes(attributes)}><tabDurSym/>${continuations.has(id) ? heldNote(continuations.get(id)) : tabNote(id ? `${id}-tabn` : '', frets.get(id))}</tabGrp>`);
      return;
    }
    if (RESTS.has(name) || REPEATS.has(name)) {
      if (!selfClosing) skip = 1;
      // Repeats keep their attributes (the number of measures or beats repeated); rests their duration.
      const kept = REPEATS.has(name) ? attributes.replace(/\s+xml:id\s*=\s*(?:"[^"]*"|'[^']*')/, '').trimEnd() : durAttributes(attributes);
      clone.push(`<${name}${idAttr(id, '-tab')}${kept}/>`);
      return;
    }
    if (!selfClosing) skip = 1;
  });
  out.push(mei.slice(last));
  return out.join('');
}
