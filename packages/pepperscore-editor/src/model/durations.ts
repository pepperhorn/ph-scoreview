export const TICKS_PER_QUARTER = 960;

export const DURATION_BASES = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd'] as const;
export type DurationBase = typeof DURATION_BASES[number];
export type Duration = { base: DurationBase; dots: 0 | 1 | 2 };

export const BASE_TICKS: Record<DurationBase, number> = {
  whole: 3840,
  half: 1920,
  quarter: 960,
  eighth: 480,
  '16th': 240,
  '32nd': 120,
};

/** Ticks of a (possibly dotted) duration, ignoring any tuplet scaling. */
export function durationTicks(d: Duration): number {
  const base = BASE_TICKS[d.base];
  if (d.dots === 2) return base * 1.75;
  if (d.dots === 1) return base * 1.5;
  return base;
}

/** Ticks in one bar of the given time signature: count * 4/unit quarters. */
export function measureTicks(time: { count: number; unit: number }): number {
  return (time.count * 4 * TICKS_PER_QUARTER) / time.unit;
}

/**
 * Greedy split of a tick span into durations, for rest padding: largest base
 * first, preferring the single-dotted form when it fits.
 */
export function ticksToDurations(ticks: number): Duration[] {
  const out: Duration[] = [];
  let remaining = ticks;
  for (const base of DURATION_BASES) {
    const plain = BASE_TICKS[base];
    const dotted = plain * 1.5;
    while (remaining >= plain) {
      if (remaining >= dotted) {
        out.push({ base, dots: 1 });
        remaining -= dotted;
      } else {
        out.push({ base, dots: 0 });
        remaining -= plain;
      }
    }
  }
  if (remaining > 0) throw new Error(`Cannot express ${ticks} ticks as durations`);
  return out;
}
