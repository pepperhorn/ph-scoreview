import { pitchMidi, transposePitchSpelled, type Instrument, type Level, type Transposition } from '../../model/instruments';
import { eventStarts } from '../../model/query';
import type { Event, Key, Part, Pitch } from '../../model/schema';

export type Phrase = { eventIds: string[] };
export type Shift = 0 | 12 | -12;

const CONCERT: Transposition = { semitones: 0, diatonic: 0 };

/**
 * The written key (fifths) of music in concert key `concertFifths` shown with `transposition` (written minus
 * sounding): the transposition as fifths, `(7 * semitones) mod 12` normalised to -6..6, added and wrapped
 * back into -7..7. Alto sax (+9 semitones) is +3 fifths; a B-flat instrument +2.
 */
export function writtenKeyFifths(concertFifths: number, transposition: Transposition): number {
  let shift = (((7 * transposition.semitones) % 12) + 12) % 12;
  if (shift > 6) shift -= 12;
  const fifths = concertFifths + shift;
  return fifths > 7 ? fifths - 12 : fifths < -7 ? fifths + 12 : fifths;
}

const add = (a: Transposition, b: Transposition): Transposition => ({ semitones: a.semitones + b.semitones, diatonic: a.diatonic + b.diatonic });
const negate = (t: Transposition): Transposition => ({ semitones: -t.semitones, diatonic: -t.diatonic });

/** Events of a part in order, bar by bar and sequence by sequence, with their bar index. */
function partEvents(part: Part): { event: Event; measure: number; sequence: string }[] {
  const out: { event: Event; measure: number; sequence: string }[] = [];
  part.measures.forEach((pm, measure) => {
    for (const seq of pm.sequences) for (const { event } of eventStarts(seq)) out.push({ event, measure, sequence: seq.id });
  });
  return out;
}

/**
 * The phrases of a part: runs of pitched events in one sequence of one bar, broken by a rest and after the
 * end of a slur (its target is the phrase's last event). A tie across a bar line joins the two phrases so a
 * tied note never moves on one side only.
 */
