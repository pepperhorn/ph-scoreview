/**
 * System-aware paging for Vertical mode. A page is a scroll position whose viewport shows whole systems: it starts at
 * a system top (less a small pad) and holds as many complete systems as fit. Overhang repeats the last systems of the
 * previous page at the top of the next, but only while at least one new complete system still fits below them.
 * A system taller than the viewport is a tall page: it is stepped through a viewport at a time.
 */
export type SystemSpan = { top: number; bottom: number };
/** `first..last` are the systems wholly in view at `start`; a tall page shows part of system `first` (=== `last`). */
export type ReadingPage = { start: number; first: number; last: number; tall: boolean };

/** Space kept above a page's first system; the previous system's bottom margin is blank at least this far. */
export const PAGE_PAD_PX = 8;
/** Overlap between consecutive steps through a system taller than the viewport. */
export const TALL_PAGE_OVERLAP_PX = 48;
/** Scroll positions this close count as the same page. */
export const PAGE_EPSILON_PX = 2;

export function systemPages(systems: SystemSpan[], viewHeight: number, overlap: number, pad = PAGE_PAD_PX, tallOverlap = TALL_PAGE_OVERLAP_PX): ReadingPage[] {
  const n = systems.length;
  if (!n || viewHeight <= 0) return [{ start: 0, first: 0, last: n - 1, tall: false }];
  const fits = (index: number, start: number) => systems[index].bottom <= start + viewHeight + .5;
  const topOf = (index: number) => Math.max(0, systems[index].top - pad);
  const pages: ReadingPage[] = [];
  // The first page shows the title; when the first system does not fit below it, the first page starts at that system.
  let first = 0;
  let start = fits(0, 0) ? 0 : topOf(0);
  for (let next = 0; next < n;) {
    let last = next - 1;
    while (last + 1 < n && fits(last + 1, start)) last++;
    if (last < next) {
      // A system taller than the viewport: step through it, ending with its bottom in view.
      const end = Math.max(start, systems[next].bottom + pad - viewHeight);
      const step = Math.max(40, viewHeight - tallOverlap);
      for (let at = start; ; at = Math.min(end, at + step)) {
        pages.push({ start: at, first: next, last: next, tall: true });
        if (at >= end - .5) break;
      }
      next++;
      if (next < n) { first = next; start = topOf(next); }
      continue;
    }
    pages.push({ start, first, last, tall: false });
    next = last + 1;
    if (next >= n) break;
    // Overhang: repeat up to `overlap` systems, dropping them until one new complete system fits.
    let repeat = Math.max(0, Math.min(overlap, next - first));
    while (repeat > 0 && !fits(next, topOf(next - repeat))) repeat--;
    first = next - repeat;
    start = topOf(first);
  }
  return pages;
}

/** Distinct page starts in scroll order. */
export const pageStarts = (pages: ReadingPage[]) => [...new Set(pages.map(page => Math.round(page.start)))].sort((a, b) => a - b);

/** The page start a turn moves to from `current`: the next start below it, or the last start above it (else the top). */
export function turnTarget(pages: ReadingPage[], current: number, direction: number, epsilon = PAGE_EPSILON_PX): number | null {
  const starts = pageStarts(pages);
  if (direction > 0) return starts.find(start => start > current + epsilon) ?? null;
  return [...starts].reverse().find(start => start < current - epsilon) ?? (current > epsilon ? 0 : null);
}

/** The first page that shows system `index` whole (or the first step of it when it is tall). */
export const pageOfSystem = (pages: ReadingPage[], index: number) => pages.find(page => page.first <= index && index <= page.last) ?? null;
