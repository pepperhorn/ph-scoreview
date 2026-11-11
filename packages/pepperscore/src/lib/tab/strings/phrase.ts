import type { StringChart } from './charts';
import { fingeringCandidates, type PitchSpelling, type StringFingering } from './solver';

export interface FingerNote { id: string; onset: number; duration: number; midi: number | null; spelling?: PitchSpelling; tieStop?: boolean; fixed?: StringFingering }
type Held = { midi: number; until: number; fingering: StringFingering };
interface Path {
  cost: number;
  missed: number;
  position: number;
  held: Held[];
  previous?: Path;
  labels: [string, StringFingering][];
}
// Equivalent futures share hand position and sounding strings. Keep a bounded
// beam for polyphonic passages; monophonic state count is just the chart positions.
const MAX_PATHS = 64;
const compare = (a: Path, b: Path) => a.missed - b.missed || a.cost - b.cost;

/** Solve simultaneous voices together, keeping sounding strings occupied and a common hand position.
 * Candidate rank retains the single-note teaching preferences. Shifts cost four
 * ranks plus two per position travelled; opens carry the hand without a shift.
 * Unsupported events stay unlabelled rather than inventing a pitch or an impossible double stop. */
export function solveFingerPhrase(chart: StringChart, notes: FingerNote[]): Map<string, StringFingering> {
  const events = new Map<number, FingerNote[]>();
  for (const note of notes) {
    const event = events.get(note.onset);
    if (event) event.push(note); else events.set(note.onset, [note]);
  }
  let paths: Path[] = [{ cost: 0, missed: 0, position: 0, held: [], labels: [] }];
  const ordered = [...events].sort(([a], [b]) => a - b);
  for (const [eventIndex, [onset, event]] of ordered.entries()) {
    const following = ordered[eventIndex + 1];
    const next = new Map<string, Path>();
    const keep = (path: Path) => {
      // Forget strings released before the next event, except exact-boundary
      // ties. Those paths have identical future constraints and can coalesce.
      const relevant = following ? path.held.filter(h => h.until > following[0]
        || (h.until === following[0] && following[1].some(n => n.tieStop && n.midi === h.midi))) : [];
      const key = JSON.stringify([path.position, relevant]), prior = next.get(key);
      if (!prior || compare(path, prior) < 0) next.set(key, path);
    };
    const candidates = event.map(note => note.fixed ? [note.fixed] : note.midi === null ? [] : fingeringCandidates(chart, note.midi, note.spelling));
    for (const previous of paths) {
      // A tie ending exactly here still owns its string for the continuation.
      const tied = event.map(note => note.tieStop ? previous.held.find(h => h.midi === note.midi && h.until >= onset) : undefined);
      const held = previous.held.filter(h => h.until > onset);
      const choices = candidates.map((list, i) => !event[i].fixed && tied[i] ? [tied[i]!.fingering] : list);
      let feasible = false;
      const visit = (index: number, picked: StringFingering[], cost: number) => {
        if (index === event.length) {
          feasible = true;
          const position = picked.find(f => f.position)?.position ?? previous.position;
          const shift = previous.position && position !== previous.position ? 4 + 2 * Math.abs(position - previous.position) : 0;
          const sounding = [...held];
          picked.forEach((fingering, i) => {
            if (event[i].midi !== null) sounding.push({ midi: event[i].midi!, until: onset + event[i].duration, fingering });
          });
          keep({ cost: previous.cost + cost + shift, missed: previous.missed, position, held: sounding,
            previous, labels: picked.map((f, i) => [event[i].id, f]) });
          return;
        }
        choices[index].forEach((candidate, rank) => {
          const occupied = [...held, ...picked.map((fingering, i) => ({ midi: event[i].midi, fingering }))];
          if (occupied.some(other => (other.fingering.string === candidate.string && other.midi !== event[index].midi)
            || (candidate.position && other.fingering.position && candidate.position !== other.fingering.position))) return;
          visit(index + 1, [...picked, candidate], cost + rank);
        });
      };
      // Four physical strings bound chord search. Larger chords cannot be bowed as one event.
      if (new Set(event.map(n => n.midi)).size <= 4) visit(0, [], 0);
      if (!feasible) keep({ ...previous, held, previous, labels: [], missed: previous.missed + event.length });
    }
    // Prefer labelling feasible events before minimizing movement, so a cheap
    // dead end cannot win by silently dropping notes later in the phrase.
    paths = [...next.values()].sort(compare).slice(0, MAX_PATHS);
  }
  const result = new Map<string, StringFingering>();
  const steps: Path[] = [];
  for (let path: Path | undefined = paths[0]; path; path = path.previous) steps.push(path);
  for (const step of steps.reverse()) for (const [id, fingering] of step.labels) result.set(id, fingering);
  return result;
}
