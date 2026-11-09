import { useId, useState } from 'react';
import { INSTRUMENT_IDS, INSTRUMENTS, instrumentName, type SwitchInstrumentId } from 'pepperscore/instruments';
import { addPart, canAddPart, canEditPart, removePart, setPartInstrument } from '../engine/commands/parts';
import type { EditorStore } from '../engine/store';
import { staffCount } from '../model/query';
import { useUi } from './controls';
import { useEditorStore } from './useEditorStore';

const choices = INSTRUMENT_IDS.filter((id): id is SwitchInstrumentId => id !== 'drum-kit');

/** The same licence-aware form in the desktop popover and phone strip. */
export function PartsPanel({ store }: { store: EditorStore }) {
  const doc = useEditorStore(store, s => s.document);
  const { editable, maxStaves } = useUi();
  const [instrument, setInstrument] = useState<SwitchInstrumentId>('flute');
  const prefix = useId();
  const capReason = `The licence allows ${maxStaves} staves. Piano needs two staves.`;
  const addReason = !editable ? 'Editing requires a valid licence.' : !canAddPart(doc, maxStaves, instrument) ? capReason : '';
  return (
    <div className="ps-parts-panel">
      <p className="ps-parts-count">{staffCount(doc)} of {maxStaves} staves</p>
      {doc.parts.map(part => {
        const empty = canEditPart(doc, part.id);
        const editReason = !editable ? 'Editing requires a valid licence.' : !empty ? 'This part has notes. Only empty parts can change instrument or be removed.' : '';
        const removeReason = editReason || (doc.parts.length === 1 ? 'Keep at least one part in the score.' : '');
        const current = choices.find(id => INSTRUMENTS[id].gmProgram === part.instrument.gmProgram && (id === 'piano' ? 2 : 1) === part.staves && part.instrument.midiChannel !== 10);
        const without = { ...doc, parts: doc.parts.filter(p => p.id !== part.id) };
        const reasonId = `${prefix}-${part.id}`;
        return (
          <section className="ps-parts-row" key={part.id} aria-label={part.name}>
            <label className="ps-parts-field">
              <span className="ps-parts-name">{part.name}</span>
              <select className="ps-select ps-parts-instrument" aria-label={`Instrument for ${part.name}`} aria-describedby={reasonId} title={editReason || capReason} disabled={!!editReason} value={current ?? ''} onChange={e => {
                const target = e.target.value as SwitchInstrumentId;
                if (editable && canEditPart(store.getState().document, part.id) && canAddPart(without, maxStaves, target)) store.dispatch(setPartInstrument, { partId: part.id, instrument: target });
              }}>
                {!current && <option value="" disabled>{part.name} (current)</option>}
                {choices.map(id => {
                  const fits = canAddPart(without, maxStaves, id);
                  return <option key={id} value={id} disabled={!fits}>{instrumentName(id)}{fits ? '' : ' (exceeds stave limit)'}</option>;
                })}
              </select>
            </label>
            <button type="button" className="ps-btn ps-btn-ghost ps-parts-remove" aria-label={`Remove ${part.name}`} aria-describedby={reasonId} title={removeReason || `Remove ${part.name}`} disabled={!!removeReason} onClick={() => { if (editable) store.dispatch(removePart, { partId: part.id }); }}>Remove</button>
            <p id={reasonId} className="ps-parts-reason">{removeReason || capReason}</p>
          </section>
        );
      })}
      <div className="ps-parts-add">
        <label className="ps-parts-field">
          <span className="ps-parts-name">New part</span>
          <select className="ps-select ps-parts-new-instrument" aria-label="New part instrument" disabled={!editable || !canAddPart(doc, maxStaves)} value={instrument} onChange={e => setInstrument(e.target.value as SwitchInstrumentId)}>
            {choices.map(id => <option key={id} value={id} disabled={!canAddPart(doc, maxStaves, id)}>{instrumentName(id)}{canAddPart(doc, maxStaves, id) ? '' : ' (exceeds stave limit)'}</option>)}
          </select>
        </label>
        <button type="button" className="ps-btn ps-popover-apply ps-parts-add-button" disabled={!!addReason} title={addReason || 'Add part'} aria-describedby={`${prefix}-add-reason`} onClick={() => {
          if (editable && canAddPart(store.getState().document, maxStaves, instrument)) store.dispatch(addPart, { instrument });
        }}>Add part</button>
        <p id={`${prefix}-add-reason`} className="ps-parts-reason">{addReason || 'Choose an instrument, then add its empty part.'}</p>
      </div>
    </div>
  );
}
