import { eventAtCursor, eventsBeforeCursor } from '../engine/commands/cursor';
import { justEntered } from '../engine/commands/notes';
import { applyAutoBeam } from '../engine/autobeam';
import { findEvent, findNote, findSequence } from '../engine/sequence-edit';
import type { Command, EditorState } from '../engine/types';
import { measureIndex } from '../model/query';
import type { Duration } from '../model/durations';
import type { GlobalMeasure } from '../model/schema';

/** An event id from a selected event or note id. */
function eventIdOf(state: EditorState, id: string): string | undefined {
  const doc = state.document;
  return findEvent(doc, id)?.event.id ?? findNote(doc, id)?.event.id;
}

/**
 * The single selected event; else the event entry mode just entered (the cursor still right after it); else the
 * event the cursor sits on (the one drawn highlighted, after a click or an arrow); else the event before the cursor.
 */
export function targetEvent(state: EditorState): string | undefined {
  if (state.selection.ids.length === 1) {
    const id = eventIdOf(state, state.selection.ids[0]);
    if (id) return id;
  }
  return justEntered(state)?.event.id ?? eventAtCursor(state.document, state.cursor) ?? eventsBeforeCursor(state.document, state.cursor, 1)[0];
}

/** The single selected note, else the top note of the target event. */
export function targetNote(state: EditorState): string | undefined {
  const ids = state.selection.ids;
  if (ids.length === 1 && findNote(state.document, ids[0])) return ids[0];
  const eventId = targetEvent(state);
  return eventId ? findEvent(state.document, eventId)?.event.notes?.at(-1)?.id : undefined;
}

/**
 * The duration the duration buttons light: the target event's in select (Edit) mode, where they resize it; else the
 * entry duration. The same object while neither changes, so it suits a store selector.
 */
export function shownDuration(state: EditorState): Duration {
  const id = state.cursor.mode === 'select' ? targetEvent(state) : undefined;
  return (id && findEvent(state.document, id)?.event.duration) || state.cursor.duration;
}

/** Two selected events in time order, else the two most recent events before the cursor. */
export function slurPair(state: EditorState): [string, string] | undefined {
  const selected = [...new Set(state.selection.ids.map((id) => eventIdOf(state, id)).filter((id): id is string => !!id))];
  if (selected.length === 2) {
    const [a, b] = selected.map((id) => findEvent(state.document, id)!);
    const ordered = a.measureIndex < b.measureIndex || (a.measureIndex === b.measureIndex && a.tick <= b.tick) ? [a, b] : [b, a];
    return [ordered[0].event.id, ordered[1].event.id];
  }
  const recent = eventsBeforeCursor(state.document, state.cursor, 2);
  return recent.length === 2 ? [recent[1], recent[0]] : undefined;
}

type BarlineState = 'regular' | 'double' | 'repeatStart' | 'repeatEnd' | 'final';
const BARLINE_CYCLE: BarlineState[] = ['regular', 'double', 'repeatStart', 'repeatEnd', 'final'];

function barlineState(g: GlobalMeasure): BarlineState {
  if (g.repeatStart) return 'repeatStart';
  if (g.repeatEnd) return 'repeatEnd';
  return g.barline === 'double' || g.barline === 'final' ? g.barline : 'regular';
}

/** Steps a bar through regular → double → repeat start → repeat end → final → regular, as one undo step. */
export const cycleBarline: Command<{ measureId: string }> = {
  label: 'Change barline',
  run: (draft, { measureId }) => {
    const g = draft.document.global.measures[measureIndex(draft.document, measureId)];
    if (!g) return;
    const next = BARLINE_CYCLE[(BARLINE_CYCLE.indexOf(barlineState(g)) + 1) % BARLINE_CYCLE.length];
    delete g.barline;
    delete g.repeatStart;
    delete g.repeatEnd;
    if (next === 'double' || next === 'final') g.barline = next;
    else if (next === 'repeatStart') g.repeatStart = true;
    else if (next === 'repeatEnd') g.repeatEnd = {};
  },
};

/** Restores automatic beaming of one (staff, voice) sequence in a global measure. */
export const autoBeamSequence: Command<{ partId: string; measureId: string; staff: number; voice: number }> = {
  label: 'Set beam grouping',
  run: (draft, { partId, measureId, staff, voice }) => {
    const ctx = findSequence(draft.document, partId, measureId, staff, voice);
    if (ctx) applyAutoBeam(ctx.pm, ctx.seq, ctx.time);
  },
};
