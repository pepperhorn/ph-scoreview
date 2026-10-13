import type { PepperScoreClickInfo } from 'pepperscore';
import type { Cursor } from '../engine/types';
import { measureTicks } from '../model/durations';
import { effectiveTime, eventStarts, locateEvent, noteToEvent, sequenceFor } from '../model/query';
import type { Document } from '../model/schema';

export type ClickTarget = { cursor: Partial<Cursor>; selection: string[] };

/**
 * The (part, staff) of the viewer's 1-based visible staff index: the viewer draws one staff per
 * entry, walking the compiled layout's parts in order and each part's staves.
 */
export function staffAt(doc: Document, viewerStaff: number): { partId: string; staff: number } | undefined {
  const layout = doc.layouts[0];
  let n = 0;
  for (const lp of layout?.parts ?? []) {
    const part = doc.parts.find((p) => p.id === lp.partId);
    if (!part) continue;
    for (let staff = 1; staff <= part.staves; staff++) if (++n === viewerStaff) return { partId: part.id, staff };
  }
  return undefined;
}

/**
 * Where a click on the engraving puts the cursor. A hit note's `sourceId` is the MusicXML id of its
 * first pitch, which is a model note id (a rest's is its event id): the cursor moves onto that
 * event and selects it. Otherwise a click in a measure moves the cursor to the nearest event start
 * at or before the click in that staff's voice 1, and clears the selection.
 */
export function clickTarget(doc: Document, info: PepperScoreClickInfo): ClickTarget | undefined {
  if (info.sourceId) {
    const eventId = noteToEvent(doc).get(info.sourceId) ?? info.sourceId;
    const located = locateEvent(doc, eventId);
    if (located) {
      const part = doc.parts[located.partIndex];
      const seq = part.measures[located.measureIndex].sequences[located.sequenceIndex];
      return {
        cursor: { partId: part.id, staff: seq.staff, voice: seq.voice as Cursor['voice'], measureId: doc.global.measures[located.measureIndex].id, tick: located.tick },
        selection: [eventId],
      };
    }
  }
  const index = info.measureIndex;
  if (index === undefined || !doc.global.measures[index]) return undefined;
  const where = staffAt(doc, info.staff ?? 1) ?? staffAt(doc, 1);
  if (!where) return undefined;
  const pm = doc.parts.find((p) => p.id === where.partId)?.measures[index];
  const barTicks = measureTicks(effectiveTime(doc, index));
  const target = (info.fraction ?? 0) * barTicks;
  const seq = pm && sequenceFor(pm, where.staff, 1);
  let tick = 0;
  for (const start of seq ? eventStarts(seq, barTicks) : []) if (start.tick <= target + 1e-6) tick = start.tick;
  return { cursor: { partId: where.partId, staff: where.staff, voice: 1, measureId: doc.global.measures[index].id, tick }, selection: [] };
}
