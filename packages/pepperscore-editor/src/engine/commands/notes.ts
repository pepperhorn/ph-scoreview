import { BASE_TICKS, DURATION_BASES, durationTicks, measureTicks, type Duration } from '../../model/durations';
import { restEvent } from '../../model/create';
import { newId } from '../../model/ids';
import { effectiveClef, effectiveTime, eventStarts, measureIndex, sequenceFor } from '../../model/query';
import type { Articulation, Clef, Event, Part, Pitch, Sequence, Tuplet } from '../../model/schema';
import { applyAutoBeam, splitBeamsAtRests } from '../autobeam';
import { splitEvent } from '../refill';
import {
  contextAt, copyEvent, findEvent, findNote, mergeRests, nextEvent, replaceRange, restsFor, settle, TICK_EPSILON, type EventAt, type SeqContext,
} from '../sequence-edit';
import type { Command, Editable } from '../types';
import { insertMeasure } from './score';

/** The middle staff line, the pitch a rest turns into when there is no last entered pitch. */
const MIDDLE_LINE: Record<Clef, Pitch> = {
  treble: { step: 'B', octave: 4, alter: 0 },
  bass: { step: 'D', octave: 3, alter: 0 },
  alto: { step: 'C', octave: 4, alter: 0 },
  tenor: { step: 'A', octave: 3, alter: 0 },
  percussion: { step: 'B', octave: 4, alter: 0 },
  treble8vb: { step: 'B', octave: 3, alter: 0 },
};

const sameDuration = (a: Duration, b: Duration) => a.base === b.base && a.dots === b.dots;

/** `event` cut to `length` ticks: itself when it fits, else tied pieces. */
const fitted = (event: Event, length: number): Event[] =>
  length < durationTicks(event.duration) - TICK_EPSILON ? splitEvent(event, length, false) : [event];

/**
 * Enters a note (or a rest) at the cursor, overwriting what sounds in `[tick, tick + duration)`
 * and clamped to the bar end, then auto-beams the sequence and advances the cursor (into the
 * next bar at the bar end, appending one after the last bar).
 */
export const enterEvent: Command<{ pitch?: Pitch; rest?: boolean }> = {
  label: 'Enter note',
  run: (draft, { pitch, rest }) => {
    const doc = draft.document;
    const cursor = draft.cursor;
    const part = doc.parts.find((p) => p.id === cursor.partId);
    const index = measureIndex(doc, cursor.measureId);
    if (!part || index < 0 || (!rest && !pitch)) return;
    const length = Math.min(durationTicks(cursor.duration), measureTicks(effectiveTime(doc, index)) - cursor.tick);
    if (length <= TICK_EPSILON || cursor.tick < 0) return;
    const event: Event = rest
      ? { id: newId(), type: 'event', duration: { ...cursor.duration }, rest: true }
      : { id: newId(), type: 'event', duration: { ...cursor.duration }, notes: [{ id: newId(), pitch: { ...pitch! } }] };
    const pm = part.measures[index];
    const existing = sequenceFor(pm, cursor.staff, cursor.voice);
    // A new voice is built on a scratch bar of rests so an infeasible entry creates nothing.
    const target = existing ?? { id: newId(), staff: cursor.staff, voice: cursor.voice, content: restsFor(measureTicks(effectiveTime(doc, index))) };
    if (!replaceRange(target, measureTicks(effectiveTime(doc, index)), cursor.tick, length, fitted(event, length))) return;
    if (!existing) pm.sequences.push(target);
    const ctx = contextAt(doc, part, index, sequenceFor(pm, cursor.staff, cursor.voice)!);
    settle(draft, ctx);
    applyAutoBeam(ctx.pm, ctx.seq, ctx.time);

    if (!rest) {
      cursor.lastPitch = { ...pitch! };
      cursor.lastPitchAt = { partId: part.id, staff: cursor.staff };
    }
    cursor.entered = event.id;
    const next = cursor.tick + length;
    if (next < ctx.barTicks - TICK_EPSILON) cursor.tick = next;
    else if (index + 1 < doc.global.measures.length) {
      cursor.measureId = doc.global.measures[index + 1].id;
      cursor.tick = 0;
    } else insertMeasure.run(draft, { afterMeasureId: cursor.measureId });
  },
};

