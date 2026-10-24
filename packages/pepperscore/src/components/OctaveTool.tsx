// The octave tool's toolbar: while it shows, a click on a note selects instead of seeking (PepperScore.tsx
// `onScoreClick`); 8va / 8vb move the selection by an octave (the reader's `PartSwitch.octaves`).

/** What is selected: the number of notes and the staff they are on; null for nothing yet. */
export type OctaveToolSelection = { count: number; partName: string } | null;

export type OctaveToolProps = {
  selection: OctaveToolSelection;
  /** Whether there are octave moves Reset would clear (the selection's staff, else any). */
  canReset?: boolean;
  onUp: () => void;
  onDown: () => void;
  onPhrase: () => void;
  onReset: () => void;
  onDone: () => void;
};

/**
 * A group of labelled buttons; Escape (handled by the reader's root) leaves the tool like Done. Unavailable buttons are
 * aria-disabled, not disabled, so a button that becomes unavailable when pressed (Reset) keeps the focus.
 */
export default function OctaveTool({ selection, canReset = true, onUp, onDown, onPhrase, onReset, onDone }: OctaveToolProps) {
  const none = !selection;
  const status = selection
    ? `${selection.count} ${selection.count === 1 ? 'note' : 'notes'} selected · ${selection.partName}`
    : 'Tap a note to select it, then tap (or Shift-click) another for a passage.';
  return <div className="octave-toolbar" role="group" aria-label="Octave tool" tabIndex={-1}>
    <span className="octave-toolbar-status" role="status" aria-live="polite">{status}</span>
    <div className="octave-toolbar-actions">
      <button type="button" className="octave-up octave-toolbar-button" aria-label="Move selection up an octave" title="Move selection up an octave" aria-disabled={none} onClick={() => { if (!none) onUp(); }}>8va ↑</button>
      <button type="button" className="octave-down octave-toolbar-button" aria-label="Move selection down an octave" title="Move selection down an octave" aria-disabled={none} onClick={() => { if (!none) onDown(); }}>8vb ↓</button>
      <button type="button" className="octave-phrase octave-toolbar-button" title="Widen the selection to its phrase" aria-disabled={none} onClick={() => { if (!none) onPhrase(); }}>Select phrase</button>
      <button type="button" className="octave-reset octave-toolbar-button" title={selection ? `Clear the octave moves of ${selection.partName}` : 'Clear all octave moves'} aria-disabled={!canReset} onClick={() => { if (canReset) onReset(); }}>Reset</button>
      <button type="button" className="octave-done octave-toolbar-button is-primary" title="Leave the octave tool (Esc)" onClick={onDone}>Done</button>
    </div>
  </div>;
}
