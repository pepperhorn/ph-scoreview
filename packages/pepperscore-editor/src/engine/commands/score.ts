import { emptyPartMeasure } from '../../model/create';
import { newId } from '../../model/ids';
import { effectiveKey, effectiveTime, measureIndex } from '../../model/query';
import type { Clef, GlobalMeasure, Jump, Key, Time } from '../../model/schema';
import { clampCursor } from '../cursor-clamp';
import { pruneDanglingReferences, pruneSelection } from '../prune';
import { refillMeasure } from '../refill';
import type { Command, Cursor, Editable } from '../types';

type Barline = NonNullable<GlobalMeasure['barline']>;
type Tempo = NonNullable<GlobalMeasure['tempo']>;
export type Mark = 'segno' | 'coda' | 'toCoda' | 'fine';

/** Runs `fn` on the global measure `measureId`; unknown ids are a no-op. */
function withMeasure(draft: Editable, measureId: string, fn: (g: GlobalMeasure, index: number) => void): void {
  const index = measureIndex(draft.document, measureId);
  if (index >= 0) fn(draft.document.global.measures[index], index);
}

/** Refills every bar from `from` on, prunes broken references and keeps the cursor inside its bar. */
function refillFrom(draft: Editable, from: number): void {
  const doc = draft.document;
  for (let i = Math.max(from, 0); i < doc.global.measures.length; i++) refillMeasure(doc, i);
  pruneDanglingReferences(doc);
  pruneSelection(draft);
  const cursor = clampCursor(doc, draft.cursor);
  if (cursor !== draft.cursor) Object.assign(draft.cursor, cursor);
}

/** Rapid changes to one bar's time signature are one undo step (the refill of a passing value is undone with it). */
export const setTime: Command<{ measureId: string; time: Time }> = {
  label: 'Set time signature',
  coalesceKey: ({ measureId }) => `time:${measureId}`,
  run: (draft, { measureId, time }) =>
    withMeasure(draft, measureId, (g, index) => {
      if (g.time?.count === time.count && g.time.unit === time.unit) return;
      g.time = { count: time.count, unit: time.unit };
      refillFrom(draft, index);
    }),
};

export const setKey: Command<{ measureId: string; key: Key }> = {
  label: 'Set key signature',
  run: (draft, { measureId, key }) =>
    withMeasure(draft, measureId, (g) => {
      if (g.key && g.key.fifths === key.fifths && g.key.mode === key.mode) return;
      g.key = { ...key };
    }),
};

/** In bar 1 this sets the part's initial clef; later bars get a clef change at tick 0. */
export const setClef: Command<{ partId: string; measureId: string; staff: number; clef: Clef }> = {
  label: 'Set clef',
  run: (draft, { partId, measureId, staff, clef }) => {
    const part = draft.document.parts.find((p) => p.id === partId);
    const index = measureIndex(draft.document, measureId);
    if (!part || index < 0 || staff < 1 || staff > part.staves) return;
    const pm = part.measures[index];
    const others = pm.clefs?.filter((c) => !(c.staff === staff && (c.tick ?? 0) === 0));
    if (index === 0) {
      part.clefs[staff - 1] = clef;
      if (others && others.length !== pm.clefs!.length) {
        if (others.length) pm.clefs = others;
        else delete pm.clefs;
      }
    } else {
      pm.clefs = [...(others ?? []), { staff, clef }];
    }
  },
};

export const setBarline: Command<{ measureId: string; barline: Barline }> = {
  label: 'Set barline',
  run: (draft, { measureId, barline }) =>
    withMeasure(draft, measureId, (g) => {
      if (barline === 'regular') delete g.barline;
      else g.barline = barline;
    }),
};

export const toggleRepeatStart: Command<{ measureId: string }> = {
  label: 'Toggle repeat start',
  run: (draft, { measureId }) =>
    withMeasure(draft, measureId, (g) => {
      if (g.repeatStart) delete g.repeatStart;
      else g.repeatStart = true;
    }),
};

/** `times: null` removes the repeat end; omitted `times` means the default (play twice). */
export const setRepeatEnd: Command<{ measureId: string; times?: number | null }> = {
  label: 'Set repeat end',
  run: (draft, { measureId, times }) =>
    withMeasure(draft, measureId, (g) => {
      if (times === null) delete g.repeatEnd;
      else g.repeatEnd = times === undefined ? {} : { times };
    }),
};

export const setEnding: Command<{ measureId: string; numbers: number[] | null }> = {
  label: 'Set ending',
  run: (draft, { measureId, numbers }) =>
    withMeasure(draft, measureId, (g) => {
      if (numbers === null) delete g.ending;
      else g.ending = { numbers: [...numbers] };
    }),
};

export const setJump: Command<{ measureId: string; jump: Jump | null }> = {
  label: 'Set jump',
  run: (draft, { measureId, jump }) =>
    withMeasure(draft, measureId, (g) => {
      if (jump === null) delete g.jump;
      else g.jump = { type: jump.type, target: jump.target };
    }),
};

