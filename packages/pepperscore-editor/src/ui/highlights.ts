import type { PepperScoreHighlight } from 'pepperscore';
import { eventAtCursor } from '../engine/commands/cursor';
import { findEvent, findNote } from '../engine/sequence-edit';
import type { ViewResult } from '../engine/layout/apply-layout';
import type { Cursor, Selection } from '../engine/types';
import { measureIndex } from '../model/query';
import type { Document, Event } from '../model/schema';

/** The MusicXML ids the viewer knows an event by: its notes', or its own for a rest. */
const idsOf = (event: Event): string[] => (event.notes?.length ? event.notes.map((n) => n.id) : [event.id]);

/**
 * Viewer highlights for the cursor and selection: the event under the cursor gets `ps-cursor`
 * (else the cursor's measure gets `ps-cursor-measure`); selected events and notes get `ps-selection`;
 * with the active layout's `view`, the notes range fitting or an override moved get `ps-transposed`.
 */
export function editorHighlights(doc: Document, cursor: Cursor, selection: Selection, view?: ViewResult): PepperScoreHighlight[] {
  const out: PepperScoreHighlight[] = [];
  // The view document's notes: a swapped part's events keep their ids there.
  const moved = view ? Object.keys(view.moved).flatMap((id) => { const event = findEvent(view.document, id)?.event; return event ? idsOf(event) : []; }) : [];
  if (moved.length) out.push({ ids: moved, className: 'ps-transposed' });
  const atCursor = eventAtCursor(doc, cursor);
  const event = atCursor ? findEvent(doc, atCursor)?.event : undefined;
  if (event) out.push({ ids: idsOf(event), className: 'ps-cursor' });
  else {
    const index = measureIndex(doc, cursor.measureId);
    if (index >= 0) out.push({ measures: [index], className: 'ps-cursor-measure' });
  }
  const selected = selection.ids.flatMap((id) => {
    const found = findEvent(doc, id)?.event;
    if (found) return idsOf(found);
    return findNote(doc, id) ? [id] : [];
  });
  if (selected.length) out.push({ ids: selected, className: 'ps-selection' });
  return out;
}
