import type { Duration } from './durations';
import { newId } from './ids';
import type { Clef, Document, Event, Key, Part, PartMeasure, Time } from './schema';

export type NewPart = { name: string; clef: Clef; gmProgram: number; staves?: 1 | 2 };

export function restEvent(d: Duration): Event {
  return { id: newId(), type: 'event', duration: { ...d }, rest: true };
}

export function fullMeasureRest(): Event {
  return { id: newId(), type: 'event', rest: true, fullMeasure: true, duration: { base: 'whole', dots: 0 } };
}

/** One full-measure rest sequence (voice 1) per staff. The full-measure rest fills any time signature. */
export function emptyPartMeasure(part: Part, _time: Time): PartMeasure {
  const sequences = [];
  for (let staff = 1; staff <= part.staves; staff++) {
    sequences.push({ id: newId(), voice: 1, staff, content: [fullMeasureRest()] });
  }
  return { id: newId(), sequences, beams: [], directions: [] };
}

export function createDocument(args: {
  meta?: Document['meta'];
  parts: NewPart[];
  measures: number;
  time?: Time;
  key?: Key;
}): Document {
  const time: Time = args.time ?? { count: 4, unit: 4 };
  const key: Key = args.key ?? { fifths: 0 };
  const globalMeasures = Array.from({ length: args.measures }, (_, i) =>
    i === 0 ? { id: newId(), time: { ...time }, key: { ...key } } : { id: newId() },
  );
  const parts: Part[] = args.parts.map((p) => {
    const staves = p.staves ?? 1;
    const part: Part = {
      id: newId(),
      name: p.name,
      instrument: { gmProgram: p.gmProgram },
      staves,
      clefs: staves === 2 ? [p.clef, 'bass'] : [p.clef],
      measures: [],
    };
    part.measures = globalMeasures.map(() => emptyPartMeasure(part, time));
    return part;
  });
  return {
    global: { measures: globalMeasures },
    parts,
    layouts: [{ id: newId(), name: 'Full score', kind: 'score', transposing: true, parts: parts.map((p) => ({ partId: p.id })), overrides: {} }],
    style: {},
    meta: { ...args.meta },
  };
}
