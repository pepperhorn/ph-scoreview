import { createEditorStore } from '../store';
import {
  addChordNote, addSlur, deleteEvents, enterEvent, makeTuplet, removeSlur, setAccidental, setCursor, setDuration, setPitch,
  shiftOctave, stepPitch, toggleArticulation, toggleDot, toggleRest, toggleTie,
} from './index';
import { createDocument } from '../../model/create';
import { eventStarts, sequenceTicks } from '../../model/query';
import type { Document, Event, Pitch, Tuplet } from '../../model/schema';
import { helloDoc } from '../../test-helpers';

const P = (step: Pitch['step'], octave: number, alter = 0): Pitch => ({ step, octave, alter });
const q = (id: string, p: Pitch): Event => ({ id, type: 'event', duration: { base: 'quarter', dots: 0 }, notes: [{ id: `${id}n`, pitch: p }] });
const seqOf = (store: ReturnType<typeof createEditorStore>, measure = 0) => store.getState().document.parts[0].measures[measure].sequences[0];

/** Flute 4/4, two bars; bar 1: C4 D4 E4 F4 quarters (q1-q4, notes q1n-q4n); bar 2 as given (default full-measure rest). */
function quartersDoc(bar2?: Event[], key = 0): Document {
  const doc = createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 2, key: { fifths: key } });
  doc.parts[0].measures[0].sequences[0].content = [q('q1', P('C', 4)), q('q2', P('D', 4)), q('q3', P('E', 4)), q('q4', P('F', 4))];
  if (bar2) doc.parts[0].measures[1].sequences[0].content = bar2;
  return doc;
}

test('enterEvent clamps at bar end', () => {
  const store = createEditorStore(helloDoc());
  store.dispatch(setCursor, { tick: 3360, duration: { base: 'half', dots: 0 }, mode: 'enter' }, { record: false });
  store.dispatch(enterEvent, { pitch: { step: 'G', octave: 4, alter: 0 } });
  const seq = seqOf(store);
  expect(seq.content.at(-1)).toMatchObject({ duration: { base: 'eighth', dots: 0 }, notes: [{ pitch: { step: 'G' } }] });
  expect(sequenceTicks(seq)).toBe(3840);
  expect(store.getState().cursor.measureId).not.toBe(store.getState().document.global.measures[0].id);
  expect(store.getState().document.global.measures).toHaveLength(2);
  expect(store.getState().cursor).toMatchObject({ tick: 0, lastPitch: P('G', 4) });
  expect(store.getState().invariantErrors).toEqual([]);
});

test('enterEvent overwrites: shortens the note it starts inside, advances the cursor, one undo step each', () => {
  const store = createEditorStore(helloDoc());
  store.dispatch(setCursor, { tick: 480, duration: { base: 'eighth', dots: 0 }, mode: 'enter' }, { record: false });
  store.dispatch(enterEvent, { pitch: P('A', 4) });
  const starts = eventStarts(seqOf(store), 3840);
  expect(starts.map((s) => [s.tick, s.ticks])).toEqual([[0, 480], [480, 480], [960, 960], [1920, 1920]]);
  expect(starts[0].event.id).toBe('e1');
  expect(store.getState().cursor.tick).toBe(960);
  store.dispatch(enterEvent, { rest: true });
  expect(eventStarts(seqOf(store), 3840)[2].event).toMatchObject({ rest: true, duration: { base: 'eighth' } });
  expect(store.getState().invariantErrors).toEqual([]);
  store.undo();
  store.undo();
  expect(seqOf(store).content).toEqual(helloDoc().parts[0].measures[0].sequences[0].content);
});

test('enterEvent into a full-measure rest splits it into plain rests', () => {
  const store = createEditorStore(quartersDoc());
  store.dispatch(setCursor, { measureId: store.getState().document.global.measures[1].id, tick: 960, duration: { base: 'quarter', dots: 0 } }, { record: false });
  store.dispatch(enterEvent, { pitch: P('G', 4) });
  const seq = seqOf(store, 1);
  expect(seq.content.map((e) => (e as Event).rest ?? false)).toEqual([true, false, true]);
  expect(seq.content.some((e) => (e as Event).fullMeasure)).toBe(false);
  expect(store.getState().invariantErrors).toEqual([]);
});

test('entering rests over every note collapses the bar to a full-measure rest', () => {
  const store = createEditorStore(helloDoc());
  store.dispatch(setCursor, { tick: 0, duration: { base: 'half', dots: 0 } }, { record: false });
  store.dispatch(enterEvent, { rest: true });
  expect(seqOf(store).content).toMatchObject([{ rest: true, fullMeasure: true }]);
  expect(store.getState().invariantErrors).toEqual([]);
});

