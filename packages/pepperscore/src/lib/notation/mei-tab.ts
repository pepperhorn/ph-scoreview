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
 * the TAB event of a Score note by its source ID. Tie continuations keep their duration but show no fret.
 *
 * Frets come from the fingering solver (tab/fret-assign.ts), run over each staff's whole document so it sees the
 * passage, not one measure. `tab.course`/`tab.fret` already on notation notes (MusicXML `<technical>` string/fret) are
 * fixed constraints. `retarget` moves staff-bound text (chord symbols, tempo, directions) of a notation staff that the
 * view hides onto its TAB staff.
 */
import { assignFrets, type FretEvent, type FretPos, type FretResult } from '../tab/fret-assign';
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

const PITCH_NAMES: [string, string?][] = [['c'], ['c', 's'], ['d'], ['e', 'f'], ['e'], ['f'], ['f', 's'], ['g'], ['a', 'f'], ['a'], ['b', 'f'], ['b']];
const escapeId = (id: string) => id.replace(/[&<>"]/g, '');
const idAttr = (id: string, suffix: string) => id ? ` xml:id="${escapeId(id)}${suffix}"` : '';

type NoteRec = { id: string; midi: number | null; fixed?: FretPos; continuation: boolean; tieStart: boolean; extend: number; dur: number };
type EventRec = { onset: number; dur: number; notes: NoteRec[] };
type StaffInfo = { ppq?: number; semi: number };

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

/** Course pitches for a tuning (course 1 = the highest string), as MEI `<course>`s. */
function tuningXml(tuning: number[], capo: number): string {
  return `<tuning>${[...tuning].reverse().map((midi, index) => {
    const pitch = midi + capo;
    const [pname, accid] = PITCH_NAMES[((pitch % 12) + 12) % 12];
    return `<course n="${index + 1}" pname="${pname}" oct="${Math.floor(pitch / 12) - 1}"${accid ? ` accid="${accid}"` : ''}/>`;
  }).join('')}</tuning>`;
}

/**
 * Pass 1: each generated staff's events in document order, onsets in quarter notes from the document start (measure
 * lengths from their layers, an empty or measure-rest measure from the meter).
 */
function collect(mei: string, generate: Set<string>, useFixed: boolean): { staves: Map<string, EventRec[]>; tieStarts: Set<string>; tieEnds: Set<string>; info: Map<string, StaffInfo> } {
  const staves = new Map<string, EventRec[]>([...generate].map(n => [n, []]));
  const info = new Map<string, StaffInfo>();
  const tieStarts = new Set<string>();
  const tieEnds = new Set<string>();
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
  let cursor = 0;
  const tuplets: number[] = [];
  let chord: EventRec | null = null; let chordGrace = false;
  let note: { rec: NoteRec; attributes: string; written?: string; gestural?: string; event: EventRec; inChord: boolean } | null = null;
  let graceDepth = 0;
  const finishNote = () => {
    if (!note) return;
    const semi = info.get(staff!)?.semi ?? 0;
    note.rec.midi = midiOf(note.attributes, note, semi);
    note = null;
  };
  scan(mei, ({ closing, name, attributes, selfClosing }) => {
    if (closing) {
      if (name === 'measure') {
        inMeasure = false;
        measureStart += measureLength > 0 && !measureRest ? measureLength : Math.max(measureLength, meter);
        return;
      }
      if (!staff) return;
      if (graceDepth) { graceDepth--; return; }
      if (name === 'note') finishNote();
      else if (name === 'chord') { if (chord && !chordGrace) cursor += chord.dur; chord = null; }
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
      if (generate.has(n)) {
        const previous = info.get(n);
        const ppq = Number(attributeOf(attributes, 'ppq'));
        const semi = attributeOf(attributes, 'trans.semi');
        info.set(n, { ppq: ppq > 0 ? ppq : previous?.ppq, semi: semi !== null ? Number(semi) || 0 : previous?.semi ?? 0 });
      }
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
      if (generate.has(n) && !selfClosing) { staff = n; staffDepth = 1; }
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
    if (name === 'chord') {
      chordGrace = attributeOf(attributes, 'grace') !== null;
      if (chordGrace) { if (!selfClosing) graceDepth = 1; return; }
      chord = { onset: measureStart + cursor, dur: durationOf(attributes, ppq, tuplets), notes: [] };
      events.push(chord);
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
      const tie = attributeOf(attributes, 'tie') || '';
      const course = Number(attributeOf(attributes, 'tab.course')), fret = Number(attributeOf(attributes, 'tab.fret'));
      const fixed = useFixed && course >= 1 && Number.isInteger(fret) && attributeOf(attributes, 'tab.fret') !== null ? { string: course, fret } : undefined;
      const rec: NoteRec = { id, midi: null, fixed, continuation: /[mt]/.test(tie), tieStart: /[im]/.test(tie), extend: 0, dur: event.dur };
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
    if (RESTS.has(name)) {
      if (name === 'mRest' || name === 'mSpace' || name === 'multiRest') measureRest = true;
      else cursor += durationOf(attributes, ppq, tuplets);
    }
  });
  return { staves, tieStarts, tieEnds, info };
}

/** Pass 2: solve each staff (tie continuations extend the note they continue and are not fingered again). */
function solve(staves: Map<string, EventRec[]>, tieStarts: Set<string>, tieEnds: Set<string>, spec: TabSpec, memory: FretMemory | undefined): Map<string, FretResult> {
  const frets = new Map<string, FretResult>();
  for (const events of staves.values()) {
    const open = new Map<number, NoteRec>();
    const fretEvents: FretEvent[] = [];
    const owners: NoteRec[][] = [];
    for (const event of events) {
      const notes: NoteRec[] = [];
      for (const rec of event.notes) {
        if (rec.midi === null) continue;
        const continued = rec.continuation || tieEnds.has(rec.id);
        const from = continued ? open.get(rec.midi) : undefined;
        if (from) { from.extend += rec.dur; rec.continuation = true; }
        else { rec.continuation = false; notes.push(rec); }
        if (rec.tieStart || tieStarts.has(rec.id)) open.set(rec.midi, from ?? rec);
        else if (from) open.delete(rec.midi);
      }
      if (!notes.length) continue;
      owners.push(notes);
      fretEvents.push({ onset: event.onset, durations: notes.map(rec => rec.dur), pitches: notes.map(rec => rec.midi!), fixed: notes.map(rec => memory?.get(rec.id) ?? rec.fixed) });
    }
    // Durations include the tied continuations, so a held note's string stays busy.
    fretEvents.forEach((event, index) => { event.durations = owners[index].map(rec => rec.dur + rec.extend); });
    const results = assignFrets(fretEvents, { tuning: spec.tuning, capo: spec.capo });
    results.forEach((row, index) => row.forEach((result, at) => {
      const rec = owners[index][at];
      frets.set(rec.id, result);
      if (memory && rec.id && 'string' in result && !memory.has(rec.id)) memory.set(rec.id, { string: result.string, fret: result.fret });
    }));
  }
  return frets;
}

const durAttributes = (attributes: string) => ['dur', 'dots', 'dur.ppq'].map(name => { const value = attributeOf(attributes, name); return value !== null ? ` ${name}="${value}"` : ''; }).join('');
const tabNote = (id: string, result: FretResult | undefined) => result && 'string' in result ? `<note${idAttr(id, '')} tab.course="${result.string}" tab.fret="${result.fret}"/>` : '';

/**
 * Add the TAB staves of `spec` to `mei` and retarget hidden staves' control events. `memory` (optional) keeps
 * fingerings by note ID across calls: a remembered note is fixed for the solver and new results are added to it.
 */
export function injectTab(mei: string, spec: TabSpec, memory?: FretMemory): string {
  const generate = new Set(spec.generate);
  const retarget = spec.retarget;
  const retargeting = Object.keys(retarget).length > 0;
  if (!generate.size && !retargeting) return mei;
  const { staves, tieStarts, tieEnds, info } = generate.size ? collect(mei, generate, spec.fixed) : { staves: new Map<string, EventRec[]>(), tieStarts: new Set<string>(), tieEnds: new Set<string>(), info: new Map<string, StaffInfo>() };
  const frets = generate.size ? solve(staves, tieStarts, tieEnds, spec, memory) : new Map<string, FretResult>();
  const continuations = new Set<string>();
  for (const events of staves.values()) for (const event of events) for (const rec of event.notes) if (rec.continuation) continuations.add(rec.id);
  const tuning = tuningXml(spec.tuning, spec.capo);

  const out: string[] = [];
  let last = 0;
  // The first score definition gets the TAB staffDefs.
  let scoreDefDepth = -1; let scoreDefDone = false; let depth = 0;
  let staffDef: { n: string; id: string; meterSig: string; depth: number } | null = null;
  // The TAB clone of the generated staff being read.
  let clone: string[] | null = null; let cloneDepth = 0; let skip = 0;
  let chordOpen = false;
  const staffDefXml = (n: string, id: string, meterSig: string) => {
    const ppq = info.get(n)?.ppq;
    return `<staffDef${idAttr(id, '-tab')} n="${100 + Number(n)}" lines="6" notationtype="tab.guitar" keysig="0"${ppq ? ` ppq="${ppq}"` : ''}><clef shape="TAB" line="5"/>${tuning}${meterSig}</staffDef>`;
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
        if (moved !== staffAttr) tag = tag.replace(/(\sstaff\s*=\s*)(?:"[^"]*"|'[^']*')/, `$1"${moved}"`);
      }
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
        cloneDepth = depth; skip = 0; chordOpen = false;
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
      else if (name === 'chord' && chordOpen) { clone.push('</tabGrp>'); chordOpen = false; }
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
      if (selfClosing) clone.push('</tabGrp>'); else chordOpen = true;
      return;
    }
    if (name === 'note') {
      if (!selfClosing) skip = 1;
      if (chordOpen) { if (!continuations.has(id)) clone.push(tabNote(id ? `${id}-tab` : '', frets.get(id))); return; }
      if (attributeOf(attributes, 'grace') !== null) return;
      clone.push(`<tabGrp${idAttr(id, '-tab')}${durAttributes(attributes)}><tabDurSym/>${continuations.has(id) ? '' : tabNote(id ? `${id}-tabn` : '', frets.get(id))}</tabGrp>`);
      return;
    }
    if (RESTS.has(name)) {
      if (!selfClosing) skip = 1;
      clone.push(`<${name}${idAttr(id, '-tab')}${durAttributes(attributes)}/>`);
      return;
    }
    if (!selfClosing) skip = 1;
  });
  out.push(mei.slice(last));
  return out.join('');
}
