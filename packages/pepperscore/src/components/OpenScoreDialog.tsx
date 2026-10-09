import { useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, FileMusic, FolderOpen, Upload, X } from 'lucide-react';
import { collectDroppedScoreFiles, FOLDER_MAX_ENTRIES, looksLikeAbc, type CollectedScoreFiles, type ScoreFileCandidate } from '../lib/score-files';
import './open-score-dialog.css';

export type OpenScoreDialogProps = {
  onClose(): void;
  /** Opens one file through the reader's normal import path. */
  onOpenFile(file: File): void;
  /** Opens pasted ABC text through the reader's normal ABC path. */
  onOpenAbc(text: string): void;
  /** Shows the reader's own file picker. */
  onBrowse(): void;
};

const FORMATS = [
  { name: 'MusicXML', detail: '.musicxml, .xml, compressed .mxl' },
  { name: 'MIDI', detail: '.mid, .midi' },
  { name: 'MEI', detail: '.mei' },
  { name: 'ABC notation', detail: '.abc, .txt, or paste' },
] as const;
const TIP = 'Paste ABC notation here, or drop a score file or a folder of scores.';
const NOT_ABC = 'This doesn’t look like ABC notation yet: a tune needs a K: (key) line, e.g. K:C.';
const hasFiles = (data: DataTransfer | null) => Boolean(data && Array.from(data.types || []).includes('Files'));
const FOCUSABLE = 'button:not([disabled]), textarea, input:not([type=file]):not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** "Open a score" modal: format guide, file browsing, and one box that takes pasted ABC or dropped files and folders. */
export default function OpenScoreDialog({ onClose, onOpenFile, onOpenAbc, onBrowse }: OpenScoreDialogProps) {
  const headingId = useId();
  const tipId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const dragDepth = useRef(0);
  const [abc, setAbc] = useState('');
  const [dragging, setDragging] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState('');
  const [choices, setChoices] = useState<ScoreFileCandidate[] | null>(null);
  const [truncated, setTruncated] = useState(false);

  // Focus the entry box on open; hand focus back to whatever opened the dialog on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    textRef.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      // Only while focus is in this dialog's reader (a click on dialog text can leave it on the reader root):
      // another reader on the page keeps its own keys.
      if (!panelRef.current?.closest('.pepperscore')?.contains(document.activeElement)) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.key !== 'Tab' || !panelRef.current) return;
      // Keep Tab inside the dialog.
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panelRef.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panelRef.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose]);

  const open = (file: File) => { onClose(); onOpenFile(file); };
  const settle = ({ candidates, unsupported, truncated: cut }: CollectedScoreFiles, folder: boolean) => {
    setScanning(false);
    setTruncated(cut);
    if (candidates.length === 1 && !cut) { open(candidates[0].file); return; }
    if (candidates.length > 1 || (candidates.length === 1 && cut)) { setChoices(candidates); setMessage(''); return; }
    setChoices(null);
    if (unsupported.length) setMessage(`${unsupported.length === 1 ? `“${unsupported[0]}” isn’t` : `${unsupported.length} files aren’t`} a supported score. Choose a MusicXML, MIDI, MEI or ABC file.`);
    else setMessage(folder ? 'No MusicXML, MIDI, MEI or ABC files were found in that folder.' : 'Nothing to open there. Drop a MusicXML, MIDI, MEI or ABC file.');
  };
  const scan = (work: Promise<CollectedScoreFiles>, folder: boolean) => {
    setScanning(true); setMessage(''); setChoices(null);
    work.then(result => settle(result, folder), () => { setScanning(false); setMessage('Those files couldn’t be read. Try choosing them with Browse files.'); });
  };
  const submitAbc = () => {
    const text = abc.trim();
    if (!text) return;
    if (!looksLikeAbc(text)) { setMessage(NOT_ABC); textRef.current?.focus(); return; }
    onClose(); onOpenAbc(text);
  };

  const dragProps = {
    onDragEnter: (event: React.DragEvent) => { if (!hasFiles(event.dataTransfer)) return; event.preventDefault(); dragDepth.current++; setDragging(true); },
    onDragOver: (event: React.DragEvent) => { if (!hasFiles(event.dataTransfer)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; },
    onDragLeave: (event: React.DragEvent) => { if (!hasFiles(event.dataTransfer)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); },
    onDrop: (event: React.DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return; // plain text dropped into the box inserts as usual
      event.preventDefault();
      dragDepth.current = 0; setDragging(false);
      const folder = Array.from(event.dataTransfer.items || []).some(item => (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory: boolean } | null }).webkitGetAsEntry?.()?.isDirectory);
      scan(collectDroppedScoreFiles(event.dataTransfer), folder);
    },
  };

  const messageIsHint = message === NOT_ABC;
  return <div className={`open-dialog-backdrop ${dragging ? 'is-drag-over' : ''}`} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }} {...dragProps}>
    <section ref={panelRef} tabIndex={-1} className="open-dialog" role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <div className="open-dialog-heading">
        <div className="open-dialog-title"><FolderOpen className="open-dialog-title-icon" size={18}/><h2 id={headingId} className="open-dialog-title-text">Open a score</h2></div>
        <button className="icon-button open-dialog-close" aria-label="Close open score dialog" onClick={onClose}><X size={19}/></button>
      </div>
      <p className="open-dialog-intro">Scoreflow reads these notation formats. Everything stays on this device.</p>
      <ul className="open-dialog-formats" aria-label="Supported formats">{FORMATS.map(format => <li key={format.name} className="open-dialog-format"><span className="open-dialog-format-name">{format.name}</span><span className="open-dialog-format-detail">{format.detail}</span></li>)}</ul>

      {choices ? <div className="open-dialog-choices">
        <div className="open-dialog-choices-heading">
          <h3 className="open-dialog-choices-title">Choose a score <span className="open-dialog-choices-count">{choices.length} found</span></h3>
          <button className="text-action open-dialog-choices-back" onClick={() => { setChoices(null); setTruncated(false); textRef.current?.focus(); }}><ChevronLeft size={15}/> Back</button>
        </div>
        {truncated && <p className="open-dialog-choices-note">Only the first {FOLDER_MAX_ENTRIES} items (four folders deep) were searched.</p>}
        <ul className="open-dialog-choice-list" aria-label="Scores found">{choices.map(choice => <li key={choice.path} className="open-dialog-choice-item">
          <button className="open-dialog-choice" onClick={() => open(choice.file)}>
            <FileMusic className="open-dialog-choice-icon" size={17}/>
            <span className="open-dialog-choice-text"><span className="open-dialog-choice-name">{choice.file.name}</span><span className="open-dialog-choice-path">{choice.path}</span></span>
            <span className="open-dialog-choice-format">{choice.format}</span>
          </button>
        </li>)}</ul>
      </div> : <>
        <label className="open-dialog-entry-label" htmlFor={`${headingId}-abc`}>ABC notation, or drop files here</label>
        <div className={`open-dialog-dropzone ${dragging ? 'is-drag-over' : ''} ${scanning ? 'is-scanning' : ''}`}>
          <textarea ref={textRef} id={`${headingId}-abc`} className="open-dialog-abc-input" value={abc} spellCheck={false} placeholder={'X:1\nT:My tune\nK:C\nC D E F | G2 G2 |'} aria-describedby={tipId}
            onChange={event => { setAbc(event.target.value); if (messageIsHint) setMessage(''); }}
            onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submitAbc(); } }}/>
          {dragging && <div className="open-dialog-drop-overlay" aria-hidden="true"><Upload className="open-dialog-drop-icon" size={26}/><span className="open-dialog-drop-text">Drop to open</span></div>}
          {scanning && <div className="open-dialog-drop-overlay is-scanning" role="status"><span className="score-loading-spinner open-dialog-spinner"/><span className="open-dialog-drop-text">Looking for scores…</span></div>}
        </div>
        <p id={tipId} className="open-dialog-tip">{TIP} <span className="open-dialog-tip-keys">Ctrl/⌘ + Enter opens pasted ABC.</span></p>
      </>}

      {message && <p className={`open-dialog-message ${messageIsHint ? 'is-hint' : 'is-error'}`} role={messageIsHint ? 'status' : 'alert'}>{message}</p>}

      <div className="open-dialog-actions">
        <button className="open-dialog-browse" onClick={() => { onBrowse(); onClose(); }}><FolderOpen size={16}/> Browse files</button>
        {!choices && <button className="primary-action open-dialog-open-abc" disabled={!abc.trim()} onClick={submitAbc}>Open ABC</button>}
      </div>
    </section>
  </div>;
}