test('entering four eighths auto-beams them', () => {
  const store = createEditorStore(helloDoc());
  store.dispatch(setCursor, { tick: 0, duration: { base: 'eighth', dots: 0 }, mode: 'enter' }, { record: false });
  for (const step of ['C', 'D', 'E', 'F'] as const) store.dispatch(enterEvent, { pitch: P(step, 5) });
  const pm = store.getState().document.parts[0].measures[0];
  const ids = eventStarts(pm.sequences[0], 3840).slice(0, 4).map((s) => s.event.id);
  expect(pm.beams).toHaveLength(1);
  expect(pm.beams[0].events).toEqual(ids);
  expect(store.getState().invariantErrors).toEqual([]);
});

test('pitch commands: setPitch, stepPitch in the key, shiftOctave, setAccidental; pitch edits coalesce', () => {
  const store = createEditorStore(quartersDoc(undefined, 2)); // D major: F# C#
  store.dispatch(stepPitch, { noteId: 'q3n', steps: 1 });
  store.dispatch(stepPitch, { noteId: 'q3n', steps: -3 });
  const pitchOf = (id: string) => (seqOf(store).content as Event[]).flatMap((e) => e.notes ?? []).find((n) => n.id === id)!.pitch;
  expect(pitchOf('q3n')).toEqual(P('C', 4, 1));
  expect(store.getState().history.past).toHaveLength(1);
  store.dispatch(setPitch, { noteId: 'q1n', pitch: P('A', 3) });
  store.dispatch(shiftOctave, { noteId: 'q1n', octaves: 2 });
  expect(pitchOf('q1n')).toEqual(P('A', 5));
  store.dispatch(shiftOctave, { noteId: 'q1n', octaves: 9 });
  expect(pitchOf('q1n')).toEqual(P('A', 5));
  store.dispatch(setAccidental, { noteId: 'q1n', alter: -1 });
  expect(pitchOf('q1n')).toEqual(P('A', 5, -1));
  store.dispatch(addChordNote, { eventId: 'q2', pitch: P('F', 4, 1) });
  store.dispatch(addChordNote, { eventId: 'q2', pitch: P('F', 4, 1) });
  expect((seqOf(store).content[1] as Event).notes!.map((n) => n.pitch.step)).toEqual(['D', 'F']);
  expect(store.getState().invariantErrors).toEqual([]);
});

test('setPitch drops a tie that no longer joins equal pitches', () => {
  const store = createEditorStore(quartersDoc());
  store.dispatch(setPitch, { noteId: 'q2n', pitch: P('C', 4) });
  store.dispatch(toggleTie, { noteId: 'q1n' });
  expect((seqOf(store).content[0] as Event).notes![0].tie).toEqual({ target: 'q2n' });
  store.dispatch(setPitch, { noteId: 'q2n', pitch: P('D', 4) });
  expect((seqOf(store).content[0] as Event).notes![0].tie).toBeUndefined();
  expect(store.getState().invariantErrors).toEqual([]);
});

test('setDuration and toggleDot overwrite following events and leave rests when shrinking', () => {
  const store = createEditorStore(quartersDoc());
  store.dispatch(setDuration, { eventId: 'q1', duration: { base: 'half', dots: 0 } });
  expect(eventStarts(seqOf(store), 3840).map((s) => s.event.id)).toEqual(['q1', 'q3', 'q4']);
  store.dispatch(setDuration, { eventId: 'q1', duration: { base: 'quarter', dots: 0 } });
  expect(eventStarts(seqOf(store), 3840).map((s) => [s.tick, s.event.rest ?? false])).toEqual([[0, false], [960, true], [1920, false], [2880, false]]);
  store.dispatch(toggleDot, { eventId: 'q1' });
  expect(eventStarts(seqOf(store), 3840).map((s) => s.ticks)).toEqual([1440, 480, 960, 960]);
  store.dispatch(setDuration, { eventId: 'q4', duration: { base: 'whole', dots: 0 } });
  expect(sequenceTicks(seqOf(store), 3840)).toBe(3840);
  expect(eventStarts(seqOf(store), 3840).at(-1)!.event.id).toBe('q4');
  expect(store.getState().invariantErrors).toEqual([]);
});

