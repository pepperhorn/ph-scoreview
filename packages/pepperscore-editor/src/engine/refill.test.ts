import { refillMeasure } from './refill';
import { createDocument } from '../model/create';
import { checkInvariants } from '../model/invariants';
import { eventStarts, sequenceTicks } from '../model/query';
import type { Event } from '../model/schema';

const restEv = (id: string, base: 'quarter' | 'eighth' | 'half' = 'quarter'): Event => ({ id, type: 'event', duration: { base, dots: 0 }, rest: true });

test('refillMeasure drops beams that lose events', () => {
  const doc = createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 1 });
  const pm = doc.parts[0].measures[0];
  pm.sequences[0].content = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => restEv(id, 'eighth'));
  pm.beams = [{ id: 'keep', events: ['a', 'b'] }, { id: 'gone', events: ['g', 'h'] }];
  doc.global.measures[0].time = { count: 3, unit: 4 };
  refillMeasure(doc, 0);
  expect(pm.beams.map((b) => b.id)).toEqual(['keep']);
  expect(checkInvariants(doc)).toEqual([]);
});

test('refillMeasure drops a beam that fails the beam invariant', () => {
  const doc = createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 1 });
  const pm = doc.parts[0].measures[0];
  // 'bad' spans eighth y and quarter z, which a beam may not include.
  pm.sequences[0].content = [restEv('q', 'half'), restEv('x', 'eighth'), restEv('y', 'eighth'), restEv('z')];
  pm.beams = [{ id: 'ok', events: ['x', 'y'] }, { id: 'bad', events: ['y', 'z'] }];
  refillMeasure(doc, 0);
  expect(pm.beams.map((b) => b.id)).toEqual(['ok']);
});

test('refillMeasure pads an empty sequence and leaves a full-measure rest alone', () => {
  const doc = createDocument({ parts: [{ name: 'Piano', clef: 'treble', gmProgram: 1, staves: 2 }], measures: 1 });
  const pm = doc.parts[0].measures[0];
  const fullRest = pm.sequences[1].content[0];
  pm.sequences.push({ id: 'v2', staff: 1, voice: 2, content: [] });
  refillMeasure(doc, 0);
  expect(sequenceTicks(pm.sequences[2])).toBe(3840);
  expect(pm.sequences[1].content).toEqual([fullRest]);
  expect(checkInvariants(doc)).toEqual([]);
});

test('refillMeasure replaces a tuplet crossing the bar with rests', () => {
  const doc = createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 1 });
  doc.parts[0].measures[0].sequences[0].content = [
    restEv('q1'), restEv('q2'),
    { id: 't', type: 'tuplet', outer: { multiple: 3, base: 'quarter' }, inner: { multiple: 2, base: 'quarter' }, content: [restEv('t1'), restEv('t2'), restEv('t3')] },
  ];
  doc.global.measures[0].time = { count: 3, unit: 4 };
  refillMeasure(doc, 0);
  const seq = doc.parts[0].measures[0].sequences[0];
  expect(seq.content.every((c) => c.type === 'event')).toBe(true);
  expect(eventStarts(seq).map((s) => s.event.id).slice(0, 2)).toEqual(['q1', 'q2']);
  expect(checkInvariants(doc)).toEqual([]);
});
