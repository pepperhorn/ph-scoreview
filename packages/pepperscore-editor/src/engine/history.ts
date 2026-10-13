import type { History, HistoryEntry } from './types';

/** Entries with the same coalesce key recorded within this window merge into one undo step. */
export const COALESCE_MS = 500;

/**
 * Returns `past` with `entry` appended, or merged into the last entry when both share a
 * coalesce key and were recorded within `COALESCE_MS` (patches concatenated, inverse prepended).
 */
export function coalesceOrPush(past: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const last = past.at(-1);
  if (last && entry.coalesceKey !== undefined && last.coalesceKey === entry.coalesceKey && entry.at - last.at <= COALESCE_MS) {
    const merged: HistoryEntry = {
      ...last,
      patches: [...last.patches, ...entry.patches],
      inverse: [...entry.inverse, ...last.inverse],
      at: entry.at,
    };
    return [...past.slice(0, -1), merged];
  }
  return [...past, entry];
}

/** Records a new entry: coalesces or pushes, and clears the redo stack. */
export function record(history: History, entry: HistoryEntry): History {
  return { past: coalesceOrPush(history.past, entry), future: [] };
}

/** Moves the last past entry onto the future stack; undefined when there is nothing to undo. */
export function takeUndo(history: History): { entry: HistoryEntry; history: History } | undefined {
  const entry = history.past.at(-1);
  if (!entry) return undefined;
  return { entry, history: { past: history.past.slice(0, -1), future: [...history.future, entry] } };
}

/** Moves the last future entry back onto the past stack; undefined when there is nothing to redo. */
export function takeRedo(history: History): { entry: HistoryEntry; history: History } | undefined {
  const entry = history.future.at(-1);
  if (!entry) return undefined;
  return { entry, history: { past: [...history.past, entry], future: history.future.slice(0, -1) } };
}
