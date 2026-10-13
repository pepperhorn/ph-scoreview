import { current, isDraft } from 'immer';
import { BASE_TICKS, durationTicks, measureTicks, ticksToDurations } from '../model/durations';
import { fullMeasureRest, restEvent } from '../model/create';
import { newId } from '../model/ids';
import { effectiveTime, eventStarts, locateEvent, measureIndex, sequenceFor } from '../model/query';
import type { Document, Event, Note, Part, PartMeasure, Sequence, Time, Tuplet } from '../model/schema';
import { pruneDanglingReferences, pruneSelection } from './prune';
import { refillMeasure, splitEvent } from './refill';
import type { Editable } from './types';

/** Tuplet-scaled ticks can be fractional; compare positions within this tolerance. */
export const TICK_EPSILON = 1e-6;

/** A sequence with everything needed to edit it. */
export type SeqContext = { part: Part; measureIndex: number; pm: PartMeasure; seq: Sequence; time: Time; barTicks: number };
/** An event in its sequence: start tick and (tuplet-scaled) length. */
export type EventAt = SeqContext & { event: Event; tick: number; ticks: number; position: number; contentIndex: number; inTuplet: boolean };

export function contextAt(doc: Document, part: Part, index: number, seq: Sequence): SeqContext {
  const time = effectiveTime(doc, index);
  return { part, measureIndex: index, pm: part.measures[index], seq, time, barTicks: measureTicks(time) };
}

/** The (staff, voice) sequence of `partId` in global measure `measureId`, if any. */
export function findSequence(doc: Document, partId: string, measureId: string, staff: number, voice: number): SeqContext | undefined {
  const part = doc.parts.find((p) => p.id === partId);
  const index = measureIndex(doc, measureId);
  const seq = part && index >= 0 ? sequenceFor(part.measures[index], staff, voice) : undefined;
  return part && seq ? contextAt(doc, part, index, seq) : undefined;
}

export function findEvent(doc: Document, eventId: string): EventAt | undefined {
  const hit = locateEvent(doc, eventId);
  if (!hit) return undefined;
  const part = doc.parts[hit.partIndex];
  const ctx = contextAt(doc, part, hit.measureIndex, part.measures[hit.measureIndex].sequences[hit.sequenceIndex]);
  const starts = eventStarts(ctx.seq, ctx.barTicks);
  const position = starts.findIndex((s) => s.event.id === eventId);
  return { ...ctx, event: hit.event, tick: hit.tick, ticks: starts[position].ticks, position, contentIndex: hit.contentIndex, inTuplet: ctx.seq.content[hit.contentIndex].type === 'tuplet' };
}

export function findNote(doc: Document, noteId: string): (EventAt & { note: Note }) | undefined {
  for (const part of doc.parts)
    for (let mi = 0; mi < part.measures.length; mi++)
      for (const seq of part.measures[mi].sequences)
        for (const { event } of eventStarts(seq)) {
          const note = event.notes?.find((n) => n.id === noteId);
          if (note) return { ...findEvent(doc, event.id)!, note };
        }
  return undefined;
}

/** The event after `at` in its voice: next in the bar, else the first of the next bar's (staff, voice) sequence. */
export function nextEvent(at: EventAt): Event | undefined {
  const starts = eventStarts(at.seq, at.barTicks);
  if (at.position + 1 < starts.length) return starts[at.position + 1].event;
  const following = at.part.measures[at.measureIndex + 1];
  const seq = following && sequenceFor(following, at.seq.staff, at.seq.voice);
  return seq ? eventStarts(seq)[0]?.event : undefined;
}

export const restsFor = (ticks: number): Event[] => ticksToDurations(Math.round(ticks)).map(restEvent);

function expressible(ticks: number): boolean {
  if (Math.abs(ticks - Math.round(ticks)) > TICK_EPSILON) return false;
  try {
    ticksToDurations(Math.round(ticks));
    return true;
  } catch {
    return false;
  }
}

