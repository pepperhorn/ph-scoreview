import type { ViewResult } from '../engine/layout/apply-layout';
import { INSTRUMENT_IDS, instrumentFor, instrumentName, type InstrumentId, type Transposition } from '../model/instruments';
import { eventStarts } from '../model/query';
import type { Document, Layout, LayoutPart, Part, Swap } from '../model/schema';

/** One part's staff in the Layout tab's stave list. */
export type StaveRow = { partId: string; staff: number; name: string; on: boolean; meta: string };

/** The staves layout part `lp` shows of `part`, ascending; absent `staves` is all of them. */
export const shownStaves = (part: Part, lp: LayoutPart): number[] =>
  lp.staves ? [...new Set(lp.staves)].filter((s) => s >= 1 && s <= part.staves).sort((a, b) => a - b) : Array.from({ length: part.staves }, (_, i) => i + 1);

/**
 * The (part, staff) pairs `layout` draws, in the viewer's order: the layout's parts in order, each part's shown
 * staves ascending (the viewer's 1-based staff index is a position in this list).
 */
export function visibleStaves(doc: Document, layout: Layout | undefined): { partId: string; staff: number }[] {
  const out: { partId: string; staff: number }[] = [];
  for (const lp of layout?.parts ?? []) {
    const part = doc.parts.find((p) => p.id === lp.partId);
    if (part) for (const staff of shownStaves(part, lp)) out.push({ partId: part.id, staff });
  }
  return out;
}

/** "Piano RH" / "Piano LH" for a keyboard part's staves, "Organ 1" / "Organ 2" otherwise; a one-staff part is its name. */
export function staffName(part: Part, staff: number): string {
  if (part.staves === 1) return part.name;
  return instrumentFor(part.instrument.gmProgram).id === 'piano' ? `${part.name} ${staff === 1 ? 'RH' : 'LH'}` : `${part.name} ${staff}`;
}

/** Every staff of the document in score order, on when `layout` shows it, with "shown", "hidden" or "as <Target>". */
export function staveRows(doc: Document, layout: Layout | undefined): StaveRow[] {
  return doc.parts.flatMap((part) => {
    const lp = layout?.parts.find((p) => p.partId === part.id);
    const shown = lp ? shownStaves(part, lp) : [];
    return Array.from({ length: part.staves }, (_, i): StaveRow => {
      const on = shown.includes(i + 1);
      const meta = !on ? 'hidden' : lp?.swap ? `as ${instrumentName(lp.swap.instrument)}` : 'shown';
      return { partId: part.id, staff: i + 1, name: staffName(part, i + 1), on, meta };
    });
  });
}

/**
 * `layout`'s parts with one staff toggled. Showing a staff of a part the layout lacks adds the part where it falls in
 * score order; hiding a part's last shown staff removes the part (its swap with it). Showing every staff drops
 * `staves` (all).
 */
export function toggleStave(doc: Document, layout: Layout, partId: string, staff: number): LayoutPart[] {
  const part = doc.parts.find((p) => p.id === partId);
  if (!part) return layout.parts;
  const order = (id: string) => doc.parts.findIndex((p) => p.id === id);
  const parts = layout.parts.map((lp) => ({ ...lp }));
  const at = parts.findIndex((lp) => lp.partId === partId);
  if (at < 0) {
    const lp: LayoutPart = part.staves > 1 ? { partId, staves: [staff] } : { partId };
    const before = parts.findIndex((p) => order(p.partId) > order(partId));
    parts.splice(before < 0 ? parts.length : before, 0, lp);
    return parts;
  }
  const shown = shownStaves(part, parts[at]);
  const next = shown.includes(staff) ? shown.filter((s) => s !== staff) : [...shown, staff].sort((a, b) => a - b);
  if (next.length === 0) parts.splice(at, 1);
  else if (next.length === part.staves) delete parts[at].staves;
  else parts[at].staves = next;
  return parts;
}

/** The extra transpositions a swap offers: none, then each interval up to an octave, up and down. */
export const INTERVALS: { value: string; label: string; interval?: Transposition }[] = (() => {
  const steps: [string, number, number][] = [
    ['m2', 1, 1], ['M2', 2, 1], ['m3', 3, 2], ['M3', 4, 2], ['P4', 5, 3], ['P5', 7, 4],
    ['m6', 8, 5], ['M6', 9, 5], ['m7', 10, 6], ['M7', 11, 6], ['P8', 12, 7],
  ];
  const out: { value: string; label: string; interval?: Transposition }[] = [{ value: 'none', label: 'None' }];
  for (const dir of ['up', 'down'] as const) {
    const sign = dir === 'up' ? 1 : -1;
    for (const [name, semitones, diatonic] of steps) out.push({ value: `${name}-${dir}`, label: `${name} ${dir}`, interval: { semitones: sign * semitones, diatonic: sign * diatonic } });
  }
  return out;
})();

/** The `INTERVALS` value for a swap's interval: `none` for none or a zero interval, `custom` for one not in the list. */
export function intervalValue(t: Transposition | undefined): string {
  if (!t || (t.semitones === 0 && t.diatonic === 0)) return 'none';
  return INTERVALS.find((i) => i.interval?.semitones === t.semitones && i.interval.diatonic === t.diatonic)?.value ?? 'custom';
}

/** Instruments a part can be shown as (all pitched ones). */
export const SWAP_TARGETS: InstrumentId[] = INSTRUMENT_IDS.filter((id) => id !== 'drum-kit');

/** The layout part the swap card starts on: the first non-piano part shown, else the first. */
export function defaultSwapPart(doc: Document, layout: Layout | undefined): string | undefined {
  const parts = (layout?.parts ?? []).map((lp) => doc.parts.find((p) => p.id === lp.partId)).filter((p): p is Part => !!p);
  return (parts.find((p) => instrumentFor(p.instrument.gmProgram).id !== 'piano') ?? parts[0])?.id;
}

/** Ids of every event in `part`, in score order. */
export function partEventIds(part: Part): string[] {
  return part.measures.flatMap((pm) => pm.sequences.flatMap((seq) => eventStarts(seq).map(({ event }) => event.id)));
}

/** The events of `part` the view moved by an octave (score order), and their common direction if they share one. */
export function movedIn(view: ViewResult, part: Part): { ids: string[]; direction?: 'up' | 'down' } {
  const ids = partEventIds(part).filter((id) => view.moved[id] !== undefined);
  const shifts = ids.map((id) => view.moved[id]);
  return { ids, direction: shifts.length && shifts.every((s) => s === shifts[0]) ? (shifts[0] > 0 ? 'up' : 'down') : undefined };
}

const LEVEL_NAMES = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' } as const;
export const levelName = (level: Swap['level']): string => LEVEL_NAMES[level];

/** "8vb", "8va" or "to fit range" for a direction (mixed or unknown). */
export const movedWord = (direction: 'up' | 'down' | undefined): string => (direction === 'down' ? '8vb' : direction === 'up' ? '8va' : 'to fit range');

/**
 * The status line's moved-notes text: "12 notes moved 8vb for Alto Sax · beginner" (one swapped part), else
 * "12 notes moved 8vb"; a mixed direction reads "moved to fit range".
 */
export function movedStatus(counts: ViewResult['counts'], swap: Swap | undefined): string {
  const n = counts.moved;
  const base = `${n} note${n === 1 ? '' : 's'} moved ${movedWord(counts.direction)}`;
  return swap ? `${base} for ${instrumentName(swap.instrument)} · ${swap.level}` : base;
}
