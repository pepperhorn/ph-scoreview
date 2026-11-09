import { INSTRUMENTS, instrumentName, type SwitchInstrumentId } from 'pepperscore/instruments';
import { emptyPartMeasure } from '../../model/create';
import { newId } from '../../model/ids';
import { effectiveTime, eventStarts, staffCount } from '../../model/query';
import type { Document, Part } from '../../model/schema';
import { clampCursor } from '../cursor-clamp';
import { documentIds, pruneDanglingReferences, pruneSelection } from '../prune';
import type { Command, Editable } from '../types';

/** Missing parts and parts containing any notes (including grace notes and tuplets) cannot be edited. */
export function canEditPart(doc: Document, partId: string): boolean {
  const part = doc.parts.find(p => p.id === partId);
  return !!part && part.measures.every(pm => pm.sequences.every(seq => eventStarts(seq).every(({ event }) => !event.notes?.length)));
}

/** A single-stave addition by default; pass the target to account for piano's two staves. */
export function canAddPart(doc: Document, maxStaves: number, instrument: SwitchInstrumentId = 'flute'): boolean {
  return staffCount(doc) + (instrument === 'piano' ? 2 : 1) <= maxStaves;
}

function instrumentFields(instrument: SwitchInstrumentId): Pick<Part, 'name' | 'instrument' | 'staves' | 'clefs' | 'transposition'> {
  const info = INSTRUMENTS[instrument];
  return {
    name: instrumentName(instrument), instrument: { gmProgram: info.gmProgram },
    staves: instrument === 'piano' ? 2 : 1, clefs: instrument === 'piano' ? ['treble', 'bass'] : [info.clef],
    ...(info.transposition.semitones || info.transposition.diatonic ? { transposition: { ...info.transposition } } : {}),
  };
}

// Public callers may receive strings from untyped hosts; do not admit percussion through this pitched-only flow.
const pitched = (id: SwitchInstrumentId): boolean => Object.hasOwn(INSTRUMENTS, id) && (id as string) !== 'drum-kit';

function repair(draft: Editable): void {
  pruneDanglingReferences(draft.document);
  Object.assign(draft.cursor, clampCursor(draft.document, draft.cursor));
  delete draft.cursor.entered;
  delete draft.cursor.chord;
  delete draft.cursor.lastPitch;
  delete draft.cursor.lastPitchAt;
  pruneSelection(draft);
  const ids = documentIds(draft.document);
  for (const layout of draft.document.layouts) for (const id of Object.keys(layout.overrides)) if (!ids.has(id)) delete layout.overrides[id];
}

/** Caller checks canAddPart against its verified licence before dispatching. Custom layouts are unchanged. */
export const addPart: Command<{ instrument: SwitchInstrumentId }> = {
  label: 'Add part',
  run(draft, { instrument }) {
    if (!pitched(instrument)) return;
    const doc = draft.document;
    const part: Part = { id: newId(), ...instrumentFields(instrument), measures: [] };
    part.measures = doc.global.measures.map((_, i) => emptyPartMeasure(part, effectiveTime(doc, i)));
    doc.parts.push(part);
    doc.layouts[0].parts.push({ partId: part.id });
  },
};

/** Changes only an empty part. Surviving rests and directions keep their ids; obsolete staff references are removed. */
export const setPartInstrument: Command<{ partId: string; instrument: SwitchInstrumentId }> = {
  label: 'Set part instrument',
  run(draft, { partId, instrument }) {
    const doc = draft.document;
    if (!pitched(instrument) || !canEditPart(doc, partId)) return;
    const part = doc.parts.find(p => p.id === partId)!;
    const fields = instrumentFields(instrument);
    if (part.name === fields.name && part.instrument.gmProgram === fields.instrument.gmProgram && part.instrument.midiChannel !== 10 && part.staves === fields.staves && part.clefs.join() === fields.clefs.join() && JSON.stringify(part.transposition) === JSON.stringify(fields.transposition)) return;
    // Channel 10 is percussion, so an explicitly pitched target must not keep it.
    const channel = part.instrument.midiChannel;
    Object.assign(part, fields);
    if (channel !== undefined && channel !== 10) part.instrument.midiChannel = channel;
    if (!fields.transposition) delete part.transposition;
    delete part.abbreviation;
    part.measures.forEach((pm, i) => {
      delete pm.clefs;
      pm.sequences = pm.sequences.filter(s => s.staff <= part.staves);
      const empty = emptyPartMeasure(part, effectiveTime(doc, i));
      for (const seq of empty.sequences) if (!pm.sequences.some(s => s.staff === seq.staff)) pm.sequences.push(seq);
      const ids = new Set(pm.sequences.flatMap(s => eventStarts(s).map(e => e.event.id)));
      pm.beams = pm.beams.filter(b => b.events.every(id => ids.has(id)));
      pm.directions = pm.directions.filter(d => d.anchor.staff <= part.staves);
    });
    for (const layout of doc.layouts) for (const lp of layout.parts) {
      if (lp.partId !== partId || !lp.staves?.length) continue;
      lp.staves = lp.staves.filter(s => s <= part.staves);
      if (!lp.staves.length) delete lp.staves;
    }
    repair(draft);
  },
};

export const removePart: Command<{ partId: string }> = {
  label: 'Remove part',
  run(draft, { partId }) {
    const doc = draft.document;
    if (doc.parts.length <= 1 || !canEditPart(doc, partId)) return;
    doc.parts = doc.parts.filter(p => p.id !== partId);
    for (const layout of doc.layouts) layout.parts = layout.parts.filter(p => p.partId !== partId);
    repair(draft);
  },
};
