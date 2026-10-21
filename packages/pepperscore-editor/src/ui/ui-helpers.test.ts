import { createEditorStore } from '../engine/store';
import { setEntryMode, setSelection } from '../engine/commands/index';
import { shownDuration } from './key-actions';
import { createDocument } from '../model/create';
import type { Cursor } from '../engine/types';
import { helloDoc } from '../test-helpers';
import { clickTarget, staffAt } from './click-mapping';
import { compileToMusicXml } from '../compile/to-musicxml';
import { writePepperScoreFile } from '../format/pepperscore-file';
import { checkStaffCap, readScoreText, sha256Hex } from './files';
import { editorHighlights } from './highlights';
import { KEYMAP } from './keymap';

const at = (doc: ReturnType<typeof helloDoc>, tick: number): Cursor => ({
  partId: doc.parts[0].id, staff: 1, voice: 1, measureId: doc.global.measures[0].id, tick, duration: { base: 'quarter', dots: 0 }, mode: 'enter',
});

describe('clickTarget', () => {
  it('puts the cursor on the event of a clicked note and selects it', () => {
    const doc = helloDoc();
    const target = clickTarget(doc, { sourceId: 'n2', measureIndex: 0, clientX: 0, clientY: 0 });
    expect(target).toEqual({ cursor: { partId: doc.parts[0].id, staff: 1, voice: 1, measureId: doc.global.measures[0].id, tick: 960 }, selection: ['e2'], mode: 'select' });
  });
  it('resolves a rest by its event id', () => {
    expect(clickTarget(helloDoc(), { sourceId: 'e3', clientX: 0, clientY: 0 })?.cursor.tick).toBe(1920);
  });
  it('implies Edit (select) for a note, Entry for a rest or staff space past the last note or in an empty bar', () => {
    const doc = helloDoc();
    expect(clickTarget(doc, { sourceId: 'n1', clientX: 0, clientY: 0 })?.mode).toBe('select');
    expect(clickTarget(doc, { sourceId: 'e3', clientX: 0, clientY: 0 })?.mode).toBe('enter');
    expect(clickTarget(doc, { measureIndex: 0, fraction: 0.9, staff: 1, clientX: 0, clientY: 0 })).toMatchObject({ cursor: { tick: 1920 }, mode: 'enter' });
    const empty = createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 2 });
    expect(clickTarget(empty, { measureIndex: 1, fraction: 0.5, staff: 1, clientX: 0, clientY: 0 })?.mode).toBe('enter');
  });
  it('maps a click in a measure to the nearest event start', () => {
    const doc = helloDoc();
    expect(clickTarget(doc, { measureIndex: 0, fraction: 0.2, staff: 1, clientX: 0, clientY: 0 })).toMatchObject({ cursor: { tick: 960 }, selection: [] }); // 768: nearer 960 than 0
    expect(clickTarget(doc, { measureIndex: 0, fraction: 0.4, staff: 1, clientX: 0, clientY: 0 })?.cursor.tick).toBe(1920); // 1536
    expect(clickTarget(doc, { measureIndex: 0, fraction: 0.05, staff: 1, clientX: 0, clientY: 0 })?.cursor.tick).toBe(0);
    expect(clickTarget(doc, { measureIndex: 0, fraction: 0.9, staff: 1, clientX: 0, clientY: 0 })?.cursor.tick).toBe(1920);
    expect(clickTarget(doc, { sourceId: 'unknown', clientX: 0, clientY: 0 })).toBeUndefined();
  });
  it('maps a click in staff space to the event the viewer engraved nearest, not the time fraction', () => {
    const doc = helloDoc();
    // fraction 0.2 (tick 768) is nearer e2's start by time, but the viewer drew e1's notehead nearest the click
    expect(clickTarget(doc, { measureIndex: 0, fraction: 0.2, staff: 1, nearestSourceId: 'n1', clientX: 0, clientY: 0 })).toMatchObject({ cursor: { tick: 0 }, selection: [], mode: 'select' });
    expect(clickTarget(doc, { measureIndex: 0, fraction: 0.05, staff: 1, nearestSourceId: 'e3', clientX: 0, clientY: 0 })).toMatchObject({ cursor: { tick: 1920 }, selection: [], mode: 'enter' });
    // a nearest note outside the clicked bar or staff (or unknown) falls back to the fraction
    expect(clickTarget(doc, { measureIndex: 0, fraction: 0.2, staff: 1, nearestSourceId: 'unknown', clientX: 0, clientY: 0 })?.cursor.tick).toBe(960);
    const piano = createDocument({ parts: [{ name: 'Piano', clef: 'treble', gmProgram: 1, staves: 2 }], measures: 1 });
    const upper = piano.parts[0].measures[0].sequences.find((s) => s.staff === 1)!;
    upper.content = [{ id: 'u1', type: 'event', duration: { base: 'quarter', dots: 0 }, notes: [{ id: 'un1', pitch: { step: 'C', octave: 5, alter: 0 } }] }, { id: 'u2', type: 'event', duration: { base: 'quarter', dots: 0 }, notes: [{ id: 'un2', pitch: { step: 'D', octave: 5, alter: 0 } }] }, { id: 'u3', type: 'event', duration: { base: 'half', dots: 0 }, rest: true }];
    expect(clickTarget(piano, { measureIndex: 0, fraction: 0.2, staff: 2, nearestSourceId: 'un1', clientX: 0, clientY: 0 })?.cursor).toMatchObject({ staff: 2, tick: 0 });
  });
  it('counts viewer staves through the layout parts and their staves', () => {
    const doc = createDocument({ parts: [{ name: 'Piano', clef: 'treble', gmProgram: 1, staves: 2 }, { name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 2 });
    expect(staffAt(doc, 2)).toEqual({ partId: doc.parts[0].id, staff: 2 });
    expect(staffAt(doc, 3)).toEqual({ partId: doc.parts[1].id, staff: 1 });
    expect(clickTarget(doc, { measureIndex: 1, fraction: 0.5, staff: 2, clientX: 0, clientY: 0 })?.cursor).toMatchObject({ partId: doc.parts[0].id, staff: 2, measureId: doc.global.measures[1].id, tick: 0 });
  });
});

