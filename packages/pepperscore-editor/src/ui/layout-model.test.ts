import type { Cursor } from '../engine/types';
import { applyLayout } from '../engine/layout/apply-layout';
import { createDocument } from '../model/create';
import type { Document, Pitch } from '../model/schema';
import { clickTarget, staffAt } from './click-mapping';
import { editorHighlights } from './highlights';
import { createCustomLayout } from '../engine/commands/index';
import { createEditorStore } from '../engine/store';
import { findEvent } from '../engine/sequence-edit';
import { customLayoutName, defaultSwapPart, INTERVALS, intervalValue, movedIn, movedNoteIds, movedStatus, planStaveToggle, staveRows, swapExportNote, swapTargetsFor, toggleStave, visibleStaves } from './layout-model';

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
    // Hiding a part's only staff keeps it (and its swap) undrawn; showing it again restores it.
    const swap = { instrument: 'alto-saxophone' as const, level: 'beginner' as const, autoRange: true, rangeOverrides: {} };
    const swapped = { ...full, parts: [{ partId: sax.id, swap }, { partId: piano.id }] };
    const noSax = toggleStave(doc, swapped, sax.id, 1);
    expect(noSax).toEqual([{ partId: sax.id, swap, staves: [] }, { partId: piano.id }]);
    expect(visibleStaves(doc, { ...full, parts: noSax })).toEqual([{ partId: piano.id, staff: 1 }, { partId: piano.id, staff: 2 }]);
    expect(toggleStave(doc, { ...full, parts: noSax }, sax.id, 1)).toEqual([{ partId: sax.id, swap }, { partId: piano.id }]);
    expect(toggleStave(doc, { ...full, parts: [{ partId: piano.id }] }, sax.id, 1)).toEqual([{ partId: sax.id }, { partId: piano.id }]);
    expect(full.parts).toEqual([{ partId: sax.id }, { partId: piano.id }]);
  });

  it('orders staves by the full score, then parts it does not list', () => {
    const doc = saxAndPiano();
    const [sax, piano] = doc.parts;
    doc.layouts[0].parts = [{ partId: piano.id }];
    expect(staveRows(doc, doc.layouts[0]).map((r) => r.name)).toEqual(['Piano RH', 'Piano LH', 'Tenor Sax']);
    doc.layouts[0].parts = [{ partId: piano.id }, { partId: sax.id }];
    const custom = { ...doc.layouts[0], id: 'c', parts: [{ partId: sax.id }] };
    expect(toggleStave(doc, custom, piano.id, 1)).toEqual([{ partId: piano.id, staves: [1] }, { partId: sax.id }]);
  });

  it('never edits the full score: a toggle there makes a custom layout, one undo step', () => {
    const doc = saxAndPiano();
    const store = createEditorStore(doc);
    const full = structuredClone(doc.layouts[0].parts);
    const plan = planStaveToggle(store.getState().document, doc.layouts[0].id, doc.parts[1].id, 1);
    expect(plan).toEqual({ kind: 'custom', name: 'Custom', parts: [{ partId: doc.parts[0].id }, { partId: doc.parts[1].id, staves: [2] }] });
    store.dispatch(createCustomLayout, { name: plan!.kind === 'custom' ? plan!.name : '', parts: plan!.parts });
    const after = store.getState();
    expect(after.document.layouts[0].parts).toEqual(full);
    expect(after.activeLayoutId).toBe(after.document.layouts[1].id);
    expect(after.history.past).toHaveLength(1);
    expect(customLayoutName(after.document)).toBe('Custom 2');
    expect(planStaveToggle(after.document, after.activeLayoutId, doc.parts[1].id, 1)?.kind).toBe('set');
  });

  it('offers every pitched instrument but the part\'s own as a swap target', () => {
    const doc = saxAndPiano();
    expect(swapTargetsFor(doc.parts[0])).not.toContain('tenor-saxophone');
    expect(swapTargetsFor(doc.parts[0])).toContain('alto-saxophone');
    expect(swapTargetsFor(doc.parts[0], 'tenor-saxophone')).toContain('tenor-saxophone');
    expect(swapTargetsFor(doc.parts[0])).not.toContain('drum-kit');
  });

  it('starts the swap card on the first non-piano part', () => {
    const doc = saxAndPiano();
    expect(defaultSwapPart(doc, doc.layouts[0])).toBe(doc.parts[0].id);
    expect(defaultSwapPart(doc, { ...doc.layouts[0], parts: [{ partId: doc.parts[1].id }] })).toBe(doc.parts[1].id);
  });
});

