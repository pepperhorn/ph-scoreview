import { createEditorStore, type EditorStore } from '../engine/store';
import { extendSelection, moveCursor, setChordMode, setCursor, setKey, setSelection } from '../engine/commands/index';
import { createDocument } from '../model/create';
import { eventStarts } from '../model/query';
import type { Event, Pitch } from '../model/schema';
import { helloDoc } from '../test-helpers';
import { describeKey, enterPitch, handleKey, KEYMAP, type KeyContext } from './keymap';
import { pianoSpelling, pitchForLetter } from './pitch-entry';

type Mods = { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean; composing?: boolean };
type FakeEvent = KeyboardEvent & { prevented: boolean };

function keyEvent(key: string, mods: Mods = {}, target: unknown = null): FakeEvent {
  const event = {
    key, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift, altKey: !!mods.alt, isComposing: !!mods.composing, target, prevented: false,
    preventDefault() { event.prevented = true; },
  };
  return event as unknown as FakeEvent;
}

function setup(doc = helloDoc()) {
  const store = createEditorStore(doc);
  const popovers: string[] = [];
  let plays = 0;
  const ctx: KeyContext = { store, openPopover: (name) => popovers.push(name), play: () => { plays++; } };
  const press = (key: string, mods?: Mods) => handleKey(keyEvent(key, mods), ctx);
  return { store, ctx, press, popovers, plays: () => plays };
}

const P = (step: Pitch['step'], octave: number, alter = 0): Pitch => ({ step, octave, alter });
const q = (id: string, p: Pitch): Event => ({ id, type: 'event', duration: { base: 'quarter', dots: 0 }, notes: [{ id: `${id}n`, pitch: p }] });
const bar = (store: EditorStore, i = 0) => eventStarts(store.getState().document.parts[0].measures[i].sequences[0], 3840).map((s) => s.event);

/** Flute 4/4, two bars of C4 D4 E4 F4 / G4 A4 B4 C5 quarters (a1-a4, b1-b4). */
function twoBars() {
  const doc = createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 2 });
  doc.parts[0].measures[0].sequences[0].content = [q('a1', P('C', 4)), q('a2', P('D', 4)), q('a3', P('E', 4)), q('a4', P('F', 4))];
  doc.parts[0].measures[1].sequences[0].content = [q('b1', P('G', 4)), q('b2', P('A', 4)), q('b3', P('B', 4)), q('b4', P('C', 5))];
  return doc;
}

test('n toggles entry mode and is consumed', () => {
  const { store, press } = setup();
  const event = keyEvent('n');
  expect(handleKey(event, setup().ctx)).toBe(true);
  expect(event.prevented).toBe(true);
  expect(press('n')).toBe(true);
  expect(store.getState().cursor.mode).toBe('enter');
  press('n');
  expect(store.getState().cursor.mode).toBe('select');
  expect(store.getState().history.past).toEqual([]);
});

test('4 then c enters a quarter C; ArrowUp raises it to D; Ctrl+z undoes', () => {
  const { store, press } = setup();
  press('n');
  press('4');
  expect(store.getState().cursor.duration).toEqual({ base: 'quarter', dots: 0 });
  expect(press('c')).toBe(true);
  expect(bar(store)[0]).toMatchObject({ duration: { base: 'quarter', dots: 0 }, notes: [{ pitch: P('C', 4) }] });
  expect(store.getState().cursor).toMatchObject({ tick: 960, lastPitch: P('C', 4) });
  press('ArrowUp');
  expect(bar(store)[0].notes![0].pitch).toEqual(P('D', 4));
  press('ArrowUp', { ctrl: true });
  expect(bar(store)[0].notes![0].pitch).toEqual(P('D', 5));
  press('z', { ctrl: true });
  expect(bar(store)[0].notes![0].pitch).toEqual(P('D', 4));
  press('z', { meta: true });
  expect(bar(store)[0].notes![0].pitch).toEqual(P('C', 4));
  press('Z', { ctrl: true, shift: true });
  expect(bar(store)[0].notes![0].pitch).toEqual(P('D', 4));
  press('z', { ctrl: true });
  press('y', { ctrl: true });
  expect(bar(store)[0].notes![0].pitch).toEqual(P('D', 4));
});

