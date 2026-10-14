import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CanvasOverlay } from '../CanvasOverlay';
import { useUi } from '../controls';
import type { ShellProps } from '../shell';
import { StatusLine } from '../StatusLine';
import { PhoneHeader, useAutoCollapse } from './PhoneHeader';
import { PhoneToolbar } from './PhoneToolbar';

/**
 * The phone editor (containers 760px wide or less): an auto-collapsing header over the top of the canvas and a
 * tabbed toolbar pinned to the bottom. The canvas is padded by both (the header's height as it animates, the
 * toolbar's measured height), so the score scrolls between them and nothing jumps.
 */
export function PhoneShell(props: ShellProps) {
  const { store, refocus } = useUi();
  const shell = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { collapsed, wake } = useAutoCollapse(4000, menuOpen, shell, refocus);

  // Any dispatch, and the user's own touch, wheel or pointer on the canvas, expands the header and restarts its
  // idle timer. Not `scroll`: the collapse itself (a taller viewport clamping scrollTop) and playback's
  // auto-scroll fire it too, which would keep the header bouncing open.
  useEffect(() => store.subscribe(() => wake()), [store, wake]);
  useEffect(() => {
    const host = stage.current;
    if (!host) return;
    const events = ['touchmove', 'wheel', 'pointerdown'] as const;
    for (const type of events) host.addEventListener(type, wake, { capture: true, passive: true });
    return () => {
      for (const type of events) host.removeEventListener(type, wake, { capture: true });
    };
  }, [wake]);
  useLayoutEffect(() => {
    const bar = toolbar.current;
    const root = shell.current;
    if (!bar || !root) return;
    const update = () => root.style.setProperty('--ps-toolbar-h', `${bar.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={shell} className="ps-shell ps-shell-phone" data-header={collapsed ? 'collapsed' : 'full'}>
      <PhoneHeader
        collapsed={collapsed} wake={wake} playing={props.playing} onPlay={props.onPlay} menuOpen={menuOpen} setMenuOpen={setMenuOpen}
        licence={props.licence} onSave={props.onSave} onExport={props.onExport} onOpen={props.onOpen} onNew={props.onNew}
      />
      <div className="ps-phone-body">
        {props.banners}
        <main className="ps-canvas ps-phone-canvas" aria-label="Score">
          <div ref={stage} className="ps-desk ps-editor-stage">
            {props.viewer}
            <CanvasOverlay stage={stage} popover={null} closePopover={props.closePopover} draws={props.draws} />
          </div>
        </main>
        <StatusLine savedAt={props.savedAt} onReport={props.onReport} />
      </div>
      <PhoneToolbar ref={toolbar} popover={props.popover} closePopover={props.closePopover} onReport={props.onReport} />
    </div>
  );
}
