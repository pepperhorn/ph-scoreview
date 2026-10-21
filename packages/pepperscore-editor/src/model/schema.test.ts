import { createDocument } from './create';
import { LayoutSchema, parseDocument, SwapSchema } from './schema';
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
  expect(doc.layouts).toEqual([{ id: expect.any(String), name: 'Full score', kind: 'score', transposing: true, parts: [{ partId: doc.parts[0].id }], overrides: {} }]);
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

test('a phase 1 layout parses as a transposing score layout', () => {
  expect(LayoutSchema.parse({ id: 'L1', name: 'Score', kind: 'score', parts: [{ partId: 'p1' }], overrides: {} }))
    .toEqual({ id: 'L1', name: 'Score', kind: 'score', transposing: true, parts: [{ partId: 'p1' }], overrides: {} });
  expect(LayoutSchema.parse({ id: 'L1', name: 'Score', parts: [{ partId: 'p1' }], overrides: {} })).toMatchObject({ kind: 'score', transposing: true });
});

test('layouts take custom kinds, concert pitch, per-layout style and part swaps', () => {
  const layout = LayoutSchema.parse({
    id: 'L2', name: 'Alto Sax (Tenor)', kind: 'custom', transposing: false, style: { staffSize: 6 }, overrides: {},
    parts: [{ partId: 'p1', staves: [1], swap: { instrument: 'alto-saxophone', level: 'beginner' } }],
  });
  expect(layout.kind).toBe('custom');
  expect(layout.transposing).toBe(false);
  expect(layout.style).toEqual({ staffSize: 6 });
  expect(layout.parts[0].swap).toEqual({ instrument: 'alto-saxophone', level: 'beginner', autoRange: true, rangeOverrides: {} });
});

test('swaps validate the instrument, level, interval and octave overrides', () => {
  const swap = { instrument: 'trumpet', level: 'advanced', interval: { semitones: 4, diatonic: 2 }, autoRange: false, rangeOverrides: { e1: 12, e2: -12, e3: 0 } };
  expect(SwapSchema.parse(swap)).toEqual(swap);
  expect(() => SwapSchema.parse({ ...swap, instrument: 'kazoo' })).toThrow();
  expect(() => SwapSchema.parse({ ...swap, level: 'expert' })).toThrow();
  expect(() => SwapSchema.parse({ ...swap, interval: { semitones: 1.5, diatonic: 1 } })).toThrow();
  expect(() => SwapSchema.parse({ ...swap, rangeOverrides: { e1: 7 } })).toThrow();
  expect(() => LayoutSchema.parse({ id: 'L', name: 'L', kind: 'conductor', parts: [], overrides: {} })).toThrow();
});
