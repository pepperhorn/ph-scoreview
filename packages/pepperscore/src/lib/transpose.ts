import { GM_SOUNDS, pitch, type KeyMode, type Measure, type Part, type Pitch, type Score, type Transposition } from './score';
import { enharmonicFlip, keyFromFifths, spellChordSymbol, transposeInterval, spellingProfileFor, type SpellingKey, type SpellingProfile } from './spelling';
import type { SpellingSpec } from './notation/mei-spelling';
import { foldFifths, intervalFifths, moveChordSymbol, parseInterval, respellLine, transposeSpelled, viewKey, type Interval, type LineNote } from './notation/respell';

export type ScorePitchView = 'written' | 'concert';

/**
 * How a Score view was transposed and spelled (set by `scoreForView`); the renderer hands the same plan to the Verovio
 * worker (`spellingSpecFor`), so the engraving and the Score's note names agree.
 */
export type PitchView = {
  view: ScorePitchView;
  semitones: number;
  flip: boolean;
  /** The Verovio interval with quality for the transposition (spelling.ts `planTranspose`). */
  interval: string;
  /** Part ids whose pitch the view itself moves (transposing parts at concert pitch). */
  viewMoved: string[];
  /** The Score this view was made from. */
  source: Score;
};

export function transposeKey(fifths: number, semitones: number): number {
  if (!semitones) return fifths;
  const next = fifths + semitones * 7;
  return ((next + 6) % 12 + 12) % 12 - 6;
}

function sourceTransposition(part: Part, measure: Measure | undefined): Transposition {
  return measure?.transposition || part.transposition || { semitones: 0 };
}

export function soundingMidi(part: Part, measure: Measure, note: Pitch, semitones: number): number {
  if (part.clef === 'percussion') return note.midi;
  return note.midi + semitones + (part.pitchBasis === 'concert' ? 0 : sourceTransposition(part, measure).semitones);
}

/** The interval a view moves a measure of a part by: written to sounding pitch in the concert view, else none. */
function viewInterval(part: Part, measure: Measure | undefined, view: ScorePitchView): Interval {
  const transposition = sourceTransposition(part, measure);
  if (!transposition.semitones || part.pitchBasis === 'concert' || view !== 'concert') return { diatonic: 0, chromatic: 0 };
  return { diatonic: transposition.diatonic ?? Math.round(transposition.semitones * 7 / 12), chromatic: transposition.semitones };
}
const movedByView = (part: Part, view: ScorePitchView) => part.clef !== 'percussion' && (part.measures.length ? part.measures : [undefined]).some(measure => viewInterval(part, measure, view).chromatic !== 0);

/** A part's spelling profile in a view: its instrument's in the written view; one global (neutral) key at concert pitch. */
export function viewProfile(part: Part, view: ScorePitchView): SpellingProfile {
  if (view === 'concert') return 'neutral';
  return spellingProfileFor({ instrument: part.instrument, family: GM_SOUNDS.find(sound => sound.program !== null && sound.program === part.gmProgram)?.family });
}

const sameMidi = (a: Pitch, midi: number) => a.midi === midi;
/**
 * A Score as a view shows it: written or concert pitch, transposed by `semitones` and optionally spelled in the
 * enharmonic key. Spelling follows docs/specs/transpose-and-spelling.md through the same plan the Verovio worker uses
 * (notation/respell.ts), so note names match the engraved noteheads. Percussion is never moved.
 */
