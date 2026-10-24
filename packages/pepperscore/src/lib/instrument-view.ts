// The instrument switch's view of a score: a pure Score-model transform run after `scoreForView`. Each switched part
// is fitted at its final sounding pitch (after `semitones` and the key flip) and rewritten as the target instrument,
// so playback, note names and the timeline read what the MEI pass engraves from the same result (`staves`).
import { INSTRUMENTS as MODEL, writtenKeyFifths, writtenPitch, type InstrumentClef, type InstrumentId, type Level, type Transposition as ModelTransposition } from './instrument-model';
import { applyOverrides, joinRuns, planShifts, tieChainOf, type FitEvent, type Shift } from './range-fit-core';
import { gmProgramForNumber, type Measure, type Part, type Pitch, type Score, type ScoreNote } from './score';
import { keyFromFifths, spellChordSymbol } from './spelling';
import { foldFifths, intervalFifths, moveChordSymbol, type Interval } from './notation/respell';
import { soundingMidi } from './transpose';

/** The part all staves of one source part share: the MusicXML <score-part id>, or the part's own id for ABC/MIDI. */
export const sourcePartOf = (part: Part): string => part.sourcePartId ?? part.id;

/** A reader's switch for one staff part: `instrument` undefined = as written; `octaves` keyed by `ScoreNote.id`. */
export type PartSwitch = { instrument?: InstrumentId; level: Level; autoRange: boolean; octaves: Record<string, 12 | -12> };
/**
 * The MEI pass's view of one switched (or octave-moved) staff: `shift` = [diatonic, semitones] from the baseline MEI
 * (the source's written pitch, after the global interval) to the pitch shown; `octaves` keyed by MEI note id.
 */
export type StaffSwitch = { shift: [number, number]; clef?: InstrumentClef; octaves: Record<string, 12 | -12> };
export type InstrumentViewResult = {
  score: Score;
  /** `ScoreNote.id`s moved by an octave (auto-fit or the reader's). */
  moved: string[];
  /** `ScoreNote.id`s still outside the level's range (switched parts), or moved outside it (unswitched parts). */
  outOfRange: string[];
  /** Keyed by part id. */
  staves: Record<string, StaffSwitch>;
  /** TAB parts doubling a switched part (hidden while it is switched). */
  hiddenTab: string[];
};

/** Whether the switch is offered for a part: never for the drum kit or percussion, nor for TAB staves. */
export const switchablePart = (part: Part): boolean => part.clef !== 'percussion' && part.instrument !== 'drum-kit' && !part.tab && !part.tabOf;

const pitched = (note: ScoreNote) => !note.rest && note.pitches.some(p => !p.unpitched);
const byStart = (measure: Measure) => [...measure.notes].sort((a, b) => a.start - b.start);

/**
 * Tie pairs [from, to] of note ids: a tie-start pitch to the next same-MIDI tie-stop pitch in the same voice, across
 * bar lines (keyed like playback's ties, `voice:midi`). A one-pitch note's own tie flags count for its pitch.
 */
function tiesOf(part: Part): [string, string][] {
  const open = new Map<string, string>();
  const ties: [string, string][] = [];
  for (const measure of part.measures) for (const note of byStart(measure)) {
    if (!pitched(note)) continue;
    const single = note.pitches.length === 1;
    for (const p of note.pitches) {
      const key = `${note.voice || '1'}:${p.midi}`;
      const from = open.get(key);
      if ((p.tieStop || (single && note.tieStop)) && from !== undefined) { if (from !== note.id) ties.push([from, note.id]); open.delete(key); }
      if (p.tieStart || (single && note.tieStart)) open.set(key, note.id);
    }
  }
  return ties;
}

