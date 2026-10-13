import { measureTicks } from './durations';
import type { Beam, Document, Event, PartMeasure, Pitch, Sequence } from './schema';
import { effectiveTime, eventStarts, sequenceFor, sequenceTicks, staffCount } from './query';

const STAFF_LIMIT = 4;
/** Tuplet-scaled ticks can be fractional; compare bar lengths within this tolerance. */
const TICK_EPSILON = 1e-6;

const samePitch = (a: Pitch, b: Pitch) => a.step === b.step && a.octave === b.octave && a.alter === b.alter;

function isFullMeasureRestOnly(seq: Sequence): boolean {
  const [only] = seq.content;
  return seq.content.length === 1 && only.type === 'event' && only.fullMeasure === true;
}

export type BeamIssue = { kind: 'outside' } | { kind: 'non-consecutive' } | { kind: 'long'; eventId: string };

/**
 * Why `beam` breaks the beam invariant in `pm` (bar of `barTicks`): its events must be
 * consecutive events of one sequence, each shorter than a quarter. Undefined when valid.
 */
export function beamIssue(pm: PartMeasure, beam: Beam, barTicks: number): BeamIssue | undefined {
  const seq = pm.sequences.find((s) => eventStarts(s, barTicks).some((e) => e.event.id === beam.events[0]));
  const starts = seq ? eventStarts(seq, barTicks) : [];
  const positions = beam.events.map((id) => starts.findIndex((s) => s.event.id === id));
  if (beam.events.length < 2 || positions.some((p) => p < 0)) return { kind: 'outside' };
  if (positions.some((p, i) => i > 0 && p !== positions[i - 1] + 1)) return { kind: 'non-consecutive' };
  const long = positions.map((p) => starts[p]).find((s) => s.ticks >= 960 - TICK_EPSILON);
  return long ? { kind: 'long', eventId: long.event.id } : undefined;
}

export const beamIsValid = (pm: PartMeasure, beam: Beam, barTicks: number): boolean => beamIssue(pm, beam, barTicks) === undefined;

/** Structural checks the editor relies on; each message is `"<code>: <detail>"`. Returns [] when valid. */
/** `maxStaves` is the staff cap (default 4; a licence may raise it). */
export function checkInvariants(doc: Document, { maxStaves = STAFF_LIMIT }: { maxStaves?: number } = {}): string[] {
  const errors: string[] = [];
  const globals = doc.global.measures;

  for (const part of doc.parts) {
    if (part.measures.length !== globals.length) {
      errors.push(`measure-count: part ${part.name} has ${part.measures.length} measures, expected ${globals.length}`);
    }

    const partEventIds = new Set<string>();
    for (const pm of part.measures) for (const seq of pm.sequences) for (const s of eventStarts(seq)) partEventIds.add(s.event.id);

    part.measures.forEach((pm, mi) => {
      const where = `part ${part.name} measure ${mi + 1}`;
      const expected = measureTicks(effectiveTime(doc, mi));

      for (const seq of pm.sequences) {
        if (isFullMeasureRestOnly(seq)) continue;
        const actual = sequenceTicks(seq, expected);
        if (Math.abs(actual - expected) > TICK_EPSILON) {
          errors.push(`bar-length: ${where} staff ${seq.staff} voice ${seq.voice} has ${actual} ticks, expected ${expected}`);
        }
      }

      for (const beam of pm.beams) {
        const issue = beamIssue(pm, beam, expected);
        if (issue?.kind === 'outside') errors.push(`beam-events: beam ${beam.id} in ${where} references events outside one sequence`);
        else if (issue?.kind === 'non-consecutive') errors.push(`beam-events: beam ${beam.id} in ${where} has non-consecutive events`);
        else if (issue?.kind === 'long') errors.push(`beam-events: beam ${beam.id} includes event ${issue.eventId} of a quarter or longer`);
      }

      for (const seq of pm.sequences) {
        const starts = eventStarts(seq);
        starts.forEach(({ event }, i) => {
          for (const note of event.notes ?? []) {
            if (!note.tie) continue;
            let next: Event | undefined = starts[i + 1]?.event;
            if (!next && mi + 1 < part.measures.length) {
              const following = sequenceFor(part.measures[mi + 1], seq.staff, seq.voice);
              next = following ? eventStarts(following)[0]?.event : undefined;
            }
            const target = next?.notes?.find((n) => n.id === note.tie!.target);
            if (!target || !samePitch(target.pitch, note.pitch)) {
              errors.push(`tie-target: note ${note.id} in ${where} ties to ${note.tie.target}, which is not an equal pitch in the next event`);
            }
          }
          for (const slur of event.slurs ?? []) {
            if (!partEventIds.has(slur.target)) {
              errors.push(`slur-target: slur ${slur.id} in ${where} targets ${slur.target}, not an event of the part`);
            }
          }
        });
      }
    });
  }

  globals.forEach((g, i) => {
    if (!g.ending) return;
    for (let j = i; j >= 0; j--) {
      if (globals[j].repeatStart) return;
      if (j < i && globals[j].repeatEnd && !globals[j].ending) break;
    }
    errors.push(`ending-after-repeat: ending in measure ${i + 1} has no preceding repeat start`);
  });

  const jumps = globals.map((g) => g.jump).filter((j) => j !== undefined);
  if (jumps.some((j) => j.target === 'coda')) {
    if (!globals.some((g) => g.toCoda)) errors.push('jump-targets: a jump to the coda needs a To Coda mark');
    if (!globals.some((g) => g.coda)) errors.push('jump-targets: a jump to the coda needs a coda');
  }
  if (jumps.some((j) => j.type === 'ds') && !globals.some((g) => g.segno)) {
    errors.push('jump-targets: a D.S. jump needs a segno');
  }
  if (globals.some((g) => g.fine) && !jumps.some((j) => j.target === 'fine')) {
    errors.push('jump-targets: Fine needs a jump targeting fine');
  }

  const staves = staffCount(doc);
  if (staves > maxStaves) errors.push(`staff-cap: ${staves} staves, limit ${maxStaves}`);

  return errors;
}
