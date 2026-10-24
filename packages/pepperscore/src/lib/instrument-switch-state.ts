// The reader's instrument switch state around `applyInstrumentView` (instrument-view.ts): host settings and saved
// records to per-staff-part switches, the pitch view rule for concert-basis scores, and what playback and the
// highlights read from a switched view. Pure; PepperScore.tsx holds the state.
import { isLevel, isSwitchTarget, type PartState } from './file-state';
import { INSTRUMENT_IDS, INSTRUMENTS, type InstrumentId, type Level } from './instrument-model';
import { applyInstrumentView, sourcePartOf, switchablePart, type InstrumentViewResult, type PartSound, type PartSwitch } from './instrument-view';
import type { BaseTimeline } from './playback/timeline';
import { gmProgramForSoundfont, type Part, type Score } from './score';
import { soundingMidi } from './transpose';

export const DEFAULT_RANGE_LEVEL: Level = 'intermediate';
/** The instruments a pitched part can be switched to: the model's, in its order, without the drum kit. */
export const SWITCH_TARGETS: InstrumentId[] = INSTRUMENT_IDS.filter(isSwitchTarget);
/** The instrument keys of `PepperScoreSettings`. */
export type InstrumentSettings = { instrument?: InstrumentId; instruments?: Record<string, InstrumentId>; rangeLevel?: Level; autoRange?: boolean };
export type SwitchDefaults = { level: Level; autoRange: boolean };
type Switches = Record<string, PartSwitch>;


/** Source parts in score order, numbered from 1 by the host (TAB doublings excluded), with their staff parts. */
export function sourcePartsOf(score: Score): { id: string; parts: Part[]; switchable: boolean }[] {
  const sources = new Map<string, Part[]>();
  for (const part of score.parts) if (!part.tabOf) (sources.get(sourcePartOf(part)) ?? sources.set(sourcePartOf(part), []).get(sourcePartOf(part))!).push(part);
  return [...sources].map(([id, parts]) => ({ id, parts, switchable: parts.some(switchablePart) }));
}

export const switchDefaults = (settings: InstrumentSettings): SwitchDefaults => ({
  level: isLevel(settings.rangeLevel) ? settings.rangeLevel : DEFAULT_RANGE_LEVEL,
  autoRange: typeof settings.autoRange === 'boolean' ? settings.autoRange : true,
});

/** The host's instrument per source part id: `instrument` for the first switchable source part, `instruments` (1-based numbers) over it. */
function chosenInstruments(score: Score, settings: InstrumentSettings): Map<string, InstrumentId> {
  const sources = sourcePartsOf(score);
  const chosen = new Map<string, InstrumentId>();
  const first = sources.find(source => source.switchable);
  if (first && isSwitchTarget(settings.instrument)) chosen.set(first.id, settings.instrument);
  for (const [key, id] of Object.entries(settings.instruments ?? {})) {
    const source = /^\d+$/.test(key) ? sources[Number(key) - 1] : undefined;
    if (source?.switchable && isSwitchTarget(id)) chosen.set(source.id, id);
  }
  return chosen;
}

/** As written with the defaults and no octave moves: no entry needed. */
const plain = (entry: PartSwitch, defaults: SwitchDefaults) => !entry.instrument && !entry.sound && !Object.keys(entry.octaves).length && entry.level === defaults.level && entry.autoRange === defaults.autoRange;

/**
 * Change one source part's switch on every staff part it has (a grand staff switches together). Choosing an
 * instrument (or As written) drops a picked sound: the instrument's main sound plays again.
 */
export function withSourceSwitch(score: Score, switches: Switches, sourcePart: string, patch: Partial<Omit<PartSwitch, 'octaves'>>, defaults: SwitchDefaults): Switches {
  if (patch.instrument !== undefined && !isSwitchTarget(patch.instrument)) return switches;
  const out = { ...switches };
  for (const part of score.parts) {
    if (sourcePartOf(part) !== sourcePart || part.tabOf || !switchablePart(part)) continue;
    const entry: PartSwitch = { ...(out[part.id] ?? { instrument: undefined, ...defaults, octaves: {} }), ...patch };
    if ('instrument' in patch) delete entry.sound;
    if (plain(entry, defaults)) delete out[part.id]; else out[part.id] = entry;
  }
  return out;
}