describe('editorHighlights', () => {
  it('marks the event under the cursor and the selection', () => {
    const doc = helloDoc();
    expect(editorHighlights(doc, at(doc, 960), { ids: ['e1', 'e3'] })).toEqual([
      { ids: ['n2'], className: 'ps-cursor' },
      { ids: ['n1', 'e3'], className: 'ps-selection' },
    ]);
  });
  it('marks the measure when the cursor is between event starts', () => {
    const doc = helloDoc();
    expect(editorHighlights(doc, at(doc, 100), { ids: [] })).toEqual([{ measures: [0], className: 'ps-cursor-measure' }]);
  });
});

describe('files', () => {
  it('opens a .pepperscore file with its source and editor state', () => {
    const doc = helloDoc();
    const source = { format: 'musicxml' as const, sha256: '0'.repeat(64), dropped: [] };
    const text = writePepperScoreFile({ document: doc, source, editor: { activeLayoutId: doc.layouts[0].id }, created: '2026-01-01T00:00:00.000Z' });
    expect(readScoreText(text, 'a.pepperscore')).toEqual({ document: doc, dropped: [], source, editor: { activeLayoutId: doc.layouts[0].id }, created: '2026-01-01T00:00:00.000Z' });
    expect(() => readScoreText('{"document":{}}', 'a.PepperScore')).toThrow('Not a .pepperscore file');
  });
  it('opens MusicXML of any size (the editor applies the licence staff cap) and refuses scores over a cap', () => {
    const big = createDocument({ parts: [1, 2, 3].map(() => ({ name: 'Piano', clef: 'treble' as const, gmProgram: 1, staves: 2 as const })), measures: 1 });
    expect(readScoreText(compileToMusicXml(big), 'big.musicxml').document.parts).toHaveLength(3);
    expect(() => checkStaffCap(big)).toThrow('Editing is limited to 4 staves.');
    expect(() => checkStaffCap(big, 5)).toThrow('Editing is limited to 5 staves.');
    expect(checkStaffCap(big, 6)).toBe(big);
  });
  it('hashes text as lowercase SHA-256 hex', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('toolbar bindings', () => {
  it('names keymap bindings that exist (the toolbar runs them by label)', () => {
    const labels = ['Undo', 'Redo', 'Toggle note entry', 'Toggle dot', 'Rest', 'Tie', 'Slur', 'Staccato', 'Tenuto', 'Accent', 'Marcato', 'Tuplet (3)', 'Key signature', 'Time signature', 'Clef', 'Text', 'Play'];
    const missing = labels.filter((label) => label !== 'Text' && !KEYMAP.some((b) => b.label === label));
    expect(missing).toEqual([]);
  });
});

describe('clickTarget mode for a tap that misses the notehead', () => {
  it('implies Edit when the cursor snaps onto a note, Entry when it snaps onto a rest', () => {
    const doc = helloDoc();
    expect(clickTarget(doc, { measureIndex: 0, fraction: 0.3, staff: 1, clientX: 0, clientY: 0 })).toMatchObject({ cursor: { tick: 960 }, selection: [], mode: 'select' });
    expect(clickTarget(doc, { measureIndex: 0, fraction: 0.6, staff: 1, clientX: 0, clientY: 0 })).toMatchObject({ cursor: { tick: 1920 }, mode: 'enter' });
  });
});

describe('shownDuration (the duration the rail and the phone Notes tab light)', () => {
  it('is the entry duration in entry mode, the target event duration in select (Edit) mode, where the buttons resize it', () => {
    const store = createEditorStore(helloDoc());
    store.dispatch(setEntryMode, { mode: 'enter' }, { record: false });
    store.dispatch(setSelection, { ids: ['e3'] }, { record: false });
    expect(shownDuration(store.getState())).toEqual({ base: 'quarter', dots: 0 });
    store.dispatch(setEntryMode, { mode: 'select' }, { record: false });
    expect(shownDuration(store.getState())).toEqual({ base: 'half', dots: 0 });
  });
});
