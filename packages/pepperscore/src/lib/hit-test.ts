/** Click hit testing over the drawn notes (pure: the boxes are measured by the caller, in client px). */
export type HitRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
/** A drawn note or rest: its whole box (stem, flag, accidentals, dots, lyrics) and its notehead boxes (a rest: its glyph). */
export type DrawnNote = { box: HitRect; heads: HitRect[] };

/** Noteheads whose centres are this close in x count as stacked (two voices, a chord's seconds): y then decides. */
const STACKED_PX = 4;

const gap = (value: number, from: number, to: number) => (value < from ? from - value : value > to ? value - to : 0);

/** The note nearest (x, y): the notehead centre nearest in x, stacked noteheads split by the nearest in y. */
export function nearestNote<T extends DrawnNote>(items: T[], x: number, y: number): T | undefined {
  let best: T | undefined, bestDx = Infinity, bestDy = Infinity;
  for (const item of items) {
    const heads = item.heads.length ? item.heads : [item.box];
    const left = Math.min(...heads.map(head => head.left)), right = Math.max(...heads.map(head => head.right));
    const dx = Math.abs((left + right) / 2 - x);
    const dy = Math.min(...heads.map(head => gap(y, head.top, head.bottom)));
    const stacked = Math.abs(dx - bestDx) <= STACKED_PX;
    if (stacked ? dy < bestDy || (dy === bestDy && dx < bestDx) : dx < bestDx) {
      best = item; bestDx = dx; bestDy = dy;
    }
  }
  return best;
}

/** The note whose drawn box (grown by `slop` px) holds (x, y); overlapping boxes go to the nearest notehead. */
export function noteInBox<T extends DrawnNote>(items: T[], x: number, y: number, slop: number): T | undefined {
  return nearestNote(items.filter(({ box }) => box.width && x >= box.left - slop && x <= box.right + slop && y >= box.top - slop && y <= box.bottom + slop), x, y);
}
