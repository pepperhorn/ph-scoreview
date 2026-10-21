import type { PepperScoreClickInfo } from 'pepperscore';
import type { Cursor } from '../engine/types';
import { measureTicks } from '../model/durations';
import { effectiveTime, eventStarts, locateEvent, noteToEvent, sequenceFor } from '../model/query';
import type { Document } from '../model/schema';
import { visibleStaves } from '../engine/layout/visible-staves';

/**
 * `mode` is the mode a click implies (the phone shell switches to it): a pitched note is for editing (`select`);
 * a rest, or staff space with no note under the tap (past the last note, an empty bar), is for entry (`enter`).
 */
export type ClickTarget = { cursor: Partial<Cursor>; selection: string[]; mode: Cursor['mode'] };

/**
 * The (part, staff) of the viewer's 1-based visible staff index under layout `layoutId` (default the full score):
 * the viewer draws one staff per entry of the layout's visible staves, in order, so a partial-staff layout (only
 * the piano's left hand, say) maps its first drawn staff to that staff, not to the score's first.
 */
export function staffAt(doc: Document, viewerStaff: number, layoutId?: string): { partId: string; staff: number } | undefined {
  const layout = doc.layouts.find((l) => l.id === layoutId) ?? doc.layouts[0];
  return visibleStaves(doc, layout)[viewerStaff - 1];
}

/**
 * Where a click on the engraving puts the cursor. A hit note's `sourceId` is the MusicXML id of its
 * first pitch, which is a model note id (a rest's is its event id): the cursor moves onto that
 * event and selects it. Otherwise a click in a measure moves the cursor to the event start nearest
 * the click in that staff's voice 1, and clears the selection. `doc` is the document (not the layout's view: its
 * staves are renumbered) and `layoutId` the active layout the engraving shows.
 */
export function clickTarget(doc: Document, info: PepperScoreClickInfo, layoutId?: string): ClickTarget | undefined {
  if (info.sourceId) {
    const eventId = noteToEvent(doc).get(info.sourceId) ?? info.sourceId;
    const located = locateEvent(doc, eventId);
    if (located) {
      const part = doc.parts[located.partIndex];
      const seq = part.measures[located.measureIndex].sequences[located.sequenceIndex];
      return {
        cursor: { partId: part.id, staff: seq.staff, voice: seq.voice as Cursor['voice'], measureId: doc.global.measures[located.measureIndex].id, tick: located.tick },
        selection: [eventId],
        mode: located.event.notes?.length ? 'select' : 'enter',
      };
    }
  }
  const index = info.measureIndex;
  if (index === undefined || !doc.global.measures[index]) return undefined;
  const where = staffAt(doc, info.staff ?? 1, layoutId) ?? staffAt(doc, 1, layoutId);
  if (!where) return undefined;
  const pm = doc.parts.find((p) => p.id === where.partId)?.measures[index];
  const barTicks = measureTicks(effectiveTime(doc, index));
  const target = (info.fraction ?? 0) * barTicks;
  const seq = pm && sequenceFor(pm, where.staff, 1);
  let tick = 0;
  for (const start of seq ? eventStarts(seq, barTicks) : []) if (Math.abs(start.tick - target) < Math.abs(tick - target)) tick = start.tick;
  return { cursor: { partId: where.partId, staff: where.staff, voice: 1, measureId: doc.global.measures[index].id, tick }, selection: [], mode: 'enter' };
}