/** Runs of pitched notes per voice per measure, broken at rests and after a slur end, joined across ties. */
export function phrasesOf(part: Part): string[][] {
  const runs: string[][] = [];
  for (const measure of part.measures) {
    const current = new Map<string, string[]>();
    const close = (voice: string) => { const run = current.get(voice); if (run?.length) runs.push(run); current.delete(voice); };
    for (const note of byStart(measure)) {
      const voice = note.voice || '1';
      if (!pitched(note)) { close(voice); continue; }
      (current.get(voice) ?? current.set(voice, []).get(voice)!).push(note.id);
      if (note.slurStop?.length) close(voice);
    }
    for (const voice of [...current.keys()]) close(voice);
  }
  return joinRuns(runs, tiesOf(part));
}

/** The reader's transposition (sounding minus written, MusicXML's sign) of a model transposition (written minus sounding). */
const partTransposition = (t: ModelTransposition) => (t.semitones ? { semitones: -t.semitones, diatonic: -t.diatonic } : undefined);
/** Sounding minus written of a measure of the source part as it stands in the view (none at concert basis). */
function sourceInterval(part: Part, measure: Measure | undefined): Interval {
  const t = part.clef === 'percussion' || part.pitchBasis === 'concert' ? undefined : measure?.transposition || part.transposition;
  return t?.semitones ? { diatonic: t.diatonic ?? Math.round(t.semitones * 7 / 12), chromatic: t.semitones } : { diatonic: 0, chromatic: 0 };
}

/**
 * Switches parts of a Score view (`scoreForView`'s result) to other instruments and applies the reader's octave
 * moves. Each part is treated on its own (a grand staff's callers set one `PartSwitch` on every staff). For every
 * note, `soundingMidi(outPart, measure, pitch, 0)` is its judged pitch (sounding, after the view's transposition)
 * plus its octave shift; a switched part is written for the target instrument in the written view, at sounding
 * pitch in the concert view.
 */