/** Gives `eventId` a new duration with enterEvent's overwrite semantics; shrinking leaves rests. */
function resize(draft: Editable, eventId: string, duration: (current: Duration) => Duration): void {
  const at = findEvent(draft.document, eventId);
  if (!at || at.inTuplet || at.event.fullMeasure || at.event.grace) return;
  const wanted = duration(at.event.duration);
  if (sameDuration(wanted, at.event.duration)) return;
  const length = Math.min(durationTicks(wanted), at.barTicks - at.tick);
  if (length < durationTicks(wanted) && Math.abs(length - at.ticks) < TICK_EPSILON) return; // clamped back to what it is
  const replacement = copyEvent(at.event, false);
  replacement.duration = { ...wanted };
  const work: Sequence = { id: at.seq.id, staff: at.seq.staff, voice: at.seq.voice, content: [...at.seq.content] };
  work.content.splice(at.contentIndex, 1, ...restsFor(at.ticks));
  if (!replaceRange(work, at.barTicks, at.tick, length, fitted(replacement, length))) return;
  at.seq.content = work.content;
  settle(draft, at);
  applyAutoBeam(at.pm, at.seq, at.time);
}

export const setDuration: Command<{ eventId: string; duration: Duration }> = {
  label: 'Set duration',
  run: (draft, { eventId, duration }) => resize(draft, eventId, () => duration),
};

export const toggleDot: Command<{ eventId: string }> = {
  label: 'Toggle dot',
  run: (draft, { eventId }) => resize(draft, eventId, (d) => ({ base: d.base, dots: d.dots ? 0 : 1 })),
};

/** The event entry mode just entered, while the cursor sits right after it (across a barline too). */
export function justEntered(draft: Editable): EventAt | undefined {
  const { cursor, document: doc } = draft;
  const at = cursor.entered ? findEvent(doc, cursor.entered) : undefined;
  if (!at || at.part.id !== cursor.partId || at.seq.staff !== cursor.staff || at.seq.voice !== cursor.voice) return undefined;
  const end = at.tick + at.ticks;
  const here = measureIndex(doc, cursor.measureId);
  if (here === at.measureIndex) return Math.abs(end - cursor.tick) < TICK_EPSILON ? at : undefined;
  return here === at.measureIndex + 1 && cursor.tick < TICK_EPSILON && end >= at.barTicks - TICK_EPSILON ? at : undefined;
}

/**
 * Entry-mode `.`: with a dotted entry duration, turns its dot off. Otherwise, right after entering an
 * event, toggles that event's dot and moves the cursor to its new end (the entry duration is unchanged,
 * so `4 c . d` is a dotted C then a quarter D); anywhere else, dots the entry duration. Record it only when
 * it dots an event (`entryDotChangesScore`); the other cases are cursor-only.
 */
export const entryDotChangesScore = (state: Editable): boolean => !state.cursor.duration.dots && justEntered(state) !== undefined;

export const entryDot: Command<Record<string, never>> = {
  label: 'Toggle dot',
  run: (draft) => {
    const cursor = draft.cursor;
    if (cursor.duration.dots) {
      cursor.duration = { base: cursor.duration.base, dots: 0 };
      return;
    }
    const entered = justEntered(draft);
    if (!entered) {
      cursor.duration = { base: cursor.duration.base, dots: 1 };
      return;
    }
    const id = entered.event.id;
    resize(draft, id, (d) => ({ base: d.base, dots: d.dots ? 0 : 1 }));
    const at = findEvent(draft.document, id);
    if (!at) return;
    const end = at.tick + at.ticks;
    const next = draft.document.global.measures[at.measureIndex + 1];
    if (end >= at.barTicks - TICK_EPSILON && next) {
      cursor.measureId = next.id;
      cursor.tick = 0;
    } else {
      cursor.measureId = draft.document.global.measures[at.measureIndex].id;
      cursor.tick = Math.min(end, at.barTicks);
    }
  },
};

