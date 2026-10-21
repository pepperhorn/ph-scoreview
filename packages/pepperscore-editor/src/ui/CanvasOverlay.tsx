import { useCallback, type RefObject } from 'react';
import { AddBarButtons } from './AddBarButtons';
import { useUi } from './controls';
import type { PopoverName } from './keymap';
import { Popover } from './Popover';
import { useCanvasGeometry, type DrawSignal } from './useCanvasGeometry';

/**
 * The layer over the canvas stage: the open popover and the add-bar buttons. It owns the stage geometry, so a
 * re-measure re-renders only this layer.
 */
export function CanvasOverlay({ stage, popover, closePopover, draws }: { stage: RefObject<HTMLElement | null>; popover: PopoverName | null; closePopover(): void; draws: DrawSignal }) {
  const { store, editable } = useUi();
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe((state, previous) => {
      if (state.cursor !== previous.cursor || state.selection !== previous.selection) listener();
    }),
    [store],
  );
  const open = editable ? popover : null;
  const geometry = useCanvasGeometry(stage, { cursor: !!open, last: editable, draws, subscribe });
  return (
    <div className="ps-popover-layer">
      {open && <Popover name={open} store={store} onClose={closePopover} anchor={geometry.cursor} viewport={geometry.viewport} stage={stage.current} />}
      <AddBarButtons geometry={geometry} />
    </div>
  );
}
