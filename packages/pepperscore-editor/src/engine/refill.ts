import { BASE_TICKS, durationTicks, measureTicks, ticksToDurations } from '../model/durations';
import { newId } from '../model/ids';
import { restEvent } from '../model/create';
import { beamIsValid } from '../model/invariants';
import { effectiveTime } from '../model/query';
import type { Document, Event, Note, Sequence, Tuplet } from '../model/schema';

/** Tuplet-scaled ticks can be fractional; compare positions within this tolerance. */
const TICK_EPSILON = 1e-6;

const isFullMeasureRestOnly = (seq: Sequence): boolean =>
  seq.content.length === 1 && seq.content[0].type === 'event' && seq.content[0].fullMeasure === true;

function itemTicks(item: Event | Tuplet, barTicks: number): number {
  if (item.type === 'tuplet') return item.inner.multiple * BASE_TICKS[item.inner.base];
  return item.fullMeasure ? barTicks : durationTicks(item.duration);
}

const rests = (ticks: number): Event[] => ticksToDurations(ticks).map(restEvent);

/**
 * Splits `event` into `ticksToDurations(room)` pieces. The first piece is `event` itself (ids
 * kept, so references to it survive); the others copy its notes or rest, and each note is tied
 * to its copy in the next piece. The last piece keeps the original ties only when `keepTies`.
 */
function splitEvent(event: Event, room: number, keepTies: boolean): Event[] {
  if (event.fullMeasure) return rests(room);
  const [first, ...more] = ticksToDurations(room);
  event.duration = first;
  const sourceNotes = event.notes;
  if (!sourceNotes?.length) return [event, ...more.map((d) => restEvent(d))];
  const originalTies = sourceNotes.map((n) => (n.tie ? { ...n.tie } : undefined));
  const pieces: Event[] = [event];
  for (const duration of more) {
    const notes: Note[] = sourceNotes.map((n) => ({ id: newId(), pitch: { ...n.pitch } }));
    pieces.push({ id: newId(), type: 'event', duration, notes, ...(event.stem ? { stem: event.stem } : {}) });
  }
  pieces.forEach((piece, k) => {
    const next = pieces[k + 1];
    piece.notes!.forEach((note, j) => {
      const tie = next ? { target: next.notes![j].id } : keepTies ? originalTies[j] : undefined;
      if (tie) note.tie = tie;
      else delete note.tie;
    });
  });
  return pieces;
}

/** Truncates content past the bar (splitting the overlapping item) and pads to the bar with rests. */
function refillSequence(seq: Sequence, barTicks: number): void {
  if (isFullMeasureRestOnly(seq)) return;
  const kept: (Event | Tuplet)[] = [];
  let tick = 0;
  let changed = false;
  for (let i = 0; i < seq.content.length; i++) {
    const item = seq.content[i];
    if (tick >= barTicks - TICK_EPSILON) {
      changed = true;
      break;
    }
    const ticks = itemTicks(item, barTicks);
    if (tick + ticks <= barTicks + TICK_EPSILON) {
      kept.push(item);
      tick += ticks;
      continue;
    }
    const room = barTicks - tick;
    const isLast = i === seq.content.length - 1;
    kept.push(...(item.type === 'event' ? splitEvent(item, room, isLast) : rests(room)));
    tick = barTicks;
    changed = true;
    break;
  }
  if (tick < barTicks - TICK_EPSILON) {
    kept.push(...rests(barTicks - tick));
    changed = true;
  }
  if (changed) seq.content = kept;
}

/**
 * Makes every sequence of every part measure at `measureIndex` exactly one bar long: content
 * past the bar is dropped (the overlapping event is split into tied pieces; a tuplet becomes
 * rests) and short sequences are padded with rests. A sequence holding only a full-measure
 * rest stays as is. Beams whose events are gone or no longer beamable are dropped.
 */
export function refillMeasure(doc: Document, measureIndex: number): void {
  const barTicks = measureTicks(effectiveTime(doc, measureIndex));
  for (const part of doc.parts) {
    const pm = part.measures[measureIndex];
    if (!pm) continue;
    for (const seq of pm.sequences) refillSequence(seq, barTicks);
    const beams = pm.beams.filter((b) => beamIsValid(pm, b, barTicks));
    if (beams.length !== pm.beams.length) pm.beams = beams;
  }
}
