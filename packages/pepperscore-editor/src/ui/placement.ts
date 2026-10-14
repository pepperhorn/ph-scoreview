/** A rectangle in one coordinate space (a `DOMRect` fits). */
export type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export type Side = 'left' | 'right' | 'above' | 'below';
export type Placement = { left: number; top: number; side: Side };

export const rect = (left: number, top: number, width: number, height: number): Rect => ({ left, top, width, height, right: left + width, bottom: top + height });

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * Where a popover of `size` opens beside `anchor` (the cursor bar) inside `viewport`, `gap` away from it:
 * on the left if it fits, else the right, else above, else below; never over the anchor while a side fits.
 * Beside the anchor it is top-aligned with it, above or below it is centred on it; the result is clamped
 * inside the viewport (when nothing fits, below and clamped).
 */
export function placePopover(anchor: Rect, size: { width: number; height: number }, viewport: Rect, gap = 12): Placement {
  const { width, height } = size;
  const fit = (left: number, top: number, side: Side): Placement => ({
    left: clamp(left, viewport.left, viewport.right - width),
    top: clamp(top, viewport.top, viewport.bottom - height),
    side,
  });
  const besideTop = anchor.top;
  const centredLeft = anchor.left + anchor.width / 2 - width / 2;
  if (anchor.left - gap - width >= viewport.left) return fit(anchor.left - gap - width, besideTop, 'left');
  if (anchor.right + gap + width <= viewport.right) return fit(anchor.right + gap, besideTop, 'right');
  if (anchor.top - gap - height >= viewport.top) return fit(centredLeft, anchor.top - gap - height, 'above');
  return fit(centredLeft, anchor.bottom + gap, 'below');
}

/** True when two rectangles overlap (touching edges do not). */
export const intersects = (a: Rect, b: Rect): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
