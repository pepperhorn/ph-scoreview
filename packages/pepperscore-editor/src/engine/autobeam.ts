import { measureTicks } from '../model/durations';
import { newId } from '../model/ids';
import { eventStarts } from '../model/query';
import type { Beam, Event, PartMeasure, Sequence, Time } from '../model/schema';
import { TICK_EPSILON } from './sequence-edit';

type Start = { event: Event; tick: number; ticks: number };

/** Notes and chords shorter than a quarter; rests and grace notes are never beamed. */
export const beamable = (s: Start): boolean => !s.event.rest && !s.event.grace && s.ticks < 960 - TICK_EPSILON;

/**
 * Ticks per beaming beat: compound meters (x/8, x/16 with a count divisible by 3) beam in
 * dotted beats; otherwise a quarter for x/4 and x/8, an eighth for x/16, the unit for x/2 and x/1.
 */
export function beatTicks(time: Time): number {
  const unitTicks = 3840 / time.unit;
  if (time.unit >= 8 && time.count % 3 === 0) return unitTicks * 3;
  if (time.unit === 8) return 960;
  return unitTicks;
}

/**
 * Beams for `seq` in a bar of `time`: consecutive beamable events within one beat form a beam
 * (rests, quarters and beat-crossing events break it). In 4/4, two beats of plain eighths in
 * the same half bar join into one beam of four.
 */
export function autoBeam(seq: Sequence, time: Time): Beam[] {
  const beat = beatTicks(time);
  const groups: { beat: number; starts: Start[] }[] = [];
  let run: Start[] = [];
  let runBeat = -1;
  const flush = () => {
    if (run.length > 1) groups.push({ beat: runBeat, starts: run });
    run = [];
  };
  for (const s of eventStarts(seq, measureTicks(time))) {
    const first = Math.floor((s.tick + TICK_EPSILON) / beat);
    const last = Math.floor((s.tick + s.ticks - TICK_EPSILON) / beat);
    if (!beamable(s) || first !== last) {
      flush();
      continue;
    }
    if (run.length && first !== runBeat) flush();
    runBeat = first;
    run.push(s);
  }
  flush();

  const plainEighthBeat = (g: { starts: Start[] }) => g.starts.length === 2 && g.starts.every((s) => Math.abs(s.ticks - 480) < TICK_EPSILON);
  const merged: Start[][] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i], h = groups[i + 1];
    if (time.count === 4 && time.unit === 4 && h && g.beat % 2 === 0 && h.beat === g.beat + 1 && plainEighthBeat(g) && plainEighthBeat(h)) {
      merged.push([...g.starts, ...h.starts]);
      i++;
    } else merged.push(g.starts);
  }
  return merged.map((starts) => ({ id: newId(), events: starts.map((s) => s.event.id) }));
}

/**
 * Replaces the beams of `pm` that touch `seq` with `beams`, keeping other sequences' beams.
 * A new beam over the same events as an old one keeps the old one (and its id).
 */
export function replaceSequenceBeams(pm: PartMeasure, seq: Sequence, beams: Beam[], barTicks: number): void {
  const ids = new Set(eventStarts(seq, barTicks).map((s) => s.event.id));
  const touching = pm.beams.filter((b) => b.events.some((id) => ids.has(id)));
  const same = (a: Beam, b: Beam) => a.events.length === b.events.length && a.events.every((id, i) => id === b.events[i]);
  if (touching.length === beams.length && touching.every((b, i) => same(b, beams[i]))) return;
  const kept = pm.beams.filter((b) => !touching.includes(b));
  pm.beams = [...kept, ...beams.map((b) => touching.find((old) => same(old, b)) ?? b)];
}

export const applyAutoBeam = (pm: PartMeasure, seq: Sequence, time: Time): void => replaceSequenceBeams(pm, seq, autoBeam(seq, time), measureTicks(time));

/** Splits the beams of `pm` that touch `seq` at its rests, dropping pieces of fewer than two events. */
export function splitBeamsAtRests(pm: PartMeasure, seq: Sequence, barTicks: number): void {
  const rests = new Set(eventStarts(seq, barTicks).filter((s) => s.event.rest).map((s) => s.event.id));
  if (!pm.beams.some((b) => b.events.some((id) => rests.has(id)))) return;
  const out: Beam[] = [];
  for (const beam of pm.beams) {
    if (!beam.events.some((id) => rests.has(id))) {
      out.push(beam);
      continue;
    }
    let run: string[] = [];
    for (const id of [...beam.events, '']) {
      if (id && !rests.has(id)) run.push(id);
      else {
        if (run.length > 1) out.push({ id: newId(), events: run });
        run = [];
      }
    }
  }
  pm.beams = out;
}
