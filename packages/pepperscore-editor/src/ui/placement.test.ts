import { intersects, placePopover, rect } from './placement';

const viewport = rect(0, 0, 1000, 600);
const size = { width: 276, height: 250 };
const box = (p: { left: number; top: number }) => rect(p.left, p.top, size.width, size.height);

describe('placePopover', () => {
  it('opens on the left of the cursor bar when it fits, top-aligned', () => {
    const anchor = rect(500, 100, 200, 150);
    const p = placePopover(anchor, size, viewport);
    expect(p).toEqual({ left: 500 - 12 - 276, top: 100, side: 'left' });
    expect(intersects(box(p), anchor)).toBe(false);
  });
  it('falls back to the right when the left has no room', () => {
    const anchor = rect(100, 100, 200, 150);
    const p = placePopover(anchor, size, viewport);
    expect(p).toEqual({ left: 312, top: 100, side: 'right' });
    expect(intersects(box(p), anchor)).toBe(false);
  });
  it('goes above when neither side fits, centred on the bar', () => {
    const anchor = rect(250, 300, 500, 150);
    const p = placePopover(anchor, size, viewport);
    expect(p.side).toBe('above');
    expect(p.top).toBe(300 - 12 - 250);
    expect(p.left).toBe(250 + 250 - 138);
    expect(intersects(box(p), anchor)).toBe(false);
  });
  it('goes below as the last resort', () => {
    const anchor = rect(250, 40, 500, 150);
    const p = placePopover(anchor, size, viewport);
    expect(p).toMatchObject({ side: 'below', top: 202 });
    expect(intersects(box(p), anchor)).toBe(false);
  });
  it('clamps inside the viewport', () => {
    const left = placePopover(rect(400, 500, 100, 90), size, viewport);
    expect(left.side).toBe('left');
    expect(left.top).toBe(600 - 250);
    const below = placePopover(rect(-50, 40, 1100, 500), size, viewport);
    expect(below).toEqual({ left: 362, top: 600 - 250, side: 'below' });
    expect(placePopover(rect(-900, 400, 1880, 100), size, viewport)).toEqual({ left: 0, top: 138, side: 'above' });
  });
  it('honours a custom gap and an offset viewport', () => {
    const p = placePopover(rect(600, 200, 100, 100), size, rect(200, 100, 800, 500), 20);
    expect(p).toEqual({ left: 600 - 20 - 276, top: 200, side: 'left' });
  });
});