test('a key in an input, textarea or contentEditable target is not consumed', () => {
  const { store, ctx } = setup();
  for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
    const event = keyEvent('n', {}, target);
    expect(handleKey(event, ctx)).toBe(false);
    expect(event.prevented).toBe(false);
  }
  expect(store.getState().cursor.mode).toBe('select');
  expect(handleKey(keyEvent('n', {}, { tagName: 'DIV' }), ctx)).toBe(true);
});

test('unbound keys and 7 are not consumed', () => {
  const { press } = setup();
  press('n');
  expect(press('7')).toBe(false);
  expect(press('x')).toBe(false);
});

test('digits 1-6 set the cursor duration', () => {
  const { store, press } = setup();
  press('n');
  const bases = ['32nd', '16th', 'eighth', 'quarter', 'half', 'whole'];
  bases.forEach((base, i) => {
    press(String(i + 1));
    expect(store.getState().cursor.duration).toEqual({ base, dots: 0 });
  });
});

test('pitch letters take the octave nearest the last pitch and the key signature alteration', () => {
  expect(pitchForLetter('C', undefined, 0)).toEqual(P('C', 4));
  expect(pitchForLetter('B', undefined, 0)).toEqual(P('B', 3));
  expect(pitchForLetter('G', undefined, 0)).toEqual(P('G', 3));
  expect(pitchForLetter('A', P('E', 5), 0)).toEqual(P('A', 5));
  expect(pitchForLetter('F', P('C', 4), 0)).toEqual(P('F', 4)); // 5 up vs 7 down
  expect(pitchForLetter('F', P('B', 4), 0)).toEqual(P('F', 5)); // tritone either way: the higher
  expect(pitchForLetter('F', P('C', 4), 2)).toEqual(P('F', 4, 1));
  expect(pitchForLetter('B', P('C', 5), -1)).toEqual(P('B', 4, -1));
});

test('in select mode note letters, digits and rests are ignored; c and d open popovers', () => {
  const { store, press, popovers } = setup();
  const before = store.getState().document;
  expect(press('e')).toBe(false);
  expect(press('4')).toBe(false);
  expect(press('0')).toBe(false);
  expect(store.getState().document).toBe(before);
  for (const k of ['c', 'd', 'k', 'q', 'v', 'j']) expect(press(k)).toBe(true);
  expect(popovers).toEqual(['clef', 'dynamic', 'key', 'time', 'ending', 'jump']);
});

test('in enter mode c and d enter notes; 0 enters a rest; . dots the last event', () => {
  const { store, press, popovers } = setup();
  press('n');
  press('d');
  press('0');
  expect(bar(store).slice(0, 2)).toMatchObject([{ notes: [{ pitch: P('D', 4) }] }, { rest: true }]);
  press('.');
  expect(bar(store)[1].duration).toEqual({ base: 'quarter', dots: 1 });
  expect(popovers).toEqual([]);
});

test('articulation keys match the typed character and toggle on the last entered event', () => {
  const { store, press } = setup();
  press('n');
  press('e');
  press('S', { shift: true });
  press('-');
  press('>', { shift: true }); // Shift+. on a US layout
  press('^', { shift: true }); // Shift+6 on a US layout
  expect(bar(store)[0].articulations).toEqual(['staccato', 'tenuto', 'accent', 'marcato']);
  press('>'); // a layout that types > without Shift
  expect(bar(store)[0].articulations).toEqual(['staccato', 'tenuto', 'marcato']);
  expect(press('<', { shift: true })).toBe(false);
  expect(press('s')).toBe(true); // plain s is the slur, not staccato
  expect(bar(store)[0].articulations).toEqual(['staccato', 'tenuto', 'marcato']);
});