/** Set the reader's octave moves (by `ScoreNote.id`) of one staff part. */
export function withOctaves(switches: Switches, partId: string, octaves: Record<string, 12 | -12>, defaults: SwitchDefaults): Switches {
  const entry = { ...(switches[partId] ?? { instrument: undefined, ...defaults, octaves: {} }), octaves: { ...octaves } };
  const out = { ...switches };
  if (plain(entry, defaults)) delete out[partId]; else out[partId] = entry;
  return out;
}

/**
 * A Sound pick on a staff part: while the part is switched it only overrides the instrument's main sound (the switch
 * itself is kept); undefined when the part is not switched (the pick then changes the part's own sound).
 */
export function withSound(switches: Switches, partId: string, sound: PartSound): Switches | undefined {
  const entry = switches[partId];
  if (!entry?.instrument) return undefined;
  return { ...switches, [partId]: { ...entry, sound: { instrument: sound.instrument, ...(sound.gmSoundfont ? { gmSoundfont: sound.gmSoundfont } : {}) } } };
}

/** The host's settings as switches (a score without a saved record). */
export function switchesFromSettings(score: Score, settings: InstrumentSettings): Switches {
  const defaults = switchDefaults(settings);
  let out: Switches = {};
  for (const [source, instrument] of chosenInstruments(score, settings)) out = withSourceSwitch(score, out, source, { instrument }, defaults);
  return out;
}

/** A host settings change: only the changed keys are applied again (the reader's other choices stay). */
export function applyHostSwitchChange(score: Score, current: Switches, previous: InstrumentSettings, next: InstrumentSettings): Switches {
  const defaults = switchDefaults(next);
  const before = chosenInstruments(score, previous), after = chosenInstruments(score, next);
  let out = current;
  for (const source of sourcePartsOf(score)) {
    if (before.get(source.id) !== after.get(source.id)) out = withSourceSwitch(score, out, source.id, { instrument: after.get(source.id) }, defaults);
  }
  const level = previous.rangeLevel !== next.rangeLevel && isLevel(next.rangeLevel) ? next.rangeLevel : undefined;
  const autoRange = previous.autoRange !== next.autoRange && typeof next.autoRange === 'boolean' ? next.autoRange : undefined;
  if (level !== undefined || autoRange !== undefined) out = Object.fromEntries(Object.entries(out).map(([id, entry]) => [id, { ...entry, ...(level ? { level } : {}), ...(autoRange !== undefined ? { autoRange } : {}) }]));
  return out;
}

/**
 * Switches restored from a saved record's parts (already validated by file-state.ts). The staves of a source part
 * switch together, so they are normalised to its first staff with a saved switch (instrument, level, fit): a staff
 * whose switch differs or was dropped takes it, keeping its own octave moves (and its sound when the instrument matches).
 */
export function switchesFromSaved(score: Score, parts: Record<string, PartState>): Switches {
  const out: Switches = {};
  for (const source of sourcePartsOf(score)) {
    const staves = source.parts.filter(switchablePart);
    const lead = staves.map(part => parts[part.id]?.switch).find(Boolean);
    if (!lead) continue;
    for (const part of staves) {
      const saved = parts[part.id]?.switch;
      const sound = saved?.sound && saved.instrument === lead.instrument && lead.instrument ? { sound: { ...saved.sound } } : {};
      out[part.id] = { instrument: lead.instrument, level: lead.level, autoRange: lead.autoRange, octaves: { ...saved?.octaves }, ...sound };
    }
  }
  return out;
}

/**
 * The saved pitch view to restore. A concert-basis score used to be forced to (and saved as) concert pitch while no
 * part was switched to a transposing instrument, so a saved 'concert' there was never the reader's choice: it opens as
 * 'written', and a later switch to a B♭/E♭ instrument shows its written pitch.
 */
