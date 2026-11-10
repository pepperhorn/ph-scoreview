import { memo, useRef, useState, type ReactNode } from 'react';
import { setMeta } from '../engine/commands/index';
import { effectiveKey, effectiveTime } from '../model/query';
import { tip, useCursorBar, useUi } from './controls';
import { OPEN_ACCEPT } from './files';
import { Glyph, Icon, SMUFL } from './icons';
import type { PopoverName } from './keymap';
import { keyName } from './Popover';
import { tempoAt } from './TempoFields';
import { useEditorStore } from './useEditorStore';

export type TopBarProps = {
  playing: boolean;
  /** `Editor · N staves`, or the read-only / checking state. */
  licence: { editable: boolean; checking: boolean; maxStaves: number };
  onPlay(): void;
  onSave(): void;
  onExport(): void;
  onOpen(file: File): void;
};

/** Title or composer: double-click to edit, Enter or blur commits (a blank value clears), Escape cancels. */
function MetaText({ field, placeholder, className }: { field: 'title' | 'composer'; placeholder: string; className: string }) {
  const { store, editable, refocus } = useUi();
  const value = useEditorStore(store, (s) => s.document.meta[field]);
  const [draft, setDraft] = useState<string | null>(null);
  // Escape cancels: refocusing the editor blurs the input, and that blur must not commit the draft.
  const cancelled = useRef(false);
  const Tag = field === 'title' ? 'h1' : 'p';
  if (draft !== null) {
    const commit = () => {
      if (cancelled.current) return;
      cancelled.current = true; // the blur that refocusing causes must not commit twice
      store.dispatch(setMeta, { [field]: draft });
      setDraft(null);
      refocus();
    };
    return (
      <input
        className={`ps-input ps-meta-input ps-meta-input-${field} ${className}`}
        aria-label={field === 'title' ? 'Score title' : 'Composer'}
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            cancelled.current = true;
            setDraft(null);
            refocus();
          }
        }}
      />
    );
  }
  return (
    <Tag className={`${className} ${value ? '' : 'is-empty'}`.trim()} title={editable ? 'Double-click to edit' : undefined} onDoubleClick={editable ? () => { cancelled.current = false; setDraft(value ?? ''); } : undefined}>
      {value || placeholder}
    </Tag>
  );
}

/** Brand, title and composer, the key/time/tempo chips, history, Play, file actions and the licence badge. */
export const TopBar = memo(function TopBar({ playing, licence, onPlay, onSave, onExport, onOpen }: TopBarProps) {
  const { store, editable, togglePopover, refocus } = useUi();
  // The cursor's bar only (its key, time and tempo): a move within the bar does not re-render the top bar.
  const { index } = useCursorBar();
  const document = useEditorStore(store, (s) => s.document);
  const canUndo = useEditorStore(store, (s) => s.history.past.length > 0);
  const canRedo = useEditorStore(store, (s) => s.history.future.length > 0);
  const key = effectiveKey(document, index);
  const time = effectiveTime(document, index);
  const tempo = tempoAt(document, index);
  const chip = (name: PopoverName, label: string, k: string, value: ReactNode) => (
    <button type="button" className={`ps-btn ps-chip ps-chip-${name}`} aria-label={label} title={tip(label)} data-ps-popover-for={name} disabled={!editable} onClick={() => togglePopover(name)}>
      <span className="ps-chip-k">{k}</span>{value}
    </button>
  );
  const history = (label: 'Undo' | 'Redo', enabled: boolean, run: () => void) => (
    <button type="button" className={`ps-btn ps-icon-btn ps-${label.toLowerCase()}`} aria-label={label} title={tip(label)} disabled={!editable || !enabled} onClick={() => { run(); refocus(); }}>
      <Icon name={label === 'Undo' ? 'undo' : 'redo'} size={17} />
    </button>
  );
  return (
    <header className="ps-topbar">
      <div className="ps-brand"><span className="ps-brand-mark"><Glyph c={SMUFL.gClef} alt="𝄞" /></span><span className="ps-brand-name">pepperscore</span></div>
      <div className="ps-title-block">
        <MetaText field="title" placeholder="Untitled score" className="ps-score-title" />
        <MetaText field="composer" placeholder="Composer" className="ps-score-composer" />
      </div>
      <button type="button" className="ps-btn ps-btn-ghost ps-btn-details" aria-label="Score details" data-ps-popover-for="details" disabled={!editable} onClick={() => togglePopover('details')}>Details</button>
      <button type="button" className="ps-btn ps-btn-ghost ps-btn-parts" aria-label="Parts" data-ps-popover-for="parts" disabled={!editable} onClick={() => togglePopover('parts')}>Parts</button>
      <div className="ps-chips" aria-label="Score settings">
        {chip('key', 'Key signature', 'Key', keyName(key.fifths, key.mode ?? 'major'))}
        {chip('time', 'Time signature', 'Time', `${time.count}/${time.unit}`)}
        {chip('tempo', 'Tempo', 'Tempo', tempo ? <><Glyph c={SMUFL.quarter} alt="♩" className="ps-glyph-mm" />= {tempo.bpm}</> : 'None')}
      </div>
      <div className="ps-actions">
        <div className="ps-history">
          {history('Undo', canUndo, () => store.undo())}
          {history('Redo', canRedo, () => store.redo())}
        </div>
        <button type="button" className={`ps-btn ps-btn-play ${playing ? 'is-playing' : ''}`.trim()} aria-label={playing ? 'Stop' : 'Play'} title={tip(playing ? 'Stop' : 'Play from the cursor', 'Play')} onClick={onPlay}>
          <Icon name={playing ? 'stop' : 'play'} size={14} /><span className="ps-btn-text">{playing ? 'Stop' : 'Play'}</span>
        </button>
        <div className="ps-file">
          <button type="button" className="ps-btn ps-btn-ghost ps-btn-save" title="Download .pepperscore" disabled={!editable} onClick={onSave}><Icon name="save" size={15} /><span className="ps-btn-text">Save</span></button>
          <button type="button" className="ps-btn ps-btn-ghost ps-btn-export" title="Download MusicXML" onClick={onExport}><Icon name="export" size={15} /><span className="ps-btn-text">Export</span></button>
          <label className={`ps-btn ps-btn-ghost ps-btn-open ${editable ? '' : 'ps-btn-disabled'}`.trim()} title="Open .pepperscore or MusicXML">
            <Icon name="open" size={15} /><span className="ps-btn-text">Open</span>
            <input className="ps-open-input" type="file" accept={OPEN_ACCEPT} hidden disabled={!editable} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onOpen(file); }} />
          </label>
        </div>
        <span className={`ps-licence ${licence.editable ? '' : 'is-viewer'}`.trim()}>
          <span className="ps-licence-dot" />
          {licence.editable ? `Editor · ${licence.maxStaves} staves` : licence.checking ? 'Checking licence…' : 'Viewer · read-only'}
        </span>
      </div>
    </header>
  );
});
