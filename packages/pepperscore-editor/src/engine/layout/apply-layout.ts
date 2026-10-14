import { INSTRUMENTS, type Instrument } from '../../model/instruments';
import { effectiveKey, eventStarts } from '../../model/query';
import type { Direction, Document, Layout, Part, Swap } from '../../model/schema';
import { pruneDanglingReferences } from '../prune';
import { fitToRange, type FitResult } from './range-fit';

/**
 * The active layout's view of a document: the `document` to compile (the layout's parts, staves, swaps,
 * concert pitch and direction overrides applied; ids unchanged so clicks map back), the events range
 * fitting or an override moved by an octave, the note ids of those events as drawn (a rest's own id; document
 * order; what `ps-transposed` highlights), a summary for the status line, and fitting diagnostics.
 */
export type ViewResult = {
  document: Document;
  moved: Record<string, 12 | -12>;
  movedNotes: string[];
  counts: { moved: number; partId?: string; direction?: 'up' | 'down' };
  diagnostics: string[];
};

const isConcert = (t: Part['transposition']) => !t || (t.semitones === 0 && t.diatonic === 0);

/** `part` shown as (or copied to) `target`: name, GM program, first clef and transposition follow it. */
function retarget(part: Part, target: Instrument, transposing: boolean): Part {
  const { abbreviation: _abbreviation, transposition: _transposition, ...rest } = part;
  const next: Part = { ...rest, name: target.label, instrument: { ...part.instrument, gmProgram: target.gmProgram }, clefs: [target.clef, ...part.clefs.slice(1)] };
  if (transposing && !isConcert(target.transposition)) next.transposition = { ...target.transposition };
  return next;
}

/** `part` as its `swap` shows it in a layout that is (or is not) `transposing`. */
export function swapPart(doc: Document, part: Part, swap: Swap, transposing: boolean): FitResult {
  const target = INSTRUMENTS[swap.instrument];
  const fit = fitToRange(part, {
    keyByMeasure: (i) => effectiveKey(doc, i), target, level: swap.level, interval: swap.interval,
    overrides: swap.rangeOverrides, autoRange: swap.autoRange, transposing,
  });
  return { ...fit, part: retarget(fit.part, target, transposing) };
}

/** A transposing part written at concert pitch (spelling kept), for a concert-pitch layout. */
function concertPart(doc: Document, part: Part): Part {
  const { part: fitted } = fitToRange(part, {
    keyByMeasure: (i) => effectiveKey(doc, i), target: INSTRUMENTS.piano, level: 'advanced', overrides: {}, autoRange: false, transposing: false,
  });
  delete fitted.transposition;
  return fitted;
}

/** Only `staves` of `part`, renumbered from 1; references into the dropped staves are pruned. */
function keepStaves(doc: Document, part: Part, staves: number[]): Part | undefined {
  const keep = [...new Set(staves)].filter((s) => s >= 1 && s <= part.staves).sort((a, b) => a - b);
  if (keep.length === part.staves) return part;
  if (keep.length === 0) return undefined;
  const renumber = (staff: number) => keep.indexOf(staff) + 1;
  const kept = structuredClone(part);
  kept.staves = keep.length as 1 | 2;
  kept.clefs = keep.map((s) => part.clefs[s - 1] ?? 'treble');
  for (const pm of kept.measures) {
    pm.sequences = pm.sequences.filter((s) => keep.includes(s.staff)).map((s) => ({ ...s, staff: renumber(s.staff) }));
    pm.directions = pm.directions.filter((d) => keep.includes(d.anchor.staff)).map((d) => ({ ...d, anchor: { ...d.anchor, staff: renumber(d.anchor.staff) } }));
    const clefs = pm.clefs?.filter((c) => keep.includes(c.staff)).map((c) => ({ ...c, staff: renumber(c.staff) }));
    if (clefs?.length) pm.clefs = clefs;
    else delete pm.clefs;
  }
  pruneDanglingReferences({ ...doc, parts: [kept] });
  return kept;
}

/** Directions with the layout's overrides: `hidden` removes, `text` rewords a text direction, `offset` moves. */
function withOverrides(part: Part, overrides: Layout['overrides']): Part {
  const touches = part.measures.some((pm) => pm.directions.some((d) => overrides[d.id]));
  if (!touches) return part;
  const measures = part.measures.map((pm) => {
    if (!pm.directions.some((d) => overrides[d.id])) return pm;
    const directions = pm.directions.flatMap((d): Direction[] => {
      const o = overrides[d.id];
      if (!o) return [d];
      if (o.hidden) return [];
      const next = { ...d };
      if (o.offset) next.offset = { ...o.offset };
      if (o.text !== undefined && next.kind === 'text') next.text = o.text;
      return [next];
    });
    return { ...pm, directions };
  });
  return { ...part, measures };
}

/**
 * The document as layout `layoutId` shows it. An unknown layout (or none) and the full score with nothing to
 * change return `doc` itself. Otherwise the view document holds the layout's parts in its order, with its
 * only layout listing them, and leaves `doc` untouched.
 */
export function applyLayout(doc: Document, layoutId: string): ViewResult {
  const layout = doc.layouts.find((l) => l.id === layoutId);
  if (!layout) return { document: doc, moved: {}, movedNotes: [], counts: { moved: 0 }, diagnostics: [] };
  const moved: Record<string, 12 | -12> = {};
  const movedBy = new Set<string>();
  const diagnostics: string[] = [];
  const parts: Part[] = [];
  const movedNotes: string[] = [];

  for (const lp of layout.parts) {
    const source = doc.parts.find((p) => p.id === lp.partId);
    if (!source) continue;
    // A part with every staff hidden is not drawn: its swap moves nothing and reports nothing.
    if (lp.staves && !lp.staves.some((s) => s >= 1 && s <= source.staves)) continue;
    let part = source;
    if (lp.swap) {
      const fit = swapPart(doc, source, lp.swap, layout.transposing);
      part = fit.part;
      Object.assign(moved, fit.moved);
      if (Object.keys(fit.moved).length) movedBy.add(source.id);
      diagnostics.push(...fit.diagnostics);
    } else if (!layout.transposing && !isConcert(source.transposition)) {
      part = concertPart(doc, source);
    }
    const kept = lp.staves ? keepStaves(doc, part, lp.staves) : part;
    if (!kept) continue;
    parts.push(withOverrides(kept, layout.overrides));
    // The drawn notes of the moved events (hidden staves dropped), collected once here rather than per cursor move.
    if (movedBy.has(source.id)) {
      for (const pm of kept.measures) for (const seq of pm.sequences) for (const { event } of eventStarts(seq)) {
        if (moved[event.id] === undefined) continue;
        if (event.notes?.length) for (const n of event.notes) movedNotes.push(n.id);
        else movedNotes.push(event.id);
      }
    }
  }

  const shifts = Object.values(moved);
  const counts: ViewResult['counts'] = { moved: shifts.length };
  if (movedBy.size === 1) counts.partId = [...movedBy][0];
  if (shifts.length && shifts.every((s) => s === shifts[0])) counts.direction = shifts[0] > 0 ? 'up' : 'down';

  const unchanged = layout === doc.layouts[0] && parts.length === doc.parts.length && parts.every((p, i) => p === doc.parts[i]);
  const document: Document = unchanged ? doc : { ...doc, parts, layouts: [{ ...layout, parts: parts.map((p) => ({ partId: p.id })) }] };
  return { document, moved, movedNotes, counts, diagnostics };
}
