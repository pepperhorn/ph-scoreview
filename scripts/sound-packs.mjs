import { fileURLToPath } from 'node:url';

/** FluidR3 sounds shipped in pepperscore-sounds-core; every other program falls back to TimGM6mb at runtime. */
export const CORE_FLUIDR3 = [
  'acoustic_grand_piano', 'electric_piano_1', 'acoustic_guitar_nylon', 'acoustic_guitar_steel', 'electric_guitar_clean',
  'electric_guitar_jazz', 'acoustic_bass', 'electric_bass_finger', 'string_ensemble_1', 'violin', 'cello', 'flute',
  'clarinet', 'alto_sax', 'tenor_sax', 'trumpet', 'trombone', 'choir_aahs', 'voice_oohs',
];
export const COMPLETE_DIR = fileURLToPath(new URL('../packages/pepperscore-sounds-complete/', import.meta.url));
export const CORE_DIR = fileURLToPath(new URL('../packages/pepperscore-sounds-core/', import.meta.url));