test('articulations and tuplets work on the selected event in select mode', () => {
  const { store, press } = setup();
  store.dispatch(setSelection, { ids: ['e2'] }, { record: false });
  expect(press('>', { shift: true })).toBe(true);
  expect(press('S', { shift: true })).toBe(true);
  expect(bar(store)[1].articulations).toEqual(['accent', 'staccato']);
  expect(press('3', { ctrl: true })).toBe(true);
  expect(store.getState().document.parts[0].measures[0].sequences[0].content[1]).toMatchObject({ type: 'tuplet', outer: { multiple: 3 } });
});

test('Ctrl+3 makes a triplet of the last event, with or without Shift (AZERTY)', () => {
  const { store, press } = setup();
  press('n');
  press('c');
  expect(press('3', { ctrl: true, shift: true })).toBe(true);
  expect(store.getState().document.parts[0].measures[0].sequences[0].content[0]).toMatchObject({ type: 'tuplet', outer: { multiple: 3 } });
});

test('digit durations ignore Shift (AZERTY)', () => {
  const { store, press } = setup();
  press('n');
  expect(press('5', { shift: true })).toBe(true);
  expect(store.getState().cursor.duration).toEqual({ base: 'half', dots: 0 });
});

test('Space on a focused button and IME composition are not consumed', () => {
  const { ctx, plays } = setup();
  const onButton = keyEvent(' ', {}, { tagName: 'BUTTON' });
  expect(handleKey(onButton, ctx)).toBe(false);
  expect(onButton.prevented).toBe(false);
  expect(plays()).toBe(0);
  expect(handleKey(keyEvent('n', { composing: true }), ctx)).toBe(false);
  expect(ctx.store.getState().cursor.mode).toBe('select');
  expect(handleKey(keyEvent('n', {}, { tagName: 'BUTTON' }), ctx)).toBe(true);
});

test('t ties the last note to the next equal pitch; s slurs the last two entered', () => {
  const { store, press } = setup();
  press('n');
  press('c');
  press('c');
  press('ArrowLeft');
  press('ArrowLeft');
  expect(store.getState().cursor.tick).toBe(0);
  press('ArrowRight');
  press('t');
  const [first, second] = bar(store);
  expect(first.notes![0].tie).toEqual({ target: second.notes![0].id });
  press('ArrowRight');
  press('s');
  expect(bar(store)[0].slurs).toMatchObject([{ target: second.id }]);
});

test('s uses two selected events in time order', () => {
  const { store, press } = setup(twoBars());
  store.dispatch(setSelection, { ids: ['b2', 'a3'] }, { record: false });
  press('s');
  expect(bar(store)[2].slurs).toMatchObject([{ target: 'b2' }]);
});

test('arrows move by event across bars; Ctrl by measure; Shift extends the selection', () => {
  const { store, press } = setup(twoBars());
  const [m1, m2] = store.getState().document.global.measures.map((m) => m.id);
  store.dispatch(setCursor, { measureId: m1, tick: 2880 }, { record: false });
  press('ArrowRight');
  expect(store.getState().cursor).toMatchObject({ measureId: m2, tick: 0 });
  press('ArrowLeft');
  expect(store.getState().cursor).toMatchObject({ measureId: m1, tick: 2880 });
  press('ArrowRight', { ctrl: true });
  expect(store.getState().cursor).toMatchObject({ measureId: m2, tick: 0 });
  press('ArrowRight', { ctrl: true });
  expect(store.getState().cursor).toMatchObject({ measureId: m2, tick: 0 });
  press('ArrowLeft', { ctrl: true });
  press('ArrowLeft');
  expect(store.getState().cursor).toMatchObject({ measureId: m1, tick: 0 });
  store.dispatch(setSelection, { ids: ['a1'] }, { record: false });
  press('ArrowRight', { shift: true });
  press('ArrowRight', { shift: true });
  expect(store.getState().selection.ids).toEqual(['a1', 'a2', 'a3']);
  expect(store.getState().cursor.tick).toBe(1920);
  store.dispatch(extendSelection, { delta: 2 }, { record: false });
  expect(store.getState().cursor).toMatchObject({ measureId: m2, tick: 0 });
  expect(store.getState().selection.ids).toEqual(['a1', 'a2', 'a3', 'a4', 'b1']);
  store.dispatch(extendSelection, { delta: -1 }, { record: false });
  expect(store.getState().selection.ids).toEqual(['a1', 'a2', 'a3', 'a4']);
  expect(store.getState().history.past).toEqual([]);
});

