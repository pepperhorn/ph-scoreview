import type { StringChart } from './charts';
import { fingeringCandidates, type PitchSpelling, type StringFingering } from './solver';

export interface FingerNote { id: string; onset: number; duration: number; midi: number | null; spelling?: PitchSpelling; tieStop?: boolean; fixed?: StringFingering }
/** Solve simultaneous voices together, keeping sounding strings occupied and a common hand position.
 * Unsupported events stay unlabelled rather than inventing a pitch or an impossible double stop. */
export function solveFingerPhrase(chart: StringChart, notes: FingerNote[]): Map<string, StringFingering> {
  const result = new Map<string, StringFingering>();
  const events = new Map<number, FingerNote[]>();
  for (const note of notes) events.set(note.onset, [...(events.get(note.onset) ?? []), note]);
  let held: { midi: number; until: number; fingering: StringFingering }[] = [];
  for (const [onset, event] of [...events].sort(([a], [b]) => a - b)) {
    // A tie ending exactly here still owns its string for the continuation.
    const tied = event.map(note => note.tieStop ? held.find(h => h.midi === note.midi && h.until >= onset) : undefined);
    held = held.filter(h => h.until > onset);
    const choices = event.map((note, i) => note.fixed ? [note.fixed] : tied[i] ? [tied[i]!.fingering] : note.midi === null ? [] : fingeringCandidates(chart, note.midi, note.spelling));
    let best: StringFingering[] | undefined, bestCost = Infinity;
    const visit = (index: number, picked: StringFingering[], cost: number) => {
      if (cost >= bestCost) return;
      if (index === event.length) { best = [...picked]; bestCost = cost; return; }
      choices[index].forEach((candidate, rank) => {
        const occupied = [...held.map(h => ({ midi: h.midi, fingering: h.fingering })), ...picked.map((fingering, i) => ({ midi: event[i].midi, fingering }))];
        if (occupied.some(other => (other.fingering.string === candidate.string && other.midi !== event[index].midi)
          || (candidate.position && other.fingering.position && candidate.position !== other.fingering.position))) return;
        visit(index + 1, [...picked, candidate], cost + rank);
      });
    };
    // Four physical strings bound chord search. Larger chords cannot be bowed as one event.
    if (new Set(event.map(n => n.midi)).size <= 4) visit(0, [], 0);
    if (!best) continue;
    best.forEach((fingering, i) => {
      result.set(event[i].id, fingering);
      if (event[i].midi !== null) held.push({ midi: event[i].midi!, until: onset + event[i].duration, fingering });
    });
  }
  return result;
}
