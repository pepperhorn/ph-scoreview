import { newId } from '../../model/ids';
import { eventStarts, measureIndex, sequenceFor } from '../../model/query';
import type { Beam, Document } from '../../model/schema';
import { beamable, replaceSequenceBeams } from '../autobeam';
import { contextAt, findEvent, type SeqContext } from '../sequence-edit';
import type { Command, Editable } from '../types';

/**
 * The (staff, voice) sequence of a bar: `measureId` is a part-measure id, or a global measure
 * id read in the cursor's part.
 */
function sequenceIn(draft: Editable, measureId: string, staff: number, voice: number): SeqContext | undefined {
  const doc: Document = draft.document;
  for (const part of doc.parts) {
    const index = part.measures.findIndex((pm) => pm.id === measureId);
    const seq = index >= 0 ? sequenceFor(part.measures[index], staff, voice) : undefined;
    if (seq) return contextAt(doc, part, index, seq);
  }
  const part = doc.parts.find((p) => p.id === draft.cursor.partId);
  const index = measureIndex(doc, measureId);
  const seq = part && index >= 0 ? sequenceFor(part.measures[index], staff, voice) : undefined;
  return part && seq ? contextAt(doc, part, index, seq) : undefined;
}

/** Re-beams a sequence in runs of `group` beamable events (rests and quarters break runs); `group` < 2 unbeams it. */
export const setBeamGroup: Command<{ measureId: string; staff: number; voice: number; group: number }> = {
  label: 'Set beam grouping',
  run: (draft, { measureId, staff, voice, group }) => {
    const ctx = sequenceIn(draft, measureId, staff, voice);
    if (!ctx) return;
    const beams: Beam[] = [];
    let run: string[] = [];
    const flush = () => {
      for (let i = 0; i < run.length; i += Math.max(group, 1)) {
        const chunk = run.slice(i, i + Math.max(group, 1));
        if (chunk.length > 1) beams.push({ id: newId(), events: chunk });
      }
      run = [];
    };
    for (const s of eventStarts(ctx.seq, ctx.barTicks)) {
      if (beamable(s)) run.push(s.event.id);
      else flush();
    }
    flush();
    replaceSequenceBeams(ctx.pm, ctx.seq, beams, ctx.barTicks);
  },
};

/** Ends the event's beam before it; the pieces keep only runs of two or more. */
export const breakBeam: Command<{ eventId: string }> = {
  label: 'Break beam',
  run: (draft, { eventId }) => {
    const at = findEvent(draft.document, eventId);
    const beam = at?.pm.beams.find((b) => b.events.includes(eventId));
    if (!at || !beam) return;
    const split = beam.events.indexOf(eventId);
    if (split === 0) return;
    const pieces = [beam.events.slice(0, split), beam.events.slice(split)].filter((p) => p.length > 1);
    const index = at.pm.beams.indexOf(beam);
    at.pm.beams.splice(index, 1, ...pieces.map((events, i) => ({ id: i === 0 ? beam.id : newId(), events })));
  },
};

/** Joins the event (and its beam) to the previous event's beam; both must be beamable notes. */
export const joinBeam: Command<{ eventId: string }> = {
  label: 'Join beam',
  run: (draft, { eventId }) => {
    const at = findEvent(draft.document, eventId);
    if (!at || at.position === 0) return;
    const starts = eventStarts(at.seq, at.barTicks);
    const prev = starts[at.position - 1];
    if (!beamable(prev) || !beamable(starts[at.position])) return;
    const beams = at.pm.beams;
    const left = beams.find((b) => b.events.includes(prev.event.id));
    const right = beams.find((b) => b.events.includes(eventId));
    if (left && left === right) return;
    const events = [...(left?.events ?? [prev.event.id]), ...(right?.events ?? [eventId])];
    const joined: Beam = { id: left?.id ?? right?.id ?? newId(), events };
    // The joined beam takes the place of the first beam it replaces (or goes last).
    const out: Beam[] = [];
    for (const b of beams) {
      if (b !== left && b !== right) out.push(b);
      else if (!out.includes(joined)) out.push(joined);
    }
    if (!out.includes(joined)) out.push(joined);
    at.pm.beams = out;
  },
};