test('Delete turns the selection (or the last event) into rests; Space plays; Escape leaves entry mode', () => {
  const { store, press, plays } = setup(twoBars());
  store.dispatch(setSelection, { ids: ['a2', 'a3'] }, { record: false });
  press('Delete');
  expect(bar(store).map((e) => !!e.rest)).toEqual([false, true, false]);
  store.dispatch(setSelection, { ids: [] }, { record: false });
  store.dispatch(setCursor, { tick: 960 }, { record: false });
  press('Backspace');
  expect(bar(store).map((e) => !!e.rest)).toEqual([true, false]);
  press(' ');
  expect(plays()).toBe(1);
  press('n');
  press('Escape');
  expect(store.getState().cursor.mode).toBe('select');
});

test('r cycles the cursor bar barline: regular, double, repeat start, repeat end, final, regular', () => {
  const { store, press } = setup();
  const g = () => store.getState().document.global.measures[0];
  const seen: unknown[] = [];
  for (let i = 0; i < 5; i++) {
    press('r');
    seen.push([g().barline, g().repeatStart, g().repeatEnd]);
  }
  expect(seen).toEqual([['double', undefined, undefined], [undefined, true, undefined], [undefined, undefined, {}], ['final', undefined, undefined], [undefined, undefined, undefined]]);
  expect(store.getState().history.past).toHaveLength(5);
});

test('b cycles the beam grouping 2, 3, 4, auto; / breaks the beam', () => {
  const doc = createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 1 });
  const e = (id: string): Event => ({ id, type: 'event', duration: { base: 'eighth', dots: 0 }, notes: [{ id: `${id}n`, pitch: P('C', 5) }] });
  doc.parts[0].measures[0].sequences[0].content = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8'].map(e);
  const { store, press } = setup(doc);
  const beams = () => store.getState().document.parts[0].measures[0].beams.map((b) => b.events.length);
  store.dispatch(setSelection, { ids: ['e1'] }, { record: false });
  press('b');
  expect(beams()).toEqual([2, 2, 2, 2]);
  press('b');
  expect(beams()).toEqual([3, 3, 2]);
  press('b');
  expect(beams()).toEqual([4, 4]);
  press('b'); // auto: 4/4 eighths pair across each half bar
  expect(beams()).toEqual([4, 4]);
  press('b');
  expect(beams()).toEqual([2, 2, 2, 2]);
  store.dispatch(setSelection, { ids: ['e2'] }, { record: false });
  press('/');
  expect(beams()).toEqual([2, 2, 2]);
});

test('every binding has keys, a label and a description', () => {
  for (const binding of KEYMAP) {
    expect(binding.keys.length).toBeGreaterThan(0);
    expect(binding.label).not.toBe('');
  }
  const redo = KEYMAP.find((b) => b.label === 'Redo')!;
  expect(describeKey(redo)).toBe('Ctrl+Shift+Z / Ctrl+Y');
});

const ticksOf = (store: EditorStore) => eventStarts(store.getState().document.parts[0].measures[0].sequences[0], 3840).map((s) => [s.tick, s.event.duration, s.event.notes?.[0]?.pitch.step ?? 'rest']);

