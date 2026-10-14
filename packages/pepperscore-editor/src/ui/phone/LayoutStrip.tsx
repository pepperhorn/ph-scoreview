import { useState } from 'react';
import { setActiveLayout, setLayoutTransposing } from '../../engine/commands/index';
import { useDispatch, useUi } from '../controls';
import { Icon } from '../icons';
import { Check, layoutLabel, useLayoutStaves, useSwapPart } from '../LayoutTab';
import { SwapCard, swapSummary, useSwapTarget } from '../SwapCard';
import { PBtn } from './PhoneTabs';

/**
 * The phone toolbar's Layout tab: row 1 toggles the active layout's staves; row 2 holds the instrument swap
 * chip ("Tenor Sax → Alto Sax · Beginner · Fit on"), which opens the swap card as an inline strip in place of
 * both rows, the layout selector and the concert pitch toggle.
 */
export function LayoutStrip() {
  const { editable } = useUi();
  const dispatch = useDispatch();
  const { document, layoutId, layout, rows, canToggle, toggle } = useLayoutStaves();
  const [swapPart, setSwapPart] = useSwapPart();
  const target = useSwapTarget(swapPart);
  const [open, setOpen] = useState(false);
  const concert = layout?.transposing === false;

  if (open) {
    return (
      <div
        className="ps-prow ps-pstrip ps-pstrip-swap"
        role="dialog"
        aria-label="Instrument swap"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }}
      >
        <span className="ps-pstrip-label">Swap</span>
        <div className="ps-pstrip-fields"><SwapCard partId={swapPart} onPart={setSwapPart} compact /></div>
        <button type="button" className="ps-btn ps-pstrip-close" aria-label="Close" onClick={() => setOpen(false)}><Icon name="close" size={15} /></button>
      </div>
    );
  }
  return (
    <>
      <div className="ps-prow ps-prow-staves" role="group" aria-label="Staves in layout">
        {rows.map((row) => (
          <PBtn key={`${row.partId}/${row.staff}`} label={row.name} text on={row.on} disabled={!canToggle(row)} className="ps-pchip-stave" onClick={() => toggle(row)}>
            <Check on={row.on} />{row.name}
          </PBtn>
        ))}
      </div>
      <div className="ps-prow ps-prow-swap" role="group" aria-label="Instrument swap and layout">
        {target && (
          <PBtn label="Instrument swap: open" text on={!!target.swap} className="ps-pchip-swap" onClick={() => setOpen(true)}>
            {target.swap && <span className="ps-moved-dot" />}{swapSummary(target.part, target.swap)}
          </PBtn>
        )}
        <select className="ps-select ps-pselect ps-pselect-layout" aria-label="Layout" value={layoutId} onChange={(e) => dispatch(setActiveLayout, { layoutId: e.target.value })}>
          {document.layouts.map((l) => <option key={l.id} value={l.id}>{layoutLabel(l)}</option>)}
        </select>
        <PBtn label="Concert pitch" text on={concert} disabled={!editable} onClick={() => dispatch(setLayoutTransposing, { layoutId, transposing: concert })}>Concert</PBtn>
      </div>
    </>
  );
}
