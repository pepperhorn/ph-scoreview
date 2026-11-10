import type { ReactNode } from 'react';
import { BAR_HEADER_ID } from '../lib/bar-items';
import type { HeaderControlId } from '../lib/header-controls';
import type { BarItemId } from '../lib/skin';

export default function DrawerControls({ items, elements }: {
  items: BarItemId[]; elements: Partial<Record<HeaderControlId, ReactNode>>;
}) {
  const visible = items.filter(id => elements[BAR_HEADER_ID[id]] != null);
  if (!visible.length) return null;
  return <section className="drawer-panel playback-view-panel" aria-label="Playback and view">
    <h3>Playback and view</h3>
    <div className="drawer-extra-controls">{visible.map(id => <div key={id} className={`drawer-extra drawer-extra-${id}`} data-drawer-control={id}>{elements[BAR_HEADER_ID[id]]}</div>)}</div>
  </section>;
}
