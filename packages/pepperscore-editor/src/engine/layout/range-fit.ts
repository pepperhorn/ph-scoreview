import { pitchMidi, transposePitchSpelled, writtenKeyFifths, type InstrumentInfo, type RangeLevel, type Transposition } from '../../model/instruments';
import { applyOverrides, joinRuns, planShifts, tieChainOf, type FitEvent, type Shift } from 'pepperscore/instruments';
import { eventStarts } from '../../model/query';
import type { Event, Key, Part, Pitch } from '../../model/schema';

export type Phrase = { eventIds: string[] };
export type { Shift };

const CONCERT: Transposition = { semitones: 0, diatonic: 0 };

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
  const events = partEvents(part);
  for (const { event } of events) for (const slur of event.slurs ?? []) slurEnds.add(slur.target);

  const runs: string[][] = [];
  let current: string[] | undefined;
  let where = '';
  for (const { event, measure, sequence } of events) {
    if (`${measure}/${sequence}` !== where) { current = undefined; where = `${measure}/${sequence}`; }
    if (event.rest || !event.notes?.length) { current = undefined; continue; }
    if (!current) { current = []; runs.push(current); }
    current.push(event.id);
    if (slurEnds.has(event.id)) current = undefined;
  }

  return joinRuns(runs, tiePairs(events)).map((eventIds) => ({ eventIds }));
}

/** Every tie as (event holding the tied note, event owning its target note), in event order. */
function tiePairs(events: { event: Event }[]): [string, string][] {
  const noteOwner = new Map<string, string>();
  for (const { event } of events) for (const n of event.notes ?? []) noteOwner.set(n.id, event.id);
  const ties: [string, string][] = [];
  for (const { event } of events)
    for (const n of event.notes ?? []) {
      const owner = n.tie && noteOwner.get(n.tie.target);
      if (owner) ties.push([event.id, owner]);
    }
  return ties;
}

export type FitOptions = {
  /** The concert key in force in bar `i` (used only to spell notes that cannot keep their spelling). */
  keyByMeasure: (i: number) => Key;
  target: InstrumentInfo;
  level: RangeLevel;
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

  let shifts: Record<string, Shift> = {};
  if (autoRange && range) {
    const soundingMidi = (p: Pitch) => pitchMidi(p) - source.semitones + interval.semitones;
    const byId = new Map(events.map(({ event }) => [event.id, event]));
    const fitEvents = (ids: string[]): FitEvent[] => ids.map((id) => ({ id, midi: (byId.get(id)?.notes ?? []).map((n) => soundingMidi(n.pitch)) }));
    const phraseIds = phrases(part).map((p) => p.eventIds);
    const plan = planShifts(phraseIds.map(fitEvents), range, true);
    shifts = plan.shifts;
    // Report in phrase order, keyed by each phrase's first event.
    const bothWays = new Set(plan.bothWays.map((ids) => ids[0]));
    const stillOut = new Set(plan.stillOut.map((ids) => ids[0]));
    for (const ids of phraseIds) {
      if (bothWays.has(ids[0])) diagnostics.push(`range: ${where(ids)} is out of ${span} both ways; not moved`);
      else if (stillOut.has(ids[0])) diagnostics.push(`range: ${where(ids)} is still out of ${span} after moving ${shifts[ids[0]] > 0 ? '8va' : '8vb'}`);
    }
  }
  shifts = applyOverrides(shifts, overrides, tieChainOf(tiePairs(events), events.map(({ event }) => event.id)));

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
    let shift = shifts[event.id] ?? 0;
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