/**
 * The pitch entry on `staff` of `part` at bar `index` aims near: the last entered pitch when it was entered on that
 * part and staff, else the middle line of the staff's clef there (so a first treble G is G4, a bass G is G3).
 */
export function referencePitch(state: Pick<Editable, 'cursor'>, part: Part, index: number, staff: number): Pitch {
  const { lastPitch, lastPitchAt } = state.cursor;
  if (lastPitch && (!lastPitchAt || (lastPitchAt.partId === part.id && lastPitchAt.staff === staff))) return lastPitch;
  return MIDDLE_LINE[effectiveClef(part, index, staff)];
}

/** The pitch entry at the cursor aims near (see `referencePitch`); the middle line of treble when the cursor is lost. */
export function cursorReferencePitch(state: Pick<Editable, 'document' | 'cursor'>): Pitch {
  const part = state.document.parts.find((p) => p.id === state.cursor.partId);
  if (!part) return state.cursor.lastPitch ?? MIDDLE_LINE.treble;
  return referencePitch(state, part, Math.max(measureIndex(state.document, state.cursor.measureId), 0), state.cursor.staff);
}

/** The pitch a rest turns into by default: the last pitch entered on its staff, else the middle line of the staff's clef. */
export function restPitch(draft: Editable, at: EventAt): Pitch {
  return referencePitch(draft, at.part, at.measureIndex, at.seq.staff);
}

/**
 * Note → rest (its notes, slurs and articulations go); rest → note at `pitch`, else `restPitch` (the last entered
 * pitch or the middle line).
 */
export const toggleRest: Command<{ eventId: string; pitch?: Pitch }> = {
  label: 'Toggle rest',
  run: (draft, { eventId, pitch: given }) => {
    const at = findEvent(draft.document, eventId);
    if (!at || at.event.grace) return;
    const event = at.event;
    if (!event.rest) {
      for (const key of ['notes', 'slurs', 'articulations', 'stem'] as const) delete event[key];
      event.rest = true;
      splitBeamsAtRests(at.pm, at.seq, at.barTicks);
      settle(draft, at);
      return;
    }
    const pitch = given ?? restPitch(draft, at);
    delete event.rest;
    event.notes = [{ id: newId(), pitch: { ...pitch } }];
    if (event.fullMeasure) {
      delete event.fullMeasure;
      at.seq.content.splice(at.contentIndex, 1, ...splitEvent(event, at.barTicks, false));
    }
    settle(draft, at);
    applyAutoBeam(at.pm, at.seq, at.time);
  },
};

/** Turns events into rests (grace events are removed) and merges adjacent rests. */
export const deleteEvents: Command<{ ids: string[] }> = {
  label: 'Delete',
  run: (draft, { ids }) => {
    const touched = new Map<string, SeqContext>();
    for (const id of ids) {
      const at = findEvent(draft.document, id);
      if (!at || at.event.rest) continue;
      touched.set(at.seq.id, at);
      if (at.event.grace) {
        removeGrace(at);
        continue;
      }
      for (const key of ['notes', 'slurs', 'articulations', 'stem'] as const) delete at.event[key];
      at.event.rest = true;
    }
    for (const ctx of touched.values()) {
      ctx.seq.content = ctx.seq.content.flatMap((item) =>
        item.type === 'tuplet' && item.content.every((e) => e.rest || e.grace) ? restsFor(item.inner.multiple * BASE_TICKS[item.inner.base]) : [item]);
      splitBeamsAtRests(ctx.pm, ctx.seq, ctx.barTicks);
      mergeRests(ctx.seq, ctx.barTicks);
      settle(draft, ctx);
    }
  },
};

function removeGrace(at: EventAt): void {
  const item = at.seq.content[at.contentIndex];
  if (item.type === 'tuplet') item.content = item.content.filter((e) => e.id !== at.event.id);
  else at.seq.content.splice(at.contentIndex, 1);
}

