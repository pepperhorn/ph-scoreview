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

/** The phone header's overflow menu: Save, Export, Open and New, and the licence state. Closes on a choice, Escape or a tap outside. */
export function PhoneMenu({ licence, onSave, onExport, onOpen, onNew, onClose }: PhoneMenuProps & { onClose(): void }) {
  const { editable, refocus } = useUi();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.('[data-ps-menu-toggle]')) return; // the toggle closes it itself
      if (root.current && !root.current.contains(target)) onClose();
    };
    window.document.addEventListener('pointerdown', outside, true);
    return () => window.document.removeEventListener('pointerdown', outside, true);
  }, [onClose]);
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
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onClose();
        refocus();
      }}
    >
      <button type="button" role="menuitem" className="ps-btn ps-pmenu-item ps-btn-save" disabled={!editable} onClick={choose(onSave)}><Icon name="save" size={16} />Save</button>
      <button type="button" role="menuitem" className="ps-btn ps-pmenu-item ps-btn-export" onClick={choose(onExport)}><Icon name="export" size={16} />Export MusicXML</button>
      <label role="menuitem" className={`ps-btn ps-pmenu-item ps-btn-open ${editable ? '' : 'ps-btn-disabled'}`.trim()}>
        <Icon name="open" size={16} />Open…
        <input className="ps-open-input" type="file" accept={OPEN_ACCEPT} hidden disabled={!editable} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; onClose(); if (file) onOpen(file); }} />
      </label>
      <button type="button" role="menuitem" className="ps-btn ps-pmenu-item ps-btn-new" disabled={!editable} onClick={choose(onNew)}><Icon name="plus" size={16} />New score</button>
      <span className={`ps-licence ps-pmenu-licence ${licence.editable ? '' : 'is-viewer'}`.trim()}>
        <span className="ps-licence-dot" />
        {licence.editable ? `Editor · ${licence.maxStaves} staves` : licence.checking ? 'Checking licence…' : 'Viewer · read-only'}
      </span>
    </div>
  );
}
