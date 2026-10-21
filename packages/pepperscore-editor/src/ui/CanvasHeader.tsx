import { memo } from 'react';
import { setActiveLayout } from '../engine/commands/index';
import { tip, useCursorBar, useCursorPartName, useRun, useUi } from './controls';
import { Icon } from './icons';
import { layoutLabel } from './LayoutTab';
import { useEditorStore } from './useEditorStore';

export type ViewerMode = 'vertical' | 'endless';

/** Above the score: the Entry/Edit badge (click toggles), the position, the layout selector, Page/Endless, zoom and (medium widths) the inspector toggle. */
export const CanvasHeader = memo(function CanvasHeader({ mode, onMode, inspectorOpen, onInspector }: { mode: ViewerMode; onMode(mode: ViewerMode): void; inspectorOpen: boolean; onInspector(): void }) {
  const { store, editable, refocus } = useUi();
  const run = useRun();
  const { index, bars } = useCursorBar();
  const partName = useCursorPartName();
  const entry = useEditorStore(store, (s) => s.cursor.mode === 'enter');
  const layouts = useEditorStore(store, (s) => s.document.layouts);
  const activeLayoutId = useEditorStore(store, (s) => s.activeLayoutId);
  return (
    <div className="ps-canvas-head">
      <div className="ps-canvas-crumbs">
        <button
          type="button"
          className={`ps-btn ps-mode-pill ${entry ? 'is-entry' : 'is-select'}`}
          aria-label="Toggle note entry"
          aria-pressed={entry}
          title={tip(entry ? 'Note entry: click for Edit mode' : 'Edit mode: click for note entry', 'Toggle note entry')}
          disabled={!editable}
          onClick={() => run('Toggle note entry')}
        >
          <span className="ps-mode-dot" />{entry ? 'Entry' : 'Edit'}
        </button>
        <span className="ps-crumb">{partName ? `${partName} · ` : ''}bar {index + 1} of {bars}</span>
      </div>
      <div className="ps-canvas-view">
        <label className="ps-btn ps-layout-select" title="Layout">
          <span className="ps-layout-select-k">Layout</span>
          <select
            className="ps-layout-select-input"
            aria-label="Layout"
            value={activeLayoutId}
            onChange={(e) => {
              store.dispatch(setActiveLayout, { layoutId: e.target.value });
              refocus();
            }}
          >
            {layouts.map((l) => <option key={l.id} value={l.id}>{layoutLabel(l)}</option>)}
          </select>
          <Icon name="chevron" size={13} />
        </label>
        <div className="ps-seg ps-view-toggle" role="group" aria-label="View">
          {(['vertical', 'endless'] as const).map((m) => (
            <button key={m} type="button" className={`ps-seg-item ${mode === m ? 'is-on' : ''}`.trim()} aria-pressed={mode === m} onClick={() => { onMode(m); refocus(); }}>
              {m === 'vertical' ? 'Page' : 'Endless'}
            </button>
          ))}
        </div>
        <span className="ps-zoom ps-zoom-readout" aria-hidden="true">100%</span>
        {/* Shown only on medium containers, where the inspector is a drawer over the canvas. */}
        <button type="button" className={`ps-btn ps-btn-ghost ps-btn-sm ps-inspector-toggle ${inspectorOpen ? 'is-on' : ''}`.trim()} aria-expanded={inspectorOpen} aria-controls="ps-inspector" onClick={onInspector}>Inspector</button>
      </div>
    </div>
  );
});
