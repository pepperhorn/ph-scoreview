import { clampCursor } from './cursor-clamp';
import { createDocument } from '../model/create';
import type { Document } from '../model/schema';
import type { Cursor } from './types';
import { threeQuarterNotesDoc } from '../test-helpers';

const base = (doc: Document): Cursor => ({
  partId: doc.parts[0].id, staff: 1, voice: 1, measureId: doc.global.measures[0].id, tick: 0, duration: { base: 'quarter', dots: 0 }, mode: 'select',
});

test('a valid cursor is returned unchanged', () => {
  const doc = threeQuarterNotesDoc();
  const cursor = { ...base(doc), tick: 1920 };
  expect(clampCursor(doc, cursor)).toBe(cursor);
});

test('a tick past the bar end moves to the last event start; a negative tick to 0', () => {
  const doc = threeQuarterNotesDoc();
  expect(clampCursor(doc, { ...base(doc), tick: 3840 }).tick).toBe(2880);
  expect(clampCursor(doc, { ...base(doc), tick: -5 }).tick).toBe(0);
  expect(clampCursor(doc, { ...base(doc), voice: 2, tick: 5000 }).tick).toBe(0);
});

test('an unknown part or staff falls back to the first part and a valid staff', () => {
  const doc = createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }, { name: 'Pno', clef: 'treble', gmProgram: 1, staves: 2 }], measures: 1 });
  expect(clampCursor(doc, { ...base(doc), partId: 'gone' }).partId).toBe(doc.parts[0].id);
  expect(clampCursor(doc, { ...base(doc), staff: 2 }).staff).toBe(1);
  expect(clampCursor(doc, { ...base(doc), partId: doc.parts[1].id, staff: 2 }).staff).toBe(2);
});

test('a missing measure falls back to the bar before its old position, or bar 1', () => {
  const before = createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 3 });
  const after = structuredClone(before);
  const [m0, m1, m2] = before.global.measures.map((m) => m.id);
  after.global.measures.splice(2, 1);
  after.parts[0].measures.splice(2, 1);
  expect(clampCursor(after, { ...base(before), measureId: m2, tick: 960 }, before)).toMatchObject({ measureId: m1, tick: 0 });
  expect(clampCursor(after, { ...base(before), measureId: 'unknown' })).toMatchObject({ measureId: m0, tick: 0 });
});
