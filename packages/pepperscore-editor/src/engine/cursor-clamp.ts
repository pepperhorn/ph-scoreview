import { measureTicks } from '../model/durations';
import { effectiveTime, eventStarts, measureIndex, sequenceFor } from '../model/query';
import type { Document } from '../model/schema';
import type { Cursor } from './types';

/**
 * Returns a cursor that points at things existing in `doc`; the same object when it already does.
 * - unknown part → first part; staff outside the part's staves → 1
 * - missing measure → the bar before its position in `previous` (as deleteMeasure does), or bar 1; tick 0
 * - tick before 0 → 0; tick at or past the bar end → start of the last event of the cursor's
 *   sequence (0 when there is none)
 */
export function clampCursor(doc: Document, cursor: Cursor, previous?: Document): Cursor {
  const next = { ...cursor };
  const part = doc.parts.find((p) => p.id === cursor.partId) ?? doc.parts[0];
  if (part && part.id !== cursor.partId) next.partId = part.id;
  if (part && (next.staff < 1 || next.staff > part.staves)) next.staff = 1;

  let index = measureIndex(doc, cursor.measureId);
  if (index < 0 && doc.global.measures.length) {
    const old = previous ? measureIndex(previous, cursor.measureId) : -1;
    index = Math.min(Math.max(old - 1, 0), doc.global.measures.length - 1);
    next.measureId = doc.global.measures[index].id;
    next.tick = 0;
  }

  if (next.tick < 0) next.tick = 0;
  if (index >= 0) {
    const barTicks = measureTicks(effectiveTime(doc, index));
    if (next.tick >= barTicks) {
      const pm = part?.measures[index];
      const seq = pm ? sequenceFor(pm, next.staff, next.voice) : undefined;
      next.tick = seq ? (eventStarts(seq, barTicks).at(-1)?.tick ?? 0) : 0;
    }
  }

  const changed = (Object.keys(next) as (keyof Cursor)[]).some((k) => next[k] !== cursor[k]);
  return changed ? next : cursor;
}
