// The instrument switch's view of a score: a pure Score-model transform run after `scoreForView`. Each switched part
// is fitted at its final sounding pitch (after `semitones` and the key flip) and rewritten as the target instrument,
// so playback, note names and the timeline read what the MEI pass engraves from the same result (`staves`).
import { INSTRUMENTS as MODEL, pitchMidi, transposePitchSpelled, writtenKeyFifths, writtenPitch, type InstrumentClef, type InstrumentId, type Level, type SpelledPitch, type Transposition as ModelTransposition } from './instrument-model';
import { applyOverrides, joinRuns, planShifts, tieChainOf, type FitEvent, type Shift } from './range-fit-core';
import { gmProgramForNumber, type KeyMode, type Measure, type Part, type Pitch, type Score, type ScoreNote } from './score';
import { keyFromFifths, spellChordSymbol } from './spelling';
import { foldFifths, intervalFifths, moveChordSymbol, respellLine, type Interval, type LineNote } from './notation/respell';
import { generatedEngraving, generatedPitchId } from './notation/document';
import { soundingMidi } from './transpose';

/** The part all staves of one source part share: the MusicXML <score-part id>, or the part's own id for ABC/MIDI. */
export const sourcePartOf = (part: Part): string => part.sourcePartId ?? part.id;

/**
 * The playback sound a reader picked for a switched part (the mixer's Sound grid, like `Part.instrument` and
 * `gmSoundfont`: the GM sound's icon id and FluidR3 name; no `gmSoundfont` with `instrument: 'drum-kit'` = the kit).
 */
export type PartSound = { instrument: InstrumentId; gmSoundfont?: string };
/**
 * A reader's switch for one staff part: `instrument` undefined = as written; `octaves` keyed by `ScoreNote.id`;
 * `sound` overrides the target's main sound (only while switched; cleared when the instrument changes).
 */
export type PartSwitch = { instrument?: InstrumentId; level: Level; autoRange: boolean; octaves: Record<string, 12 | -12>; sound?: PartSound };
/**
 * The MEI pass's view of one switched (or octave-moved) staff: `shift` = [diatonic, semitones] from the baseline MEI
 * (the source's written pitch, after the global interval) to the pitch shown; `octaves` keyed by MEI note id.
 */
export type StaffSwitch = { shift: [number, number]; clef?: InstrumentClef; octaves: Record<string, 12 | -12> };
/**
 * What the MEI pass needs of one staff of a switched view (carried on `Score.instrumentView`): its `StaffSwitch` and,
 * for a switched part, its keys [measure index, fifths, mode] before the global transposition (the source's written
 * keys moved by `shift`), as `SpellingSpec` staves take them.
 */
export type EngravedSwitch = StaffSwitch & { keys?: [number, number, KeyMode][] };
export type InstrumentViewResult = {
  score: Score;
  /** `ScoreNote.id`s moved by an octave (auto-fit or the reader's). */
  moved: string[];
  /** `ScoreNote.id`s still outside the level's range (switched parts), or moved outside it (unswitched parts). */
  outOfRange: string[];
  /** Keyed by part id. */
  staves: Record<string, StaffSwitch>;
  /**
   * TAB parts doubling a switched or octave-moved part (their frets are stale). The renderer reads the same from
   * `score.instrumentView` (tab/tab-parts.ts `planTab`): regenerated while the part is a guitar, else hidden.
   */
  hiddenTab: string[];
};

/**
 * Whether the switch is offered for a part: never for the drum kit or percussion, nor for TAB staves. Judged on the
 * part as imported: a Sound pick (`withPickedSound`) changes `instrument` but never what can be switched.
 */
export const switchablePart = (part: Part): boolean => part.clef !== 'percussion' && (part.importedInstrument ?? part.instrument) !== 'drum-kit' && !part.tab && !part.tabOf;

/**
 * A part playing a picked sound (the mixer's Sound grid or a saved record): its icon id, GM program and FluidR3 name,
 * with the instrument it was imported as kept in `importedInstrument`.
 */
export const withPickedSound = (part: Part, sound: { instrument: InstrumentId; gmProgram?: number; gmSoundfont?: string }): Part =>
  ({ ...part, importedInstrument: part.importedInstrument ?? part.instrument, instrument: sound.instrument, gmProgram: sound.gmProgram, gmSoundfont: sound.gmSoundfont });

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

/**
 * Respell a switched part's pitches in place as the MEI pass does: each voice one line across measures, in each
 * measure's (shown) key, a tie's end taking its start's spelling.
 */
