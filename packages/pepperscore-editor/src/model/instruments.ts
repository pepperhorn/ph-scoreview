// The instrument model lives in pepperscore core (`pepperscore/instruments`); this keeps the editor's import sites and public API.
export {
  INSTRUMENT_IDS, LEVELS, INSTRUMENTS, instrumentName, instrumentFor, pitchMidi, keyAlter, spellMidi,
  writtenPitch, transposePitchSpelled, transposePitch, writtenKeyFifths, spelledSoundingMidi as soundingMidi,
} from 'pepperscore/instruments';
export type { InstrumentId, RangeLevel, Transposition, InstrumentInfo } from 'pepperscore/instruments';
