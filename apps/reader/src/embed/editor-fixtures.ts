import { createDocument, INSTRUMENTS, newId, type Document, type Event, type Pitch } from '@pepperhorn/pepperscore-editor';

type Base = Event['duration']['base'];
const pitch = (name: string): Pitch => ({ step: name[0] as Pitch['step'], octave: Number(name.slice(1)), alter: 0 });
const note = (base: Base, name: string): Event => ({ id: newId(), type: 'event', duration: { base, dots: 0 }, notes: [{ id: newId(), pitch: pitch(name) }] });
const rest = (base: Base): Event => ({ id: newId(), type: 'event', duration: { base, dots: 0 }, rest: true });

/**
 * Tenor Sax (written pitch) and Piano, four 4/4 bars, for the instrument swap: bars 1 and 3 are a high phrase
 * (written C6 D6 E6 D6, then E6 D6) that sounds above the alto sax's beginner range, so showing the tenor part as
 * Alto Sax at beginner moves those six notes 8vb; bars 2 and 4 stay in range.
 */
export function tenorPianoDocument(): Document {
  const tenor = INSTRUMENTS['tenor-saxophone'];
  const doc = createDocument({
    meta: { title: 'Swap Study' },
    parts: [{ name: 'Tenor Sax', clef: 'treble', gmProgram: tenor.gmProgram }, { name: 'Piano', clef: 'treble', gmProgram: 1, staves: 2 }],
    measures: 4,
  });
  const [sax, piano] = doc.parts;
  sax.transposition = { ...tenor.transposition };
  const saxBars: Event[][] = [
    [note('quarter', 'C6'), note('quarter', 'D6'), note('quarter', 'E6'), note('quarter', 'D6')],
    [note('half', 'A5'), note('half', 'G5')],
    [note('quarter', 'E6'), note('quarter', 'D6'), rest('half')],
    [note('whole', 'C5')],
  ];
  const right = ['E4', 'F4', 'G4', 'E4'], left = ['C3', 'A2', 'G2', 'C3'];
  saxBars.forEach((content, i) => { sax.measures[i].sequences[0].content = content; });
  piano.measures.forEach((pm, i) => {
    pm.sequences[0].content = [note('whole', right[i])];
    pm.sequences[1].content = [note('whole', left[i])];
  });
  return doc;
}
