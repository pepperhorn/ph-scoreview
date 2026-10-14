import type { Document, Layout, LayoutPart, Part } from '../../model/schema';

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