test('n 4 c . d: the dot lengthens the C and D follows it at 1440', () => {
  const { store, press } = setup(createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 2 }));
  for (const k of ['n', '4', 'c', '.', 'd']) press(k);
  expect(ticksOf(store).slice(0, 2)).toEqual([[0, { base: 'quarter', dots: 1 }, 'C'], [1440, { base: 'quarter', dots: 0 }, 'D']]);
  expect(store.getState().cursor).toMatchObject({ tick: 2400, duration: { base: 'quarter', dots: 0 } });
});

test('n 4 . c: the dot applies to the entry duration', () => {
  const { store, press } = setup(createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 2 }));
  for (const k of ['n', '4', '.']) press(k);
  expect(store.getState().cursor.duration).toEqual({ base: 'quarter', dots: 1 });
  press('c');
  expect(ticksOf(store)[0]).toEqual([0, { base: 'quarter', dots: 1 }, 'C']);
  expect(store.getState().cursor.tick).toBe(1440);
  press('.'); // the entry duration is dotted: . turns that off, the C keeps its dot
  expect(store.getState().cursor.duration).toEqual({ base: 'quarter', dots: 0 });
  expect(ticksOf(store)[0]).toEqual([0, { base: 'quarter', dots: 1 }, 'C']);
});

test('after moving the cursor, . in entry mode dots the entry duration, not the event before', () => {
  const { store, press } = setup(twoBars());
  press('n');
  store.dispatch(setCursor, { tick: 960 }, { record: false });
  press('.');
  expect(store.getState().cursor.duration).toEqual({ base: 'quarter', dots: 1 });
  expect(bar(store)[0].duration).toEqual({ base: 'quarter', dots: 0 });
});

test('. in select mode toggles the selected event dot', () => {
  const { store, press } = setup(twoBars());
  store.dispatch(setSelection, { ids: ['a1'] }, { record: false });
  press('.');
  expect(bar(store)[0].duration).toEqual({ base: 'quarter', dots: 1 });
  expect(store.getState().cursor.duration).toEqual({ base: 'quarter', dots: 0 });
});

test('entry-mode . on the entry duration is not an undo step', () => {
  const { store, press } = setup();
  for (const k of ['n', '4', '.']) press(k);
  expect(store.getState().history.past).toEqual([]);
  press('c'); // a dotted C
  press('.'); // entry duration back to a quarter: cursor-only
  press('.'); // right after the C: removes its dot, recorded
  expect(store.getState().history.past.map((e) => e.label)).toEqual(['Enter note', 'Toggle dot']);
  expect(bar(store)[0].duration).toEqual({ base: 'quarter', dots: 0 });
  expect(store.getState().cursor.tick).toBe(960);
});

const pitches = (e: Event) => e.notes!.map((n) => n.pitch);

test('+ sharpens, _ flattens (to double accidentals at most), = restores the natural', () => {
  const { store, press } = setup();
  for (const k of ['n', '4', 'c']) press(k);
  expect(press('+', { shift: true })).toBe(true);
  expect(pitches(bar(store)[0])).toEqual([P('C', 4, 1)]);
  press('+');
  press('+');
  expect(pitches(bar(store)[0])).toEqual([P('C', 4, 2)]);
  press('=');
  expect(pitches(bar(store)[0])).toEqual([P('C', 4)]);
  press('_', { shift: true });
  press('_');
  press('_');
  expect(pitches(bar(store)[0])).toEqual([P('C', 4, -2)]);
  expect(press('-')).toBe(true); // still tenuto
  expect(bar(store)[0].articulations).toEqual(['tenuto']);
});