function respellLines(measures: Measure[]): void {
  const lines = new Map<string, { pitch: Pitch; tieStart: boolean; input: LineNote }[]>();
  for (const measure of measures) {
    const key = keyFromFifths(foldFifths(measure.key ?? 0), measure.keyMode ?? 'major');
    for (const note of byStart(measure)) {
      if (!pitched(note)) continue;
      const voice = note.voice || '1';
      const line = lines.get(voice) ?? lines.set(voice, []).get(voice)!;
      for (const p of note.pitches) {
        if (p.unpitched) continue;
        const source = { step: p.step as SpelledPitch['step'], octave: p.octave, alter: p.alter };
        const midi = pitchMidi(source);
        let tiedFrom: number | undefined;
        if (p.tieStop || (note.pitches.length === 1 && note.tieStop)) for (let back = line.length - 1; back >= 0 && back >= line.length - 8; back--) {
          if (line[back].input.midi === midi && line[back].tieStart) { tiedFrom = back; break; }
        }
        line.push({ pitch: p, tieStart: !!(p.tieStart || (note.pitches.length === 1 && note.tieStart)), input: { midi, source, key, chord: note.pitches.length > 1, tiedFrom } });
      }
    }
  }
  for (const line of lines.values()) respellLine(line.map(entry => entry.input)).forEach((result, index) => {
    const { pitch } = line[index];
    pitch.step = result.step; pitch.octave = result.octave; pitch.alter = result.alter;
  });
}

/** The reader's transposition (sounding minus written, MusicXML's sign) of a model transposition (written minus sounding). */
const partTransposition = (t: ModelTransposition) => (t.semitones ? { semitones: -t.semitones, diatonic: -t.diatonic } : undefined);
/** Sounding minus written of a measure of the source part as it stands in the view (none at concert basis). */
function sourceInterval(part: Part, measure: Measure | undefined): Interval {
  const t = part.clef === 'percussion' || part.pitchBasis === 'concert' ? undefined : measure?.transposition || part.transposition;
  return t?.semitones ? { diatonic: t.diatonic ?? Math.round(t.semitones * 7 / 12), chromatic: t.semitones } : { diatonic: 0, chromatic: 0 };
}

/** A part at sounding pitch without its transposition, so `soundingMidi` reads its MIDI as is. */
const withoutTransposition = (part: Part): Part => ({ ...part, transposition: undefined, measures: part.measures.map(measure => (measure.transposition ? { ...measure, transposition: undefined } : measure)) });

/**
 * Switches parts of a Score view (`scoreForView`'s result) to other instruments and applies the reader's octave
 * moves. Each part is treated on its own (a grand staff's callers set one `PartSwitch` on every staff). For every
 * note of every part, `soundingMidi(outPart, measure, pitch, 0)` is its judged pitch (sounding, after the view's
 * transposition) plus its octave shift: a concert view's transposing parts (already at sounding pitch) lose their
 * transposition, switched or not. A switched part is written for the target instrument in the written view, at
 * sounding pitch in the concert view. A target without a pitched clef or ranges (the drum kit) is treated as written.
 *
 * The view is the Score's own (`score.pitchView.view`); `scorePitch` only applies to a Score no view was made of.
 * Throws when `score` already carries an instrument view: apply it once, to `scoreForView`'s result (a second pass
 * would stack the shifts).
 */
