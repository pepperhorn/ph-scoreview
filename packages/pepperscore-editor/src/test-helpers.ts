import { createDocument } from './model/create';
import type { Document, Event, Pitch } from './model/schema';

const pitch = (step: Pitch['step'], octave: number): Pitch => ({ step, octave, alter: 0 });
const quarter = (id: string, noteId: string, p: Pitch): Event => ({
  id, type: 'event', duration: { base: 'quarter', dots: 0 }, notes: [{ id: noteId, pitch: p }],
});

/** Flute, one 4/4 bar: C5 D5 quarters (events e1, e2; notes n1, n2) and a half rest (e3). */
export function helloDoc(): Document {
  const doc = createDocument({ meta: { title: 'Hello' }, parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 1 });
  doc.parts[0].measures[0].sequences[0].content = [
    quarter('e1', 'n1', pitch('C', 5)),
    quarter('e2', 'n2', pitch('D', 5)),
    { id: 'e3', type: 'event', duration: { base: 'half', dots: 0 }, rest: true },
  ];
  return doc;
}

/** Flute, one 4/4 bar: C4 D4 E4 quarters (events e1-e3; notes n1-n3) and a quarter rest (e4). */
export function threeQuarterNotesDoc(): Document {
  const doc = createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 1 });
  doc.parts[0].measures[0].sequences[0].content = [
    quarter('e1', 'n1', pitch('C', 4)),
    quarter('e2', 'n2', pitch('D', 4)),
    quarter('e3', 'n3', pitch('E', 4)),
    { id: 'e4', type: 'event', duration: { base: 'quarter', dots: 0 }, rest: true },
  ];
  return doc;
}
