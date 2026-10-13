import { newId } from '../../model/ids';
import { measureIndex } from '../../model/query';
import type { Anchor, Direction, Dynamic, PartMeasure } from '../../model/schema';
import type { Command, Editable } from '../types';

type WedgeShape = Extract<Direction, { kind: 'wedge' }>['shape'];
type TextStyle = NonNullable<Extract<Direction, { kind: 'text' }>['style']>;

/** The part measure an anchor lands in: `partId`'s, defaulting to the cursor's part. */
function measureFor(draft: Editable, anchor: Anchor, partId?: string): PartMeasure | undefined {
  const part = draft.document.parts.find((p) => p.id === (partId ?? draft.cursor.partId));
  const index = measureIndex(draft.document, anchor.measureId);
  return part && index >= 0 && anchor.staff <= part.staves ? part.measures[index] : undefined;
}

function add(draft: Editable, anchor: Anchor, partId: string | undefined, make: (id: string, anchor: Anchor) => Direction): void {
  measureFor(draft, anchor, partId)?.directions.push(make(newId(), { ...anchor }));
}

function findDirection(draft: Editable, id: string): { pm: PartMeasure; index: number } | undefined {
  for (const part of draft.document.parts)
    for (const pm of part.measures) {
      const index = pm.directions.findIndex((d) => d.id === id);
      if (index >= 0) return { pm, index };
    }
  return undefined;
}

export const addDynamic: Command<{ anchor: Anchor; value: Dynamic; partId?: string }> = {
  label: 'Add dynamic',
  run: (draft, { anchor, value, partId }) => add(draft, anchor, partId, (id, a) => ({ kind: 'dynamic', id, anchor: a, value })),
};

export const addWedge: Command<{ anchor: Anchor; shape: WedgeShape; endTick: number; endMeasureId?: string; partId?: string }> = {
  label: 'Add hairpin',
  run: (draft, { anchor, shape, endTick, endMeasureId, partId }) =>
    add(draft, anchor, partId, (id, a) => ({ kind: 'wedge', id, anchor: a, shape, endTick, ...(endMeasureId ? { endMeasureId } : {}) })),
};

export const addText: Command<{ anchor: Anchor; text: string; style?: TextStyle; partId?: string }> = {
  label: 'Add text',
  run: (draft, { anchor, text, style, partId }) => add(draft, anchor, partId, (id, a) => ({ kind: 'text', id, anchor: a, text, ...(style ? { style } : {}) })),
};

export const removeDirection: Command<{ id: string }> = {
  label: 'Remove',
  run: (draft, { id }) => {
    const found = findDirection(draft, id);
    if (found) found.pm.directions.splice(found.index, 1);
  },
};

/** Moves a direction by (dx, dy) staff spaces; repeated nudges of one direction coalesce. */
export const nudge: Command<{ id: string; dx: number; dy: number }> = {
  label: 'Nudge',
  coalesceKey: ({ id }) => `nudge:${id}`,
  run: (draft, { id, dx, dy }) => {
    const found = findDirection(draft, id);
    if (!found || (dx === 0 && dy === 0)) return;
    const d = found.pm.directions[found.index];
    d.offset = { x: (d.offset?.x ?? 0) + dx, y: (d.offset?.y ?? 0) + dy };
  },
};
