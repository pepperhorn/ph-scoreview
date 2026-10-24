// Schema-free range-fit rules shared by the editor and the reader: both build phrases and ties from their
// own score model and hand them here as plain event ids and MIDI numbers.

export type Shift = 0 | 12 | -12;
/** One event (note or chord): its notes' judged MIDI (sounding plus interval). */
export type FitEvent = { id: string; midi: number[] };

/** Merges runs of event ids that a tie links (`[from, to]`), keeping the first run's position. */
export function joinRuns(runs: string[][], ties: [string, string][]): string[][] {
  const runOf = new Map<string, number>();
  runs.forEach((run, i) => run.forEach((id) => runOf.set(id, i)));
  const parent = runs.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (const [from, to] of ties) {
    const a = runOf.get(from), b = runOf.get(to);
    if (a === undefined || b === undefined) continue;
    const [ra, rb] = [root(a), root(b)];
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  const merged = new Map<number, string[]>();
  runs.forEach((run, i) => {
    const r = root(i);
    merged.set(r, [...(merged.get(r) ?? []), ...run]);
  });
  return [...merged.values()];
}

/** The ordered chain of events the ties link around `id` (itself alone when untied). */
export function tieChainOf(ties: [string, string][]): (id: string) => string[] {
  const parent = new Map<string, string>();
  const root = (id: string): string => { let r = id; while (parent.has(r)) r = parent.get(r)!; return r; };
  const order: string[] = [];
  const seen = new Set<string>();
  const note = (id: string) => { if (!seen.has(id)) { seen.add(id); order.push(id); } };
  for (const [from, to] of ties) {
    note(from); note(to);
    const [a, b] = [root(from), root(to)];
    if (a !== b) parent.set(b, a);
  }
  const groups = new Map<string, string[]>();
  for (const id of order) {
    const r = root(id);
    groups.set(r, [...(groups.get(r) ?? []), id]);
  }
  return (id) => (seen.has(id) ? groups.get(root(id))! : [id]);
}

export type ShiftPlan = { shifts: Record<string, Shift>; bothWays: string[][]; stillOut: string[][] };

/**
 * Plans an octave per phrase: any note below the range moves every event up, above moves it down, both
 * leaves the phrase (listed in `bothWays`); a phrase still out after its move keeps it (listed in
 * `stillOut`). A chord is out when any of its notes is. No range or `autoRange` off plans no shifts.
 */
export function planShifts(phrases: FitEvent[][], range: { low: number; high: number } | undefined, autoRange: boolean): ShiftPlan {
  const shifts: Record<string, Shift> = {};
  const bothWays: string[][] = [];
  const stillOut: string[][] = [];
  for (const phrase of phrases) for (const e of phrase) shifts[e.id] = 0;
  if (!autoRange || !range) return { shifts, bothWays, stillOut };
  const outside = (midis: number[]) => ({ below: midis.some((m) => m < range.low), above: midis.some((m) => m > range.high) });
  for (const phrase of phrases) {
    const midis = phrase.flatMap((e) => e.midi);
    const ids = phrase.map((e) => e.id);
    const { below, above } = outside(midis);
    if (below && above) { bothWays.push(ids); continue; }
    if (!below && !above) continue;
    const shift: Shift = below ? 12 : -12;
    for (const id of ids) shifts[id] = shift;
    const after = outside(midis.map((m) => m + shift));
    if (after.below || after.above) stillOut.push(ids);
  }
  return { shifts, bothWays, stillOut };
}

/** Sets single events from the user's overrides, each extended along its tie chain (the first override on a chain wins); overrides beat planned shifts. */
export function applyOverrides(shifts: Record<string, Shift>, overrides: Record<string, Shift>, chainOf: (id: string) => string[]): Record<string, Shift> {
  const out = { ...shifts };
  for (const id of Object.keys(overrides)) {
    const chain = chainOf(id);
    const owner = chain.find((e) => overrides[e] !== undefined)!;
    for (const e of chain) out[e] = overrides[owner];
  }
  return out;
}