test('accidentals and semitone steps work on the selected note in select mode', () => {
  const { store, press } = setup(twoBars());
  store.dispatch(setSelection, { ids: ['a3'] }, { record: false });
  expect(press('ArrowUp', { alt: true })).toBe(true);
  expect(pitches(bar(store)[2])).toEqual([P('F', 4)]);
  press('ArrowUp', { alt: true });
  expect(pitches(bar(store)[2])).toEqual([P('F', 4, 1)]);
  press('ArrowDown', { alt: true });
  press('ArrowDown', { alt: true });
  press('ArrowDown', { alt: true });
  expect(pitches(bar(store)[2])).toEqual([P('E', 4, -1)]);
  press('+');
  expect(pitches(bar(store)[2])).toEqual([P('E', 4)]);
});

test('Shift+letter adds that letter to the target event chord, near its top note, in the key; the cursor stays', () => {
  const { store, press } = setup();
  const m1 = store.getState().document.global.measures[0].id;
  store.dispatch(setKey, { measureId: m1, key: { fifths: 2 } });
  for (const k of ['n', '4', 'd']) press(k);
  const cursor = store.getState().cursor;
  expect(press('F', { shift: true })).toBe(true);
  expect(press('A', { shift: true })).toBe(true);
  expect(pitches(bar(store)[0])).toEqual([P('D', 4), P('F', 4, 1), P('A', 4)]);
  press('D', { shift: true }); // nearest the top note A4
  expect(pitches(bar(store)[0])).toEqual([P('D', 4), P('F', 4, 1), P('A', 4), P('D', 5)]);
  press('A', { shift: true }); // A4 is already there: an octave above
  expect(pitches(bar(store)[0])).toEqual([P('D', 4), P('F', 4, 1), P('A', 4), P('D', 5), P('A', 5)]);
  expect(store.getState().cursor).toEqual(cursor);
  expect(press('S', { shift: true })).toBe(true); // Shift+S stays staccato
  expect(bar(store)[0].articulations).toEqual(['staccato']);
});

test('with "Add to chord" on, plain letters add to the chord instead of entering', () => {
  const { store, press } = setup();
  for (const k of ['n', '4', 'c']) press(k);
  store.dispatch(setChordMode, { on: true }, { record: false });
  const cursor = store.getState().cursor;
  press('e');
  press('g');
  expect(pitches(bar(store)[0])).toEqual([P('C', 4), P('E', 4), P('G', 4)]);
  expect(store.getState().cursor.tick).toBe(cursor.tick);
  store.dispatch(setChordMode, { on: false }, { record: false });
  press('d');
  expect(pitches(bar(store)[1])).toEqual([P('D', 4)]);
});

test('plain arrows replace the selection with the event at the cursor: click C, three rights, Delete deletes F', () => {
  const { store, press } = setup(twoBars());
  store.dispatch(setCursor, { tick: 0 }, { record: false });
  store.dispatch(setSelection, { ids: ['a1'] }, { record: false }); // a click on the C
  press('ArrowRight');
  expect(store.getState().selection.ids).toEqual(['a2']);
  press('ArrowRight');
  press('ArrowRight');
  expect(store.getState().selection.ids).toEqual(['a4']);
  press('Delete');
  expect(bar(store).map((e) => (e.rest ? 'rest' : e.notes![0].pitch.step))).toEqual(['C', 'D', 'E', 'rest']);
});

test('Ctrl+arrows select the event at the new cursor; Escape in select mode clears the selection', () => {
  const { store, press } = setup(twoBars());
  store.dispatch(setSelection, { ids: ['a1', 'a2'] }, { record: false });
  press('ArrowRight', { ctrl: true });
  expect(store.getState().selection.ids).toEqual(['b1']);
  store.dispatch(setSelection, { ids: ['a3'] }, { record: false });
  press('Escape');
  expect(store.getState().selection.ids).toEqual([]);
});

test('in entry mode arrows clear the selection so the target stays the event before the cursor', () => {
  const { store, press } = setup(twoBars());
  press('n');
  store.dispatch(setSelection, { ids: ['a1'] }, { record: false });
  press('ArrowRight');
  expect(store.getState().selection.ids).toEqual([]);
});

