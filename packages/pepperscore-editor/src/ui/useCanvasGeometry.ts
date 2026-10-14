import { useEffect, useRef, useState, type RefObject } from 'react';
import { rect, type Rect } from './placement';

/** Rectangles in the canvas stage's coordinates: the stage itself, the cursor bar and the last drawn bar. */
export type CanvasGeometry = { viewport: Rect; cursor: Rect | null; last: Rect | null };

const EMPTY: CanvasGeometry = { viewport: rect(0, 0, 0, 0), cursor: null, last: null };

/** `element`'s client rect relative to `origin`; null when it is not laid out. */
export function relativeRect(element: Element | null | undefined, origin: DOMRect): Rect | null {
  if (!element) return null;
  const r = element.getBoundingClientRect();
  return r.width || r.height ? rect(r.left - origin.left, r.top - origin.top, r.width, r.height) : null;
}

/** The cursor bar: the `ps-cursor-measure` highlight, else the bar holding the `ps-cursor` note (else that note). */
export function cursorBarElement(host: ParentNode): Element | null {
  const bar = host.querySelector('[data-ps-highlight~="ps-cursor-measure"], .ps-cursor-measure');
  if (bar) return bar;
  const note = host.querySelector('[data-ps-highlight~="ps-cursor"], .ps-cursor');
  return note?.closest('.measure') ?? note?.closest('.chord') ?? note ?? null;
}

const same = (a: Rect | null, b: Rect | null) => a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

/**
 * Measures the stage when `trigger` changes (a draw, a highlight change), on scroll and on resize, at most once
 * per frame and a frame after the change (the viewer re-applies highlights after a draw), so popovers and the
 * add-bar buttons follow the engraving. Nothing is measured while the viewer redraws.
 */
export function useCanvasGeometry(stage: RefObject<HTMLElement | null>, trigger: unknown): CanvasGeometry {
  const [geometry, setGeometry] = useState<CanvasGeometry>(EMPTY);
  const scheduleRef = useRef<() => void>(() => {});
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = 0;
      scheduleRef.current();
    });
    return () => cancelAnimationFrame(frame);
  }, [trigger]);
  useEffect(() => {
    const host = stage.current;
    if (!host) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const origin = host.getBoundingClientRect();
      const bars = host.querySelectorAll('.score-system svg .measure');
      const next: CanvasGeometry = {
        viewport: rect(0, 0, origin.width, origin.height),
        cursor: relativeRect(cursorBarElement(host), origin),
        last: relativeRect(bars[bars.length - 1], origin),
      };
      setGeometry((previous) => (same(previous.viewport, next.viewport) && same(previous.cursor, next.cursor) && same(previous.last, next.last) ? previous : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    scheduleRef.current = schedule;
    schedule();
    const resize = new ResizeObserver(schedule);
    resize.observe(host);
    host.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      host.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [stage]);
  return geometry;
}
