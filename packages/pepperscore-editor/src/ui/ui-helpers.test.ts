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
    expect(target).toEqual({ cursor: { partId: doc.parts[0].id, staff: 1, voice: 1, measureId: doc.global.measures[0].id, tick: 960 }, selection: ['e2'] });
  });
  it('resolves a rest by its event id', () => {
    expect(clickTarget(helloDoc(), { sourceId: 'e3', clientX: 0, clientY: 0 })?.cursor.tick).toBe(1920);
  });
  it('maps a click in a measure to the nearest event start', () => {
    const doc = helloDoc();
    expect(clickTarget(doc, { measureIndex: 0, fraction: 0.2, staff: 1, clientX: 0, clientY: 0 })).toMatchObject({ cursor: { tick: 960 }, selection: [] }); // 768: nearer 960 than 0
    expect(clickTarget(doc, { measureIndex: 0, fraction: 0.4, staff: 1, clientX: 0, clientY: 0 })?.cursor.tick).toBe(1920); // 1536
    expect(clickTarget(doc, { measureIndex: 0, fraction: 0.05, staff: 1, clientX: 0, clientY: 0 })?.cursor.tick).toBe(0);
    expect(clickTarget(doc, { measureIndex: 0, fraction: 0.9, staff: 1, clientX: 0, clientY: 0 })?.cursor.tick).toBe(1920);
    expect(clickTarget(doc, { sourceId: 'unknown', clientX: 0, clientY: 0 })).toBeUndefined();
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
