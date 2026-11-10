import { useEffect, useRef } from 'react';
import { useUi } from '../controls';
import { OPEN_ACCEPT } from '../files';
import { Icon } from '../icons';

export type PhoneMenuProps = {
  licence: { editable: boolean; checking: boolean; maxStaves: number };
  onSave(): void;
  onExport(): void;
  onOpen(file: File): void;
  onNew(): void;
};

/** The phone header's overflow menu: Save, Export, Open and New, and the licence state. Focuses its first item; closes on a choice, Escape or a tap outside. */
export function PhoneMenu({ licence, onSave, onExport, onOpen, onNew, onClose }: PhoneMenuProps & { onClose(): void }) {
  const { editable, refocus, togglePopover } = useUi();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.('[data-ps-menu-toggle]')) return; // the toggle closes it itself
      if (root.current && !root.current.contains(target)) onClose();
    };
    // Escape is taken on the window in the capture phase, ahead of the editor root's key handling (which would
    // otherwise read it as "select mode"), whether or not focus is in the menu.
    const escape = (event: KeyboardEvent) => {
      if ((event.target as Element)?.closest?.('[data-ps-plugin]')) return;
      if (event.key !== 'Escape' || !root.current?.closest('.ps-editor')?.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      refocus();
    };
    window.document.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', escape, true);
    return () => {
      window.document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', escape, true);
    };
  }, [onClose, refocus]);
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, []);
  const choose = (action: () => void) => () => {
    onClose();
    action();
    refocus();
  };
  return (
    <div
      ref={root}
      className="ps-pmenu"
      role="menu"
      aria-label="File"
    >
      <button type="button" role="menuitem" className="ps-btn ps-pmenu-item ps-btn-save" disabled={!editable} onClick={choose(onSave)}><Icon name="save" size={16} />Save</button>
      <button type="button" role="menuitem" className="ps-btn ps-pmenu-item ps-btn-export" onClick={choose(onExport)}><Icon name="export" size={16} />Export MusicXML</button>
      <label role="menuitem" className={`ps-btn ps-pmenu-item ps-btn-open ${editable ? '' : 'ps-btn-disabled'}`.trim()}>
        <Icon name="open" size={16} />Open…
        <input className="ps-open-input" type="file" accept={OPEN_ACCEPT} hidden disabled={!editable} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; onClose(); if (file) onOpen(file); }} />
      </label>
      <button type="button" role="menuitem" className="ps-btn ps-pmenu-item ps-btn-details" data-ps-target="details" data-ps-popover-for="details" disabled={!editable} onClick={choose(() => togglePopover('details'))}>Score details</button>
      <button type="button" role="menuitem" className="ps-btn ps-pmenu-item ps-btn-parts" data-ps-target="parts" data-ps-popover-for="parts" disabled={!editable} onClick={choose(() => togglePopover('parts'))}>Parts</button>
      <button type="button" role="menuitem" className="ps-btn ps-pmenu-item ps-btn-new" disabled={!editable} onClick={choose(onNew)}><Icon name="plus" size={16} />New score</button>
      <span className={`ps-licence ps-pmenu-licence ${licence.editable ? '' : 'is-viewer'}`.trim()}>
        <span className="ps-licence-dot" />
        {licence.editable ? `Editor · ${licence.maxStaves} staves` : licence.checking ? 'Checking licence…' : 'Viewer · read-only'}
      </span>
    </div>
  );
}
