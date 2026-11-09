/** Greedy zero-based line starts, including 0 for a non-empty score. Oversize bars stand alone. */
export function breakLines(barWidths: number[], capacity: number, maxBars: number): number[] {
  if (!Number.isFinite(capacity) || capacity <= 0 || !Number.isInteger(maxBars) || maxBars < 1
    || barWidths.some(width => !Number.isFinite(width) || width < 0)) throw new RangeError('Invalid PDF line dimensions.');
  const starts: number[] = [];
  let used = 0, count = 0;
  for (let index = 0; index < barWidths.length; index++) {
    const width = barWidths[index];
    if (!count || count >= maxBars || used + width > capacity) { starts.push(index); used = 0; count = 0; }
    used += width; count++;
  }
  return starts;
}