export function phrases(part: Part): Phrase[] {
  const slurEnds = new Set<string>();
  const noteOwner = new Map<string, string>();
  const events = partEvents(part);
  for (const { event } of events) {
    for (const slur of event.slurs ?? []) slurEnds.add(slur.target);
    for (const n of event.notes ?? []) noteOwner.set(n.id, event.id);
  }

  const runs: string[][] = [];
  const runOf = new Map<string, number>();
  let current: string[] | undefined;
  let where = '';
  for (const { event, measure, sequence } of events) {
    if (`${measure}/${sequence}` !== where) { current = undefined; where = `${measure}/${sequence}`; }
    if (event.rest || !event.notes?.length) { current = undefined; continue; }
    if (!current) { current = []; runs.push(current); }
    current.push(event.id);
    runOf.set(event.id, runs.length - 1);
    if (slurEnds.has(event.id)) current = undefined;
  }

  // Union the runs a tie links, keeping the first run's position.
  const parent = runs.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (const { event } of events)
    for (const n of event.notes ?? []) {
      const owner = n.tie && noteOwner.get(n.tie.target);
      const a = runOf.get(event.id), b = owner !== undefined ? runOf.get(owner) : undefined;
      if (a === undefined || b === undefined) continue;
      const [ra, rb] = [root(a), root(b)];
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  const merged = new Map<number, string[]>();
  runs.forEach((run, i) => {
    const r = root(i);
    merged.set(r, [...(merged.get(r) ?? []), ...run]);
  });
  return [...merged.values()].map((eventIds) => ({ eventIds }));
}

export type FitOptions = {
  /** The concert key in force in bar `i` (used only to spell notes that cannot keep their spelling). */
  keyByMeasure: (i: number) => Key;
  target: Instrument;
  level: Level;
  /** A free transposition on top of the instruments'. */
  interval?: Transposition;
  /** Event id to the user's octave shift; beats the computed shift for that event only. */
  overrides: Record<string, Shift>;
  autoRange: boolean;
  /** Written for the target's transposition when true; concert pitch otherwise. */
  transposing: boolean;
  /** The pitches' transposition (written minus sounding); defaults to `part.transposition`, else concert. */
  sourceTransposition?: Transposition;
};

export type FitResult = { part: Part; moved: Record<string, 12 | -12>; diagnostics: string[] };

/** Each event's tie chain (the events its ties link, both ways, in order); untied events are absent. */
function tieChains(events: { event: Event }[]): Map<string, string[]> {
  const noteOwner = new Map<string, string>();
  for (const { event } of events) for (const n of event.notes ?? []) noteOwner.set(n.id, event.id);
  const parent = new Map<string, string>();
  const root = (id: string): string => { let r = id; while (parent.has(r)) r = parent.get(r)!; return r; };
  for (const { event } of events)
    for (const n of event.notes ?? []) {
      const owner = n.tie && noteOwner.get(n.tie.target);
      if (!owner) continue;
      const [a, b] = [root(event.id), root(owner)];
      if (a !== b) parent.set(b, a);
    }
  const groups = new Map<string, string[]>();
  for (const { event } of events) {
    const r = root(event.id);
    groups.set(r, [...(groups.get(r) ?? []), event.id]);
  }
  const chains = new Map<string, string[]>();
  for (const chain of groups.values()) if (chain.length > 1) for (const id of chain) chains.set(id, chain);
  return chains;
}

/**
 * Shows `part` for `target`: every note goes to sounding pitch, then up the `interval`, then (when
 * transposing) to the target's written pitch, keeping its spelling. With `autoRange`, a phrase holding a
 * note outside the target's range at `level` (judged on sounding plus interval) moves an octave as one:
 * up when below, down when above, not at all (with a diagnostic) when both; a phrase still out of range
 * after its move keeps it and gets a diagnostic. Overrides then set single events, extended to their tie
 * chain so a tie never breaks (the first override along the chain wins). A shift that would take a note
 * past octave 0..9 is skipped with a diagnostic. Unpitched targets (no ranges) are not fitted. `moved`
 * holds the events shifted by an octave.
 */
export function fitToRange(part: Part, options: FitOptions): FitResult {
  const { target, level, interval = CONCERT, overrides, autoRange, transposing } = options;
  const source = options.sourceTransposition ?? part.transposition ?? CONCERT;
  const range = target.ranges?.[level];
  const toSounding = add(negate(source), interval);
  const diagnostics: string[] = [];
  const events = partEvents(part);
  const measureOf = new Map(events.map(({ event, measure }) => [event.id, measure]));
  const where = (ids: string[]) => `part ${part.name} bar ${(measureOf.get(ids[0]) ?? 0) + 1} phrase ${ids[0]}..${ids.at(-1)}`;
  const span = `the ${target.label} ${level} range`;

  const shifts = new Map<string, Shift>();
  if (autoRange && range) {
    const soundingMidi = (p: Pitch) => pitchMidi(p) - source.semitones + interval.semitones;
    const byId = new Map(events.map(({ event }) => [event.id, event]));
    const outside = (midis: number[]) => ({ below: midis.some((m) => m < range.low), above: midis.some((m) => m > range.high) });
    for (const phrase of phrases(part)) {
      const midis = phrase.eventIds.flatMap((id) => (byId.get(id)?.notes ?? []).map((n) => soundingMidi(n.pitch)));
      const { below, above } = outside(midis);
      if (below && above) {
        diagnostics.push(`range: ${where(phrase.eventIds)} is out of ${span} both ways; not moved`);
        continue;
      }
      if (!below && !above) continue;
      const shift = below ? 12 : -12;
      for (const id of phrase.eventIds) shifts.set(id, shift);
      const after = outside(midis.map((m) => m + shift));
      if (after.below || after.above) diagnostics.push(`range: ${where(phrase.eventIds)} is still out of ${span} after moving ${shift > 0 ? '8va' : '8vb'}`);
    }
  }

  const chains = tieChains(events);
  const overrideFor = (id: string): Shift | undefined => {
    const owner = (chains.get(id) ?? [id]).find((e) => overrides[e] !== undefined);
    return owner === undefined ? undefined : overrides[owner];
  };

  const moved: Record<string, 12 | -12> = {};
  const fitted = structuredClone(part);
  for (const { event, measure } of partEvents(fitted)) {
    if (!event.notes?.length) continue;
    const concert = options.keyByMeasure(measure).fifths;
    const written = (shift: number) => event.notes!.map((n) => {
      const sounding = spell(n.pitch, toSounding, writtenKeyFifths(concert, interval), diagnostics, n.id);
      const octaved = { ...sounding, octave: sounding.octave + shift / 12 };
      return transposing ? spell(octaved, target.transposition, writtenKeyFifths(concert, add(interval, target.transposition)), diagnostics, n.id) : octaved;
    });
    let shift = overrideFor(event.id) ?? shifts.get(event.id) ?? 0;
    let pitches = written(shift);
    if (shift !== 0 && pitches.some((p) => p.octave < 0 || p.octave > 9)) {
      diagnostics.push(`range: event ${event.id} in part ${part.name} cannot move ${shift > 0 ? '8va' : '8vb'} past octave ${shift > 0 ? 9 : 0}; not moved`);
      shift = 0;
      pitches = written(0);
    }
    if (shift !== 0) moved[event.id] = shift as 12 | -12;
    event.notes.forEach((n, i) => { n.pitch = pitches[i]; });
  }
  return { part: fitted, moved, diagnostics };
}

function spell(pitch: Pitch, t: Transposition, keyFifths: number, diagnostics: string[], noteId: string): Pitch {
  const result = transposePitchSpelled(pitch, t, keyFifths);
  if (result.respelled) diagnostics.push(`spelling: note ${noteId} needs more than a double accidental; respelled`);
  return result.pitch;
}