export function scoreForView(score: Score, view: ScorePitchView, semitones: number, flip = false): Score {
  const viewMoved = score.parts.filter(part => movedByView(part, view)).map(part => part.id);
  if (!semitones && !flip && !viewMoved.length) return score;
  // A flip only applies while the reference key has an enharmonic equivalent (or the score is transposed).
  if (flip && !semitones && !enharmonicFlip(referencePlan(score, view, 0, false).source)) flip = false;
  if (!semitones && !flip && !viewMoved.length) return score;
  const { source, key: target } = referencePlan(score, view, semitones, flip);
  const interval = transposeInterval(source.tonic, target.tonic, semitones);
  const global = parseInterval(interval);
  const pitchView: PitchView = { view, semitones, flip, interval, viewMoved, source: score };
  return { ...score, pitchView, parts: score.parts.map(part => {
    const moved = viewMoved.includes(part.id);
    if (part.clef === 'percussion' || (!moved && !semitones && !flip && !interval)) return part;
    const staff = { profile: viewProfile(part, view), moved };
    // Keys per measure, then every voice respelled as one line across measures.
    const measureKeys = part.measures.map(measure => {
      const shift = viewInterval(part, measure, view);
      return viewKey((measure.key ?? part.key ?? score.key) + intervalFifths(shift), semitones, measure.keyMode ?? part.keyMode ?? score.keyMode ?? 'major', staff, flip);
    });
    const lines = new Map<string, { measure: number; note: number; pitch: number; input: LineNote }[]>();
    part.measures.forEach((measure, measureIndex) => {
      const shift = viewInterval(part, measure, view);
      const order = measure.notes.map((note, index) => ({ note, index })).sort((a, b) => a.note.start - b.note.start);
      for (const { note, index } of order) {
        if (note.rest || !note.pitches.length) continue;
        const line = lines.get(note.voice || '1') ?? lines.set(note.voice || '1', []).get(note.voice || '1')!;
        note.pitches.forEach((source, pitchIndex) => {
          if (source.unpitched) return;
          const spelled = transposeSpelled(transposeSpelled({ step: source.step, alter: source.alter, octave: source.octave }, shift), global);
          const midi = source.midi + shift.chromatic + semitones;
          let tiedFrom: number | undefined;
          if (source.tieStop || note.tieStop) for (let back = line.length - 1; back >= 0 && back >= line.length - 8; back--) {
            const previous = part.measures[line[back].measure].notes[line[back].note].pitches[line[back].pitch];
            if (sameMidi({ ...previous, midi: line[back].input.midi }, midi) && (previous.tieStart || part.measures[line[back].measure].notes[line[back].note].tieStart)) { tiedFrom = back; break; }
          }
          line.push({ measure: measureIndex, note: index, pitch: pitchIndex, input: { midi, source: spelled, key: measureKeys[measureIndex], chord: note.pitches.length > 1, tiedFrom } });
        });
      }
    });
    const spelled = new Map<string, Pitch>();
    for (const line of lines.values()) {
      respellLine(line.map(entry => entry.input)).forEach((result, index) => {
        const entry = line[index];
        spelled.set(`${entry.measure}|${entry.note}|${entry.pitch}`, pitch(result.step, result.octave, result.alter));
      });
    }
    const measures = part.measures.map((measure, measureIndex) => {
      const key = measureKeys[measureIndex];
      const intervals = [viewInterval(part, measure, view), global];
      return { ...measure, key: key.fifths, keyMode: key.mode, notes: measure.notes.map((note, noteIndex) => ({
        ...note,
        pitches: note.pitches.map((source, pitchIndex) => {
          const result = spelled.get(`${measureIndex}|${noteIndex}|${pitchIndex}`);
          return result ? { ...source, ...result, accidental: undefined, cautionary: undefined } : source;
        }),
        chordSymbol: note.chordSymbol ? spellChordSymbol(moveChordSymbol(note.chordSymbol, intervals), key) : undefined,
      })) };
    });
    return { ...part, key: measures[0]?.key ?? part.key, keyMode: measures[0]?.keyMode ?? part.keyMode, measures };
  }) };
}

/**
 * The worker's spelling plan for a Score view (`scoreForView`'s result, optionally instrument-switched by
 * `applyInstrumentView`) with its staff numbers: the same interval, flip, per-staff profiles and moved staves, which
 * staves are percussion (never given a key signature), and the switched staves' shift, clef and octave moves.
 */
