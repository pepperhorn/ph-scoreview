import { createDocument } from './create';
import { checkInvariants } from './invariants';
import { eventStarts, sequenceTicks, staffCount } from './query';
import type { Document, Event } from './schema';
import { threeQuarterNotesDoc } from '../test-helpers';

const has = (doc: Document, code: string) => checkInvariants(doc).some(m => m.startsWith(code + ':'));

test('bar-length invariant catches a short sequence', () => {
  const doc = createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 1 });
  doc.parts[0].measures[0].sequences[0].content = [{ id: 'e1', type: 'event', duration: { base: 'half', dots: 0 }, rest: true }];
  expect(has(doc, 'bar-length')).toBe(true);
});

test('staff cap', () => {
  const doc = createDocument({ parts: [1,2,3].map(n => ({ name: `P${n}`, clef: 'treble' as const, gmProgram: 1, staves: 2 as const })), measures: 1 });
  expect(staffCount(doc)).toBe(6);
  expect(checkInvariants(doc)).toContain('staff-cap: 6 staves, limit 4');
});

test('measure-count', () => {
  const doc = createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 2 });
  doc.parts[0].measures.pop();
  expect(has(doc, 'measure-count')).toBe(true);
});

test('beam-events', () => {
  const doc = threeQuarterNotesDoc();
  const pm = doc.parts[0].measures[0];
  const ids = pm.sequences[0].content.map(c => c.id);
  pm.beams = [{ id: 'b1', events: [ids[0], ids[1]] }];
  expect(checkInvariants(doc)).toEqual(['beam-events: beam b1 includes event ' + ids[0] + ' of a quarter or longer']);
  const seq = pm.sequences[0];
  seq.content = (['a','b','c','d','e','f','g','h'] as const).map(id => ({ id, type: 'event' as const, duration: { base: 'eighth' as const, dots: 0 as const }, rest: true as const }));
  pm.beams = [{ id: 'b1', events: ['a', 'b'] }];
  expect(checkInvariants(doc)).toEqual([]);
  pm.beams = [{ id: 'b1', events: ['a', 'c'] }];
  expect(has(doc, 'beam-events')).toBe(true);
  pm.beams = [{ id: 'b1', events: ['a', 'zz'] }];
  expect(has(doc, 'beam-events')).toBe(true);
});

test('tie-target', () => {
  const doc = createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 2 });
  const note = (id: string, step: 'C' | 'D', tie?: string) => ({ id, pitch: { step, octave: 4, alter: 0 }, ...(tie ? { tie: { target: tie } } : {}) });
  const ev = (id: string, n: ReturnType<typeof note>, base: 'half' | 'whole' = 'half'): Event => ({ id, type: 'event', duration: { base, dots: 0 }, notes: [n] });
  const [m1, m2] = doc.parts[0].measures;
  m1.sequences[0].content = [ev('e1', note('n1', 'C', 'n2')), ev('e2', note('n2', 'C', 'n3'))];
  m2.sequences[0].content = [ev('e3', note('n3', 'C'), 'whole')];
  expect(checkInvariants(doc)).toEqual([]);
  m2.sequences[0].content = [ev('e3', note('n3', 'D'), 'whole')];
  expect(has(doc, 'tie-target')).toBe(true);
  m1.sequences[0].content = [ev('e1', note('n1', 'C', 'n3')), ev('e2', note('n2', 'C'))];
  m2.sequences[0].content = [ev('e3', note('n3', 'C'), 'whole')];
  expect(has(doc, 'tie-target')).toBe(true);
});

test('slur-target', () => {
  const doc = threeQuarterNotesDoc();
  const seq = doc.parts[0].measures[0].sequences[0];
  const first = seq.content[0] as Event;
  first.slurs = [{ id: 's1', target: seq.content[2].id }];
  expect(checkInvariants(doc)).toEqual([]);
  first.slurs = [{ id: 's1', target: 'missing' }];
  expect(has(doc, 'slur-target')).toBe(true);
});

test('ending-after-repeat', () => {
  const doc = createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 4 });
  const g = doc.global.measures;
  g[2].ending = { numbers: [1] };
  g[2].repeatEnd = {};
  g[3].ending = { numbers: [2] };
  expect(checkInvariants(doc).filter(m => m.startsWith('ending-after-repeat'))).toHaveLength(2);
  g[0].repeatStart = true;
  expect(checkInvariants(doc)).toEqual([]);
  g[1].repeatEnd = {};
  expect(has(doc, 'ending-after-repeat')).toBe(true);
});

test('jump-targets', () => {
  const doc = createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 4 });
  const g = doc.global.measures;
  g[3].jump = { type: 'ds', target: 'coda' };
  expect(checkInvariants(doc).filter(m => m.startsWith('jump-targets'))).toHaveLength(3);
  g[0].segno = true;
  g[1].toCoda = true;
  g[2].coda = true;
  expect(checkInvariants(doc)).toEqual([]);
  g[1].fine = true;
  expect(has(doc, 'jump-targets')).toBe(true);
  g[3].jump = { type: 'dc', target: 'fine' };
  g[1].toCoda = undefined;
  g[2].coda = undefined;
  expect(checkInvariants(doc)).toEqual([]);
});

const sixteenth = (id: string): Event => ({ id, type: 'event', duration: { base: '16th', dots: 0 }, rest: true });

test('septuplet: seven 16ths in the time of four fill the beat exactly', () => {
  const doc = createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 1 });
  const seq = doc.parts[0].measures[0].sequences[0];
  seq.content = [
    { id: 't7', type: 'tuplet', outer: { multiple: 7, base: '16th' }, inner: { multiple: 4, base: '16th' }, content: [1, 2, 3, 4, 5, 6, 7].map(n => sixteenth(`s${n}`)) },
    { id: 'r', type: 'event', duration: { base: 'half', dots: 1 }, rest: true },
  ];
  const starts = eventStarts(seq);
  expect(starts[6].tick + starts[6].ticks).toBe(960);
  expect(starts[7].tick).toBe(960);
  expect(sequenceTicks(seq)).toBe(3840);
  expect(checkInvariants(doc)).toEqual([]);
});

test('quintuplet: five 16ths in the time of four', () => {
  const doc = createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 1 });
  const seq = doc.parts[0].measures[0].sequences[0];
  seq.content = [
    { id: 't5', type: 'tuplet', outer: { multiple: 5, base: '16th' }, inner: { multiple: 4, base: '16th' }, content: [1, 2, 3, 4, 5].map(n => sixteenth(`q${n}`)) },
    { id: 'r', type: 'event', duration: { base: 'half', dots: 1 }, rest: true },
  ];
  expect(eventStarts(seq).map(s => s.ticks).slice(0, 5)).toEqual([192, 192, 192, 192, 192]);
  expect(checkInvariants(doc)).toEqual([]);
});

test('bar-length accepts a full-measure rest in 3/4 and rejects a whole rest there', () => {
  const doc = createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 1, time: { count: 3, unit: 4 } });
  expect(checkInvariants(doc)).toEqual([]);
  doc.parts[0].measures[0].sequences[0].content = [{ id: 'w', type: 'event', duration: { base: 'whole', dots: 0 }, rest: true }];
  expect(checkInvariants(doc)).toEqual(['bar-length: part Fl measure 1 staff 1 voice 1 has 3840 ticks, expected 2880']);
});
