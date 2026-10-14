import type { Cursor } from '../engine/types';
import { applyLayout } from '../engine/layout/apply-layout';
import { createDocument } from '../model/create';
import type { Document, Pitch } from '../model/schema';
import { clickTarget, staffAt } from './click-mapping';
import { editorHighlights } from './highlights';
import { defaultSwapPart, INTERVALS, intervalValue, movedIn, movedStatus, staveRows, toggleStave, visibleStaves } from './layout-model';

/** Tenor sax (written C6 D6 quarters, a half rest) and a two-staff piano, one 4/4 bar. */
function saxAndPiano(): Document {
  const doc = createDocument({ parts: [{ name: 'Tenor Sax', clef: 'treble', gmProgram: 67 }, { name: 'Piano', clef: 'treble', gmProgram: 1, staves: 2 }], measures: 1 });
  doc.parts[0].transposition = { semitones: 14, diatonic: 8 };
  const p = (step: Pitch['step'], octave: number): Pitch => ({ step, octave, alter: 0 });
  doc.parts[0].measures[0].sequences[0].content = [
    { id: 'e1', type: 'event', duration: { base: 'quarter', dots: 0 }, notes: [{ id: 'n1', pitch: p('C', 6) }] },
    { id: 'e2', type: 'event', duration: { base: 'quarter', dots: 0 }, notes: [{ id: 'n2', pitch: p('D', 6) }] },
    { id: 'e3', type: 'event', duration: { base: 'half', dots: 0 }, rest: true },
  ];
  return doc;
}

describe('stave list', () => {
  it('lists every staff, marking hidden staves and swapped parts', () => {
    const doc = saxAndPiano();
    const [sax, piano] = doc.parts;
    const layout = { ...doc.layouts[0], parts: [{ partId: sax.id, swap: { instrument: 'alto-saxophone' as const, level: 'beginner' as const, autoRange: true, rangeOverrides: {} } }, { partId: piano.id, staves: [2] }] };
    expect(staveRows(doc, layout).map((r) => [r.name, r.on, r.meta])).toEqual([
      ['Tenor Sax', true, 'as Alto Sax'], ['Piano RH', false, 'hidden'], ['Piano LH', true, 'shown'],
    ]);
    expect(visibleStaves(doc, layout)).toEqual([{ partId: sax.id, staff: 1 }, { partId: piano.id, staff: 2 }]);
  });

  it('toggles staves: partial staves, all staves, removing and re-adding a part in score order', () => {
    const doc = saxAndPiano();
    const [sax, piano] = doc.parts;
    const full = doc.layouts[0];
    const lhOnly = toggleStave(doc, full, piano.id, 1);
    expect(lhOnly).toEqual([{ partId: sax.id }, { partId: piano.id, staves: [2] }]);
    expect(toggleStave(doc, { ...full, parts: lhOnly }, piano.id, 1)).toEqual([{ partId: sax.id }, { partId: piano.id }]);
    const noSax = toggleStave(doc, full, sax.id, 1);
    expect(noSax).toEqual([{ partId: piano.id }]);
    expect(toggleStave(doc, { ...full, parts: noSax }, sax.id, 1)).toEqual([{ partId: sax.id }, { partId: piano.id }]);
    expect(toggleStave(doc, { ...full, parts: [{ partId: sax.id }] }, piano.id, 2)).toEqual([{ partId: sax.id }, { partId: piano.id, staves: [2] }]);
    expect(full.parts).toEqual([{ partId: sax.id }, { partId: piano.id }]);
  });

  it('starts the swap card on the first non-piano part', () => {
    const doc = saxAndPiano();
    expect(defaultSwapPart(doc, doc.layouts[0])).toBe(doc.parts[0].id);
    expect(defaultSwapPart(doc, { ...doc.layouts[0], parts: [{ partId: doc.parts[1].id }] })).toBe(doc.parts[1].id);
  });
});

describe('interval table', () => {
  it('offers none and m2..P8 up and down as semitone and diatonic pairs', () => {
    expect(INTERVALS).toHaveLength(23);
    expect(INTERVALS[0]).toEqual({ value: 'none', label: 'None' });
    const by = (value: string) => INTERVALS.find((i) => i.value === value)?.interval;
    expect(by('M3-up')).toEqual({ semitones: 4, diatonic: 2 });
    expect(by('P5-down')).toEqual({ semitones: -7, diatonic: -4 });
    expect(by('m7-up')).toEqual({ semitones: 10, diatonic: 6 });
    expect(by('P8-down')).toEqual({ semitones: -12, diatonic: -7 });
    expect(intervalValue(undefined)).toBe('none');
    expect(intervalValue({ semitones: 0, diatonic: 0 })).toBe('none');
    expect(intervalValue({ semitones: -5, diatonic: -3 })).toBe('P4-down');
    expect(intervalValue({ semitones: 6, diatonic: 3 })).toBe('custom');
  });
});

describe('moved notes', () => {
  it('counts, highlights and describes the notes a swap moved', () => {
    const doc = saxAndPiano();
    doc.layouts[0].parts[0].swap = { instrument: 'alto-saxophone', level: 'beginner', autoRange: true, rangeOverrides: {} };
    const view = applyLayout(doc, doc.layouts[0].id);
    expect(movedIn(view, doc.parts[0])).toEqual({ ids: ['e1', 'e2'], direction: 'down' });
    expect(movedStatus(view.counts, doc.layouts[0].parts[0].swap)).toBe('2 notes moved 8vb for Alto Sax · beginner');
    expect(movedStatus({ moved: 3 }, undefined)).toBe('3 notes moved to fit range');
    const cursor: Cursor = { partId: doc.parts[0].id, staff: 1, voice: 1, measureId: doc.global.measures[0].id, tick: 0, duration: { base: 'quarter', dots: 0 }, mode: 'select' };
    expect(editorHighlights(doc, cursor, { ids: [] }, view)[0]).toEqual({ ids: ['n1', 'n2'], className: 'ps-transposed' });
  });
});

describe('click mapping on partial-staff layouts', () => {
  it('maps the viewer staff through the layout visible staves', () => {
    const doc = saxAndPiano();
    const [sax, piano] = doc.parts;
    doc.layouts.push({ id: 'lh', name: 'Left hand', kind: 'custom', transposing: true, overrides: {}, parts: [{ partId: piano.id, staves: [2] }] });
    doc.layouts.push({ id: 'mix', name: 'Mix', kind: 'custom', transposing: true, overrides: {}, parts: [{ partId: piano.id, staves: [2] }, { partId: sax.id }] });
    expect(staffAt(doc, 1, 'lh')).toEqual({ partId: piano.id, staff: 2 });
    expect(staffAt(doc, 2, 'lh')).toBeUndefined();
    expect(staffAt(doc, 2, 'mix')).toEqual({ partId: sax.id, staff: 1 });
    expect(staffAt(doc, 1)).toEqual({ partId: sax.id, staff: 1 });
    expect(clickTarget(doc, { measureIndex: 0, fraction: 0.5, staff: 1, clientX: 0, clientY: 0 }, 'lh')?.cursor).toMatchObject({ partId: piano.id, staff: 2 });
  });
});
