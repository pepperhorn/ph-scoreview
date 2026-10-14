import { useLayoutEffect, useState, type RefObject } from 'react';

/** Containers this wide or narrower get the phone shell (the same breakpoint as the stylesheet's phone rules). */
export const PHONE_MAX_WIDTH = 760;

/**
 * True when the editor root is a phone-sized container (content width 760px or less), followed with a
 * `ResizeObserver`; `force` (the `forcePhone` prop) overrides the measurement either way.
 */
export function useIsPhone(root: RefObject<HTMLElement | null>, force?: boolean): boolean {
  const [phone, setPhone] = useState(false);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || force !== undefined) return;
    const update = (width: number) => setPhone(width > 0 && width <= PHONE_MAX_WIDTH);
    update(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [root, force]);
  return force ?? phone;
}
