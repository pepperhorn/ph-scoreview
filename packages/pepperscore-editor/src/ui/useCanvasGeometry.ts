import { useEffect, useState, type RefObject } from 'react';
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

/** A signal the session fires after every viewer draw; listeners never re-render the session. */
export type DrawSignal = { subscribe(listener: () => void): () => void };
export function createDrawSignal(): DrawSignal & { emit(): void } {
  const listeners = new Set<() => void>();
  return {
    emit: () => listeners.forEach((listener) => listener()),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The last bar of the last drawn system (only that system's bars are scanned). */
function lastBarElement(host: ParentNode): Element | null {
  const systems = host.querySelectorAll('.score-system');
  const bars = systems[systems.length - 1]?.querySelectorAll('svg .measure');
  return bars?.[bars.length - 1] ?? null;
}

export type GeometryNeeds = {
  /** The cursor bar is measured (popover open): again after every cursor or selection change. */
  cursor: boolean;
  /** The last bar is measured (add-bar buttons shown). */
  last: boolean;
  /** Fires after every viewer draw. */
  draws: DrawSignal;
  /** Cursor and selection changes (the viewer re-applies its highlights a frame later). */
  subscribe(listener: () => void): () => void;
};

/**
 * Measures what `needs` asks for, a frame after a draw, a highlight change (cursor needed only), a scroll or a
 * resize, at most once per frame; with nothing needed it measures and listens to nothing.
 */
export function useCanvasGeometry(stage: RefObject<HTMLElement | null>, needs: GeometryNeeds): CanvasGeometry {
  const [geometry, setGeometry] = useState<CanvasGeometry>(EMPTY);
  const { cursor: wantCursor, last: wantLast, draws, subscribe } = needs;
  useEffect(() => {
    const host = stage.current;
    if (!host || (!wantCursor && !wantLast)) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const origin = host.getBoundingClientRect();
      const next: CanvasGeometry = {
        viewport: rect(0, 0, origin.width, origin.height),
        cursor: wantCursor ? relativeRect(cursorBarElement(host), origin) : null,
        last: wantLast ? relativeRect(lastBarElement(host), origin) : null,
      };
      setGeometry((previous) => (same(previous.viewport, next.viewport) && same(previous.cursor, next.cursor) && same(previous.last, next.last) ? previous : next));
    };
    // Two frames: the viewer applies highlights in its own effect, after this one is scheduled.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => (frame = requestAnimationFrame(measure)));
    };
    schedule();
    const resize = new ResizeObserver(schedule);
    resize.observe(host);
    const unsubscribeDraws = draws.subscribe(schedule);
    const unsubscribeStore = wantCursor ? subscribe(schedule) : () => {};
    host.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      unsubscribeDraws();
      unsubscribeStore();
      host.removeEventListener('scroll', schedule, true);
    };
  }, [stage, wantCursor, wantLast, draws, subscribe]);
  return geometry;
}
