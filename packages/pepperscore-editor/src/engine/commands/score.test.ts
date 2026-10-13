import { createEditorStore } from '../store';
import {
  deleteMeasure, insertMeasure, setBarline, setClef, setEnding, setJump, setKey, setRepeatEnd, setTempo, setTime,
  toggleMark, toggleRepeatStart,
} from './index';
import { createDocument } from '../../model/create';
import { checkInvariants } from '../../model/invariants';
import { effectiveClef, sequenceTicks } from '../../model/query';
import type { Document, Event } from '../../model/schema';
import type { Command } from '../types';
import { helloDoc, threeQuarterNotesDoc } from '../../test-helpers';

const fourBars = (): Document => createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 4 });
const ids = (doc: Document) => doc.global.measures.map((m) => m.id);
const restEv = (id: string, base: 'quarter' | 'eighth' | 'half' = 'quarter'): Event => ({ id, type: 'event', duration: { base, dots: 0 }, rest: true });

const setSelectionTo: Command<string[]> = { label: 'sel', run: (d: { selection: { ids: string[] } }, ids: string[]) => { d.selection.ids = ids; } };

/** Flute 4/4, two bars: a whole note C5 (event w, note wn), then a full-measure rest. */
function wholeNoteDoc(): Document {
  const doc = createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 2 });
  doc.parts[0].measures[0].sequences[0].content = [
    { id: 'w', type: 'event', duration: { base: 'whole', dots: 0 }, notes: [{ id: 'wn', pitch: { step: 'C', octave: 5, alter: 0 } }] },
  ];
  return doc;
}

test('setTime refills sequences', () => {
  const store = createEditorStore(threeQuarterNotesDoc());  // 4/4 bar: three quarter notes + quarter rest
  const m = store.getState().document.global.measures[0].id;
  store.dispatch(setTime, { measureId: m, time: { count: 2, unit: 4 } });
  const seq = store.getState().document.parts[0].measures[0].sequences[0];
  expect(sequenceTicks(seq)).toBe(1920); expect(seq.content).toHaveLength(2);
  store.dispatch(setTime, { measureId: m, time: { count: 6, unit: 4 } });
  expect(sequenceTicks(store.getState().document.parts[0].measures[0].sequences[0])).toBe(5760);
  expect(store.getState().invariantErrors).toEqual([]);
});

test('setTime splits an overlapping note into tied pieces and keeps its ids', () => {
  const store = createEditorStore(wholeNoteDoc());
  const [m0] = ids(store.getState().document);
  store.dispatch(setTime, { measureId: m0, time: { count: 5, unit: 8 } });
  const doc = store.getState().document;
  const content = doc.parts[0].measures[0].sequences[0].content as Event[];
  expect(content.map((e) => e.duration)).toEqual([{ base: 'half', dots: 0 }, { base: 'eighth', dots: 0 }]);
  expect(content[0].id).toBe('w');
  expect(content[0].notes![0].id).toBe('wn');
  expect(content[0].notes![0].tie).toEqual({ target: content[1].notes![0].id });
  expect(content[1].notes![0].pitch).toEqual({ step: 'C', octave: 5, alter: 0 });
  expect(content[1].notes![0].tie).toBeUndefined();
  // The following bar inherits 5/8; its full-measure rest stays as is.
  expect(doc.parts[0].measures[1].sequences[0].content).toHaveLength(1);
  expect(store.getState().invariantErrors).toEqual([]);
  store.undo();
  expect(store.getState().document.parts[0].measures[0].sequences[0].content).toHaveLength(1);
});

test('setTime refills following bars that inherit the time, not those after the next change', () => {
  const doc = fourBars();
  for (const pm of doc.parts[0].measures) pm.sequences[0].content = [0, 1, 2, 3].map((i) => restEv(`${pm.id}-${i}`));
  doc.global.measures[2].time = { count: 4, unit: 4 };
  const store = createEditorStore(doc);
  store.dispatch(setTime, { measureId: doc.global.measures[0].id, time: { count: 3, unit: 4 } });
  const lengths = store.getState().document.parts[0].measures.map((pm) => sequenceTicks(pm.sequences[0]));
  expect(lengths).toEqual([2880, 2880, 3840, 3840]);
  expect(store.getState().invariantErrors).toEqual([]);
});

test('setTime pulls a cursor past the new bar end onto the last event of the bar', () => {
  const store = createEditorStore(threeQuarterNotesDoc());
  const [m0] = ids(store.getState().document);
  store.dispatch({ label: 'c', run: (d) => { d.cursor.tick = 2880; } }, {}, { record: false });
  store.dispatch(setTime, { measureId: m0, time: { count: 2, unit: 4 } });
  expect(store.getState().cursor.tick).toBe(960);
});

