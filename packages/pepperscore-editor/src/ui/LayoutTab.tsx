import { useState } from 'react';
import { createCustomLayout, createPartLayouts, setActiveLayout, setLayoutParts, setLayoutTransposing } from '../engine/commands/index';
import type { Layout } from '../model/schema';
import { Section, Seg, useDispatch, useUi } from './controls';
import { Icon } from './icons';
import { defaultSwapPart, planStaveToggle, staveRows, type StaveRow } from './layout-model';
import { SwapCard } from './SwapCard';
import { useEditorStore } from './useEditorStore';

/** A checkbox mark (the stave list and the phone's stave chips). */
export const Check = ({ on }: { on: boolean }) => <span className={`ps-check ${on ? 'is-on' : ''}`.trim()} aria-hidden="true">{on && <Icon name="check" size={11} />}</span>;

/** "Alto Sax (part)": a layout's name with its kind, the full score bare. */
export const layoutLabel = (layout: Layout): string => (layout.kind === 'score' ? layout.name : `${layout.name} (${layout.kind})`);

/**
 * The active layout and its stave rows, with a toggle that never hides the last shown staff (a layout must show
 * something) and never edits the full score (see `planStaveToggle`).
 */
export function useLayoutStaves() {
  const { store } = useUi();
  const dispatch = useDispatch();
  const document = useEditorStore(store, (s) => s.document);
  const layoutId = useEditorStore(store, (s) => s.activeLayoutId);
  const layout = document.layouts.find((l) => l.id === layoutId);
  const rows = staveRows(document, layout);
  const shown = rows.filter((r) => r.on).length;
  const canToggle = (row: StaveRow) => !row.on || shown > 1;
  const toggle = (row: StaveRow) => {
    const plan = canToggle(row) ? planStaveToggle(document, layoutId, row.partId, row.staff) : undefined;
    if (plan?.kind === 'set') dispatch(setLayoutParts, { layoutId: plan.layoutId, parts: plan.parts });
    else if (plan) dispatch(createCustomLayout, { name: plan.name, parts: plan.parts });
  };
  /** The full score is never edited: a toggle there makes a custom layout. */
  const isFullScore = layout !== undefined && layout === document.layouts[0];
  return { document, layoutId, layout, rows, canToggle, toggle, isFullScore };
}

/** The swap card's part: the user's choice while the layout shows it, else the first non-piano part. */
export function useSwapPart(): [string | undefined, (partId: string) => void] {
  const { store } = useUi();
  const [chosen, setChosen] = useState<string>();
  const fallback = useEditorStore(store, (s) => defaultSwapPart(s.document, s.document.layouts.find((l) => l.id === s.activeLayoutId)));
  const shown = useEditorStore(store, (s) => !!chosen && !!s.document.layouts.find((l) => l.id === s.activeLayoutId)?.parts.some((lp) => lp.partId === chosen));
  return [shown ? chosen : fallback, setChosen];
}

/**
 * The inspector's Layout tab: the staves the active layout shows (and as what), transposing or concert pitch, the
 * layouts (switch, make part layouts, save the current staves as a custom layout) and the instrument swap card.
 */
export function LayoutTab() {
  const { editable } = useUi();
  const dispatch = useDispatch();
  const { document, layoutId, layout, rows, canToggle, toggle, isFullScore } = useLayoutStaves();
  const [swapPart, setSwapPart] = useSwapPart();
  const [name, setName] = useState('');
  const save = () => {
    if (!layout || !name.trim()) return;
    dispatch(createCustomLayout, { name: name.trim(), parts: layout.parts });
    setName('');
  };
  return (
    <>
      <Section title="Staves in layout" className="ps-insp-staves">
        <ul className="ps-stave-list">
          {rows.map((row) => (
            <li key={`${row.partId}/${row.staff}`} className={`ps-stave-item ${row.on ? 'is-on' : ''}`.trim()} data-part={row.partId} data-staff={row.staff}>
              <button type="button" role="checkbox" aria-checked={row.on} className="ps-stave-label" disabled={!editable || !canToggle(row)} onClick={() => toggle(row)}>
                <Check on={row.on} /><span className="ps-stave-name">{row.name}</span>
              </button>
              <span className="ps-stave-meta">{row.meta}</span>
            </li>
          ))}
        </ul>
        {isFullScore && <p className="ps-insp-note ps-stave-hint">Hiding a stave makes a custom layout.</p>}
        <div className="ps-pitch-mode">
          <Seg label="Pitch display" value={layout?.transposing === false ? 'concert' : 'transposing'}
            items={[{ value: 'transposing', label: 'Transposing' }, { value: 'concert', label: 'Concert pitch' }]}
            onSelect={(v) => dispatch(setLayoutTransposing, { layoutId, transposing: v === 'transposing' })} />
        </div>
      </Section>
      <Section title="Layouts" className="ps-insp-layouts">
        <div className="ps-profile-chips" role="group" aria-label="Layouts">
          {document.layouts.map((l) => (
            <button key={l.id} type="button" className={`ps-btn ps-profile-chip ${l.id === layoutId ? 'is-on' : ''}`.trim()} aria-pressed={l.id === layoutId} onClick={() => dispatch(setActiveLayout, { layoutId: l.id })}>
              {l.name}{l.kind !== 'score' && <span className="ps-profile-kind"> ({l.kind})</span>}
            </button>
          ))}
          <button type="button" className="ps-btn ps-profile-chip ps-profile-parts" title="One part layout per part" disabled={!editable} onClick={() => dispatch(createPartLayouts, {})}>+ Parts</button>
        </div>
        <form className="ps-save-view" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <input className="ps-input ps-save-view-input" placeholder="Name…" aria-label="Custom layout name" value={name} disabled={!editable} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="ps-btn ps-btn-primary ps-btn-sm ps-save-layout" disabled={!editable || !name.trim()}>Save as custom layout</button>
        </form>
      </Section>
      <Section title="Instrument swap" className="ps-insp-swap">
        <SwapCard partId={swapPart} onPart={setSwapPart} />
      </Section>
    </>
  );
}
