import { BASE_TICKS, durationTicks, measureTicks, type DurationBase } from '../model/durations';
import { effectiveKey, effectiveTime, measureIndex } from '../model/query';
import type { Articulation, Clef, Direction, Document, Dynamic, Event, Note, Part, PartMeasure, Sequence, Tuplet } from '../model/schema';
import { writeLeftBarline, writeNavigation, writeRightBarline } from './barlines-and-navigation';
import { el, leaf, type Child } from './xml';

/** Ticks per quarter in the model, used directly as MusicXML divisions. */
const DIVISIONS = 960;

const CLEF_SIGNS: Record<Clef, { sign: string; line: number; octave?: number }> = {
  treble: { sign: 'G', line: 2 },
  bass: { sign: 'F', line: 4 },
  alto: { sign: 'C', line: 3 },
  tenor: { sign: 'C', line: 4 },
  percussion: { sign: 'percussion', line: 2 },
  treble8vb: { sign: 'G', line: 2, octave: -1 },
};
const DYNAMIC_SOUND: Record<Dynamic, number> = { ppp: 25, pp: 38, p: 50, mp: 62, mf: 75, f: 88, ff: 100, fff: 112, sfz: 100, fp: 75 };
const ARTICULATION_XML: Record<Exclude<Articulation, 'fermata'>, string> = {
  staccato: 'staccato', tenuto: 'tenuto', accent: 'accent', marcato: 'strong-accent', staccatissimo: 'staccatissimo',
};
const ACCIDENTAL_XML: Record<number, string> = { [-2]: 'flat-flat', [-1]: 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' };
const BEAM_DEPTH: Partial<Record<DurationBase, number>> = { eighth: 1, '16th': 2, '32nd': 3 };
const SHARPS = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];

/** An event as written: integer start tick and duration; grace events take no time. */
type Written = { event: Event; tick: number; duration: number; tuplet?: { tuplet: Tuplet; first: boolean; last: boolean } };
/** A direction waiting to be written before the first staff-1 voice-1 event at or after `tick`. */
type Placed = { tick: number; write: (offset: number) => string };
type SlurMark = { type: 'start' | 'stop'; number: number; placement?: string };

type PartContext = {
  doc: Document;
  part: Part;
  /** The first written part also carries the global directions (navigation, tempo, rehearsal). */
  first: boolean;
  tieTargets: Set<string>;
  slurs: Map<string, SlurMark[]>;
  placed: Map<number, Placed[]>;
};

