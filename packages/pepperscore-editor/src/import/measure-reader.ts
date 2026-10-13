import { BASE_TICKS, DURATION_BASES, TICKS_PER_QUARTER, durationTicks, measureTicks, ticksToDurations, type Duration, type DurationBase } from '../model/durations';
import { restEvent } from '../model/create';
import { newId } from '../model/ids';
import { effectiveTime, sequenceTicks } from '../model/query';
import type { Articulation, Clef, Direction, Document, Dynamic, Event, GlobalMeasure, Note, Part, PartMeasure, Pitch, Sequence, Tuplet } from '../model/schema';
import { endingNumbers, navigationWord } from './navigation-words';
import type { XmlElement } from './xml-stream';

/** Reads one MusicXML `<measure>` of a part into the model: notes, attributes, directions and barlines. */

export type Dropped = { feature: string; count: number; location: string };

/** Unmodelled features, counted per (feature, location) in first-seen order. */
export class DropLog {
  private readonly entries = new Map<string, Dropped>();
  add(feature: string, location: string): void {
    const key = `${feature}\u0000${location}`;
    const entry = this.entries.get(key);
    if (entry) entry.count++;
    else this.entries.set(key, { feature, count: 1, location });
  }
  list(): Dropped[] {
    return [...this.entries.values()];
  }
}

export type Wedge = Extract<Direction, { kind: 'wedge' }>;

/** State carried across the measures of one part. */
export type PartReader = {
  doc: Document;
  drop: DropLog;
  partIndex: number;
  part: Part;
  /** MusicXML divisions per quarter. */
  divisions: number;
  /** Per staff: MusicXML voice → model voice (1-4), numbered in order of first appearance. */
  voices: Map<number, Map<string, number>>;
  /** Tie starts waiting for their stop, keyed by sequence and pitch. */
  ties: Map<string, { note: Note; location: string }[]>;
  /** Open slur starts per number. */
  slurs: Map<number, { event: Event; side?: 'up' | 'down'; location: string }[]>;
  /** Slur stops that came before their start, per number. */
  slurStops: Map<number, Event[]>;
  wedges: Map<number, { wedge: Wedge; measureIndex: number }>;
  ending?: { numbers: number[]; measures: number[] };
};

type SequenceState = {
  seq: Sequence;
  key: string;
  tuplet?: { tuplet: Tuplet; explicit: boolean };
  beam?: string[];
};

type MeasureContext = {
  reader: PartReader;
  index: number;
  pm: PartMeasure;
  global: GlobalMeasure;
  location: string;
  /** Model ticks from the bar start. */
  cursor: number;
  sequences: Map<string, SequenceState>;
  last?: { event: Event; start: number; key: string };
};