test('Shift+Left after Shift+Right shrinks the selection back to the anchor, then extends left', () => {
  const { store, press } = setup(twoBars());
  store.dispatch(setCursor, { tick: 960 }, { record: false });
  store.dispatch(setSelection, { ids: ['a2'] }, { record: false });
  press('ArrowRight', { shift: true });
  press('ArrowRight', { shift: true });
  expect(store.getState().selection.ids).toEqual(['a2', 'a3', 'a4']);
  press('ArrowLeft', { shift: true });
  expect(store.getState().selection.ids).toEqual(['a2', 'a3']);
  press('ArrowLeft', { shift: true });
  expect(store.getState().selection.ids).toEqual(['a2']);
  press('ArrowLeft', { shift: true });
  expect([...store.getState().selection.ids].sort()).toEqual(['a1', 'a2']);
  press('ArrowRight', { shift: true });
  expect(store.getState().selection.ids).toEqual(['a2']);
});

test('Shift+arrow with no selection anchors on the cursor event', () => {
  const { store, press } = setup(twoBars());
  store.dispatch(setCursor, { tick: 1920 }, { record: false });
  press('ArrowLeft', { shift: true });
  expect([...store.getState().selection.ids].sort()).toEqual(['a2', 'a3']);
});

test('n 4 c d e Escape Delete deletes the E (the last entered note), not the rest after it', () => {
  const { store, press } = setup(createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 2 }));
  for (const k of ['n', '4', 'c', 'd', 'e', 'Escape']) press(k);
  const e = bar(store)[2];
  expect(store.getState().selection.ids).toEqual([e.id]);
  press('Delete');
  expect(bar(store).map((x) => (x.rest ? 'rest' : x.notes![0].pitch.step))).toEqual(['C', 'D', 'rest']);
  expect(bar(store)[2].duration).toEqual({ base: 'half', dots: 0 }); // the E's rest merged with the rest that followed
});

test('Escape in select mode clears the selection', () => {
  const { store, press } = setup(twoBars());
  store.dispatch(setSelection, { ids: ['a2'] }, { record: false });
  press('Escape');
  expect(store.getState().selection.ids).toEqual([]);
});

test('after Escape and n again, . toggles the entry duration, not the old note', () => {
  const { store, press } = setup(createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 2 }));
  for (const k of ['n', '4', 'c', 'Escape', 'n', '.']) press(k);
  expect(store.getState().cursor.duration).toEqual({ base: 'quarter', dots: 1 });
  expect(bar(store)[0].duration).toEqual({ base: 'quarter', dots: 0 });
  expect(store.getState().cursor.entered).toBeUndefined();
});

test('Shift+Left from a cursor past the last event start anchors on the event before the cursor', () => {
  const { store, press } = setup(twoBars());
  store.dispatch(setCursor, { tick: 1000 }, { record: false });
  press('ArrowLeft', { shift: true });
  expect(store.getState().selection.ids).toEqual(['a2']);
  press('ArrowLeft', { shift: true });
  expect(store.getState().selection.ids).toEqual(['a2', 'a1']);
});

