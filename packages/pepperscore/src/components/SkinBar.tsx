import { Ellipsis } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { BAR_HEADER_ID } from '../lib/bar-items';
import type { HeaderControlId } from '../lib/header-controls';
import type { BarItemId } from '../lib/skin';

/** Reuses the header's elements and More panel; container CSS selects the tier presentation. */
export default function SkinBar({ bar, elements, moreRef, moreOpen, setMoreOpen, panelId }: {
  bar: BarItemId[]; elements: Partial<Record<HeaderControlId, ReactNode>>;
  moreRef: RefObject<HTMLDivElement | null>; moreOpen: boolean; setMoreOpen: (open: boolean) => void; panelId: string;
}) {
  const items = bar.filter(id => elements[BAR_HEADER_ID[id]] != null);
  const render = (ids: BarItemId[]) => ids.map(id => <div key={id} className={`header-control header-control-${BAR_HEADER_ID[id]}`} data-header-control={BAR_HEADER_ID[id]} data-bar-item={id}>{elements[BAR_HEADER_ID[id]]}</div>);
  return <div className="transport skin-bar">
    {render(items.slice(0, 4))}
    {items.length > 4 && <div className="header-more" ref={moreRef} data-open={moreOpen ? 'true' : 'false'}>
      <button type="button" className={`icon-button header-more-toggle ${moreOpen ? 'is-open' : ''}`} aria-label="More controls" title="More controls" aria-expanded={moreOpen} aria-controls={panelId} onClick={() => setMoreOpen(!moreOpen)}><Ellipsis size={19}/></button>
      <div id={panelId} className="header-secondary-panel" role="group" aria-label="Secondary controls">{render(items.slice(4))}</div>
    </div>}
  </div>;
}
