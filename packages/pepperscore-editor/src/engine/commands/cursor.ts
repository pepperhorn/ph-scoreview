import { measureTicks, type Duration } from '../../model/durations';
import { effectiveTime, eventStarts, measureIndex, sequenceFor } from '../../model/query';
import type { Document } from '../../model/schema';
import { clampCursor } from '../cursor-clamp';
import { findNote, TICK_EPSILON } from '../sequence-edit';
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
  if (draft.cursor.entered !== undefined) delete draft.cursor.entered;
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

/**
 * Replaces the selection with the event at the cursor (none: empty) in select mode; clears it in entry
 * mode, where commands target the just-entered event, else the event at the cursor. Arrows and Escape use it so a selection
 * never outlives the cursor leaving it.
 */
function selectAtCursor(draft: Editable): void {
  const id = draft.cursor.mode === 'select' ? eventAtCursor(draft.document, draft.cursor) : undefined;
  const ids = id ? [id] : [];
  if (ids.length !== draft.selection.ids.length || ids.some((x, i) => x !== draft.selection.ids[i])) draft.selection.ids = ids;
}

/** Cursor and selection only; never recorded. By event: to the previous/next event start; by measure: tick 0 of the adjacent bar. The selection becomes the event at the new cursor (see `selectAtCursor`). */
export const moveCursor: Command<{ by: 'event' | 'measure'; delta: number }> = {
  label: 'Move cursor',
  record: false,
  run: (draft, { by, delta }) => {
    move(draft, by, delta);
    selectAtCursor(draft);
  },
};

/**
 * Escape: select mode. Leaving entry mode right after entering a note selects that note (the event before the
 * cursor), so "enter, Esc, fix it" acts on it; otherwise, and always in select mode, the selection is cleared.
 * Cursor and selection only; never recorded.
 */
export const escapeToSelect: Command<Record<string, never>> = {
  label: 'Select mode',
  record: false,
  run: (draft) => {
    const last = draft.cursor.mode === 'enter' && draft.cursor.entered !== undefined ? eventsBeforeCursor(draft.document, draft.cursor, 1)[0] : undefined;
    const ids = last ? [last] : [];
    if (draft.cursor.mode !== 'select') draft.cursor.mode = 'select';
    if (draft.cursor.entered !== undefined) delete draft.cursor.entered;
    if (ids.length !== draft.selection.ids.length || ids.some((x, i) => x !== draft.selection.ids[i])) draft.selection.ids = ids;
  },
};

/** Event ids of the cursor's (part, staff, voice) in score order, across bars. */
function voiceEvents(doc: Document, cursor: Cursor): string[] {
  return doc.global.measures.flatMap((_, index) => startsIn(doc, cursor, index).map((s) => s.id));
}

/**
 * Shift+arrow: moves the cursor by event and selects the contiguous run from the anchor to the event it
 * lands on (the head). The anchor is the first selected event (a selected note counts as its event)
 * when it is in the cursor's voice, else the event at the cursor before the move (none there: the event before
 * the cursor); it stays first in
 * `selection.ids`, so moving back towards it shrinks the run. Never recorded.
 */
export const extendSelection: Command<{ delta: number }> = {
  label: 'Extend selection',
  record: false,
  run: (draft, { delta }) => {
    const doc = draft.document;
    const order = voiceEvents(doc, draft.cursor);
    const first = draft.selection.ids[0];
    const firstEvent = first === undefined ? undefined : order.includes(first) ? first : findNote(doc, first)?.event.id;
    const anchor = firstEvent && order.includes(firstEvent) ? firstEvent : eventAtCursor(doc, draft.cursor) ?? eventsBeforeCursor(doc, draft.cursor, 1)[0];
    move(draft, 'event', delta);
    const head = eventAtCursor(doc, draft.cursor);
    if (!anchor || !head) return;
    const [a, h] = [order.indexOf(anchor), order.indexOf(head)];
    const run = a <= h ? order.slice(a, h + 1) : [anchor, ...order.slice(h, a)];
    if (run.length !== draft.selection.ids.length || run.some((x, i) => x !== draft.selection.ids[i])) draft.selection.ids = run;
  },
};

/** Cursor-only; never recorded. */
export const setEntryMode: Command<{ mode: Cursor['mode'] }> = {
  label: 'Set entry mode',
  record: false,
  run: (draft, { mode }) => {
    if (draft.cursor.mode !== mode) draft.cursor.mode = mode;
    if (draft.cursor.entered !== undefined) delete draft.cursor.entered;
  },
};

/** "Add to chord" on or off. Cursor-only; never recorded. */
export const setChordMode: Command<{ on: boolean }> = {
  label: 'Add to chord',
  record: false,
  run: (draft, { on }) => {
    if (on) draft.cursor.chord = true;
    else if (draft.cursor.chord !== undefined) delete draft.cursor.chord;
  },
};

/** Cursor-only; never recorded. */
export const setCursorDuration: Command<{ duration: Duration }> = {
  label: 'Set entry duration',
  record: false,
  run: (draft, { duration }) => {
    const d = draft.cursor.duration;
    if (d.base !== duration.base || d.dots !== duration.dots) draft.cursor.duration = { ...duration };
  },
};
