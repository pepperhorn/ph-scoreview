import { memo, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { setActiveLayout } from '../../engine/commands/index';
import { effectiveKey, effectiveTime } from '../../model/query';
import { useCursorBar, useRun, useUi } from '../controls';
import { Glyph, Icon, SMUFL } from '../icons';
import type { PopoverName } from '../keymap';
import { layoutLabel } from '../LayoutTab';
import { keyName } from '../Popover';
import { tempoAt } from '../TempoFields';
import { useEditorStore } from '../useEditorStore';
import { PhoneMenu, type PhoneMenuProps } from './PhoneMenu';

/**
 * Collapses after `ms` without a `wake()` (the phone shell wakes it on every store dispatch, touch, wheel or
 * pointer down on the canvas, and header tap); `wake()` expands it again and restarts the timer. While `paused`
 * (the overflow menu is open) it stays expanded with no timer. The timer lives in a ref, so frequent wakes (a
 * swipe) cost no renders. The collapse makes the first row (`.ps-phead-main` in `root`) inert, which would drop
 * focus held there (Play, More) to the page and stop the editor's keys, so `refocus` returns it to the editor first.
 */
export function useAutoCollapse(ms = 4000, paused = false, root?: RefObject<HTMLElement | null>, refocus?: () => void): { collapsed: boolean; wake(): void } {
  const [collapsed, setCollapsed] = useState(false);
  const timer = useRef(0);
  const held = useRef(paused);
  held.current = paused;
  const focus = useRef({ root, refocus });
  focus.current = { root, refocus };
  const wake = useCallback(() => {
    setCollapsed(false);
    window.clearTimeout(timer.current);
    if (held.current) return;
    timer.current = window.setTimeout(() => {
      const { root, refocus } = focus.current;
      const active = root?.current?.ownerDocument.activeElement;
      if (active && root?.current?.querySelector('.ps-phead-main')?.contains(active)) refocus?.();
      setCollapsed(true);
    }, ms);
  }, [ms]);
  useEffect(() => {
    wake();
    return () => window.clearTimeout(timer.current);
  }, [wake, paused]);
  return { collapsed, wake };
}

export type PhoneHeaderProps = PhoneMenuProps & {
  collapsed: boolean;
  wake(): void;
  playing: boolean;
  onPlay(): void;
  menuOpen: boolean;
  setMenuOpen(open: boolean): void;
};

/**
 * The phone header, for occasional controls (the constant ones sit in the toolbar, within reach), two rows: brand,
 * title and composer, Undo and Redo, Play and the overflow menu; then the position, the layout chip and the key, time
 * and tempo chips (their popovers open as inline strips in the toolbar). Collapsed (`data-header="collapsed"` on the
 * shell) it is a 28px strip: position and key.
 */
export const PhoneHeader = memo(function PhoneHeader({ collapsed, wake, playing, onPlay, menuOpen, setMenuOpen, ...menu }: PhoneHeaderProps) {
  const { store, editable, togglePopover, refocus } = useUi();
  const run = useRun();
  const { index, bars } = useCursorBar();
  const document = useEditorStore(store, (s) => s.document);
  const layouts = useEditorStore(store, (s) => s.document.layouts);
  const activeLayoutId = useEditorStore(store, (s) => s.activeLayoutId);
  const canUndo = useEditorStore(store, (s) => s.history.past.length > 0);
  const canRedo = useEditorStore(store, (s) => s.history.future.length > 0);
  const key = effectiveKey(document, index);
  const time = effectiveTime(document, index);
  const tempo = tempoAt(document, index);
  // The closed menu returns focus to the editor, so keys work at once and the collapse never strands focus.
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    refocus();
  }, [setMenuOpen, refocus]);
  const chip = (name: PopoverName, label: string, k: string, value: ReactNode) => (
    <button type="button" className={`ps-btn ps-chip ps-pchip ps-chip-${name}`} aria-label={label} disabled={!editable} onClick={() => togglePopover(name)}>
      <span className="ps-chip-k">{k}</span>{value}
    </button>
  );
  return (
    <>
      <header className="ps-phead" aria-label="Score header" onPointerDown={wake}>
        <div className="ps-phead-main" inert={collapsed}>
          <span className="ps-brand-mark ps-phead-brand"><Glyph c={SMUFL.gClef} alt="𝄞" /></span>
          <div className="ps-phead-titles">
            <h1 className={`ps-score-title ps-phead-title ${document.meta.title ? '' : 'is-empty'}`.trim()}>{document.meta.title || 'Untitled score'}</h1>
            {document.meta.composer && <p className="ps-score-composer ps-phead-composer">{document.meta.composer}</p>}
          </div>
          <div className="ps-phead-history" role="group" aria-label="History">
            <button type="button" className="ps-btn ps-icon-btn ps-phead-undo" aria-label="Undo" title="Undo" disabled={!editable || !canUndo} onClick={() => run('Undo')}>
              <Icon name="undo" size={17} />
            </button>
            <button type="button" className="ps-btn ps-icon-btn ps-phead-redo" aria-label="Redo" title="Redo" disabled={!editable || !canRedo} onClick={() => run('Redo')}>
              <Icon name="redo" size={17} />
            </button>
          </div>
          <button type="button" className={`ps-btn ps-btn-play ps-phead-play ${playing ? 'is-playing' : ''}`.trim()} aria-label={playing ? 'Stop' : 'Play'} onClick={() => { onPlay(); refocus(); }}>
            <Icon name={playing ? 'stop' : 'play'} size={14} />
          </button>
          <button type="button" className="ps-btn ps-icon-btn ps-phead-more" aria-label="More" aria-haspopup="menu" aria-expanded={menuOpen} data-ps-menu-toggle="" onClick={() => { setMenuOpen(!menuOpen); if (menuOpen) refocus(); }}>
            <Icon name="more" size={18} />
          </button>
        </div>
        <div className="ps-phead-meta" aria-label="Score settings">
          <span className="ps-phead-crumb">bar {index + 1} of {bars}</span>
          <label className="ps-btn ps-chip ps-pchip ps-chip-layout" title="Layout">
            <select
              className="ps-layout-select-input"
              aria-label="Layout"
              value={activeLayoutId}
              onChange={(e) => {
                store.dispatch(setActiveLayout, { layoutId: e.target.value });
                refocus();
              }}
            >
              {layouts.map((l) => <option key={l.id} value={l.id}>{layoutLabel(l)}</option>)}
            </select>
            <Icon name="chevron" size={12} />
          </label>
          {chip('key', 'Key signature', 'Key', keyName(key.fifths, key.mode ?? 'major'))}
          {chip('time', 'Time signature', 'Time', `${time.count}/${time.unit}`)}
          {chip('tempo', 'Tempo', 'Tempo', tempo ? <><Glyph c={SMUFL.quarter} alt="♩" className="ps-glyph-mm" />= {tempo.bpm}</> : 'None')}
        </div>
      </header>
      {menuOpen && <PhoneMenu {...menu} onClose={closeMenu} />}
    </>
  );
});