test('piano keys spell for the key: its signature first, else natural, else sharps in sharp keys and flats in flat keys', () => {
  const names = (fifths: number) => Array.from({ length: 12 }, (_, pc) => pianoSpelling(pc, fifths)).map(({ step, alter }) => `${step}${['bb', 'b', '', '#', '##'][alter + 2]}`);
  expect(names(0)).toEqual(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);
  expect(names(-2)).toEqual(['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']);
  expect(names(6)).toEqual(['C', 'C#', 'D', 'D#', 'E', 'E#', 'F#', 'G', 'G#', 'A', 'A#', 'B']);
  expect(names(-6)).toEqual(['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'Cb']);
});

test('enterPitch enters an exact alteration nearest the last pitch, and adds to the chord in chord mode', () => {
  const { store, ctx, press } = setup();
  const m1 = store.getState().document.global.measures[0].id;
  store.dispatch(setKey, { measureId: m1, key: { fifths: 1 } });
  for (const k of ['n', '4']) press(k);
  enterPitch(ctx, 'F', 0); // F natural despite the F sharp in G major
  enterPitch(ctx, 'C', -1); // C flat, nearest F4
  expect([...pitches(bar(store)[0]), ...pitches(bar(store)[1])]).toEqual([P('F', 4), P('C', 5, -1)]);
  store.dispatch(setChordMode, { on: true }, { record: false });
  enterPitch(ctx, 'E', -1);
  expect(pitches(bar(store)[1])).toEqual([P('C', 5, -1), P('E', 5, -1)]);
  enterPitch(ctx, 'G'); // no alteration given: the key's
  expect(pitches(bar(store)[1]).at(-1)).toEqual(P('G', 5));
});

test('in select (Edit) mode the toolbar letters, piano, durations and rest change the selected event instead of entering', () => {
  const { store, ctx } = setup();
  const run = (label: string) => KEYMAP.find((b) => b.label === label)!.action(ctx);
  store.dispatch(setSelection, { ids: ['e2'] }, { record: false });
  const before = bar(store).length;
  run('Note A'); // nearest the old pitch (D5)
  expect(pitches(bar(store)[1])).toEqual([P('A', 4)]);
  enterPitch(ctx, 'F', 1);
  expect(pitches(bar(store)[1])).toEqual([P('F', 4, 1)]);
  expect(bar(store).length).toBe(before);
  run('Eighth note');
  expect(bar(store)[1].duration).toEqual({ base: 'eighth', dots: 0 });
  expect(store.getState().cursor.duration).toEqual({ base: 'quarter', dots: 0 }); // the entry duration is unchanged
  run('Rest');
  expect(bar(store)[1].rest).toBe(true);
});

test('in Edit mode a letter or piano key on a rest pitches that rest in place: its duration kept, the cursor still, one undo step', () => {
  const { store, ctx } = setup();
  store.dispatch(setCursor, { tick: 1920 }, { record: false });
  store.dispatch(setSelection, { ids: ['e3'] }, { record: false });
  const cursor = store.getState().cursor;
  const undoDepth = store.getState().history.past.length;
  KEYMAP.find((b) => b.label === 'Note A')!.action(ctx);
  const third = bar(store)[2];
  expect(third).toMatchObject({ id: 'e3', duration: { base: 'half', dots: 0 } });
  expect(third.rest).toBeUndefined();
  expect(pitches(third)).toEqual([P('A', 4)]); // nearest the last entered pitch, else the middle line (B4)
  expect(bar(store)).toHaveLength(3);
  expect(store.getState().cursor).toMatchObject({ mode: 'select', tick: cursor.tick, measureId: cursor.measureId });
  expect(store.getState().history.past.length).toBe(undoDepth + 1);
  enterPitch(ctx, 'B', -1);
  expect(pitches(bar(store)[2])).toEqual([P('B', 4, -1)]);
});

test('in Edit mode a longer duration stops at the barline (tied within the bar); the next bar is untouched', () => {
  const { store, ctx } = setup(twoBars());
  store.dispatch(setSelection, { ids: ['a3'] }, { record: false });
  KEYMAP.find((b) => b.label === 'Whole note')!.action(ctx);
  const total = eventStarts(store.getState().document.parts[0].measures[0].sequences[0], 3840).reduce((sum, s) => sum + s.ticks, 0);
  expect(total).toBe(3840);
  expect(pitches(bar(store)[0])).toEqual([P('C', 4)]);
  expect(bar(store, 1).map((e) => e.id)).toEqual(['b1', 'b2', 'b3', 'b4']);
});