export function applyInstrumentView(score: Score, switches: Record<string, PartSwitch>, scorePitch: 'written' | 'concert'): InstrumentViewResult {
  const moved: string[] = [];
  const outOfRange: string[] = [];
  const staves: Record<string, StaffSwitch> = {};
  const switched = (id: string) => { const part = score.parts.find(item => item.id === id); return !!part && switchablePart(part) && !!switches[id]?.instrument; };
  const hiddenTab = score.parts.filter(part => part.tabOf && switched(part.tabOf)).map(part => part.id);
  const viewMoved = new Set(score.pitchView?.view === 'concert' ? score.pitchView.viewMoved : []);

  const parts = score.parts.map(part => {
    const choice = switches[part.id];
    if (!choice || !switchablePart(part)) return part;
    const target = choice.instrument ? MODEL[choice.instrument] : undefined;
    // A concert view already moved a transposing part to sounding pitch (keeping its transposition), so its MIDI is judged as is.
    const atSounding = viewMoved.has(part.id);
    const judged = (measure: Measure, p: Pitch) => (atSounding ? p.midi : soundingMidi(part, measure, p, 0));

    // Fit: phrases at judged pitch against the target's range, then the reader's overrides along tie chains.
    const notes = new Map<string, { note: ScoreNote; measure: Measure }>();
    for (const measure of part.measures) for (const note of byStart(measure)) if (pitched(note)) notes.set(note.id, { note, measure });
    const midiOf = (id: string) => { const { note, measure } = notes.get(id)!; return note.pitches.filter(p => !p.unpitched).map(p => judged(measure, p)); };
    const phrases: FitEvent[][] = phrasesOf(part).map(phrase => phrase.map(id => ({ id, midi: midiOf(id) })));
    const range = (target ?? MODEL[part.instrument])?.ranges?.[choice.level];
    const plan = planShifts(phrases, range, !!target && choice.autoRange);
    const overrides = Object.fromEntries(Object.entries(choice.octaves ?? {}).filter(([id, value]) => notes.has(id) && (value === 12 || value === -12))) as Record<string, Shift>;
    const shifts = applyOverrides(plan.shifts, overrides, tieChainOf(tiesOf(part), [...notes.keys()]));
    const octaves: Record<string, 12 | -12> = {};
    for (const [id, { note }] of notes) {
      const shift = shifts[id] ?? 0;
      const out = !!range && midiOf(id).some(m => m + shift < range.low || m + shift > range.high);
      if (shift) {
        moved.push(id);
        for (const p of note.pitches) if (p.sourceId && !p.unpitched) octaves[p.sourceId] = shift;
      }
      // Unswitched parts are as written: only the reader's moves are flagged.
      if (out && (target || shift)) outOfRange.push(id);
    }

    const own = sourceInterval(part, part.measures[0]);
    if (!target) {
      if (!Object.keys(octaves).length) return part;
      // The baseline MEI is written pitch; a concert view's own move of the staff stays.
      staves[part.id] = { shift: atSounding ? [own.diatonic, own.chromatic] : [0, 0], octaves };
      // At sounding pitch the transposition is dropped, so playback reads the shown MIDI as is.
      const sounding = atSounding ? { transposition: undefined } : {};
      return { ...part, ...sounding, measures: part.measures.map(measure => ({ ...measure, ...sounding, notes: measure.notes.map(note => {
        const shift = shifts[note.id];
        return shift ? { ...note, pitches: note.pitches.map(p => (p.unpitched ? p : { ...p, octave: p.octave + shift / 12, midi: p.midi + shift, ...(p.displayOctave !== undefined ? { displayOctave: p.displayOctave + shift / 12 } : {}) })) } : note;
      }) })) };
    }

    // Rewrite as the target: written pitch and key in the written view, sounding pitch in the concert view.
    const written = scorePitch === 'written';
    const shown: ModelTransposition = written ? target.transposition : { semitones: 0, diatonic: 0 };
    staves[part.id] = { shift: [shown.diatonic + own.diatonic, shown.semitones + own.chromatic], clef: target.clef, octaves };
    const measures = part.measures.map(measure => {
      // The view's key is the source's shown key; at concert pitch it is the sounding key unless the part is written.
      const source = atSounding ? { diatonic: 0, chromatic: 0 } : sourceInterval(part, measure);
      const concertFifths = foldFifths((measure.key ?? part.key ?? score.key) + intervalFifths(source));
      const fifths = written ? writtenKeyFifths(concertFifths, target.transposition) : concertFifths;
      const mode = measure.keyMode ?? part.keyMode ?? score.keyMode ?? 'major';
      // Chord symbols move from the view's pitch to the shown one (sounding, then the target's written interval).
      const symbolMove: Interval[] = [source, { diatonic: shown.diatonic, chromatic: shown.semitones }];
      return { ...measure, key: fifths, keyMode: mode, clef: undefined, transposition: undefined, notes: measure.notes.map(note => {
        const shift = shifts[note.id] ?? 0;
        return { ...note, transposition: undefined,
          pitches: note.pitches.map(p => {
            if (p.unpitched || note.rest) return p;
            const spelled = writtenPitch(judged(measure, p) + shift, shown, fifths);
            return { ...p, ...spelled, midi: judged(measure, p) + shift + shown.semitones, accidental: undefined, cautionary: undefined };
          }),
          chordSymbol: note.chordSymbol ? spellChordSymbol(moveChordSymbol(note.chordSymbol, symbolMove), keyFromFifths(foldFifths(fifths), mode)) : undefined,
        };
      }) };
    });
    return { ...part, instrument: target.id, gmProgram: target.gmProgram, gmSoundfont: gmProgramForNumber(target.gmProgram)?.soundfont, clef: target.clef,
      pitchBasis: 'written' as const, transposition: written ? partTransposition(target.transposition) : undefined,
      key: measures[0]?.key ?? part.key, keyMode: measures[0]?.keyMode ?? part.keyMode, measures };
  });
  return { score: { ...score, parts }, moved, outOfRange, staves, hiddenTab };
}