export function compileToMusicXml(doc: Document, options: { layoutId?: string } = {}): string {
  const layout = options.layoutId === undefined ? doc.layouts[0] : doc.layouts.find((l) => l.id === options.layoutId);
  if (!layout) throw new Error(`Unknown layout ${options.layoutId}`);
  const parts = layout.parts.map((lp) => doc.parts.find((p) => p.id === lp.partId)).filter((p): p is Part => p !== undefined);
  const tieTargets = new Set<string>();
  for (const part of doc.parts) for (const pm of part.measures) for (const seq of pm.sequences) for (const w of writtenEvents(seq, 0))
    for (const note of w.event.notes ?? []) if (note.tie) tieTargets.add(note.tie.target);

  const score = el('score-partwise', { version: '4.0' }, [
    doc.meta.title !== undefined && el('work', undefined, [leaf('work-title', doc.meta.title)]),
    doc.meta.composer !== undefined && el('identification', undefined, [leaf('creator', doc.meta.composer, { type: 'composer' })]),
    el('part-list', undefined, parts.map((part, i) => writeScorePart(part, `P${i + 1}`))),
    ...parts.map((part, i) => writePart({ doc, part, first: i === 0, tieTargets, slurs: slurMarks(part), placed: placedDirections(doc, part) }, `P${i + 1}`)),
  ]);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${score}\n`;
}

function writeScorePart(part: Part, id: string): string {
  const instrument = `${id}-I1`;
  return el('score-part', { id }, [
    leaf('part-name', part.name),
    part.abbreviation !== undefined && leaf('part-abbreviation', part.abbreviation),
    el('score-instrument', { id: instrument }, [leaf('instrument-name', part.name)]),
    el('midi-instrument', { id: instrument }, [
      part.instrument.midiChannel !== undefined && leaf('midi-channel', part.instrument.midiChannel),
      leaf('midi-program', part.instrument.gmProgram),
    ]),
  ]);
}

function writePart(ctx: PartContext, id: string): string {
  return el('part', { id }, ctx.part.measures.map((_, index) => writeMeasure(ctx, index)));
}

/** Sequences in writing order: staff 1 voice 1 first, then by staff and voice. */
function orderedSequences(pm: PartMeasure): Sequence[] {
  return [...pm.sequences].sort((a, b) => a.staff - b.staff || a.voice - b.voice);
}

function writeMeasure(ctx: PartContext, index: number): string {
  const { doc, part } = ctx;
  const pm = part.measures[index];
  const barTicks = measureTicks(effectiveTime(doc, index));
  const sequences = orderedSequences(pm).map((seq) => ({ seq, written: writtenEvents(seq, barTicks) }));
  // A bar without sequences still advances time (and keeps its directions) via one empty voice.
  if (!sequences.length) sequences.push({ seq: { id: '', staff: 1, voice: 1, content: [] }, written: [] });
  const accidentals = accidentalMarks(sequences, effectiveKey(doc, index).fifths, ctx.tieTargets);
  const beams = beamMarks(pm);
  const children: Child[] = [writeLeftBarline(doc, index), writeAttributes(ctx, index)];
  if (ctx.first) children.push(...writeNavigation(doc, index, 'start'));
  let cursor = 0;
  sequences.forEach(({ seq, written }, i) => {
    if (i > 0) children.push(el('backup', undefined, [leaf('duration', cursor)]));
    cursor = 0;
    const directions = i === 0 ? [...(ctx.placed.get(index) ?? [])].sort((a, b) => a.tick - b.tick) : [];
    const voice = (seq.staff - 1) * 4 + seq.voice;
    const staff = part.staves === 2 ? seq.staff : undefined;
    for (const w of written) {
      while (directions.length && directions[0].tick <= w.tick) {
        const direction = directions.shift()!;
        children.push(direction.write(direction.tick - w.tick));
      }
      children.push(...writeEvent(ctx, w, voice, staff, accidentals, beams.get(w.event.id) ?? []));
      cursor = Math.max(cursor, w.tick + w.duration);
    }
    if (cursor < barTicks) {
      children.push(el('forward', undefined, [leaf('duration', barTicks - cursor), leaf('voice', voice), staff !== undefined && leaf('staff', staff)]));
      cursor = barTicks;
    }
    for (const d of directions) children.push(d.write(d.tick - cursor));
  });
  if (ctx.first) children.push(...writeNavigation(doc, index, 'end'));
  children.push(writeRightBarline(doc, index));
  return el('measure', { number: index + 1 }, children);
}

/**
 * Events of a sequence with integer ticks. A full-measure rest spans the bar.
 * Tuplet members are scaled by span/written and rounded; the last member
 * absorbs the rounding so the tuplet totals its span exactly.
 */
function writtenEvents(seq: Sequence, barTicks: number): Written[] {
  const out: Written[] = [];
  let tick = 0;
  for (const item of seq.content) {
    if (item.type === 'event') {
      const duration = item.grace ? 0 : item.fullMeasure ? barTicks : durationTicks(item.duration);
      out.push({ event: item, tick, duration });
      tick += duration;
      continue;
    }
    const span = item.inner.multiple * BASE_TICKS[item.inner.base];
    const scale = span / (item.outer.multiple * BASE_TICKS[item.outer.base]);
    const timed = item.content.filter((e) => !e.grace);
    const total = Math.round(timed.reduce((sum, e) => sum + durationTicks(e.duration), 0) * scale);
    let used = 0;
    item.content.forEach((event, k) => {
      let duration = 0;
      if (!event.grace) duration = event === timed[timed.length - 1] ? total - used : Math.round(durationTicks(event.duration) * scale);
      out.push({ event, tick: tick + used, duration, tuplet: { tuplet: item, first: k === 0, last: k === item.content.length - 1 } });
      used += duration;
    });
    tick += used;
  }
  return out;
}

function writeClef(staff: number, clef: Clef): string {
  const { sign, line, octave } = CLEF_SIGNS[clef];
  return el('clef', { number: staff }, [leaf('sign', sign), leaf('line', line), octave !== undefined && leaf('clef-octave-change', octave)]);
}

/** Full attributes in the first measure; afterwards only what changes there (time, key, bar-start clefs). */
function writeAttributes(ctx: PartContext, index: number): string | undefined {
  const { doc, part } = ctx;
  const g = doc.global.measures[index];
  const pm = part.measures[index];
  const first = index === 0;
  for (const c of pm.clefs ?? []) {
    if ((c.tick ?? 0) > 0) console.warn(`pepperscore-editor: mid-bar clef (${c.clef} at tick ${c.tick}, part ${part.name}, measure ${index + 1}) is not compiled yet; dropped`);
  }
  const clefs = new Map<number, Clef>();
  if (first) part.clefs.forEach((clef, i) => clefs.set(i + 1, clef));
  for (const c of pm.clefs ?? []) if ((c.tick ?? 0) === 0) clefs.set(c.staff, c.clef);
  const key = first ? effectiveKey(doc, 0) : g.key;
  const time = first ? effectiveTime(doc, 0) : g.time;
  const children: Child[] = [
    first && leaf('divisions', DIVISIONS),
    key && el('key', undefined, [leaf('fifths', key.fifths), key.mode && leaf('mode', key.mode)]),
    time && el('time', undefined, [leaf('beats', time.count), leaf('beat-type', time.unit)]),
    first && part.staves === 2 && leaf('staves', 2),
    ...[...clefs].sort(([a], [b]) => a - b).map(([staff, clef]) => writeClef(staff, clef)),
  ];
  return children.some(Boolean) ? el('attributes', undefined, children) : undefined;
}

function keyAlter(fifths: number, step: string): number {
  if (fifths > 0) return SHARPS.slice(0, fifths).includes(step) ? 1 : 0;
  if (fifths < 0) return [...SHARPS].reverse().slice(0, -fifths).includes(step) ? -1 : 0;
  return 0;
}

/**
 * `<accidental>` per note id, engraver style: per staff, in time order, an
 * accidental shows when the alter differs from the key signature or from an
 * earlier note of the same step and octave in the bar. `show`/`cautionary`
 * force it; `hide` suppresses it. A tie continuation shows none and leaves
 * the bar's state alone.
 */
function accidentalMarks(sequences: { seq: Sequence; written: Written[] }[], fifths: number, tieTargets: Set<string>): Map<string, string> {
  const marks = new Map<string, string>();
  for (const staff of new Set(sequences.map(({ seq }) => seq.staff))) {
    const timeline = sequences.filter(({ seq }) => seq.staff === staff).flatMap(({ written }) => written).sort((a, b) => a.tick - b.tick);
    const state = new Map<string, number>();
    for (const { event } of timeline) for (const note of event.notes ?? []) {
      const { step, octave, alter } = note.pitch;
      const key = `${step}${octave}`;
      const implied = state.get(key) ?? keyAlter(fifths, step);
      const mode = note.accidental ?? 'auto';
      const tieStop = tieTargets.has(note.id);
      const shown = mode === 'show' || mode === 'cautionary' || (mode === 'auto' && alter !== implied && !tieStop);
      if (shown) marks.set(note.id, leaf('accidental', ACCIDENTAL_XML[alter], mode === 'cautionary' ? { cautionary: 'yes' } : undefined));
      if (shown || !tieStop) state.set(key, alter);
    }
  }
  return marks;
}

/**
 * `<beam>` elements per event id. Level 1 spans the whole beam; levels 2 and 3
 * run over consecutive 16ths / 32nds, and a lone short note gets a hook
 * (forward at the start of the beam, backward elsewhere).
 */
function beamMarks(pm: PartMeasure): Map<string, string[]> {
  const events = new Map<string, Event>();
  for (const seq of pm.sequences) for (const w of writtenEvents(seq, 0)) events.set(w.event.id, w.event);
  const marks = new Map<string, string[]>();
  for (const beam of pm.beams) {
    const depths = beam.events.map((id) => BEAM_DEPTH[events.get(id)?.duration.base ?? 'quarter'] ?? 1);
    for (let level = 1; level <= 3; level++) {
      depths.forEach((depth, i) => {
        if (depth < level) return;
        const before = i > 0 && depths[i - 1] >= level;
        const after = i < depths.length - 1 && depths[i + 1] >= level;
        const value = before && after ? 'continue' : after ? 'begin' : before ? 'end' : i === 0 ? 'forward hook' : 'backward hook';
        const list = marks.get(beam.events[i]) ?? [];
        list.push(leaf('beam', value, { number: level }));
        marks.set(beam.events[i], list);
      });
    }
  }
  return marks;
}

/**
 * Picks the lowest number (1..16) free over each closed interval, so
 * overlapping spans (and one ending where another starts) differ.
 */
function allocateNumbers(spans: { id: string; from: number; to: number }[]): Map<string, number> {
  const numbers = new Map<string, number>();
  const active: { to: number; number: number }[] = [];
  for (const span of [...spans].sort((a, b) => a.from - b.from)) {
    for (let i = active.length - 1; i >= 0; i--) if (active[i].to < span.from) active.splice(i, 1);
    let number = 1;
    while (active.some((a) => a.number === number) && number < 16) number++;
    active.push({ to: span.to, number });
    numbers.set(span.id, number);
  }
  return numbers;
}

/** Slur start/stop marks per event id across the whole part, in writing order. */
function slurMarks(part: Part): Map<string, SlurMark[]> {
  const order = new Map<string, number>();
  const slurs: { id: string; from: string; to: string; placement?: string }[] = [];
  for (const pm of part.measures) for (const seq of orderedSequences(pm)) for (const { event } of writtenEvents(seq, 0)) {
    order.set(event.id, order.size);
    for (const slur of event.slurs ?? []) slurs.push({ id: slur.id, from: event.id, to: slur.target, placement: slur.side && (slur.side === 'up' ? 'above' : 'below') });
  }
  const spans = slurs.filter((s) => order.has(s.to) && s.to !== s.from).map((s) => {
    const a = order.get(s.from)!, b = order.get(s.to)!;
    return { ...s, from: Math.min(a, b), to: Math.max(a, b), start: a <= b ? s.from : s.to, stop: a <= b ? s.to : s.from };
  });
  const numbers = allocateNumbers(spans);
  const marks = new Map<string, SlurMark[]>();
  const add = (id: string, mark: SlurMark) => marks.set(id, [...(marks.get(id) ?? []), mark]);
  for (const span of spans) {
    add(span.start, { type: 'start', number: numbers.get(span.id)!, placement: span.placement });
    add(span.stop, { type: 'stop', number: numbers.get(span.id)! });
  }
  // Within an event, stops come before starts.
  for (const list of marks.values()) list.sort((a, b) => (a.type === b.type ? 0 : a.type === 'stop' ? -1 : 1));
  return marks;
}

function writeEvent(ctx: PartContext, w: Written, voice: number, staff: number | undefined, accidentals: Map<string, string>, beams: string[]): string[] {
  const { event } = w;
  const notes: (Note | undefined)[] = event.rest || !event.notes?.length ? [undefined] : event.notes;
  const full = event.rest && event.fullMeasure;
  return notes.map((note, i) => {
    const tieStop = note !== undefined && ctx.tieTargets.has(note.id);
    const tieStart = note?.tie !== undefined;
    const lead = i === 0;
    const tuplet = w.tuplet?.tuplet;
    const children: Child[] = [
      event.grace && leaf('grace', undefined, { slash: event.grace.slash ? 'yes' : undefined }),
      !lead && leaf('chord'),
      note
        ? el('pitch', undefined, [leaf('step', note.pitch.step), note.pitch.alter !== 0 && leaf('alter', note.pitch.alter), leaf('octave', note.pitch.octave)])
        : leaf('rest', undefined, { measure: full ? 'yes' : undefined }),
      !event.grace && leaf('duration', w.duration),
      tieStop && leaf('tie', undefined, { type: 'stop' }),
      tieStart && leaf('tie', undefined, { type: 'start' }),
      leaf('voice', voice),
      !full && leaf('type', event.duration.base),
      ...(full ? [] : Array.from({ length: event.duration.dots }, () => leaf('dot'))),
      note && accidentals.get(note.id),
      tuplet && el('time-modification', undefined, [leaf('actual-notes', tuplet.outer.multiple), leaf('normal-notes', tuplet.inner.multiple), leaf('normal-type', tuplet.inner.base)]),
      event.stem && leaf('stem', event.stem),
      staff !== undefined && leaf('staff', staff),
      ...(lead ? beams : []),
      writeNotations(ctx, w, tieStop, tieStart, lead),
    ];
    return el('note', { id: note?.id ?? event.id }, children);
  });
}

function writeNotations(ctx: PartContext, w: Written, tieStop: boolean, tieStart: boolean, lead: boolean): string | undefined {
  const { event } = w;
  const articulations = lead ? (event.articulations ?? []).filter((a): a is Exclude<Articulation, 'fermata'> => a !== 'fermata') : [];
  const bracket = w.tuplet?.tuplet.bracket;
  const children: Child[] = [
    tieStop && leaf('tied', undefined, { type: 'stop' }),
    tieStart && leaf('tied', undefined, { type: 'start' }),
    ...(lead ? (ctx.slurs.get(event.id) ?? []).map((s) => leaf('slur', undefined, { type: s.type, number: s.number, placement: s.placement })) : []),
    lead && w.tuplet?.first && leaf('tuplet', undefined, { type: 'start', bracket: bracket === undefined ? undefined : bracket ? 'yes' : 'no' }),
    lead && w.tuplet?.last && leaf('tuplet', undefined, { type: 'stop' }),
    articulations.length > 0 && el('articulations', undefined, articulations.map((a) => leaf(ARTICULATION_XML[a]))),
    lead && event.articulations?.includes('fermata') && leaf('fermata'),
  ];
  return children.some(Boolean) ? el('notations', undefined, children) : undefined;
}

/**
 * Part directions per measure index, each written before the first staff-1
 * voice-1 event at or after its tick. A wedge also places its stop at
 * `endTick` in its end measure.
 */
function placedDirections(doc: Document, part: Part): Map<number, Placed[]> {
  const placed = new Map<number, Placed[]>();
  const put = (index: number, item: Placed) => placed.set(index, [...(placed.get(index) ?? []), item]);
  const spans: { id: string; from: number; to: number }[] = [];
  const endOf = (d: Extract<Direction, { kind: 'wedge' }>, index: number) => {
    const end = d.endMeasureId === undefined ? index : measureIndex(doc, d.endMeasureId);
    return end < index ? index : end;
  };
  // Positions comparable across bars: bar index scaled past any bar's ticks.
  part.measures.forEach((pm, index) => pm.directions.forEach((d) => {
    if (d.kind === 'wedge') spans.push({ id: d.id, from: index * 1e6 + d.anchor.tick, to: endOf(d, index) * 1e6 + d.endTick });
  }));
  const wedges = allocateNumbers(spans);
  part.measures.forEach((pm, index) => pm.directions.forEach((d) => {
    put(index, { tick: d.anchor.tick, write: (offset) => writeDirection(part, d, offset, wedges.get(d.id)) });
    if (d.kind === 'wedge') {
      put(endOf(d, index), { tick: d.endTick, write: (offset) => writeDirection(part, d, offset, wedges.get(d.id), true) });
    }
  }));
  return placed;
}

function writeDirection(part: Part, d: Direction, offset: number, wedgeNumber?: number, wedgeStop = false): string {
  const shift = !wedgeStop && d.offset ? { 'relative-x': d.offset.x * 10, 'relative-y': d.offset.y * 10 } : {};
  let type: string;
  let sound: string | undefined;
  if (d.kind === 'dynamic') {
    type = el('dynamics', shift, [leaf(d.value)]);
    sound = leaf('sound', undefined, { dynamics: DYNAMIC_SOUND[d.value] });
  } else if (d.kind === 'wedge') {
    type = leaf('wedge', undefined, { type: wedgeStop ? 'stop' : d.shape === 'cresc' ? 'crescendo' : 'diminuendo', number: wedgeNumber, ...shift });
  } else {
    const style = d.style === 'tempo' ? { 'font-weight': 'bold' } : d.style === 'expression' ? { 'font-style': 'italic' } : {};
    type = leaf('words', d.text, { ...style, ...shift });
  }
  return el('direction', { placement: d.placement }, [
    el('direction-type', undefined, [type]),
    offset !== 0 && leaf('offset', offset),
    part.staves === 2 && leaf('staff', d.anchor.staff),
    sound,
  ]);
}
