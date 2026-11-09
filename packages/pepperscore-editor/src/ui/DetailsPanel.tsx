import { useEffect, useState, type ChangeEvent } from 'react';
import { setMeta } from '../engine/commands/score';
import type { EditorStore } from '../engine/store';
import { useEditorStore } from './useEditorStore';

/** Local drafts preserve spaces and tag separators while typing; blur commits one undoable edit. */
function DetailField({ label, value, multiline, onCommit }: { label: string; value: string; multiline?: boolean; onCommit(value: string): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const props = {
    className: 'ps-input ps-details-input',
    value: draft,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onBlur: () => { onCommit(draft); setDraft(draft.trim()); },
  };
  return (
    <label className="ps-details-field">
      <span className="ps-details-label">{label}</span>
      {multiline ? <textarea {...props} rows={3} /> : <input {...props} type="text" />}
    </label>
  );
}

/** Score-wide details, shared by the desktop popover and the phone strip. Goal is model-only. */
export function DetailsPanel({ store }: { store: EditorStore }) {
  const meta = useEditorStore(store, (state) => state.document.meta);
  return (
    <div className="ps-details-panel">
      <DetailField label="Description" value={meta.description ?? ''} multiline onCommit={(description) => store.dispatch(setMeta, { description })} />
      <DetailField label="Project" value={meta.project ?? ''} onCommit={(project) => store.dispatch(setMeta, { project })} />
      <DetailField label="Tags (comma-separated)" value={meta.tags?.join(', ') ?? ''} onCommit={(value) => store.dispatch(setMeta, { tags: value.split(',') })} />
    </div>
  );
}
