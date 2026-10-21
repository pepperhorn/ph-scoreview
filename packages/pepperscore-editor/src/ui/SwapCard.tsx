import { makeCopy, setSelection, setSwap } from '../engine/commands/index';
import { instrumentName, LEVELS, type InstrumentId } from '../model/instruments';
import { locateEvent } from '../model/query';
import type { Part, Swap } from '../model/schema';
import { Row, Seg, useDispatch, useUi } from './controls';
import { INTERVALS, intervalValue, levelName, movedIn, movedWord, swapExportNote, swapTargetsFor } from './layout-model';
import { useEditorStore } from './useEditorStore';

const NEW_SWAP: Omit<Swap, 'instrument'> = { level: 'intermediate', autoRange: true, rangeOverrides: {} };

/** The active layout's part `partId` (else its first), with its swap; undefined when the layout shows no part. */
export function useSwapTarget(partId: string | undefined): { layoutId: string; part: Part; swap: Swap | undefined; parts: Part[] } | undefined {
  const { store } = useUi();
  const document = useEditorStore(store, (s) => s.document);
  const layoutId = useEditorStore(store, (s) => s.activeLayoutId);
  const layout = document.layouts.find((l) => l.id === layoutId);
  const parts = (layout?.parts ?? []).map((lp) => document.parts.find((p) => p.id === lp.partId)).filter((p): p is Part => !!p);
  const part = parts.find((p) => p.id === partId) ?? parts[0];
  if (!layout || !part) return undefined;
  return { layoutId, part, swap: layout.parts.find((lp) => lp.partId === part.id)?.swap, parts };
}

/** "Tenor Sax → Alto Sax · Beginner · Fit on" (or "Tenor Sax · not swapped"), for the phone's swap chip. */
export const swapSummary = (part: Part, swap: Swap | undefined): string =>
  swap ? `${part.name} → ${instrumentName(swap.instrument)} · ${levelName(swap.level)} · Fit ${swap.autoRange ? 'on' : 'off'}` : `${part.name} · not swapped`;

/**
 * Instrument swap for one part of the active layout: the part, the instrument it is shown as, the level, range
 * fitting, an extra transposition, the link notice with "Make a copy (own stave)", and the moved-notes legend
 * (Review selects the moved events, Undo moves turns fitting off). `onPart` follows a part change (a copy too).
 */
export function SwapCard({ partId, onPart, compact = false }: { partId: string | undefined; onPart(partId: string): void; compact?: boolean }) {
  const { store, editable, scrollToMeasure } = useUi();
  const dispatch = useDispatch();
  const target = useSwapTarget(partId);
  const view = useEditorStore(store, (s) => s.view);
  const document = useEditorStore(store, (s) => s.document);
  if (!target) return <p className="ps-insp-note ps-swap-empty">This layout shows no parts.</p>;
  const { layoutId, part, swap, parts } = target;
  const set = (next: Swap | null) => dispatch(setSwap, { layoutId, partId: part.id, swap: next });
  const update = (patch: Partial<Swap>) => swap && set({ ...swap, ...patch });
  const chooseInterval = (value: string) => {
    if (!swap) return;
    const { interval: _old, ...rest } = swap;
    const interval = INTERVALS.find((i) => i.value === value)?.interval;
    set(interval ? { ...rest, interval } : rest);
  };
  const moved = movedIn(view, part);
  const review = () => {
    dispatch(setSelection, { ids: moved.ids }, { record: false });
    const at = locateEvent(document, moved.ids[0]);
    if (at) scrollToMeasure?.(at.measureIndex);
  };
  const copy = () => {
    const before = store.getState().document.parts.length;
    dispatch(makeCopy, { layoutId, partId: part.id });
    const after = store.getState().document.parts;
    if (after.length > before) onPart(after[after.length - 1].id);
  };
  const off = !editable || !swap;
  const exportNote = swapExportNote(document, layoutId, part, swap);
  const interval = intervalValue(swap?.interval);

  return (
    <div className={`ps-swap ${compact ? 'is-compact' : ''}`.trim()}>
      <div className="ps-swap-card">
        {parts.length > 1 && (
          <Row label="Part">
            <select className="ps-select ps-swap-part" aria-label="Part to swap" value={part.id} disabled={!editable} onChange={(e) => onPart(e.target.value)}>
              {parts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Row>
        )}
        <div className="ps-swap-head">
          <span className="ps-override-source">{part.name}</span><span className="ps-override-arrow">→</span><span className="ps-swap-shown">shown as</span>
          <select className="ps-select ps-swap-instrument" aria-label="Show as instrument" value={swap?.instrument ?? ''} disabled={!editable}
            onChange={(e) => { const id = e.target.value as InstrumentId | ''; if (!id) set(null); else if (swap) update({ instrument: id, rangeOverrides: {} }); else set({ instrument: id, ...NEW_SWAP }); }}>
            <option value="">{part.name} (no swap)</option>
            {swapTargetsFor(part, swap?.instrument).map((id) => <option key={id} value={id}>{instrumentName(id)}</option>)}
          </select>
        </div>
        <Seg className="ps-swap-level" label="Level" value={swap?.level} items={LEVELS.map((l) => ({ value: l, label: levelName(l) }))} onSelect={(level) => update({ level })} />
        <button type="button" role="switch" aria-checked={!!swap?.autoRange} className="ps-swap-toggle" disabled={off} onClick={() => update({ autoRange: !swap?.autoRange })}>
          <span className={`ps-toggle ${swap?.autoRange ? 'is-on' : ''}`.trim()} />Fit to range automatically
        </button>
        <Row label="Extra">
          <select className="ps-select ps-swap-interval" aria-label="Extra transposition" value={interval} disabled={off} onChange={(e) => chooseInterval(e.target.value)}>
            {interval === 'custom' && <option value="custom">{`${swap?.interval?.semitones} semitones`}</option>}
            {INTERVALS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
          </select>
        </Row>
        {swap && (
          <div className="ps-swap-link">
            <span className="ps-swap-link-text"><span className="ps-link-dot" />Linked to {part.name} · changes affect both</span>
            <div className="ps-swap-link-actions">
              <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm ps-swap-copy" disabled={!editable} onClick={copy}>Make a copy (own stave)</button>
              <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm ps-swap-remove" disabled={!editable} onClick={() => set(null)}>Remove swap</button>
            </div>
            {exportNote && <p className="ps-insp-note ps-swap-export-note">{exportNote}</p>}
          </div>
        )}
      </div>
      {moved.ids.length > 0 && (
        <div className="ps-moved-legend">
          <span className="ps-moved-swatch" aria-hidden="true"><span className="ps-moved-head" /></span>
          <span className="ps-moved-text">
            Moved {movedWord(moved.direction)}{moved.direction ? ' to fit range' : ''} · {moved.notes} note{moved.notes === 1 ? '' : 's'}
            {view.diagnostics.length > 0 && <span className="ps-moved-diagnostics" title={view.diagnostics.join('\n')}> · {view.diagnostics.length} range note{view.diagnostics.length === 1 ? '' : 's'}</span>}
          </span>
          <div className="ps-moved-actions">
            <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm ps-moved-review" onClick={review}>Review</button>
            <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm ps-moved-undo" disabled={!editable || !swap?.autoRange} onClick={() => update({ autoRange: false })}>Undo moves</button>
          </div>
        </div>
      )}
    </div>
  );
}
