import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { CanvasHeader } from '../CanvasHeader';
import { CanvasOverlay } from '../CanvasOverlay';
import { HintStrip } from '../HintStrip';
import { Inspector } from '../Inspector';
import { Rail } from '../Rail';
import type { ShellProps } from '../shell';
import { StatusLine } from '../StatusLine';
import { TopBar } from '../TopBar';

/**
 * The desktop editor: top bar, then the rail, the canvas (header, score with the popover layer and add-bar
 * buttons, keyboard hints) and the inspector, then the status line. Containers 760px wide or less get the
 * phone shell instead.
 */
export function DesktopShell(props: ShellProps) {
  const stage = useRef<HTMLDivElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const closeInspector = useCallback(() => setInspectorOpen(false), []);
  useInspectorDrawer(workspace, inspectorOpen, closeInspector);
  return (
    <div className="ps-shell ps-shell-desktop">
      <TopBar playing={props.playing} licence={props.licence} onPlay={props.onPlay} onSave={props.onSave} onExport={props.onExport} onOpen={props.onOpen} />
      {props.banners}
      <div ref={workspace} className="ps-workspace">
        <Rail />
        <main className="ps-canvas" aria-label="Score">
          <CanvasHeader mode={props.viewerMode} onMode={props.setViewerMode} inspectorOpen={inspectorOpen} onInspector={() => setInspectorOpen((open) => !open)} />
          <div ref={stage} className="ps-desk ps-editor-stage">
            {props.viewer}
            <CanvasOverlay stage={stage} popover={props.popover} closePopover={props.closePopover} draws={props.draws} />
          </div>
          <HintStrip />
        </main>
        <Inspector open={inspectorOpen} />
      </div>
      <StatusLine savedAt={props.savedAt} onReport={props.onReport} />
    </div>
  );
}

/**
 * The inspector drawer (medium containers): Escape or a pointer down outside it (its toggle and popovers aside)
 * closes it. Escape is taken in the capture phase, so it does not also leave entry mode.
 */
function useInspectorDrawer(workspace: RefObject<HTMLDivElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !workspace.current?.closest('.ps-editor')?.contains(event.target as Node)) return;
      event.stopPropagation();
      close();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.('.ps-inspector, .ps-inspector-toggle, .ps-popover')) return;
      close();
    };
    window.addEventListener('keydown', onKey, true);
    window.document.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [workspace, open, close]);
}