export function restoredScorePitch(score: Score, switches: Switches, saved: 'written' | 'concert'): 'written' | 'concert' {
  return saved === 'concert' && readerPitch(score, switches, saved).forcedConcert ? 'written' : saved;
}

/** Whether a part is switched to an instrument whose written pitch differs from its sounding pitch. */
const switchedToTransposing = (part: Part, switches: Switches) => {
  const target = switches[part.id]?.instrument;
  return !!target && switchablePart(part) && INSTRUMENTS[target].transposition.semitones !== 0;
};

/**
 * The pitch view the reader shows. Verovio can only move written pitch to sounding, so a concert-basis score is shown
 * at concert pitch, unless a part is switched to a transposing instrument (it shows its written pitch by default).
 */
export function readerPitch(score: Score, switches: Switches, preferred: 'written' | 'concert') {
  const concertBasis = score.parts.some(part => part.pitchBasis === 'concert');
  const switchedTransposing = score.parts.some(part => switchedToTransposing(part, switches));
  const forcedConcert = concertBasis && !switchedTransposing;
  const hasTransposingParts = switchedTransposing || score.parts.some(part => part.transposition?.semitones || part.measures.some(measure => measure.transposition?.semitones));
  return { scorePitch: forcedConcert ? 'concert' as const : preferred, concertBasis, forcedConcert, switchedTransposing, hasTransposingParts };
}

/** The switched view of `scoreForView`'s result (the switch runs last); with no switches, that result itself. */
export function switchedView(viewed: Score, switches: Switches, scorePitch: 'written' | 'concert'): InstrumentViewResult {
  if (!Object.keys(switches).length) return { score: viewed, moved: [], outOfRange: [], staves: {}, hiddenTab: [] };
  return applyInstrumentView(viewed, switches, scorePitch);
}

/** Internal highlights of a switched view, applied before the host's. */
export function switchHighlights(view: InstrumentViewResult): { ids: string[]; className: string }[] {
  return [{ ids: view.moved, className: 'ps-transposed' }, { ids: view.outOfRange, className: 'ps-out-of-range' }].filter(item => item.ids.length);
}

/**
 * The performance with the switched (or octave-moved) parts' events at the view's sounding pitch. The base timeline
 * is the source score's, at 0 semitones (playback adds `semitones`), so every other part keeps its events as before;
 * the view's pitches already include `semitones`, so they are taken back out here.
 */
export function switchedTimeline(base: BaseTimeline, view: InstrumentViewResult, semitones: number): BaseTimeline {
  if (!Object.keys(view.staves).length) return base;
  const midi = new Map<string, number>();
  for (const part of view.score.parts) {
    if (!view.staves[part.id]) continue;
    const shift = part.clef === 'percussion' ? 0 : semitones;
    for (const measure of part.measures) for (const note of measure.notes) note.pitches.forEach((p, index) => {
      if (!p.unpitched) midi.set(`${note.id}:${index}`, soundingMidi(part, measure, p, 0) - shift);
    });
  }
  return { ...base, events: base.events.map(event => {
    const value = midi.get(`${event.noteId}:${event.pitchIndex}`);
    return value === undefined || value === event.midi ? event : { ...event, midi: value };
  }) };
}

/**
 * Parts to play with: a part switched to an instrument plays the target's sound (the view part's), or the sound the
 * reader picked for it while switched (`PartSwitch.sound`).
 */
export function switchedSoundParts(parts: Part[], view: InstrumentViewResult, switches: Switches): Part[] {
  if (!parts.some(part => switches[part.id]?.instrument)) return parts;
  const shown = new Map(view.score.parts.map(part => [part.id, part]));
  return parts.map(part => {
    const entry = switches[part.id];
    if (!entry?.instrument) return part;
    if (entry.sound) return { ...part, instrument: entry.sound.instrument, gmProgram: entry.sound.gmSoundfont ? gmProgramForSoundfont(entry.sound.gmSoundfont) : undefined, gmSoundfont: entry.sound.gmSoundfont };
    const target = shown.get(part.id);
    return target ? { ...part, instrument: target.instrument, gmProgram: target.gmProgram, gmSoundfont: target.gmSoundfont } : part;
  });
}
