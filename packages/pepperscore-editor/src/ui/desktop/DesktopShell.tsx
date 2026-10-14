import { useRef } from 'react';
import { AddBarButtons } from '../AddBarButtons';
import { CanvasHeader } from '../CanvasHeader';
import { useUi } from '../controls';
import { HintStrip } from '../HintStrip';
import { Inspector } from '../Inspector';
import { Palette } from '../Palette';
import { Popover } from '../Popover';
import { Rail } from '../Rail';
import type { ShellProps } from '../shell';
import { StatusLine } from '../StatusLine';
import { TopBar } from '../TopBar';
import { useCanvasGeometry } from '../useCanvasGeometry';

/**
 * The desktop editor: top bar, then the rail, the canvas (header, score with the popover layer and add-bar
 * buttons, keyboard hints) and the inspector, then the status line. On a narrow container (760px or less)
 * the touch palette stands in for the rail and inspector until the phone shell replaces this layout.
 */
export function DesktopShell(props: ShellProps) {
  const ui = useUi();
  const stage = useRef<HTMLDivElement>(null);
  const geometry = useCanvasGeometry(stage, props.drawn);
  return (
    <div className="ps-shell ps-shell-desktop">
      <TopBar playing={props.playing} licence={props.licence} onPlay={props.onPlay} onSave={props.onSave} onExport={props.onExport} onOpen={props.onOpen} />
      {props.banners}
      <div className="ps-workspace">
        <Rail />
        <main className="ps-canvas" aria-label="Score">
          <CanvasHeader mode={props.viewerMode} onMode={props.setViewerMode} />
          <div ref={stage} className="ps-desk ps-editor-stage">
            {props.viewer}
            <div className="ps-popover-layer">
              {props.popover && ui.editable && <Popover name={props.popover} store={ui.store} onClose={props.closePopover} anchor={geometry.cursor} viewport={geometry.viewport} stage={stage.current} />}
              <AddBarButtons geometry={geometry} />
            </div>
          </div>
          <HintStrip />
        </main>
        <Inspector />
      </div>
      <Palette ctx={ui.ctx} editable={ui.editable} refocus={ui.refocus} />
      <StatusLine savedAt={props.savedAt} onReport={props.onReport} />
    </div>
  );
}
