import { measureTicks, type Duration } from '../../model/durations';
import { effectiveTime, eventStarts, measureIndex, sequenceFor } from '../../model/query';
import type { Document } from '../../model/schema';
import { clampCursor } from '../cursor-clamp';
import { TICK_EPSILON } from '../sequence-edit';
import type { Command, Cursor, Editable } from '../types';

type Place = Pick<Cursor, 'measureId' | 'tick'>;

/** Event starts of the cursor's (staff, voice) sequence in bar `index`. */
function startsIn(doc: Document, cursor: Cursor, index: number): { id: string; tick: number }[] {
  const pm = doc.parts.find((p) => p.id === cursor.partId)?.measures[index];
  const seq = pm && sequenceFor(pm, cursor.staff, cursor.voice);
  return seq ? eventStarts(seq, measureTicks(effectiveTime(doc, index))).map((s) => ({ id: s.event.id, tick: s.tick })) : [];
}

/** The previous/next event start in the cursor's sequence, crossing into the adjacent bar; `cursor` when there is none. */
function stepEvent(doc: Document, cursor: Cursor, dir: 1 | -1): Place {
  const index = measureIndex(doc, cursor.measureId);
  if (index < 0) return cursor;
  const ticks = startsIn(doc, cursor, index).map((s) => s.tick);
  const within = dir > 0 ? ticks.find((t) => t > cursor.tick + TICK_EPSILON) : ticks.filter((t) => t < cursor.tick - TICK_EPSILON).at(-1);
  if (within !== undefined) return { measureId: cursor.measureId, tick: within };
  const other = doc.global.measures[index + dir];
  if (!other) return cursor;
  const there = startsIn(doc, cursor, index + dir).map((s) => s.tick);
  return { measureId: other.id, tick: (dir > 0 ? there[0] : there.at(-1)) ?? 0 };
}

function stepMeasure(doc: Document, cursor: Cursor, dir: 1 | -1): Place {
  const other = doc.global.measures[measureIndex(doc, cursor.measureId) + dir];
  return other ? { measureId: other.id, tick: 0 } : cursor;
}

function move(draft: Editable, by: 'event' | 'measure', delta: number): void {
  const doc = draft.document;
  let cursor: Cursor = { ...draft.cursor };
  for (let i = 0; i < Math.abs(delta); i++) {
    const dir = delta > 0 ? 1 : -1;
    cursor = { ...cursor, ...(by === 'event' ? stepEvent(doc, cursor, dir) : stepMeasure(doc, cursor, dir)) };
  }
  cursor = clampCursor(doc, cursor);
  if (cursor.measureId !== draft.cursor.measureId) draft.cursor.measureId = cursor.measureId;
  if (cursor.tick !== draft.cursor.tick) draft.cursor.tick = cursor.tick;
}

/** The id of the event starting at the cursor in its sequence, if any. */
export function eventAtCursor(doc: Document, cursor: Cursor): string | undefined {
  const index = measureIndex(doc, cursor.measureId);
  if (index < 0) return undefined;
  return startsIn(doc, cursor, index).find((s) => Math.abs(s.tick - cursor.tick) < TICK_EPSILON)?.id;
}

/**
 * Ids of up to `count` events before the cursor in its (staff, voice), nearest first, walking back
 * across bars.
 */
export function eventsBeforeCursor(doc: Document, cursor: Cursor, count: number): string[] {
  const out: string[] = [];
  for (let index = measureIndex(doc, cursor.measureId); index >= 0 && out.length < count; index--) {
    const starts = startsIn(doc, cursor, index);
    const before = index === measureIndex(doc, cursor.measureId) ? starts.filter((s) => s.tick < cursor.tick - TICK_EPSILON) : starts;
    for (let i = before.length - 1; i >= 0 && out.length < count; i--) out.push(before[i].id);
  }
  return out;
}

/** Cursor-only; dispatch with `{ record: false }`. By event: to the previous/next event start; by measure: tick 0 of the adjacent bar. */
export const moveCursor: Command<{ by: 'event' | 'measure'; delta: number }> = {
  label: 'Move cursor',
  run: (draft, { by, delta }) => move(draft, by, delta),
};

/** Moves the cursor by event and adds the event it lands on to the selection; dispatch with `{ record: false }`. */
export const extendSelection: Command<{ delta: number }> = {
  label: 'Extend selection',
  run: (draft, { delta }) => {
    move(draft, 'event', delta);
    const id = eventAtCursor(draft.document, draft.cursor);
    if (id && !draft.selection.ids.includes(id)) draft.selection.ids.push(id);
  },
};

/** Cursor-only; dispatch with `{ record: false }`. */
export const setEntryMode: Command<{ mode: Cursor['mode'] }> = {
  label: 'Set entry mode',
  run: (draft, { mode }) => {
    if (draft.cursor.mode !== mode) draft.cursor.mode = mode;
  },
};

/** Cursor-only; dispatch with `{ record: false }`. */
export const setCursorDuration: Command<{ duration: Duration }> = {
  label: 'Set entry duration',
  run: (draft, { duration }) => {
    const d = draft.cursor.duration;
    if (d.base !== duration.base || d.dots !== duration.dots) draft.cursor.duration = { ...duration };
  },
};
