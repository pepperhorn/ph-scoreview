import { createEditorStore } from '../store';
import { breakBeam, enterEvent, joinBeam, setBeamGroup, setCursor } from './index';
import { autoBeam } from '../autobeam';
import { createDocument } from '../../model/create';
import { eventStarts } from '../../model/query';
import type { Event, Sequence } from '../../model/schema';
import { helloDoc } from '../../test-helpers';

const ev = (id: string, base: Event['duration']['base'], rest = false): Event =>
  rest ? { id, type: 'event', duration: { base, dots: 0 }, rest: true } : { id, type: 'event', duration: { base, dots: 0 }, notes: [{ id: `${id}n`, pitch: { step: 'C', octave: 5, alter: 0 } }] };
const seq = (content: Event[]): Sequence => ({ id: 's', staff: 1, voice: 1, content });

function eighthsStore() {
  const store = createEditorStore(helloDoc());
  store.dispatch(setCursor, { tick: 0, duration: { base: 'eighth', dots: 0 }, mode: 'enter' }, { record: false });
  for (const step of ['C', 'D', 'E', 'F'] as const) store.dispatch(enterEvent, { pitch: { step, octave: 5, alter: 0 } });
  const pm = () => store.getState().document.parts[0].measures[0];
  const ids = eventStarts(pm().sequences[0], 3840).slice(0, 4).map((s) => s.event.id);
  return { store, pm, ids };
}

test('autoBeam groups by beat; rests and quarters break beams; 4/4 eighths pair across the half bar', () => {
  const four = seq(['a', 'b', 'c', 'd'].map((id) => ev(id, 'eighth')).concat([ev('h', 'half')]));
  expect(autoBeam(four, { count: 4, unit: 4 }).map((b) => b.events)).toEqual([['a', 'b', 'c', 'd']]);
  const sixteenths = seq([...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => ev(id, '16th')), ev('x', 'quarter'), ev('h2', 'quarter')]);
  expect(autoBeam(sixteenths, { count: 3, unit: 4 }).map((b) => b.events)).toEqual([['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']]);
  const withRest = seq([ev('a', 'eighth'), ev('r', 'eighth', true), ev('b', 'eighth'), ev('c', 'eighth'), ev('q', 'quarter'), ev('h', 'quarter')]);
  expect(autoBeam(withRest, { count: 3, unit: 4 }).map((b) => b.events)).toEqual([['b', 'c']]);
  const compound = seq(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ev(id, 'eighth')));
  expect(autoBeam(compound, { count: 6, unit: 8 }).map((b) => b.events)).toEqual([['a', 'b', 'c'], ['d', 'e', 'f']]);
});

test('setBeamGroup 2 splits them', () => {
  const { store, pm, ids } = eighthsStore();
  store.dispatch(setBeamGroup, { measureId: store.getState().document.global.measures[0].id, staff: 1, voice: 1, group: 2 });
  expect(pm().beams.map((b) => b.events)).toEqual([ids.slice(0, 2), ids.slice(2)]);
  expect(store.getState().invariantErrors).toEqual([]);
  store.dispatch(setBeamGroup, { measureId: pm().id, staff: 1, voice: 1, group: 4 });
  expect(pm().beams.map((b) => b.events)).toEqual([ids]);
});

test('breakBeam splits before the event; joinBeam joins with the previous event', () => {
  const { store, pm, ids } = eighthsStore();
  store.dispatch(breakBeam, { eventId: ids[1] });
  expect(pm().beams.map((b) => b.events)).toEqual([ids.slice(1)]);
  store.dispatch(joinBeam, { eventId: ids[1] });
  expect(pm().beams.map((b) => b.events)).toEqual([ids]);
  const before = store.getState().document;
  store.dispatch(joinBeam, { eventId: ids[1] });
  store.dispatch(breakBeam, { eventId: ids[0] });
  expect(store.getState().document).toBe(before);
  expect(store.getState().invariantErrors).toEqual([]);
});

test('joinBeam refuses a quarter', () => {
  const doc = createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 1 });
  doc.parts[0].measures[0].sequences[0].content = [ev('a', 'eighth'), ev('b', 'eighth'), ev('q', 'quarter'), ev('h', 'half')];
  const store = createEditorStore(doc);
  store.dispatch(joinBeam, { eventId: 'q' });
  expect(store.getState().document.parts[0].measures[0].beams).toEqual([]);
  store.dispatch(joinBeam, { eventId: 'b' });
  expect(store.getState().document.parts[0].measures[0].beams.map((b) => b.events)).toEqual([['a', 'b']]);
});
