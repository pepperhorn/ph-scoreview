import { useState } from 'react';
import { usePosition, useUi } from './controls';
import { ScoreTab } from './ScoreTab';
import { StaveTab } from './StaveTab';
import { useEditorStore } from './useEditorStore';

type Tab = 'score' | 'stave' | 'layout';
const LABEL: Record<Tab, string> = { score: 'Score', stave: 'Stave', layout: 'Layout' };

/** The right-hand inspector: Score (score-wide settings at the cursor bar), Stave (marks at the cursor) and Layout. */
export function Inspector() {
  const { store } = useUi();
  const [tab, setTab] = useState<Tab>('score');
  const { index, beat, partName } = usePosition();
  const layoutName = useEditorStore(store, (s) => s.document.layouts.find((l) => l.id === s.activeLayoutId)?.name ?? '');
  const context = { score: `Bar ${index + 1} · whole score`, stave: `${partName} · bar ${index + 1}, beat ${beat}`, layout: `Layout · ${layoutName}` }[tab];
  return (
    <aside className="ps-inspector" aria-label="Inspector">
      <div className="ps-tabs" role="tablist">
        {(['score', 'stave', 'layout'] as const).map((t) => (
          <button key={t} type="button" role="tab" id={`ps-tab-${t}`} data-tab={t} aria-selected={tab === t} className={`ps-tab ${tab === t ? 'is-on' : ''}`.trim()} onClick={() => setTab(t)}>{LABEL[t]}</button>
        ))}
      </div>
      <div className="ps-insp-context"><span className="ps-eyebrow">{context}</span></div>
      <div className="ps-insp-body" role="tabpanel" aria-labelledby={`ps-tab-${tab}`}>
        {tab === 'score' ? <ScoreTab /> : tab === 'stave' ? <StaveTab /> : <p className="ps-insp-note ps-layout-placeholder">Layout controls arrive in Task 6 · {layoutName}</p>}
      </div>
    </aside>
  );
}