export function applyInstrumentView(score: Score, switches: Record<string, PartSwitch>, scorePitch: 'written' | 'concert'): InstrumentViewResult {
  if (score.instrumentView) throw new Error('applyInstrumentView: the Score already has an instrument view; apply it to the scoreForView result once');
  const view = score.pitchView?.view ?? scorePitch;
  const moved: string[] = [];
  const outOfRange: string[] = [];
  const staves: Record<string, StaffSwitch> = {};
  const viewMoved = new Set(score.pitchView?.view === 'concert' ? score.pitchView.viewMoved : []);
  // The MEI ids octave moves are keyed by: the pitch's source id, or for an engraving made from the Score (ABC, MIDI)
  // the id `scoreToMei` gave it (notation/document.ts).
  const generated = generatedEngraving(score.document);
  const meiIdOf = (note: ScoreNote, index: number) => (generated || !note.pitches[index].sourceId ? generatedPitchId(note, index) : note.pitches[index].sourceId!);

  const parts = score.parts.map(input => {
    // A concert view's transposing part is at sounding pitch: without its transposition, playback reads it as shown.
    const atSounding = viewMoved.has(input.id);
    const part = atSounding ? withoutTransposition(input) : input;
    const choice = switches[part.id];
    if (!choice || !switchablePart(input)) return part;
    const model = choice.instrument ? MODEL[choice.instrument] : undefined;
    const target = model && model.clef !== 'percussion' && model.ranges ? model : undefined;
    const judged = (measure: Measure, p: Pitch) => soundingMidi(part, measure, p, 0);

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
        note.pitches.forEach((p, index) => { if (!p.unpitched) octaves[meiIdOf(note, index)] = shift; });
      }
      // Unswitched parts are as written: only the reader's moves are flagged.
      if (out && (target || shift)) outOfRange.push(id);
    }

    // Known limitation: the MEI shift is the first measure's; a mid-score `measure.transposition` change in a switched
    // part is not reflected in `StaffSwitch.shift` (the Score pitches below do follow it per measure).
    const own = sourceInterval(input, input.measures[0]);
    if (!target) {
      if (!Object.keys(octaves).length) return part;
      // The baseline MEI is written pitch; a concert view's own move of the staff stays.
      staves[part.id] = { shift: atSounding ? [own.diatonic, own.chromatic] : [0, 0], octaves };
      return { ...part, measures: part.measures.map(measure => ({ ...measure, notes: measure.notes.map(note => {
        const shift = shifts[note.id];
        return shift ? { ...note, pitches: note.pitches.map(p => (p.unpitched ? p : { ...p, octave: p.octave + shift / 12, midi: p.midi + shift, ...(p.displayOctave !== undefined ? { displayOctave: p.displayOctave + shift / 12 } : {}) })) } : note;
      }) })) };
    }

    // Rewrite as the target: written pitch and key in the written view, sounding pitch in the concert view.
    const written = view === 'written';
    const shown: ModelTransposition = written ? target.transposition : { semitones: 0, diatonic: 0 };
    staves[part.id] = { shift: [shown.diatonic + own.diatonic, shown.semitones + own.chromatic], clef: target.clef, octaves };
    const measures = part.measures.map(measure => {
      // The view's key is the source's shown key; at concert pitch it is the sounding key unless the part is written.
      const source = sourceInterval(part, measure);
      const concertFifths = foldFifths((measure.key ?? part.key ?? score.key) + intervalFifths(source));
      const fifths = written ? writtenKeyFifths(concertFifths, target.transposition) : concertFifths;
      const mode = measure.keyMode ?? part.keyMode ?? score.keyMode ?? 'major';
      // Chord symbols move from the view's pitch to the shown one (sounding, then the target's written interval).
      const symbolMove: Interval[] = [source, { diatonic: shown.diatonic, chromatic: shown.semitones }];
      return { ...measure, key: fifths, keyMode: mode, clef: undefined, transposition: undefined, notes: measure.notes.map(note => {
        const shift = shifts[note.id] ?? 0;
        return { ...note, transposition: undefined,
          pitches: note.pitches.map(p => {
            if (p.unpitched) return p;
            // The source spelling moved by the interval (view pitch -> sounding -> target written, plus the octave);
            // spelled afresh from MIDI only where that passes a double accidental or the source spelling is unusable.
            const midi = judged(measure, p) + shift + shown.semitones;
            const interval = { diatonic: source.diatonic + shown.diatonic + (shift / 12) * 7, semitones: source.chromatic + shown.semitones + shift };
            const carried = transposePitchSpelled({ step: p.step as SpelledPitch['step'], octave: p.octave, alter: p.alter }, interval, fifths).pitch;
            const spelled = pitchMidi(carried) === midi && Math.abs(carried.alter) < 2 ? carried : writtenPitch(judged(measure, p) + shift, shown, fifths);
            return { ...p, ...spelled, midi, accidental: undefined, cautionary: undefined };
          }),
          chordSymbol: note.chordSymbol ? spellChordSymbol(moveChordSymbol(note.chordSymbol, symbolMove), keyFromFifths(foldFifths(fifths), mode)) : undefined,
        };
      }) };
    });
    // Where the MEI pass respells the staff (it moves, or the view is transposed or flipped), the Score takes the same
    // key-relative line spelling (notation/respell.ts), so note names match the engraved noteheads.
    const [steps, semis] = staves[part.id].shift;
    if (steps || semis || score.pitchView?.interval || score.pitchView?.semitones || score.pitchView?.flip) respellLines(measures);
    return { ...part, instrument: target.id, gmProgram: target.gmProgram, gmSoundfont: gmProgramForNumber(target.gmProgram)?.soundfont, clef: target.clef,
      pitchBasis: 'written' as const, transposition: written ? partTransposition(target.transposition) : undefined,
      key: measures[0]?.key ?? part.key, keyMode: measures[0]?.keyMode ?? part.keyMode, measures };
  });
  // A TAB staff doubling a switched or octave-moved part (every such part has a `staves` entry) no longer matches its frets.
  const hiddenTab = score.parts.filter(part => part.tabOf && staves[part.tabOf]).map(part => part.id);
  // The renderer reads the staves from the Score (transpose.ts `spellingSpecFor`), so the engraving follows this view.
  // A switched staff's keys come from the source as written (the view's source, else this Score: `scoreForView` drops
  // `instrumentView` whenever it moves pitches, so a Score carrying one is never a view's source here).
  const asWritten = score.pitchView?.source ?? score;
  const engraved: Record<string, EngravedSwitch> = {};
  for (const [id, entry] of Object.entries(staves)) {
    const source = asWritten.parts.find(part => part.id === id);
    if (!entry.clef || !source) { engraved[id] = entry; continue; }
    const keys: [number, number, KeyMode][] = [];
    const move = intervalFifths({ diatonic: entry.shift[0], chromatic: entry.shift[1] });
    source.measures.forEach((measure, index) => {
      const fifths = (measure.key ?? source.key ?? asWritten.key) + move;
      const mode = measure.keyMode ?? source.keyMode ?? asWritten.keyMode ?? 'major';
      const last = keys.at(-1);
      if (!last || last[1] !== fifths || last[2] !== mode) keys.push([index, fifths, mode]);
    });
    engraved[id] = { ...entry, ...(keys.length ? { keys } : {}) };
  }
  const instrumentView = Object.keys(engraved).length ? { staves: engraved } : undefined;
  return { score: { ...score, parts, instrumentView }, moved, outOfRange, staves, hiddenTab };
}
