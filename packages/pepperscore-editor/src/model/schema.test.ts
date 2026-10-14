import { createDocument } from './create';
import { parseDocument } from './schema';
import { checkInvariants } from './invariants';
import { durationTicks, measureTicks, ticksToDurations } from './durations';
import { helloDoc, threeQuarterNotesDoc } from '../test-helpers';

test('createDocument makes full-measure rests that pass invariants', () => {
  const doc = createDocument({ parts: [{ name: 'Piano', clef: 'treble', gmProgram: 1, staves: 2 }], measures: 4 });
  expect(doc.global.measures).toHaveLength(4);
  expect(doc.parts[0].measures[0].sequences).toHaveLength(2);
  expect(checkInvariants(doc)).toEqual([]);
  expect(parseDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
});

test('createDocument puts time and key on the first measure and builds a score layout', () => {
  const doc = createDocument({ meta: { title: 'T' }, parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 2, time: { count: 3, unit: 4 }, key: { fifths: -2 } });
  expect(doc.global.measures[0]).toMatchObject({ time: { count: 3, unit: 4 }, key: { fifths: -2 } });
  expect(doc.global.measures[1].time).toBeUndefined();
  expect(doc.layouts).toEqual([{ id: expect.any(String), name: 'Score', kind: 'score', parts: [{ partId: doc.parts[0].id }], overrides: {} }]);
  expect(doc.style).toEqual({});
  expect(doc.meta).toEqual({ title: 'T' });
});

test('duration maths', () => {
  expect(durationTicks({ base: 'quarter', dots: 1 })).toBe(1440);
  expect(durationTicks({ base: 'half', dots: 2 })).toBe(3360);
  expect(measureTicks({ count: 6, unit: 8 })).toBe(2880);
  expect(ticksToDurations(1440)).toEqual([{ base: 'quarter', dots: 1 }]);
  expect(ticksToDurations(600)).toEqual([{ base: 'eighth', dots: 0 }, { base: '32nd', dots: 0 }]);
  expect(() => ticksToDurations(100)).toThrow('Cannot express 100 ticks as durations');
});

test('parseDocument rejects malformed documents', () => {
  expect(() => parseDocument({ global: { measures: [] }, parts: [], layouts: [], style: {}, meta: {} })).toThrow();
});

test('test helpers produce valid documents', () => {
  for (const doc of [helloDoc(), threeQuarterNotesDoc()]) {
    expect(checkInvariants(doc)).toEqual([]);
    expect(parseDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  }
  expect(helloDoc().meta.title).toBe('Hello');
});
