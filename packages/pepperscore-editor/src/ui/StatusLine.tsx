import { memo } from 'react';
import { usePosition, useUi } from './controls';
import { movedNoteIds, movedStatus } from './layout-model';
import { useEditorStore } from './useEditorStore';

const DURATION_NAMES: Record<string, string> = { whole: 'whole', half: 'half', quarter: 'quarter', eighth: 'eighth', '16th': '16th', '32nd': '32nd' };
const time = (date: Date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

/** The bottom line: score check (or its problems and a report button), moved notes, the cursor and the last save. */
export const StatusLine = memo(function StatusLine({ savedAt, onReport }: { savedAt: Date | null; onReport(): void }) {
  const { store } = useUi();
  const errors = useEditorStore(store, (s) => s.invariantErrors);
  const view = useEditorStore(store, (s) => s.view);
  // The one swapped part's swap when a single part moved notes.
  const swap = useEditorStore(store, (s) => {
    const partId = s.view.counts.partId;
    return partId ? s.document.layouts.find((l) => l.id === s.activeLayoutId)?.parts.find((lp) => lp.partId === partId)?.swap : undefined;
  });
  // The whole cursor: the line shows its bar, beat, value, mode and chord state.
  const { cursor, index, beat, partName } = usePosition();
  const dots = '.'.repeat(cursor.duration.dots);
  return (
    <footer className="ps-status ps-editor-status" role="status" aria-live="polite">
      {errors.length > 0 ? (
        <span className="ps-status-check is-problem">
          <span className="ps-status-dot" />
          <span className="ps-editor-status-text">Score check found {errors.length} problem{errors.length > 1 ? 's' : ''}: {errors.join('; ')}.</span>
          <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm ps-editor-report" onClick={onReport}>Report this score</button>
        </span>
      ) : (
        <span className="ps-status-check"><span className="ps-status-dot" />Score check: no problems</span>
      )}
      {view.counts.moved > 0 && (
        <span className="ps-status-moved">
          <span className="ps-moved-dot" />
          {movedStatus(movedNoteIds(view).length, view.counts.direction, swap)}
        </span>
      )}
      {view.diagnostics.length > 0 && <span className="ps-status-diagnostics" title={view.diagnostics.join('\n')}>{view.diagnostics.length} range note{view.diagnostics.length > 1 ? 's' : ''}</span>}
      <span className="ps-status-cursor">
        {partName} · bar {index + 1}, beat {beat} · {DURATION_NAMES[cursor.duration.base]}{dots} · {cursor.mode === 'enter' ? 'entry' : 'edit'}{cursor.chord ? ' · chord' : ''}
      </span>
      {savedAt && <span className="ps-status-saved">Saved locally · {time(savedAt)}</span>}
    </footer>
  );
});
