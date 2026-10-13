import { eventStarts, sequenceFor } from '../model/query';
import type { Document, Event, Pitch } from '../model/schema';
import type { Editable } from './types';

const samePitch = (a: Pitch, b: Pitch) => a.step === b.step && a.octave === b.octave && a.alter === b.alter;

/**
 * Removes references left dangling by structural edits: ties whose target is not an equal
 * pitch in the next event, slurs to events no longer in the part, and beams over missing events.
 */
export function pruneDanglingReferences(doc: Document): void {
  for (const part of doc.parts) {
    const eventIds = new Set<string>();
    for (const pm of part.measures) for (const seq of pm.sequences) for (const s of eventStarts(seq)) eventIds.add(s.event.id);

    part.measures.forEach((pm, mi) => {
      const beams = pm.beams.filter((b) => b.events.every((id) => eventIds.has(id)));
      if (beams.length !== pm.beams.length) pm.beams = beams;

      for (const seq of pm.sequences) {
        const starts = eventStarts(seq);
        starts.forEach(({ event }, i) => {
          let next: Event | undefined = starts[i + 1]?.event;
          if (!next && mi + 1 < part.measures.length) {
            const following = sequenceFor(part.measures[mi + 1], seq.staff, seq.voice);
            next = following ? eventStarts(following)[0]?.event : undefined;
          }
          for (const note of event.notes ?? []) {
            if (!note.tie) continue;
            const target = next?.notes?.find((n) => n.id === note.tie!.target);
            if (!target || !samePitch(target.pitch, note.pitch)) delete note.tie;
          }
          if (event.slurs?.some((s) => !eventIds.has(s.target))) {
            const slurs = event.slurs.filter((s) => eventIds.has(s.target));
            if (slurs.length) event.slurs = slurs;
            else delete event.slurs;
          }
        });
      }
    });
  }
}

/** Every id a selection may hold: measures, part measures, events, notes and directions. */
export function documentIds(doc: Document): Set<string> {
  const ids = new Set<string>(doc.global.measures.map((m) => m.id));
  for (const part of doc.parts)
    for (const pm of part.measures) {
      ids.add(pm.id);
      for (const d of pm.directions) ids.add(d.id);
      for (const seq of pm.sequences)
        for (const { event } of eventStarts(seq)) {
          ids.add(event.id);
          for (const note of event.notes ?? []) ids.add(note.id);
        }
    }
  return ids;
}

/** Drops selected ids that no longer exist in the document. */
export function pruneSelection(draft: Editable): void {
  const ids = documentIds(draft.document);
  if (draft.selection.ids.some((id) => !ids.has(id))) draft.selection.ids = draft.selection.ids.filter((id) => ids.has(id));
}