/** A plain deep copy of an event (drafts included); `freshIds` gives the event and its notes new ids. */
export function copyEvent(event: Event, freshIds: boolean): Event {
  const copy: Event = structuredClone(isDraft(event) ? current(event) : event);
  if (freshIds) {
    copy.id = newId();
    for (const note of copy.notes ?? []) note.id = newId();
  }
  return copy;
}

function itemTicks(item: Event | Tuplet, barTicks: number): number {
  if (item.type === 'tuplet') return item.inner.multiple * BASE_TICKS[item.inner.base];
  return item.fullMeasure ? barTicks : durationTicks(item.duration);
}

/**
 * Overwrites `[tick, tick + length)` of `seq` with `inserted`. Items inside the range go; a note
 * starting before it keeps its head (tied pieces, ids kept), one running past it keeps its tail
 * (a note that spans the whole range keeps both, the tail with new ids). Overlapped tuplets and
 * rests leave plain rests. Returns false, changing nothing, when a remainder cannot be written
 * as durations (e.g. a cut inside a tuplet).
 */
export function replaceRange(seq: Sequence, barTicks: number, tick: number, length: number, inserted: Event[]): boolean {
  const end = tick + length;
  let at = 0;
  const spans = seq.content.map((item) => {
    const from = at;
    at += itemTicks(item, barTicks);
    return { item, from, to: at };
  });
  const overlapping = spans.filter((s) => s.to > tick + TICK_EPSILON && s.from < end - TICK_EPSILON);
  for (const s of overlapping) {
    if (s.from < tick - TICK_EPSILON && !expressible(tick - s.from)) return false;
    if (s.to > end + TICK_EPSILON && !expressible(s.to - end)) return false;
  }
  const before = spans.filter((s) => s.to <= tick + TICK_EPSILON).map((s) => s.item);
  const after = spans.filter((s) => s.from >= end - TICK_EPSILON && s.to > tick + TICK_EPSILON).map((s) => s.item);
  const heads: (Event | Tuplet)[] = [];
  const tails: (Event | Tuplet)[] = [];
  for (const { item, from, to } of overlapping) {
    const plainNote = item.type === 'event' && !item.rest;
    if (to > end + TICK_EPSILON) {
      if (!plainNote) tails.push(...restsFor(to - end));
      else tails.push(...splitEvent(from < tick - TICK_EPSILON ? copyEvent(item, true) : item, to - end, true));
    }
    if (from < tick - TICK_EPSILON) {
      if (!plainNote) heads.push(...restsFor(tick - from));
      else heads.push(...splitEvent(item, tick - from, false));
    }
  }
  seq.content = [...before, ...heads, ...inserted, ...tails, ...after];
  return true;
}

/** A sequence of nothing but plain rests becomes one full-measure rest. */
export function collapseRests(seq: Sequence): void {
  const onlyRests = seq.content.every((item) => item.type === 'event' && item.rest);
  const [first] = seq.content;
  if (!onlyRests || !first || (seq.content.length === 1 && first.type === 'event' && first.fullMeasure)) return;
  seq.content = [fullMeasureRest()];
}

/** Runs of adjacent plain rests are rewritten as the fewest rests; the first keeps its id. */
export function mergeRests(seq: Sequence, barTicks: number): void {
  const out: (Event | Tuplet)[] = [];
  let run: Event[] = [];
  const flush = () => {
    if (run.length > 1) {
      const merged = restsFor(run.reduce((sum, e) => sum + itemTicks(e, barTicks), 0));
      merged[0].id = run[0].id;
      out.push(...merged);
    } else out.push(...run);
    run = [];
  };
  for (const item of seq.content) {
    if (item.type === 'event' && item.rest && !item.fullMeasure && !item.slurs) run.push(item);
    else {
      flush();
      out.push(item);
    }
  }
  flush();
  if (out.length !== seq.content.length) seq.content = out;
}

/** Common tail of every content edit: refill the bar, collapse an all-rest sequence, drop dangling references. */
export function settle(draft: Editable, ctx: SeqContext): void {
  refillMeasure(draft.document, ctx.measureIndex);
  collapseRests(ctx.seq);
  pruneDanglingReferences(draft.document);
  pruneSelection(draft);
}
