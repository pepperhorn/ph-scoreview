import type { EditorStore } from '../../engine/store';
import { Icon } from '../icons';
import type { PopoverName } from '../keymap';
import { POPOVER_TITLES, PopoverBody } from '../Popover';

/**
 * A popover on a phone: one row inside the toolbar (in place of its button rows) with the desktop popover's
 * fields. Escape (the editor root takes it), the ✕ (first, so it is on screen however wide the fields) or Apply closes it; the time fields bring their own Apply.
 */
export function InlineStrip({ name, store, onClose }: { name: PopoverName; store: EditorStore; onClose(): void }) {
  return (
    <div
      className={`ps-prow ps-pstrip ps-popover-${name}`}
      role="dialog"
      aria-label={POPOVER_TITLES[name]}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <button type="button" className="ps-btn ps-pstrip-close" aria-label="Close" onClick={onClose}><Icon name="close" size={15} /></button>
      <span className="ps-pstrip-label">{POPOVER_TITLES[name]}</span>
      <div className="ps-pstrip-fields"><PopoverBody name={name} store={store} onClose={onClose} /></div>
      {name !== 'time' && <button type="button" className="ps-btn ps-popover-apply ps-pstrip-apply" onClick={onClose}>Apply</button>}
    </div>
  );
}
