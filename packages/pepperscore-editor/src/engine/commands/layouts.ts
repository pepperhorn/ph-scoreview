import { current, isDraft } from 'immer';
import { newId } from '../../model/ids';
import { INSTRUMENTS } from '../../model/instruments';
import type { Document, Layout, LayoutPart, Part, Swap } from '../../model/schema';
import { swapPart } from '../layout/apply-layout';
import type { Shift } from '../layout/range-fit';
import type { Command, Editable } from '../types';

const layoutOf = (draft: Editable, layoutId: string): Layout | undefined => draft.document.layouts.find((l) => l.id === layoutId);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** Layout parts naming parts of the document, copied. */
const knownParts = (doc: Document, parts: LayoutPart[]): LayoutPart[] => structuredClone(parts.filter((lp) => doc.parts.some((p) => p.id === lp.partId)));

/** Switches the layout the editor shows; dispatch with `{ record: false }`. Unknown ids are a no-op. */
export const setActiveLayout: Command<{ layoutId: string }> = {
  label: 'Switch layout',
  run: (draft, { layoutId }) => {
    if (layoutOf(draft, layoutId) && draft.activeLayoutId !== layoutId) draft.activeLayoutId = layoutId;
  },
};

/** Adds a Custom score of `parts` (unknown parts dropped) and makes it the active layout. */
export const createCustomLayout: Command<{ name: string; parts: LayoutPart[] }> = {
  label: 'Create custom layout',
  run: (draft, { name, parts }) => {
    const layout: Layout = { id: newId(), name, kind: 'custom', parts: knownParts(draft.document, parts), transposing: true, overrides: {} };
    draft.document.layouts.push(layout);
    draft.activeLayoutId = layout.id;
  },
};

/** One Part layout per part, skipping parts that already have one (a `part` layout of only that part). */
export const createPartLayouts: Command<Record<string, never>> = {
  label: 'Create part layouts',
  run: (draft) => {
    const doc = draft.document;
    for (const part of doc.parts) {
      if (doc.layouts.some((l) => l.kind === 'part' && l.parts.length === 1 && l.parts[0].partId === part.id)) continue;
      doc.layouts.push({ id: newId(), name: part.name, kind: 'part', parts: [{ partId: part.id }], transposing: true, overrides: {} });
    }
  },
};

/** Sets which parts (and staves) a layout shows, in order; unknown parts are dropped. */
export const setLayoutParts: Command<{ layoutId: string; parts: LayoutPart[] }> = {
  label: 'Set layout parts',
  run: (draft, { layoutId, parts }) => {
    const layout = layoutOf(draft, layoutId);
    const next = knownParts(draft.document, parts);
    if (layout && !same(layout.parts, next)) layout.parts = next;
  },
};

export const setLayoutTransposing: Command<{ layoutId: string; transposing: boolean }> = {
  label: 'Set transposing layout',
  run: (draft, { layoutId, transposing }) => {
    const layout = layoutOf(draft, layoutId);
    if (layout && layout.transposing !== transposing) layout.transposing = transposing;
  },
};

const layoutPartOf = (draft: Editable, layoutId: string, partId: string): { layout: Layout; lp: LayoutPart } | undefined => {
  const layout = layoutOf(draft, layoutId);
  const lp = layout?.parts.find((p) => p.partId === partId);
  return layout && lp ? { layout, lp } : undefined;
};

/** Shows a layout part for another instrument (a linked swap); `null` shows the part itself again. */
export const setSwap: Command<{ layoutId: string; partId: string; swap: Swap | null }> = {
  label: 'Swap instrument',
  run: (draft, { layoutId, partId, swap }) => {
    const found = layoutPartOf(draft, layoutId, partId);
    if (!found) return;
    if (swap === null) delete found.lp.swap;
    else if (!same(found.lp.swap, swap)) found.lp.swap = structuredClone(swap);
  },
};

/** The user's octave shift for one event of a swapped part, kept through re-fitting; `null` removes it. */
export const setRangeOverride: Command<{ layoutId: string; partId: string; eventId: string; shift: Shift | null }> = {
  label: 'Set octave override',
  run: (draft, { layoutId, partId, eventId, shift }) => {
    const swap = layoutPartOf(draft, layoutId, partId)?.lp.swap;
    if (!swap) return;
    if (shift === null) delete swap.rangeOverrides[eventId];
    else if (swap.rangeOverrides[eventId] !== shift) swap.rangeOverrides[eventId] = shift;
  },
};

/**
 * Gives `part` fresh ids throughout, rewriting the references inside it (slur and tie targets, beam
 * events, direction anchors). Returns the old-to-new id map.
 */
function renewIds(part: Part): Map<string, string> {
  const ids = new Map<string, string>();
  const renew = (old: string) => { const id = newId(); ids.set(old, id); return id; };
  const ref = (old: string) => ids.get(old) ?? old;
  part.id = renew(part.id);
  for (const pm of part.measures) {
    pm.id = renew(pm.id);
    for (const seq of pm.sequences) {
      seq.id = renew(seq.id);
      for (const item of seq.content) {
        item.id = renew(item.id);
        for (const event of item.type === 'tuplet' ? item.content : [item]) {
          if (event !== item) event.id = renew(event.id);
          for (const n of event.notes ?? []) n.id = renew(n.id);
          for (const s of event.slurs ?? []) s.id = renew(s.id);
        }
      }
    }
    for (const b of pm.beams) b.id = renew(b.id);
    for (const d of pm.directions) d.id = renew(d.id);
  }
  for (const pm of part.measures) {
    for (const seq of pm.sequences)
      for (const item of seq.content)
        for (const event of item.type === 'tuplet' ? item.content : [item]) {
          for (const n of event.notes ?? []) if (n.tie) n.tie.target = ref(n.tie.target);
          for (const s of event.slurs ?? []) s.target = ref(s.target);
        }
    for (const b of pm.beams) b.events = b.events.map(ref);
    for (const d of pm.directions) if (d.anchor.eventId) d.anchor.eventId = ref(d.anchor.eventId);
  }
  return ids;
}

/**
 * Unlinks a swapped layout part into a new part of its own: the pitches as the layout shows them (written
 * for the target when the layout is transposing), named "<Target> (from <Source>)", appended to the score
 * and replacing the source in this layout only. A part without a swap is a no-op.
 */
export const makeCopy: Command<{ layoutId: string; partId: string }> = {
  label: 'Make a copy',
  run: (draft, { layoutId, partId }) => {
    const found = layoutPartOf(draft, layoutId, partId);
    const swap = found?.lp.swap;
    if (!found || !swap) return;
    const { layout, lp } = found;
    // Plain snapshots: the swap transform clones, which a draft proxy does not allow.
    const doc = isDraft(draft.document) ? current(draft.document) : draft.document;
    const source = doc.parts.find((p) => p.id === partId);
    if (!source) return;
    const copy = swapPart(doc, source, isDraft(swap) ? current(swap) : swap, layout.transposing).part;
    const ids = renewIds(copy);
    copy.name = `${INSTRUMENTS[swap.instrument].label} (from ${source.name})`;
    draft.document.parts.push(copy);
    const overrides = doc.layouts.find((l) => l.id === layoutId)!.overrides;
    for (const [old, id] of ids) if (overrides[old]) layout.overrides[id] = structuredClone(overrides[old]);
    const replacement: LayoutPart = { partId: copy.id };
    if (lp.staves) replacement.staves = [...lp.staves];
    layout.parts[layout.parts.indexOf(lp)] = replacement;
  },
};
