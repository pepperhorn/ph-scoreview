import { setActiveLayout } from '../engine/commands/index';
import { tip, usePosition, useRun, useUi } from './controls';
import { Icon } from './icons';
import { useEditorStore } from './useEditorStore';

export type ViewerMode = 'vertical' | 'endless';

/** Above the score: the Entry/Select badge (click toggles), the position, the layout selector, Page/Endless and zoom. */
export function CanvasHeader({ mode, onMode }: { mode: ViewerMode; onMode(mode: ViewerMode): void }) {
  const { store, editable, refocus } = useUi();
  const run = useRun();
  const { cursor, index, bars, partName } = usePosition();
  const layouts = useEditorStore(store, (s) => s.document.layouts);
  const activeLayoutId = useEditorStore(store, (s) => s.activeLayoutId);
  const entry = cursor.mode === 'enter';
  return (
    <div className="ps-canvas-head">
      <div className="ps-canvas-crumbs">
        <button
          type="button"
          className={`ps-btn ps-mode-pill ${entry ? 'is-entry' : 'is-select'}`}
          aria-label="Toggle note entry"
          aria-pressed={entry}
          title={tip(entry ? 'Note entry: click for select mode' : 'Select mode: click for note entry', 'Toggle note entry')}
          disabled={!editable}
          onClick={() => run('Toggle note entry')}
        >
          <span className="ps-mode-dot" />{entry ? 'Entry' : 'Select'}
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
            {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
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
        <span className="ps-zoom" title="Zoom">100%</span>
      </div>
    </div>
  );
}