test('toggleRest turns a note into a rest and back to the last pitch', () => {
  const store = createEditorStore(quartersDoc());
  store.dispatch(toggleRest, { eventId: 'q2' });
  expect(seqOf(store).content[1]).toMatchObject({ id: 'q2', rest: true });
  expect((seqOf(store).content[1] as Event).notes).toBeUndefined();
  store.dispatch(setCursor, { lastPitch: P('B', 4) }, { record: false });
  store.dispatch(toggleRest, { eventId: 'q2' });
  expect((seqOf(store).content[1] as Event).notes![0].pitch).toEqual(P('B', 4));
  expect(store.getState().invariantErrors).toEqual([]);
});

test('deleteEvents merges rests', () => {
  const store = createEditorStore(quartersDoc());
  store.dispatch(deleteEvents, { ids: ['q2', 'q3'] });
  const content = seqOf(store).content as Event[];
  expect(content.map((e) => [e.duration.base, e.rest ?? false])).toEqual([['quarter', false], ['half', true], ['quarter', false]]);
  expect(content[0].id).toBe('q1');
  expect(store.getState().invariantErrors).toEqual([]);
  store.dispatch(deleteEvents, { ids: ['q1', 'q4'] });
  expect(seqOf(store).content).toMatchObject([{ rest: true, fullMeasure: true }]);
  expect(store.getState().invariantErrors).toEqual([]);
});

test('makeTuplet 3 on a quarter', () => {
  const store = createEditorStore(helloDoc());
  store.dispatch(makeTuplet, { eventId: 'e1', multiple: 3 });
  const seq = seqOf(store);
  const tuplet = seq.content[0] as Tuplet;
  expect(tuplet).toMatchObject({ type: 'tuplet', outer: { multiple: 3, base: 'eighth' }, inner: { multiple: 2, base: 'eighth' } });
  expect(tuplet.content).toHaveLength(3);
  expect(tuplet.content[0]).toMatchObject({ id: 'e1', duration: { base: 'eighth', dots: 0 }, notes: [{ id: 'n1', pitch: { step: 'C', octave: 5 } }] });
  expect(tuplet.content.slice(1).every((e) => e.rest)).toBe(true);
  expect(sequenceTicks(seq)).toBe(3840);
  expect(store.getState().invariantErrors).toEqual([]);
});

test('makeTuplet 5 uses sixteenths in the time of four; dotted events are refused', () => {
  const store = createEditorStore(helloDoc());
  store.dispatch(makeTuplet, { eventId: 'e2', multiple: 5 });
  expect(seqOf(store).content[1]).toMatchObject({ outer: { multiple: 5, base: '16th' }, inner: { multiple: 4, base: '16th' } });
  expect(sequenceTicks(seqOf(store))).toBe(3840);
  store.dispatch(toggleDot, { eventId: 'e1' });
  const before = store.getState().document;
  store.dispatch(makeTuplet, { eventId: 'e1', multiple: 3 });
  expect(store.getState().document).toBe(before);
});

test('toggleArticulation adds and removes', () => {
  const store = createEditorStore(helloDoc());
  store.dispatch(toggleArticulation, { eventId: 'e1', articulation: 'staccato' });
  expect((seqOf(store).content[0] as Event).articulations).toEqual(['staccato']);
  store.dispatch(toggleArticulation, { eventId: 'e1', articulation: 'staccato' });
  expect((seqOf(store).content[0] as Event).articulations).toBeUndefined();
});

test('toggleTie links equal pitches across the barline', () => {
  const store = createEditorStore(quartersDoc([q('b1', P('F', 4)), { id: 'r', type: 'event', duration: { base: 'half', dots: 1 }, rest: true }]));
  store.dispatch(toggleTie, { noteId: 'q4n' });
  expect((seqOf(store).content[3] as Event).notes![0].tie).toEqual({ target: 'b1n' });
  expect(store.getState().invariantErrors).toEqual([]);
  store.dispatch(toggleTie, { noteId: 'q4n' });
  expect((seqOf(store).content[3] as Event).notes![0].tie).toBeUndefined();
});

test('toggleTie without a matching pitch in the next event is a no-op', () => {
  const store = createEditorStore(quartersDoc());
  store.dispatch(toggleTie, { noteId: 'q1n' });
  store.dispatch(toggleTie, { noteId: 'q4n' });
  expect(store.getState().history.past).toHaveLength(0);
});

test('addSlur orders its ends; removeSlur removes it', () => {
  const store = createEditorStore(quartersDoc());
  store.dispatch(addSlur, { fromEventId: 'q4', toEventId: 'q2' });
  const slurs = (seqOf(store).content[1] as Event).slurs!;
  expect(slurs).toMatchObject([{ target: 'q4' }]);
  expect(store.getState().invariantErrors).toEqual([]);
  store.dispatch(removeSlur, { slurId: slurs[0].id });
  expect((seqOf(store).content[1] as Event).slurs).toBeUndefined();
});
