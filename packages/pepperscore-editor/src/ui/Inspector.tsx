import { memo, useState } from 'react';
import { useCursorBar, useCursorBeat, useCursorPartName, useUi } from './controls';
import { LayoutTab } from './LayoutTab';
import { ScoreTab } from './ScoreTab';
import { StaveTab } from './StaveTab';
import { useEditorStore } from './useEditorStore';

type Tab = 'score' | 'stave' | 'layout';
const LABEL: Record<Tab, string> = { score: 'Score', stave: 'Stave', layout: 'Layout' };

/** The right-hand inspector (on medium containers a drawer, `open` or not): Score (score-wide settings at the cursor bar), Stave (marks at the cursor) and Layout. */
export const Inspector = memo(function Inspector({ open = false }: { open?: boolean }) {
  const { store } = useUi();
  const [tab, setTab] = useState<Tab>('score');
  const { index } = useCursorBar();
  const beat = useCursorBeat();
  const partName = useCursorPartName();
  const layoutName = useEditorStore(store, (s) => s.document.layouts.find((l) => l.id === s.activeLayoutId)?.name ?? '');
  const context = { score: `Bar ${index + 1} · whole score`, stave: `${partName} · bar ${index + 1}, beat ${beat}`, layout: `Layout · ${layoutName}` }[tab];
  return (
    <aside id="ps-inspector" className={`ps-inspector ${open ? 'is-open' : ''}`.trim()} aria-label="Inspector">
      <div className="ps-tabs" role="tablist">
        {(['score', 'stave', 'layout'] as const).map((t) => (
          <button key={t} type="button" role="tab" id={`ps-tab-${t}`} data-tab={t} aria-selected={tab === t} className={`ps-tab ${tab === t ? 'is-on' : ''}`.trim()} onClick={() => setTab(t)}>{LABEL[t]}</button>
        ))}
      </div>
      <div className="ps-insp-context"><span className="ps-eyebrow">{context}</span></div>
      <div className="ps-insp-body" role="tabpanel" aria-labelledby={`ps-tab-${tab}`}>
        {tab === 'score' ? <ScoreTab /> : tab === 'stave' ? <StaveTab /> : <LayoutTab />}
      </div>
    </aside>
  );
});