export function spellingSpecFor(score: Score, staffOf: Map<string, string>): SpellingSpec {
  const pitchView = score.pitchView;
  const view = pitchView?.view ?? 'written';
  const staves: SpellingSpec['staves'] = {};
  // The parts as written before the view (and the switch): the view's source, else the Score the switch was applied to.
  const original = pitchView?.source ?? score.instrumentView?.base;
  for (const part of score.parts) {
    const n = staffOf.get(part.id);
    if (!n) continue;
    if (part.clef === 'percussion') { staves[n] = { profile: 'neutral', moved: false, percussion: true }; continue; }
    // The part's keys in this view before the transposition (its written keys, or sounding keys at concert pitch).
    const source = original?.parts.find(item => item.id === part.id) ?? part;
    // A switched staff moves by the switch's shift from the baseline (the source's written pitch); it replaces the
    // concert view's own move, which it already includes. Its keys are the source's moved by the same interval.
    const switched = score.instrumentView?.staves[part.id];
    const switchShift = switched?.clef ? { diatonic: switched.shift[0], chromatic: switched.shift[1] } : undefined;
    const keys: [number, number, KeyMode][] = [];
    source.measures.forEach((measure, index) => {
      const fifths = (measure.key ?? source.key ?? score.key) + intervalFifths(switchShift ?? viewInterval(source, measure, view));
      const mode = measure.keyMode ?? source.keyMode ?? score.keyMode ?? 'major';
      const last = keys.at(-1);
      if (!last || last[1] !== fifths || last[2] !== mode) keys.push([index, fifths, mode]);
    });
    const moved = !!pitchView?.viewMoved.includes(part.id) || !!switchShift?.chromatic || !!switchShift?.diatonic;
    const shift = switchShift ?? (moved ? viewInterval(source, source.measures[0], view) : undefined);
    const octaves = switched && Object.keys(switched.octaves).length ? { octaves: switched.octaves } : {};
    staves[n] = { profile: viewProfile(part, view), moved, ...(keys.length ? { keys } : {}),
      ...(shift?.chromatic || shift?.diatonic ? { shift: [shift.diatonic, shift.chromatic] as [number, number] } : {}),
      ...octaves, ...(switched?.clef ? { clef: switched.clef } : {}) };
  }
  return { interval: pitchView?.interval ?? '', semitones: pitchView?.semitones ?? 0, concert: !!pitchView?.viewMoved.length, flip: !!pitchView?.flip, staves };
}

/** The key of a measure in a (view) Score, for app-side pitch text such as inferred chord symbols. */
export function measureKey(part: Part, measure: Measure, score: Score): SpellingKey {
  return keyFromFifths(foldFifths(measure.key ?? part.key ?? score.key), measure.keyMode ?? part.keyMode ?? score.keyMode ?? 'major');
}

export type TransposeReadout = {
  /** The reference key shown (the first pitched part's key in this view after transposition and flip). */
  key: SpellingKey;
  /** The enharmonic key the flip button would switch to, or null when the key has none (button disabled). */
  flipTo: SpellingKey | null;
  /** Header readout, e.g. "+2 · D", "0 · C", "-3 · Am". */
  text: string;
};

/**
 * The reference key of a score view: the first pitched part's opening key in the view before transposition (`source`,
 * folded into -7..7) and the key it is shown in after the transposition and flip (`key`, as that staff is engraved).
 */
export function referencePlan(score: Score, view: ScorePitchView, semitones: number, flip: boolean): { source: SpellingKey; key: SpellingKey } {
  const part = score.parts.find(item => item.clef !== 'percussion');
  const first = part?.measures[0];
  const fifths = (first?.key ?? part?.key ?? score.key) + (part ? intervalFifths(viewInterval(part, first, view)) : 0);
  const mode = first?.keyMode ?? part?.keyMode ?? score.keyMode ?? 'major';
  const staff = { profile: part ? viewProfile(part, view) : 'neutral' as SpellingProfile, moved: !!part && movedByView(part, view) };
  return { source: keyFromFifths(foldFifths(fifths), mode), key: viewKey(fifths, semitones, mode, staff, flip) };
}

/** Header/drawer readout for a transposition and key flip ("+2 · D") and the key the flip offers. */
export function transposeReadout(score: Score, view: ScorePitchView, semitones: number, flip: boolean): TransposeReadout {
  const { key } = referencePlan(score, view, semitones, flip);
  const name = (item: SpellingKey) => `${item.tonic}${item.mode === 'minor' ? 'm' : ''}`;
  return { key, flipTo: enharmonicFlip(key), text: `${semitones > 0 ? '+' : ''}${semitones} · ${name(key)}` };
}

/** Spoken key name for labels: 'G flat major', 'D sharp minor'. */
export function spokenKey(key: SpellingKey): string {
  const accidental = key.tonic.slice(1) === '#' ? ' sharp' : key.tonic.slice(1) === 'b' ? ' flat' : '';
  return `${key.tonic.charAt(0)}${accidental} ${key.mode}`;
}
