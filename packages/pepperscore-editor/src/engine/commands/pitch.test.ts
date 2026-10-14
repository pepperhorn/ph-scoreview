import { createDocument } from '../../model/create';
import type { Pitch } from '../../model/schema';
import { createEditorStore } from '../store';
import { setKey } from './score';
import { stepSemitone } from './pitch';

const P = (step: Pitch['step'], octave: number, alter = 0): Pitch => ({ step, octave, alter });

function one(pitch: Pitch, fifths = 0) {
  const doc = createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 1 });
  doc.parts[0].measures[0].sequences[0].content = [{ id: 'e', type: 'event', duration: { base: 'whole', dots: 0 }, notes: [{ id: 'n', pitch }] }];
  const store = createEditorStore(doc);
  if (fifths) store.dispatch(setKey, { measureId: doc.global.measures[0].id, key: { fifths } });
  const step = (delta: number) => {
    store.dispatch(stepSemitone, { noteId: 'n', delta });
    const seq = store.getState().document.parts[0].measures[0].sequences[0].content[0];
    return seq.type === 'event' ? seq.notes![0].pitch : undefined;
  };
  return step;
}

test('stepSemitone spells up with sharps and down with flats in C major', () => {
  const step = one(P('C', 4));
  expect(step(1)).toEqual(P('C', 4, 1));
  expect(step(1)).toEqual(P('D', 4));
  expect(step(1)).toEqual(P('D', 4, 1));
  expect(step(1)).toEqual(P('E', 4));
  expect(step(1)).toEqual(P('F', 4));
  expect(step(-1)).toEqual(P('E', 4));
  expect(step(-1)).toEqual(P('E', 4, -1));
  expect(step(-1)).toEqual(P('D', 4));
  expect(step(-1)).toEqual(P('D', 4, -1));
  expect(step(-1)).toEqual(P('C', 4));
  expect(step(-1)).toEqual(P('B', 3));
});

test('stepSemitone prefers the key signature spelling, then naturals', () => {
  const inF = one(P('A', 4), -1);
  expect(inF(1)).toEqual(P('B', 4, -1)); // Bb is in F major
  const inD = one(P('E', 4), 2);
  expect(inD(1)).toEqual(P('F', 4)); // F natural, not E#
  expect(inD(1)).toEqual(P('F', 4, 1)); // F# is in D major
  expect(inD(-1)).toEqual(P('F', 4));
  const inG = one(P('C', 5), 1);
  expect(inG(-1)).toEqual(P('B', 4));
  expect(inG(-1)).toEqual(P('B', 4, -1));
});
