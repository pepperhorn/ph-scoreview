import { createDocument } from './create';
import { checkInvariants } from './invariants';
import { effectiveClef, effectiveKey, effectiveTime, ensureSequence, eventStarts, locateEvent, measureIndex, noteToEvent, sequenceFor, sequenceTicks, staffCount } from './query';
import { helloDoc } from '../test-helpers';

test('locateEvent and eventStarts handle tuplets', () => {
  const doc = createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 1 });
  const seq = doc.parts[0].measures[0].sequences[0];
  const e = (id: string) => ({ id, type: 'event' as const, duration: { base: 'eighth' as const, dots: 0 as const }, rest: true as const });
  seq.content = [{ id: 't1', type: 'tuplet', outer: { multiple: 3, base: 'eighth' }, inner: { multiple: 2, base: 'eighth' }, content: [e('a'), e('b'), e('c')] }, { id: 'h', type: 'event', duration: { base: 'half', dots: 0 }, rest: true }, e('x'), e('y')];
  expect(eventStarts(seq).map(s => [s.event.id, s.tick, s.ticks])).toEqual([['a',0,320],['b',320,320],['c',640,320],['h',960,1920],['x',2880,480],['y',3360,480]]);
  expect(locateEvent(doc, 'b')).toMatchObject({ partIndex: 0, measureIndex: 0, sequenceIndex: 0, contentIndex: 0, tick: 320, event: { id: 'b' } });
  expect(locateEvent(doc, 'x')).toMatchObject({ contentIndex: 2, tick: 2880 });
  expect(locateEvent(doc, 'nope')).toBeUndefined();
  expect(sequenceTicks(seq)).toBe(3840);
  expect(checkInvariants(doc)).toEqual([]);
});

test('effective time, key and clef walk back', () => {
  const doc = createDocument({ parts: [{ name: 'Pno', clef: 'treble', gmProgram: 1, staves: 2 }], measures: 3 });
  expect(effectiveTime(doc, 2)).toEqual({ count: 4, unit: 4 });
  expect(effectiveKey(doc, 2)).toEqual({ fifths: 0 });
  doc.global.measures[1].time = { count: 3, unit: 4 };
  doc.global.measures[1].key = { fifths: 3 };
  expect(effectiveTime(doc, 0)).toEqual({ count: 4, unit: 4 });
  expect(effectiveTime(doc, 2)).toEqual({ count: 3, unit: 4 });
  expect(effectiveKey(doc, 2)).toEqual({ fifths: 3 });
  const part = doc.parts[0];
  part.clefs = ['treble', 'bass'];
  expect(effectiveClef(part, 2, 2)).toBe('bass');
  part.measures[1].clefs = [{ staff: 1, clef: 'alto' }];
  expect(effectiveClef(part, 0, 1)).toBe('treble');
  expect(effectiveClef(part, 2, 1)).toBe('alto');
  expect(effectiveClef(part, 2, 2)).toBe('bass');
  part.clefs = [];
  expect(effectiveClef(part, 0, 2)).toBe('treble');
});

test('measureIndex, sequenceFor, ensureSequence, noteToEvent, staffCount', () => {
  const doc = helloDoc();
  expect(measureIndex(doc, doc.global.measures[0].id)).toBe(0);
  expect(measureIndex(doc, 'missing')).toBe(-1);
  const pm = doc.parts[0].measures[0];
  expect(sequenceFor(pm, 1, 1)).toBe(pm.sequences[0]);
  expect(sequenceFor(pm, 1, 2)).toBeUndefined();
  const v2 = ensureSequence(pm, 1, 2);
  expect(v2).toMatchObject({ staff: 1, voice: 2, content: [] });
  expect(pm.sequences).toHaveLength(2);
  expect(ensureSequence(pm, 1, 2)).toBe(v2);
  const map = noteToEvent(doc);
  const first = pm.sequences[0].content[0];
  if (first.type !== 'event') throw new Error('expected event');
  expect(map.get(first.notes![0].id)).toBe(first.id);
  expect(map.size).toBe(2);
  expect(staffCount(doc)).toBe(1);
});

test('a full-measure rest spans the bar it is in', () => {
  const doc = createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 2, time: { count: 3, unit: 4 } });
  const seq = doc.parts[0].measures[1].sequences[0];
  const rest = seq.content[0];
  expect(sequenceTicks(seq)).toBe(3840);
  expect(sequenceTicks(seq, 2880)).toBe(2880);
  expect(eventStarts(seq, 2880)).toEqual([{ event: rest, tick: 0, ticks: 2880 }]);
  expect(locateEvent(doc, rest.id)).toMatchObject({ measureIndex: 1, tick: 0 });
  expect(checkInvariants(doc)).toEqual([]);
});

test('grace events take no time and start at the following event', () => {
  const doc = createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 1 });
  const seq = doc.parts[0].measures[0].sequences[0];
  const ev = (id: string, base: 'quarter' | 'eighth' | 'half', grace = false) => ({
    id, type: 'event' as const, duration: { base, dots: 0 as const }, notes: [{ id: `${id}n`, pitch: { step: 'C' as const, octave: 5, alter: 0 } }],
    ...(grace ? { grace: { slash: true } } : {}),
  });
  seq.content = [
    ev('g1', 'eighth', true), ev('a', 'quarter'),
    { id: 't1', type: 'tuplet', outer: { multiple: 3, base: 'eighth' }, inner: { multiple: 2, base: 'eighth' }, content: [ev('b', 'eighth'), ev('g2', 'eighth', true), ev('c', 'eighth'), ev('d', 'eighth')] },
    ev('h', 'half'),
  ];
  expect(eventStarts(seq, 3840).map(s => [s.event.id, s.tick, s.ticks])).toEqual([
    ['g1', 0, 0], ['a', 0, 960], ['b', 960, 320], ['g2', 1280, 0], ['c', 1280, 320], ['d', 1600, 320], ['h', 1920, 1920],
  ]);
  expect(sequenceTicks(seq, 3840)).toBe(3840);
  expect(checkInvariants(doc)).toEqual([]);
});