test('setTime, setKey and setTempo with the current value record nothing', () => {
  const doc = fourBars();
  doc.global.measures[1].tempo = { bpm: 90, unit: 'quarter' };
  const store = createEditorStore(doc);
  const [m0, m1] = ids(doc);
  store.dispatch(setTime, { measureId: m0, time: { count: 4, unit: 4 } });
  store.dispatch(setKey, { measureId: m0, key: { fifths: 0 } });
  store.dispatch(setTempo, { measureId: m1, tempo: { bpm: 90, unit: 'quarter' } });
  expect(store.canUndo()).toBe(false);
  store.dispatch(setTempo, { measureId: m1, tempo: { bpm: 90, unit: 'quarter', text: 'Andante' } });
  store.dispatch(setKey, { measureId: m0, key: { fifths: 0, mode: 'minor' } });
  expect(store.getState().history.past).toHaveLength(2);
});

test('setKey, setBarline and setTempo set and clear measure attributes', () => {
  const store = createEditorStore(fourBars());
  const [, m1] = ids(store.getState().document);
  store.dispatch(setKey, { measureId: m1, key: { fifths: 2 } });
  store.dispatch(setBarline, { measureId: m1, barline: 'double' });
  store.dispatch(setTempo, { measureId: m1, tempo: { bpm: 90, unit: 'quarter' } });
  let g = store.getState().document.global.measures[1];
  expect(g).toMatchObject({ key: { fifths: 2 }, barline: 'double', tempo: { bpm: 90, unit: 'quarter' } });
  store.dispatch(setTempo, { measureId: m1, tempo: null });
  g = store.getState().document.global.measures[1];
  expect('tempo' in g).toBe(false);
  expect(store.getState().history.past).toHaveLength(4);
});

test('setClef changes the initial clef in bar 1 and adds a clef change later', () => {
  const store = createEditorStore(fourBars());
  const doc0 = store.getState().document;
  const partId = doc0.parts[0].id;
  const [m0, , m2] = ids(doc0);
  store.dispatch(setClef, { partId, measureId: m0, staff: 1, clef: 'bass' });
  store.dispatch(setClef, { partId, measureId: m2, staff: 1, clef: 'alto' });
  store.dispatch(setClef, { partId, measureId: m2, staff: 1, clef: 'tenor' });
  const part = store.getState().document.parts[0];
  expect(part.clefs).toEqual(['bass']);
  expect(part.measures[0].clefs).toBeUndefined();
  expect(part.measures[2].clefs).toEqual([{ staff: 1, clef: 'tenor' }]);
  expect(effectiveClef(part, 1, 1)).toBe('bass');
  expect(effectiveClef(part, 3, 1)).toBe('tenor');
});

test('toggleMark and setJump', () => {
  const store = createEditorStore(fourBars());
  const [m0, , m2, m3] = ids(store.getState().document);
  store.dispatch(toggleMark, { measureId: m0, mark: 'segno' });
  store.dispatch(toggleMark, { measureId: m2, mark: 'fine' });
  store.dispatch(setJump, { measureId: m3, jump: { type: 'ds', target: 'fine' } });
  expect(store.getState().invariantErrors).toEqual([]);
  expect(store.getState().document.global.measures[0].segno).toBe(true);
  store.dispatch(toggleMark, { measureId: m0, mark: 'segno' });
  expect('segno' in store.getState().document.global.measures[0]).toBe(false);
  expect(store.getState().invariantErrors).toContain('jump-targets: a D.S. jump needs a segno');
  store.dispatch(setJump, { measureId: m3, jump: null });
  expect(store.getState().invariantErrors).toContain('jump-targets: Fine needs a jump targeting fine');
});

test('insert and delete measure keep parts aligned', () => {
  const store = createEditorStore(helloDoc());
  const [m0] = ids(store.getState().document);
  store.dispatch(insertMeasure, { afterMeasureId: m0 });
  let doc = store.getState().document;
  expect(doc.global.measures).toHaveLength(2);
  expect(doc.parts[0].measures).toHaveLength(2);
  expect(doc.parts[0].measures[1].sequences[0].content[0]).toMatchObject({ rest: true, fullMeasure: true });
  expect(store.getState().cursor).toMatchObject({ measureId: doc.global.measures[1].id, tick: 0 });
  expect(store.getState().invariantErrors).toEqual([]);

  store.dispatch(deleteMeasure, { measureId: doc.global.measures[1].id });
  doc = store.getState().document;
  expect(doc.global.measures).toHaveLength(1);
  expect(doc.parts[0].measures).toHaveLength(1);
  expect(store.getState().cursor.measureId).toBe(m0);
  expect(store.getState().invariantErrors).toEqual([]);

  const before = store.getState().document;
  const entries = store.getState().history.past.length;
  store.dispatch(deleteMeasure, { measureId: m0 });
  expect(store.getState().document).toBe(before);
  expect(store.getState().history.past).toHaveLength(entries);

  store.undo();
  expect(store.getState().document.global.measures).toHaveLength(2);
  expect(store.getState().cursor.measureId).toBe(store.getState().document.global.measures[1].id);
});

