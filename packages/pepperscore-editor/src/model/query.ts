import { BASE_TICKS, durationTicks, measureTicks } from './durations';
import { newId } from './ids';
import type { Clef, Document, Event, Key, Part, PartMeasure, Sequence, Time } from './schema';

export function measureIndex(doc: Document, measureId: string): number {
  return doc.global.measures.findIndex((m) => m.id === measureId);
}

export function effectiveTime(doc: Document, index: number): Time {
  for (let i = Math.min(index, doc.global.measures.length - 1); i >= 0; i--) {
    const time = doc.global.measures[i].time;
    if (time) return time;
  }
  return { count: 4, unit: 4 };
}

export function effectiveKey(doc: Document, index: number): Key {
  for (let i = Math.min(index, doc.global.measures.length - 1); i >= 0; i--) {
    const key = doc.global.measures[i].key;
    if (key) return key;
  }
  return { fifths: 0 };
}

/** Clef in force at the end of measure `index` on `staff` (1-based). */
export function effectiveClef(part: Part, index: number, staff: number): Clef {
  for (let i = Math.min(index, part.measures.length - 1); i >= 0; i--) {
    const changes = part.measures[i].clefs?.filter((c) => c.staff === staff);
    if (changes?.length) return changes.reduce((a, b) => ((b.tick ?? 0) >= (a.tick ?? 0) ? b : a)).clef;
  }
  return part.clefs[staff - 1] ?? 'treble';
}

export function sequenceFor(pm: PartMeasure, staff: number, voice: number): Sequence | undefined {
  return pm.sequences.find((s) => s.staff === staff && s.voice === voice);
}

/**
 * Returns the (staff, voice) sequence, creating it if absent (mutates `pm`).
 * A created sequence is EMPTY and fails `bar-length` until the caller pads it with rests.
 */
export function ensureSequence(pm: PartMeasure, staff: number, voice: number): Sequence {
  const existing = sequenceFor(pm, staff, voice);
  if (existing) return existing;
  const created: Sequence = { id: newId(), voice, staff, content: [] };
  pm.sequences.push(created);
  return created;
}

type Start = { event: Event; tick: number; ticks: number; contentIndex: number };

/** Ticks of an event outside a tuplet; a full-measure rest spans the bar. */
function plainTicks(event: Event, barTicks: number | undefined): number {
  return event.fullMeasure ? (barTicks ?? 3840) : durationTicks(event.duration);
}

function walk(seq: Sequence, barTicks?: number): Start[] {
  const out: Start[] = [];
  let tick = 0;
  seq.content.forEach((item, contentIndex) => {
    if (item.type === 'tuplet') {
      // Positions are scaled from cumulative written ticks so the tuplet ends exactly on its span.
      const span = item.inner.multiple * BASE_TICKS[item.inner.base];
      const written = item.outer.multiple * BASE_TICKS[item.outer.base];
      const start = tick;
      let cumulative = 0;
      for (const event of item.content) {
        const from = start + (cumulative * span) / written;
        cumulative += durationTicks(event.duration);
        const to = start + (cumulative * span) / written;
        out.push({ event, tick: from, ticks: to - from, contentIndex });
        tick = to;
      }
    } else {
      const ticks = plainTicks(item, barTicks);
      out.push({ event: item, tick, ticks, contentIndex });
      tick += ticks;
    }
  });
  return out;
}

/**
 * Events in order, flattened out of tuplets, with tuplet-scaled start ticks and lengths.
 * A full-measure rest spans `barTicks` (default 3840).
 */
export function eventStarts(seq: Sequence, barTicks?: number): { event: Event; tick: number; ticks: number }[] {
  return walk(seq, barTicks).map(({ event, tick, ticks }) => ({ event, tick, ticks }));
}

/** Total ticks of a sequence; a full-measure rest spans `barTicks` (default 3840). */
export function sequenceTicks(seq: Sequence, barTicks?: number): number {
  const starts = walk(seq, barTicks);
  const last = starts[starts.length - 1];
  return last ? last.tick + last.ticks : 0;
}

export type Located = { partIndex: number; measureIndex: number; sequenceIndex: number; contentIndex: number; tick: number; event: Event };

export function locateEvent(doc: Document, eventId: string): Located | undefined {
  for (let partIndex = 0; partIndex < doc.parts.length; partIndex++) {
    const measures = doc.parts[partIndex].measures;
    for (let mi = 0; mi < measures.length; mi++) {
      const sequences = measures[mi].sequences;
      const barTicks = measureTicks(effectiveTime(doc, mi));
      for (let sequenceIndex = 0; sequenceIndex < sequences.length; sequenceIndex++) {
        const hit = walk(sequences[sequenceIndex], barTicks).find((s) => s.event.id === eventId);
        if (hit) return { partIndex, measureIndex: mi, sequenceIndex, contentIndex: hit.contentIndex, tick: hit.tick, event: hit.event };
      }
    }
  }
  return undefined;
}

export function noteToEvent(doc: Document): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of doc.parts)
    for (const pm of part.measures)
      for (const seq of pm.sequences)
        for (const { event } of walk(seq))
          for (const note of event.notes ?? []) map.set(note.id, event.id);
  return map;
}

export function staffCount(doc: Document): number {
  return doc.parts.reduce((sum, p) => sum + p.staves, 0);
}
