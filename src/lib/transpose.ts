import { pitch, type Measure, type Part, type Pitch, type Score, type Transposition } from './score';

export type ScorePitchView = 'written' | 'concert';
const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const sharpOrder = 'FCGDAEB';
const flatOrder = 'BEADGCF';

export function transposeKey(fifths: number, semitones: number): number {
  if (!semitones) return fifths;
  const next = fifths + semitones * 7;
  return ((next + 6) % 12 + 12) % 12 - 6;
}

function keyAlter(step: string, fifths: number): number {
  return fifths > 0 && sharpOrder.slice(0, fifths).includes(step) ? 1 : fifths < 0 && flatOrder.slice(0, -fifths).includes(step) ? -1 : 0;
}

function spellMidi(midi: number, fifths: number): Pitch {
  const octave = Math.floor(midi / 12) - 1;
  let best: Pitch | null = null;
  let bestCost = Infinity;
  for (const candidateOctave of [octave - 1, octave, octave + 1]) for (const step of steps) {
    const alter = midi - pitch(step, candidateOctave).midi;
    if (Math.abs(alter) > 2) continue;
    const cost = Math.abs(alter - keyAlter(step, fifths)) * 4 + Math.abs(alter) * .2 + (fifths < 0 && alter > 0 || fifths > 0 && alter < 0 ? .1 : 0);
    if (cost < bestCost) { best = pitch(step, candidateOctave, alter); bestCost = cost; }
  }
  return best || pitch('C', octave, midi - pitch('C', octave).midi);
}

function shiftPitch(source: Pitch, semitones: number, diatonic: number | undefined, key: number): Pitch {
  if (!semitones && !diatonic) return source;
  const midi = source.midi + semitones;
  if (diatonic !== undefined) {
    const index = steps.indexOf(source.step) + diatonic;
    const octave = source.octave + Math.floor(index / 7);
    const step = steps[((index % 7) + 7) % 7];
    const alter = midi - pitch(step, octave).midi;
    if (Math.abs(alter) <= 2) return pitch(step, octave, alter);
  }
  return spellMidi(midi, key);
}

function noteName(source: Pitch): string { return `${source.step}${source.alter > 0 ? '#'.repeat(source.alter) : 'b'.repeat(-source.alter)}`; }

function shiftChordSymbol(symbol: string, shift: (source: Pitch) => Pitch): string {
  const root = /^([A-G])([#b♯♭]?)(.*)$/.exec(symbol);
  if (!root) return symbol;
  const asPitch = (step: string, accidental: string) => pitch(step, 4, accidental === '#' || accidental === '♯' ? 1 : accidental === 'b' || accidental === '♭' ? -1 : 0);
  const suffix = root[3].replace(/\/([A-G])([#b♯♭]?)/g, (_, step: string, accidental: string) => `/${noteName(shift(asPitch(step, accidental)))}`);
  return noteName(shift(asPitch(root[1], root[2]))) + suffix;
}

function sourceTransposition(part: Part, measure: Measure): Transposition {
  return measure.transposition || part.transposition || { semitones: 0 };
}

export function soundingMidi(part: Part, measure: Measure, note: Pitch, semitones: number): number {
  if (part.clef === 'percussion') return note.midi;
  return note.midi + semitones + (part.pitchBasis === 'concert' ? 0 : sourceTransposition(part, measure).semitones);
}

export function scoreForView(score: Score, view: ScorePitchView, semitones: number): Score {
  if (!semitones && score.parts.every(part => !part.transposition?.semitones && !part.measures.some(measure => measure.transposition?.semitones))) return score;
  return { ...score, parts: score.parts.map(part => {
    if (part.clef === 'percussion') return part;
    const sourceKey = part.key ?? score.key;
    const firstTranspose = sourceTransposition(part, part.measures[0]);
    const viewShift = view === 'concert' && part.pitchBasis !== 'concert' ? firstTranspose.semitones : view === 'written' && part.pitchBasis === 'concert' ? -firstTranspose.semitones : 0;
    const key = transposeKey(transposeKey(sourceKey, viewShift), semitones);
    return { ...part, key, measures: part.measures.map(measure => {
      const transposition = sourceTransposition(part, measure);
      const viewSemitones = view === 'concert' && part.pitchBasis !== 'concert' ? transposition.semitones : view === 'written' && part.pitchBasis === 'concert' ? -transposition.semitones : 0;
      const diatonic = viewSemitones ? (view === 'concert' ? transposition.diatonic : transposition.diatonic === undefined ? undefined : -transposition.diatonic) : undefined;
      const viewKey = transposeKey(sourceKey, viewSemitones);
      const noteKey = transposeKey(viewKey, semitones);
      const shift = (source: Pitch) => shiftPitch(shiftPitch(source, viewSemitones, diatonic, viewKey), semitones, undefined, noteKey);
      return { ...measure, notes: measure.notes.map(note => ({ ...note, pitches: note.pitches.map(shift), chordSymbol: note.chordSymbol ? shiftChordSymbol(note.chordSymbol, shift) : undefined })) };
    }) };
  }) };
}