const ARTICULATIONS: Record<string, Exclude<Articulation, 'fermata'>> = {
  staccato: 'staccato', tenuto: 'tenuto', accent: 'accent', 'strong-accent': 'marcato', staccatissimo: 'staccatissimo',
};
const DYNAMICS = new Set<string>(['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'sfz', 'fp']);
const BAR_STYLES: Record<string, GlobalMeasure['barline']> = { 'light-light': 'double', 'light-heavy': 'final', dashed: 'dashed', none: 'invisible' };
/** Note children read (or deliberately ignored as playback/editorial detail). */
const NOTE_CHILDREN = new Set([
  'grace', 'chord', 'pitch', 'rest', 'duration', 'tie', 'voice', 'type', 'dot', 'accidental', 'time-modification',
  'stem', 'staff', 'beam', 'notations', 'instrument', 'footnote', 'level', 'play', 'listen',
]);
const ATTRIBUTE_CHILDREN = new Set(['divisions', 'key', 'time', 'staves', 'clef', 'footnote', 'level']);
const STEPS = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G']);

export const child = (el: XmlElement, name: string) => el.children.find((c) => c.localName === name);
export const childText = (el: XmlElement, name: string) => child(el, name)?.textContent.trim();
const children = (el: XmlElement, name: string) => el.children.filter((c) => c.localName === name);
const int = (value: string | undefined | null) => {
  const n = Number(value);
  return value !== undefined && value !== null && value.trim() !== '' && Number.isInteger(n) ? n : undefined;
};
const isBase = (value: string | undefined): value is DurationBase => (DURATION_BASES as readonly string[]).includes(value ?? '');

export function barTicksAt(doc: Document, index: number): number {
  return measureTicks(effectiveTime(doc, index));
}

function toTicks(reader: PartReader, divisions: number): number {
  return (divisions * TICKS_PER_QUARTER) / reader.divisions;
}

export function readMeasure(reader: PartReader, el: XmlElement, index: number): void {
  const pm: PartMeasure = { id: newId(), sequences: [], beams: [], directions: [] };
  reader.part.measures.push(pm);
  const ctx: MeasureContext = {
    reader, index, pm, global: reader.doc.global.measures[index], location: `P${reader.partIndex + 1}/m${index + 1}`,
    cursor: 0, sequences: new Map(),
  };
  if (el.getAttribute('implicit') === 'yes') reader.drop.add('pickup', ctx.location);
  let endingStop: 'stop' | 'discontinue' | undefined;
  for (const item of el.children) {
    switch (item.localName) {
      case 'note': readNote(ctx, item); break;
      case 'backup': ctx.cursor = Math.max(0, ctx.cursor - toTicks(reader, Number(childText(item, 'duration') ?? 0))); break;
      case 'forward': ctx.cursor += toTicks(reader, Number(childText(item, 'duration') ?? 0)); break;
      case 'attributes': readAttributes(ctx, item); break;
      case 'direction': readDirection(ctx, item); break;
      case 'sound': readSound(ctx, item); break;
      case 'barline': endingStop = readBarline(ctx, item) ?? endingStop; break;
      case 'print':
        if (item.getAttribute('new-system') === 'yes') reader.drop.add('system break', ctx.location);
        if (item.getAttribute('new-page') === 'yes') reader.drop.add('page break', ctx.location);
        break;
      default: reader.drop.add(item.localName, ctx.location);
    }
  }
  for (const state of ctx.sequences.values()) finishBeam(ctx, state);
  if (reader.ending) {
    if (!reader.ending.measures.includes(index)) reader.ending.measures.push(index);
    if (endingStop) closeEnding(reader, endingStop === 'discontinue');
  }
}

export function closeEnding(reader: PartReader, open: boolean): void {
  const ending = reader.ending;
  if (!ending) return;
  for (const m of ending.measures) {
    reader.doc.global.measures[m].ending = { numbers: [...ending.numbers], ...(open ? { open: true } : {}) };
  }
  reader.ending = undefined;
}

// ---- notes ------------------------------------------------------------------

type NotationMarks = {
  tieStart: boolean;
  tieStop: boolean;
  slurs: { type: string; number: number; side?: 'up' | 'down' }[];
  tupletStart: boolean;
  tupletStop: boolean;
  bracket?: boolean;
  articulations: Articulation[];
};

function readNotations(ctx: MeasureContext, note: XmlElement): NotationMarks {
  const marks: NotationMarks = { tieStart: false, tieStop: false, slurs: [], tupletStart: false, tupletStop: false, articulations: [] };
  const tie = (type: string | null) => {
    if (type === 'start') marks.tieStart = true;
    if (type === 'stop') marks.tieStop = true;
  };
  for (const t of children(note, 'tie')) tie(t.getAttribute('type'));
  for (const notations of children(note, 'notations')) for (const n of notations.children) {
    switch (n.localName) {
      case 'tied': tie(n.getAttribute('type')); break;
      case 'slur': {
        const placement = n.getAttribute('placement');
        marks.slurs.push({ type: n.getAttribute('type') ?? '', number: int(n.getAttribute('number')) ?? 1, side: placement === 'above' ? 'up' : placement === 'below' ? 'down' : undefined });
        break;
      }
      case 'tuplet':
        if (n.getAttribute('type') === 'start') {
          marks.tupletStart = true;
          const bracket = n.getAttribute('bracket');
          if (bracket === 'yes' || bracket === 'no') marks.bracket = bracket === 'yes';
        }
        if (n.getAttribute('type') === 'stop') marks.tupletStop = true;
        break;
      case 'articulations':
        for (const a of n.children) {
          if (ARTICULATIONS[a.localName]) marks.articulations.push(ARTICULATIONS[a.localName]);
          else ctx.reader.drop.add(a.localName, ctx.location);
        }
        break;
      case 'fermata': marks.articulations.push('fermata'); break;
      case 'ornaments':
      case 'technical':
        for (const a of n.children) ctx.reader.drop.add(a.localName, ctx.location);
        break;
      default: ctx.reader.drop.add(n.localName, ctx.location);
    }
  }
  return marks;
}

function readPitch(ctx: MeasureContext, el: XmlElement): Pitch | undefined {
  const step = childText(el, 'step') ?? '';
  const octave = int(childText(el, 'octave'));
  const rawAlter = Number(childText(el, 'alter') ?? 0) || 0;
  if (!STEPS.has(step) || octave === undefined || octave < 0 || octave > 9) {
    ctx.reader.drop.add('pitch', ctx.location);
    return undefined;
  }
  if (!Number.isInteger(rawAlter)) ctx.reader.drop.add('microtone', ctx.location);
  const alter = Math.max(-2, Math.min(2, Math.round(rawAlter)));
  return { step: step as Pitch['step'], octave, alter };
}

/** Largest (dotted) base whose ticks fit `ticks`; a 32nd at least. */
function durationFromTicks(ticks: number): Duration {
  for (const base of DURATION_BASES) {
    if (BASE_TICKS[base] * 1.5 <= ticks + 1e-6) return { base, dots: 1 };
    if (BASE_TICKS[base] <= ticks + 1e-6) return { base, dots: 0 };
  }
  return { base: '32nd', dots: 0 };
}

function sequenceState(ctx: MeasureContext, staff: number, xmlVoice: string): SequenceState | undefined {
  const { reader } = ctx;
  let map = reader.voices.get(staff);
  if (!map) reader.voices.set(staff, (map = new Map()));
  let voice = map.get(xmlVoice);
  if (voice === undefined) {
    if (map.size >= 4) return undefined;
    voice = map.size + 1;
    map.set(xmlVoice, voice);
  }
  const key = `${staff}/${voice}`;
  let state = ctx.sequences.get(key);
  if (!state) {
    const seq: Sequence = { id: newId(), staff, voice, content: [] };
    ctx.pm.sequences.push(seq);
    ctx.sequences.set(key, (state = { seq, key }));
  }
  return state;
}

function finishBeam(ctx: MeasureContext, state: SequenceState): void {
  if (state.beam && state.beam.length >= 2) ctx.pm.beams.push({ id: newId(), events: state.beam });
  state.beam = undefined;
}

function readNote(ctx: MeasureContext, el: XmlElement): void {
  const { reader } = ctx;
  for (const c of el.children) if (!NOTE_CHILDREN.has(c.localName)) reader.drop.add(c.localName, ctx.location);
  const chord = child(el, 'chord') !== undefined;
  const grace = child(el, 'grace');
  const restEl = child(el, 'rest');
  const pitchEl = child(el, 'pitch');
  const ticks = grace ? 0 : toTicks(reader, Number(childText(el, 'duration') ?? 0) || 0);
  const pitch = pitchEl ? readPitch(ctx, pitchEl) : undefined;
  const note: Note | undefined = pitch && !restEl ? { id: newId(), pitch } : undefined;
  const accidental = child(el, 'accidental');
  if (note && accidental && (accidental.getAttribute('cautionary') === 'yes' || accidental.getAttribute('parentheses') === 'yes')) note.accidental = 'cautionary';

  if (chord) {
    const last = ctx.last;
    if (!last) return;
    if (note && !last.event.rest) last.event.notes = [...(last.event.notes ?? []), note];
    applyNotations(ctx, last.event, note, last.key, readNotations(ctx, el));
    return;
  }

  const start = ctx.cursor;
  ctx.cursor += ticks;
  ctx.last = undefined;
  const staff = int(childText(el, 'staff')) ?? 1;
  if (staff < 1 || staff > reader.part.staves) {
    reader.drop.add('staff', ctx.location);
    return;
  }
  const state = sequenceState(ctx, staff, childText(el, 'voice') || '1');
  if (!state) {
    reader.drop.add('voice>4', ctx.location);
    return;
  }

  const mod = child(el, 'time-modification');
  const actual = mod ? int(childText(mod, 'actual-notes')) : undefined;
  const normal = mod ? int(childText(mod, 'normal-notes')) : undefined;
  const ratio = actual && normal && actual > 0 && normal > 0 && actual !== normal ? { actual, normal } : undefined;

  const type = childText(el, 'type');
  const dots = children(el, 'dot').length;
  if (dots > 2) reader.drop.add('dots>2', ctx.location);
  let duration: Duration;
  if (isBase(type)) duration = { base: type, dots: Math.min(dots, 2) as 0 | 1 | 2 };
  else {
    if (type) reader.drop.add(`duration ${type}`, ctx.location);
    duration = grace && !type ? { base: 'eighth', dots: 0 } : durationFromTicks(ratio ? (ticks * ratio.actual) / ratio.normal : ticks);
  }
  const normalType = mod ? childText(mod, 'normal-type') : undefined;
  const tupletBase: DurationBase = isBase(normalType) ? normalType : duration.base;

  const barTicks = barTicksAt(reader.doc, ctx.index);
  const end = sequenceTicks(state.seq, barTicks);
  if (start < end - 0.5) {
    reader.drop.add('overlapping note', ctx.location);
    return;
  }
  if (start > end + 0.5) {
    state.tuplet = undefined;
    finishBeam(ctx, state);
    const gap = Math.floor((start - end + 0.5) / BASE_TICKS['32nd']) * BASE_TICKS['32nd'];
    for (const d of ticksToDurations(gap)) state.seq.content.push(restEvent(d));
  }

  const event: Event = { id: newId(), type: 'event', duration };
  if (grace) event.grace = { slash: grace.getAttribute('slash') === 'yes' };
  if (restEl) {
    event.rest = true;
    if (restEl.getAttribute('measure') === 'yes') {
      event.fullMeasure = true;
      event.duration = { base: 'whole', dots: 0 };
    }
  } else if (note) event.notes = [note];
  else event.rest = true;
  const stem = childText(el, 'stem');
  if (stem === 'up' || stem === 'down') event.stem = stem;

  const marks = readNotations(ctx, el);
  if (ratio) {
    const open = state.tuplet?.tuplet;
    const same = open && open.outer.multiple === ratio.actual && open.inner.multiple === ratio.normal && open.inner.base === tupletBase;
    if (!same || marks.tupletStart) {
      const tuplet: Tuplet = { id: newId(), type: 'tuplet', outer: { multiple: ratio.actual, base: tupletBase }, inner: { multiple: ratio.normal, base: tupletBase }, content: [] };
      if (marks.bracket !== undefined) tuplet.bracket = marks.bracket;
      state.seq.content.push(tuplet);
      state.tuplet = { tuplet, explicit: marks.tupletStart };
    }
    const group = state.tuplet!;
    group.tuplet.content.push(event);
    const written = group.tuplet.content.reduce((sum, e) => sum + (e.grace ? 0 : durationTicks(e.duration)), 0);
    const full = written >= group.tuplet.outer.multiple * BASE_TICKS[group.tuplet.outer.base];
    if (marks.tupletStop || (!group.explicit && full)) state.tuplet = undefined;
  } else if (grace && state.tuplet) {
    state.tuplet.tuplet.content.push(event);
  } else {
    state.tuplet = undefined;
    state.seq.content.push(event);
  }

  const beam = children(el, 'beam').find((b) => (b.getAttribute('number') ?? '1') === '1')?.textContent.trim();
  if (beam === 'begin') {
    finishBeam(ctx, state);
    state.beam = [event.id];
  } else if (beam === 'continue' || beam === 'end') {
    (state.beam ??= []).push(event.id);
    if (beam === 'end') finishBeam(ctx, state);
  } else if (!grace) finishBeam(ctx, state);

  applyNotations(ctx, event, note, state.key, marks);
  ctx.last = { event, start, key: state.key };
}

function applyNotations(ctx: MeasureContext, event: Event, note: Note | undefined, key: string, marks: NotationMarks): void {
  const { reader } = ctx;
  if (note) {
    const tieKey = `${key}/${note.pitch.step}${note.pitch.alter}/${note.pitch.octave}`;
    if (marks.tieStop) {
      const pending = reader.ties.get(tieKey);
      const from = pending?.shift();
      if (from) from.note.tie = { target: note.id };
    }
    if (marks.tieStart) reader.ties.set(tieKey, [...(reader.ties.get(tieKey) ?? []), { note, location: ctx.location }]);
  }
  for (const slur of marks.slurs) {
    if (slur.type === 'stop') {
      const open = reader.slurs.get(slur.number)?.pop();
      if (open && open.event !== event) (open.event.slurs ??= []).push({ id: newId(), target: event.id, ...(open.side ? { side: open.side } : {}) });
      else if (!open) reader.slurStops.set(slur.number, [...(reader.slurStops.get(slur.number) ?? []), event]);
    } else if (slur.type === 'start') {
      const early = reader.slurStops.get(slur.number)?.pop();
      if (early && early !== event) (event.slurs ??= []).push({ id: newId(), target: early.id, ...(slur.side ? { side: slur.side } : {}) });
      else if (!early) reader.slurs.set(slur.number, [...(reader.slurs.get(slur.number) ?? []), { event, side: slur.side, location: ctx.location }]);
    }
  }
  if (marks.articulations.length) {
    const all = [...(event.articulations ?? []), ...marks.articulations];
    const plain = [...new Set(all.filter((a) => a !== 'fermata'))];
    event.articulations = all.includes('fermata') ? [...plain, 'fermata'] : plain;
  }
}

// ---- attributes ---------------------------------------------------------------

function readClef(el: XmlElement): Clef | undefined {
  const sign = childText(el, 'sign');
  const line = childText(el, 'line');
  const octave = int(childText(el, 'clef-octave-change')) ?? 0;
  if (sign === 'G' && (line ?? '2') === '2') return octave === -1 ? 'treble8vb' : octave === 0 ? 'treble' : undefined;
  if (octave !== 0) return undefined;
  if (sign === 'F' && (line ?? '4') === '4') return 'bass';
  if (sign === 'C' && line === '3') return 'alto';
  if (sign === 'C' && line === '4') return 'tenor';
  if (sign === 'percussion') return 'percussion';
  return undefined;
}

function readAttributes(ctx: MeasureContext, el: XmlElement): void {
  const { reader, global } = ctx;
  for (const c of el.children) if (!ATTRIBUTE_CHILDREN.has(c.localName)) reader.drop.add(c.localName, ctx.location);
  const divisions = Number(childText(el, 'divisions'));
  if (divisions > 0) reader.divisions = divisions;

  const key = child(el, 'key');
  if (key) {
    const fifths = int(childText(key, 'fifths'));
    const mode = childText(key, 'mode');
    if (fifths === undefined || fifths < -7 || fifths > 7) reader.drop.add('key', ctx.location);
    else global.key ??= { fifths, ...(mode === 'major' || mode === 'minor' ? { mode } : {}) };
  }

  const time = child(el, 'time');
  if (time) {
    const count = int(childText(time, 'beats'));
    const unit = int(childText(time, 'beat-type'));
    const valid = count !== undefined && count >= 1 && count <= 32 && [1, 2, 4, 8, 16].includes(unit ?? 0) && children(time, 'beats').length === 1;
    if (valid) global.time ??= { count, unit: unit as 1 | 2 | 4 | 8 | 16 };
    else reader.drop.add('time', ctx.location);
  }

  for (const c of children(el, 'clef')) {
    const staff = int(c.getAttribute('number')) ?? 1;
    if (staff < 1 || staff > reader.part.staves) continue;
    const clef = readClef(c);
    if (!clef) reader.drop.add('clef', ctx.location);
    else if (ctx.cursor > 0) reader.drop.add('mid-bar clef', ctx.location);
    else if (ctx.index === 0) reader.part.clefs[staff - 1] = clef;
    else ctx.pm.clefs = [...(ctx.pm.clefs ?? []).filter((x) => x.staff !== staff), { staff, clef }];
  }
}

// ---- directions -----------------------------------------------------------------

function shiftOf(el: XmlElement): { x: number; y: number } | undefined {
  const x = el.getAttribute('relative-x');
  const y = el.getAttribute('relative-y');
  if (x === null && y === null) return undefined;
  return { x: (Number(x) || 0) / 10, y: (Number(y) || 0) / 10 };
}

function jumpTarget(text: string): 'fine' | 'coda' | 'end' {
  return /fine/i.test(text) ? 'fine' : /coda/i.test(text) ? 'coda' : 'end';
}

function readDirection(ctx: MeasureContext, el: XmlElement): void {
  const { reader, global } = ctx;
  const placementAttr = el.getAttribute('placement');
  const placement = placementAttr === 'above' || placementAttr === 'below' ? placementAttr : undefined;
  const staff = Math.min(Math.max(int(childText(el, 'staff')) ?? 1, 1), reader.part.staves);
  const tick = Math.max(0, ctx.cursor + toTicks(reader, Number(childText(el, 'offset') ?? 0) || 0));
  const anchor = { measureId: global.id, tick, staff };
  const base: { anchor: Direction['anchor']; placement?: 'above' | 'below' } = { anchor, ...(placement ? { placement } : {}) };
  const words: XmlElement[] = [];
  let metronome: XmlElement | undefined;

  for (const type of children(el, 'direction-type')) for (const item of type.children) {
    switch (item.localName) {
      case 'dynamics':
        for (const d of item.children) {
          if (!DYNAMICS.has(d.localName)) { reader.drop.add(`dynamics ${d.localName}`, ctx.location); continue; }
          const offset = shiftOf(item);
          ctx.pm.directions.push({ kind: 'dynamic', id: newId(), ...base, ...(offset ? { offset } : {}), value: d.localName as Dynamic });
        }
        break;
      case 'wedge': readWedge(ctx, item, base); break;
      case 'words': words.push(item); break;
      case 'metronome': metronome = item; break;
      case 'rehearsal': global.rehearsal ??= item.textContent.trim(); break;
      case 'segno': global.segno = true; break;
      case 'coda': global.coda = true; break;
      case 'octave-shift': reader.drop.add('ottava', ctx.location); break;
      default: reader.drop.add(item.localName, ctx.location);
    }
  }

  const text = words.map((w) => w.textContent).join('');
  if (metronome) readMetronome(ctx, metronome, text.trim() ? text : undefined);
  else if (text.trim()) {
    const nav = navigationWord(text);
    if (nav === 'daCapo' || nav === 'dalSegno') global.jump = { type: nav === 'daCapo' ? 'dc' : 'ds', target: jumpTarget(text) };
    else if (nav === 'toCoda') global.toCoda = true;
    else if (nav) global[nav] = true;
    else {
      const first = words[0];
      const style = first.getAttribute('font-weight') === 'bold' ? 'tempo' : first.getAttribute('font-style') === 'italic' ? 'expression' : undefined;
      const offset = shiftOf(first);
      ctx.pm.directions.push({ kind: 'text', id: newId(), ...base, ...(offset ? { offset } : {}), text, ...(style ? { style } : {}) });
    }
  }
  const sound = child(el, 'sound');
  if (sound) readSound(ctx, sound);
}

function readWedge(ctx: MeasureContext, el: XmlElement, base: { anchor: Direction['anchor']; placement?: 'above' | 'below' }): void {
  const { reader } = ctx;
  const type = el.getAttribute('type');
  const number = int(el.getAttribute('number')) ?? 1;
  if (type === 'crescendo' || type === 'diminuendo') {
    const offset = shiftOf(el);
    // endTick -1 marks a wedge whose stop has not been read; the importer closes it at its bar end.
    const wedge: Wedge = { kind: 'wedge', id: newId(), ...base, ...(offset ? { offset } : {}), shape: type === 'crescendo' ? 'cresc' : 'dim', endTick: -1 };
    ctx.pm.directions.push(wedge);
    reader.wedges.set(number, { wedge, measureIndex: ctx.index });
  } else if (type === 'stop') {
    const open = reader.wedges.get(number);
    if (!open) return;
    reader.wedges.delete(number);
    open.wedge.endTick = base.anchor.tick;
    if (open.measureIndex !== ctx.index) open.wedge.endMeasureId = ctx.global.id;
  }
}

function readMetronome(ctx: MeasureContext, el: XmlElement, text: string | undefined): void {
  const unit = childText(el, 'beat-unit');
  const bpm = parseFloat(/[\d.]+/.exec(childText(el, 'per-minute') ?? '')?.[0] ?? '');
  if (!isBase(unit) || !(bpm > 0)) {
    ctx.reader.drop.add('metronome', ctx.location);
    return;
  }
  const dotted = child(el, 'beat-unit-dot') !== undefined;
  if (dotted) ctx.reader.drop.add('dotted tempo unit', ctx.location);
  if (ctx.cursor > 0) ctx.reader.drop.add('mid-bar tempo', ctx.location);
  ctx.global.tempo = { bpm: dotted ? bpm * 1.5 : bpm, unit, ...(text !== undefined ? { text } : {}) };
}

/** Navigation flags from `<sound>`; a jump only when the words have not set one. */
function readSound(ctx: MeasureContext, el: XmlElement): void {
  const g = ctx.global;
  if (el.hasAttribute('segno')) g.segno = true;
  if (el.hasAttribute('coda')) g.coda = true;
  if (el.hasAttribute('tocoda')) g.toCoda = true;
  if (el.hasAttribute('fine')) g.fine = true;
  if (el.getAttribute('dacapo') === 'yes') g.jump ??= { type: 'dc', target: 'end' };
  if (el.hasAttribute('dalsegno')) g.jump ??= { type: 'ds', target: 'end' };
}

// ---- barlines -------------------------------------------------------------------

/** Applies a barline; returns how an ending stops here, if it does. */
function readBarline(ctx: MeasureContext, el: XmlElement): 'stop' | 'discontinue' | undefined {
  const { reader, global } = ctx;
  const location = el.getAttribute('location') ?? 'right';
  const repeat = child(el, 'repeat');
  const direction = repeat?.getAttribute('direction');
  if (direction === 'forward') global.repeatStart = true;
  if (direction === 'backward') {
    const times = int(repeat!.getAttribute('times'));
    global.repeatEnd = times !== undefined && times >= 2 && times <= 16 ? { times } : {};
  }
  const style = childText(el, 'bar-style');
  if (style && style !== 'regular' && !repeat) {
    const mapped = location === 'right' ? BAR_STYLES[style] : undefined;
    if (mapped) global.barline = mapped;
    else reader.drop.add(`bar-style ${style}`, ctx.location);
  }
  for (const c of el.children) if (!['bar-style', 'repeat', 'ending', 'footnote', 'level'].includes(c.localName)) reader.drop.add(c.localName, ctx.location);

  const ending = child(el, 'ending');
  const type = ending?.getAttribute('type');
  if (!ending) return undefined;
  const numbers = endingNumbers(ending.getAttribute('number'));
  if (type === 'start') {
    if (reader.ending) closeEnding(reader, false);
    if (numbers.length) reader.ending = { numbers, measures: [ctx.index] };
    else reader.drop.add('ending', ctx.location);
    return undefined;
  }
  if (type === 'stop' || type === 'discontinue') {
    if (!reader.ending && numbers.length) reader.ending = { numbers, measures: [ctx.index] };
    return type;
  }
  return undefined;
}