/**
 * Replaces an undotted event by a tuplet of `multiple` events spanning it: 3 in the time of 2
 * one step shorter, 5/6/7 in the time of 4 two steps shorter. The first member is the original
 * event (id and notes kept); the others are rests.
 */
export const makeTuplet: Command<{ eventId: string; multiple: 3 | 5 | 6 | 7 }> = {
  label: 'Make tuplet',
  run: (draft, { eventId, multiple }) => {
    const at = findEvent(draft.document, eventId);
    if (!at || at.inTuplet || at.event.fullMeasure || at.event.grace || at.event.duration.dots) return;
    const index = DURATION_BASES.indexOf(at.event.duration.base) + (multiple === 3 ? 1 : 2);
    if (![3, 5, 6, 7].includes(multiple) || index >= DURATION_BASES.length) return;
    const base = DURATION_BASES[index];
    const first = copyEvent(at.event, false);
    first.duration = { base, dots: 0 };
    const rests = Array.from({ length: multiple - 1 }, () => restEvent({ base, dots: 0 }));
    const tuplet: Tuplet = { id: newId(), type: 'tuplet', outer: { multiple, base }, inner: { multiple: multiple === 3 ? 2 : 4, base }, content: [first, ...rests] };
    at.seq.content.splice(at.contentIndex, 1, tuplet);
    if (at.pm.beams.some((b) => b.events.includes(eventId))) at.pm.beams = at.pm.beams.filter((b) => !b.events.includes(eventId));
    settle(draft, at);
  },
};

export const toggleArticulation: Command<{ eventId: string; articulation: Articulation }> = {
  label: 'Toggle articulation',
  run: (draft, { eventId, articulation }) => {
    const at = findEvent(draft.document, eventId);
    if (!at) return;
    const event = at.event;
    if (!event.articulations?.includes(articulation)) event.articulations = [...(event.articulations ?? []), articulation];
    else if (event.articulations.length > 1) event.articulations = event.articulations.filter((a) => a !== articulation);
    else delete event.articulations;
  },
};

/** Ties a note to the equal pitch of the next event in its voice (across the barline too), or unties it; no match is a no-op. */
export const toggleTie: Command<{ noteId: string }> = {
  label: 'Toggle tie',
  run: (draft, { noteId }) => {
    const at = findNote(draft.document, noteId);
    if (!at) return;
    if (at.note.tie) {
      delete at.note.tie;
      return;
    }
    const { step, octave, alter } = at.note.pitch;
    const target = nextEvent(draft.document, at)?.notes?.find((n) => n.pitch.step === step && n.pitch.octave === octave && n.pitch.alter === alter);
    if (target) at.note.tie = { target: target.id };
  },
};

/** Slurs two events of one part, starting at the earlier; a duplicate is a no-op. */
export const addSlur: Command<{ fromEventId: string; toEventId: string }> = {
  label: 'Add slur',
  run: (draft, { fromEventId, toEventId }) => {
    const a = findEvent(draft.document, fromEventId);
    const b = findEvent(draft.document, toEventId);
    if (!a || !b || a.part !== b.part || fromEventId === toEventId) return;
    const [from, to] = a.measureIndex < b.measureIndex || (a.measureIndex === b.measureIndex && a.tick <= b.tick) ? [a, b] : [b, a];
    if (from.event.slurs?.some((s) => s.target === to.event.id)) return;
    from.event.slurs = [...(from.event.slurs ?? []), { id: newId(), target: to.event.id }];
  },
};

export const removeSlur: Command<{ slurId: string }> = {
  label: 'Remove slur',
  run: (draft, { slurId }) => {
    for (const part of draft.document.parts)
      for (const [mi, pm] of part.measures.entries())
        for (const seq of pm.sequences)
          for (const { event } of eventStarts(seq, measureTicks(effectiveTime(draft.document, mi)))) {
            if (!event.slurs?.some((s) => s.id === slurId)) continue;
            if (event.slurs.length > 1) event.slurs = event.slurs.filter((s) => s.id !== slurId);
            else delete event.slurs;
            return;
          }
  },
};