export const toggleMark: Command<{ measureId: string; mark: Mark }> = {
  label: 'Toggle mark',
  run: (draft, { measureId, mark }) =>
    withMeasure(draft, measureId, (g) => {
      if (g[mark]) delete g[mark];
      else g[mark] = true;
    }),
};

export const setTempo: Command<{ measureId: string; tempo: Tempo | null }> = {
  label: 'Set tempo',
  run: (draft, { measureId, tempo }) =>
    withMeasure(draft, measureId, (g) => {
      if (tempo === null) delete g.tempo;
      else if (!(g.tempo && g.tempo.bpm === tempo.bpm && g.tempo.unit === tempo.unit && g.tempo.text === tempo.text)) g.tempo = { ...tempo };
    }),
};

/**
 * Inserts a measure after `afterMeasureId` (null: at the start, which then takes over bar 1's
 * time and key), with a full-measure rest per staff in every part; the cursor moves there.
 */
export const insertMeasure: Command<{ afterMeasureId: string | null }> = {
  label: 'Insert measure',
  run: (draft, { afterMeasureId }) => {
    const doc = draft.document;
    const at = afterMeasureId === null ? 0 : measureIndex(doc, afterMeasureId) + 1;
    if (at === 0 && afterMeasureId !== null) return;
    const time = effectiveTime(doc, Math.max(at - 1, 0));
    const created: GlobalMeasure = at === 0 && doc.global.measures.length ? { id: newId(), time: { ...time }, key: { ...effectiveKey(doc, 0) } } : { id: newId() };
    doc.global.measures.splice(at, 0, created);
    for (const part of doc.parts) part.measures.splice(at, 0, emptyPartMeasure(part, time));
    draft.cursor.measureId = created.id;
    draft.cursor.tick = 0;
  },
};

/**
 * Deletes a measure in every part; refused when it is the only one. A time, key or tempo change, and
 * a clef change at its start, move to the next bar unless that bar has its own. When bar 1 goes, the
 * new bar 1's starting clef changes become the parts' initial clefs. A cursor in it moves to the previous bar.
 */
export const deleteMeasure: Command<{ measureId: string }> = {
  label: 'Delete measure',
  run: (draft, { measureId }) => {
    const doc = draft.document;
    const index = measureIndex(doc, measureId);
    if (index < 0 || doc.global.measures.length <= 1) return;
    const [removed] = doc.global.measures.splice(index, 1);
    const next = doc.global.measures[index];
    for (const part of doc.parts) {
      const [gone] = part.measures.splice(index, 1);
      const following = part.measures[index];
      if (!following) continue;
      const atStart = (c: { tick?: number }) => (c.tick ?? 0) === 0;
      const carried = (gone.clefs ?? []).filter((c) => atStart(c) && !following.clefs?.some((f) => f.staff === c.staff && atStart(f)));
      if (carried.length) following.clefs = [...(following.clefs ?? []), ...carried.map((c) => ({ ...c }))];
      if (index === 0 && following.clefs) {
        for (const c of following.clefs.filter(atStart)) part.clefs[c.staff - 1] = c.clef;
        const rest = following.clefs.filter((c) => !atStart(c));
        if (rest.length) following.clefs = rest;
        else delete following.clefs;
      }
    }
    if (next && removed.time && !next.time) next.time = { ...removed.time };
    if (next && removed.key && !next.key) next.key = { ...removed.key };
    if (next && removed.tempo && !next.tempo) next.tempo = { ...removed.tempo };
    for (const layout of doc.layouts) {
      if (layout.breaks?.some((b) => b.measureId === measureId)) layout.breaks = layout.breaks.filter((b) => b.measureId !== measureId);
    }
    if (draft.cursor.measureId === measureId) {
      draft.cursor.measureId = doc.global.measures[Math.max(index - 1, 0)].id;
      draft.cursor.tick = 0;
    }
    refillFrom(draft, index);
  },
};

/** Cursor-only; never recorded. */
export const setCursor: Command<Partial<Cursor>> = {
  label: 'Move cursor',
  record: false,
  run: (draft, cursor) => {
    if (draft.cursor.entered !== undefined && !('entered' in cursor)) delete draft.cursor.entered;
    Object.assign(draft.cursor, cursor);
  },
};

/** Selection-only; never recorded. */
export const setSelection: Command<{ ids: string[] }> = {
  label: 'Select',
  record: false,
  run: (draft, { ids }) => {
    draft.selection.ids = [...ids];
  },
};

/** Sets the score's title and/or composer; a blank value removes it. Keys left out are unchanged. */
export const setMeta: Command<{ title?: string; composer?: string }> = {
  label: 'Edit score info',
  run: (draft, args) => {
    const meta = draft.document.meta;
    for (const key of ['title', 'composer'] as const) {
      const value = args[key];
      if (value === undefined) continue;
      const trimmed = value.trim();
      if (!trimmed) delete meta[key];
      else if (meta[key] !== trimmed) meta[key] = trimmed;
    }
  },
};
