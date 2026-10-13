import type { PepperScoreHighlight } from 'pepperscore';
import { eventAtCursor } from '../engine/commands/cursor';
import { findEvent, findNote } from '../engine/sequence-edit';
import type { Cursor, Selection } from '../engine/types';
import { measureIndex } from '../model/query';
import type { Document, Event } from '../model/schema';

/** The MusicXML ids the viewer knows an event by: its notes', or its own for a rest. */
const idsOf = (event: Event): string[] => (event.notes?.length ? event.notes.map((n) => n.id) : [event.id]);

/**
 * Viewer highlights for the cursor and selection: the event under the cursor gets `ps-cursor`
 * (else the cursor's measure gets `ps-cursor-measure`); selected events and notes get `ps-selection`.
 */
export function editorHighlights(doc: Document, cursor: Cursor, selection: Selection): PepperScoreHighlight[] {
  const out: PepperScoreHighlight[] = [];
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
