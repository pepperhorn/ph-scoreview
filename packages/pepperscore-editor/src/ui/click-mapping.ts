import type { PepperScoreClickInfo } from 'pepperscore';
import type { Cursor } from '../engine/types';
import { measureTicks } from '../model/durations';
import { effectiveTime, eventStarts, locateEvent, noteToEvent, sequenceFor } from '../model/query';
import type { Document } from '../model/schema';
import { visibleStaves } from '../engine/layout/visible-staves';

/**
 * `mode` is the mode a click implies (the phone shell switches to it): a pitched note, hit or the one a click that
 * missed its notehead puts the cursor on, is for editing (`select`); a rest (past the last note, an empty bar) is for
 * entry (`enter`).
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
 * The start tick of the event the viewer drew nearest a staff-space click (`nearestSourceId`), when it is in the
 * clicked bar (`index`) and staff (`where`); undefined when the viewer did not supply one (an older viewer) or it
 * lies elsewhere.
 */
function engravedTick(doc: Document, info: PepperScoreClickInfo, index: number, where: { partId: string; staff: number }): number | undefined {
  if (!info.nearestSourceId) return undefined;
  const located = locateEvent(doc, noteToEvent(doc).get(info.nearestSourceId) ?? info.nearestSourceId);
  if (!located || located.measureIndex !== index || doc.parts[located.partIndex].id !== where.partId) return undefined;
  const seq = doc.parts[located.partIndex].measures[index].sequences[located.sequenceIndex];
  return seq.staff === where.staff ? located.tick : undefined;
}

/**
 * Where a click on the engraving puts the cursor. A hit note's `sourceId` is the MusicXML id of its
 * first pitch, which is a model note id (a rest's is its event id): the cursor moves onto that
 * event and selects it. Otherwise a click in a measure moves the cursor to the voice-1 event start nearest the
 * event the viewer engraved nearest the click (`nearestSourceId`; engraved x is not proportional to time), else
 * nearest the click's time `fraction` across the bar, in that staff, and clears the selection. `doc` is the document (not the layout's view: its
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
  const target = engravedTick(doc, info, index, where) ?? (info.fraction ?? 0) * barTicks;
  const seq = pm && sequenceFor(pm, where.staff, 1);
  const starts = seq ? eventStarts(seq, barTicks).filter((s) => !s.event.grace) : [];
  let tick = 0;
  for (const start of starts) if (Math.abs(start.tick - target) < Math.abs(tick - target)) tick = start.tick;
  // The cursor lands on (and highlights) the event at `tick`: a note there is edited, as if its notehead were hit.
  const pitched = !!starts.find((s) => s.tick === tick)?.event.notes?.length;
  return { cursor: { partId: where.partId, staff: where.staff, voice: 1, measureId: doc.global.measures[index].id, tick }, selection: [], mode: pitched ? 'select' : 'enter' };
}