test('insertMeasure at the start keeps the time and key in bar 1', () => {
  const doc = createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 1, time: { count: 3, unit: 4 }, key: { fifths: -2 } });
  const store = createEditorStore(doc);
  store.dispatch(insertMeasure, { afterMeasureId: null });
  const g = store.getState().document.global.measures;
  expect(g).toHaveLength(2);
  expect(g[0]).toMatchObject({ time: { count: 3, unit: 4 }, key: { fifths: -2 } });
  expect(store.getState().cursor.measureId).toBe(g[0].id);
  expect(store.getState().invariantErrors).toEqual([]);
});

test('deleteMeasure carries a time change forward and prunes ties and slurs into the deleted bar', () => {
  const doc = createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 3 });
  const [p0, p1] = doc.parts[0].measures;
  p0.sequences[0].content = [{
    id: 'a', type: 'event', duration: { base: 'whole', dots: 0 },
    notes: [{ id: 'an', pitch: { step: 'C', octave: 5, alter: 0 }, tie: { target: 'bn' } }],
    slurs: [{ id: 's', target: 'b' }],
  }];
  p1.sequences[0].content = [{ id: 'b', type: 'event', duration: { base: 'half', dots: 0 }, notes: [{ id: 'bn', pitch: { step: 'C', octave: 5, alter: 0 } }] }, restEv('r', 'half')];
  doc.global.measures[1].time = { count: 2, unit: 2 };
  expect(checkInvariants(doc)).toEqual([]);
  const store = createEditorStore(doc);
  store.dispatch(setSelectionTo, ['b', 'a']);
  store.dispatch(deleteMeasure, { measureId: doc.global.measures[1].id });
  const next = store.getState().document;
  expect(next.global.measures[1].time).toEqual({ count: 2, unit: 2 });
  const first = next.parts[0].measures[0].sequences[0].content[0] as Event;
  expect(first.notes![0].tie).toBeUndefined();
  expect(first.slurs).toBeUndefined();
  expect(store.getState().selection.ids).toEqual(['a']);
  expect(store.getState().invariantErrors).toEqual([]);
});

test('repeat and ending commands compile to valid navigation', () => {
  const store = createEditorStore(fourBars());
  const [m0, m1, m2, m3] = ids(store.getState().document);
  store.dispatch(toggleRepeatStart, { measureId: m1 });
  store.dispatch(setEnding, { measureId: m2, numbers: [1] });
  store.dispatch(setRepeatEnd, { measureId: m2, times: 2 });
  store.dispatch(setEnding, { measureId: m3, numbers: [2] });
  const g = store.getState().document.global.measures;
  expect(g[1].repeatStart).toBe(true);
  expect(g[2]).toMatchObject({ ending: { numbers: [1] }, repeatEnd: { times: 2 } });
  expect(g[3].ending).toEqual({ numbers: [2] });
  expect(store.getState().invariantErrors).toEqual([]);

  store.dispatch(setEnding, { measureId: m0, numbers: [1] });
  expect(store.getState().invariantErrors.some((m) => m.startsWith('ending-after-repeat:'))).toBe(true);
  store.dispatch(setEnding, { measureId: m0, numbers: null });
  store.dispatch(setRepeatEnd, { measureId: m2, times: null });
  store.dispatch(toggleRepeatStart, { measureId: m1 });
  const after = store.getState().document.global.measures;
  expect('repeatEnd' in after[2]).toBe(false);
  expect('repeatStart' in after[1]).toBe(false);
  expect(store.getState().invariantErrors.some((m) => m.startsWith('ending-after-repeat:'))).toBe(true);
});

test('setRepeatEnd without times adds a plain repeat end', () => {
  const store = createEditorStore(fourBars());
  const [, m1] = ids(store.getState().document);
  store.dispatch(setRepeatEnd, { measureId: m1 });
  expect(store.getState().document.global.measures[1].repeatEnd).toEqual({});
});

test('commands on an unknown measure are a no-op and record nothing', () => {
  const store = createEditorStore(fourBars());
  store.dispatch(setTime, { measureId: 'nope', time: { count: 3, unit: 4 } });
  store.dispatch(toggleMark, { measureId: 'nope', mark: 'coda' });
  expect(store.canUndo()).toBe(false);
});

test('rapid setTime on one bar coalesces into one undo step that restores the original notes', () => {
  const store = createEditorStore(threeQuarterNotesDoc());
  const before = store.getState().document;
  const m = before.global.measures[0].id;
  store.dispatch(setTime, { measureId: m, time: { count: 1, unit: 4 } });
  store.dispatch(setTime, { measureId: m, time: { count: 12, unit: 4 } });
  expect(store.getState().history.past).toHaveLength(1);
  store.undo();
  expect(store.getState().document).toEqual(before);
});