describe('swap export note', () => {
  it('says what export writes when the swap is on the full score, and nothing elsewhere', () => {
    const doc = saxAndPiano();
    const swap = { instrument: 'alto-saxophone' as const, level: 'beginner' as const, autoRange: true, rangeOverrides: {} };
    doc.layouts.push({ id: 'solo', name: 'Solo', kind: 'custom', transposing: true, overrides: {}, parts: [{ partId: doc.parts[0].id }] });
    expect(swapExportNote(doc, doc.layouts[0].id, doc.parts[0], swap)).toBe('Export writes Tenor Sax; Make a copy to export Alto Sax.');
    expect(swapExportNote(doc, 'solo', doc.parts[0], swap)).toBeUndefined();
    expect(swapExportNote(doc, doc.layouts[0].id, doc.parts[0], undefined)).toBeUndefined();
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
    expect(movedIn(view, doc.parts[0])).toEqual({ ids: ['e1', 'e2'], notes: 2, direction: 'down' });
    expect(movedStatus(2, view.counts.direction, doc.layouts[0].parts[0].swap)).toBe('2 notes moved 8vb for Alto Sax · beginner');
    expect(movedStatus(3, undefined, undefined)).toBe('3 notes moved to fit range');
    const cursor: Cursor = { partId: doc.parts[0].id, staff: 1, voice: 1, measureId: doc.global.measures[0].id, tick: 0, duration: { base: 'quarter', dots: 0 }, mode: 'select' };
    expect(editorHighlights(doc, cursor, { ids: [] }, view)[0]).toEqual({ ids: ['n1', 'n2'], className: 'ps-transposed' });
  });
});

describe('moved note counts', () => {
  it('counts the notes of moved chords, not the events', () => {
    const doc = saxAndPiano();
    const e1 = doc.parts[0].measures[0].sequences[0].content[0];
    if (e1.type === 'event') e1.notes!.push({ id: 'n1b', pitch: { step: 'E', octave: 6, alter: 0 } });
    doc.layouts[0].parts[0].swap = { instrument: 'alto-saxophone', level: 'beginner', autoRange: true, rangeOverrides: {} };
    const view = applyLayout(doc, doc.layouts[0].id);
    expect(movedIn(view, doc.parts[0])).toMatchObject({ ids: ['e1', 'e2'], notes: 3 });
    expect(movedNoteIds(view).sort()).toEqual(['n1', 'n1b', 'n2']);
  });

  it('applyLayout lists the moved note ids in document order, as the event lookup derived them', () => {
    const doc = saxAndPiano();
    const e1 = doc.parts[0].measures[0].sequences[0].content[0];
    if (e1.type === 'event') e1.notes!.push({ id: 'n1b', pitch: { step: 'E', octave: 6, alter: 0 } });
    doc.layouts[0].parts[0].swap = { instrument: 'alto-saxophone', level: 'beginner', autoRange: true, rangeOverrides: {} };
    const view = applyLayout(doc, doc.layouts[0].id);
    const derived = Object.keys(view.moved).flatMap((id) => {
      const event = findEvent(view.document, id)?.event;
      return !event ? [] : event.notes?.length ? event.notes.map((n) => n.id) : [event.id];
    });
    expect(view.movedNotes).toEqual(['n1', 'n1b', 'n2']);
    expect([...view.movedNotes].sort()).toEqual(derived.sort());
    expect(movedNoteIds(view)).toBe(view.movedNotes);
  });

  it('reads the moved notes of a 128-bar swapped score in under 1 ms', () => {
    const doc = createDocument({ parts: [{ name: 'Tenor Sax', clef: 'treble', gmProgram: 67 }, { name: 'Piano', clef: 'treble', gmProgram: 1, staves: 2 }], measures: 128 });
    doc.parts[0].transposition = { semitones: 14, diatonic: 8 };
    doc.parts[0].measures.forEach((pm, m) => {
      pm.sequences[0].content = (['C', 'D', 'E', 'D'] as const).map((step, i) => ({ id: `e${m}-${i}`, type: 'event' as const, duration: { base: 'quarter' as const, dots: 0 as const }, notes: [{ id: `n${m}-${i}`, pitch: { step, octave: 6, alter: 0 } }] }));
    });
    doc.layouts[0].parts[0].swap = { instrument: 'alto-saxophone', level: 'beginner', autoRange: true, rangeOverrides: {} };
    const view = applyLayout(doc, doc.layouts[0].id);
    expect(view.counts.moved).toBe(512);
    expect(movedIn(view, doc.parts[0]).notes).toBe(512);
    expect(movedNoteIds(view)).toHaveLength(512);
    // The fastest of 20 reads, so a GC pause or a loaded test worker does not decide it.
    const times = Array.from({ length: 20 }, () => {
      const start = performance.now();
      movedNoteIds(view);
      return performance.now() - start;
    });
    expect(Math.min(...times)).toBeLessThan(1);
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
