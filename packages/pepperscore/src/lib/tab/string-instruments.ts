import type { Part, Score } from '../score';

/** TAB instrument identity is independent of the playback sound (ukuleles use nylon guitar). */
export const STRING_INSTRUMENTS = {
  guitar: { kind: 'fretted', tuning: [40, 45, 50, 55, 59, 64] },
  bass4: { kind: 'fretted', tuning: [28, 33, 38, 43] },
  bass5: { kind: 'fretted', tuning: [23, 28, 33, 38, 43] },
  'ukulele-soprano': { kind: 'fretted', tuning: [67, 60, 64, 69] },
  'ukulele-tenor': { kind: 'fretted', tuning: [67, 60, 64, 69] },
  'ukulele-baritone': { kind: 'fretted', tuning: [50, 55, 59, 64] },
  'ukulele-bass': { kind: 'fretted', tuning: [28, 33, 38, 43] },
  violin: { kind: 'finger', tuning: [55, 62, 69, 76] },
  viola: { kind: 'unsupported', tuning: [48, 55, 62, 69] },
  cello: { kind: 'finger', tuning: [36, 43, 50, 57] },
  'double-bass': { kind: 'unsupported', tuning: [28, 33, 38, 43] },
} as const;
export type TabInstrument = keyof typeof STRING_INSTRUMENTS;
export type TabInstruments = Record<string, TabInstrument | 'none'>;
export const validTabInstrument = (id: unknown): id is TabInstrument =>
  typeof id === 'string' && Object.hasOwn(STRING_INSTRUMENTS, id);

/** Render metadata travels with the score through the existing render/PDF planning paths. */
export type TabScore = Score & { tabSettings?: { instruments?: TabInstruments; tuning?: number[] } };
export function withTabSettings(score: Score, instruments?: TabInstruments, tuning?: number[]): TabScore {
  return { ...score, tabSettings: { instruments, tuning } };
}

/** Explicit identity/name wins over a generic GM sound, especially acoustic bass (GM 33). */
export function stringInstrument(part: Part, override?: TabInstrument | 'none', switched = false): TabInstrument | undefined {
  if (part.tab || part.clef === 'percussion') return;
  if (override === 'none') return;
  if (validTabInstrument(override)) return override;
  const name = switched ? '' : part.name;
  if (/ukulele|ukelele/i.test(name)) {
    if (/baritone/i.test(name)) return 'ukulele-baritone';
    if (/bass/i.test(name)) return 'ukulele-bass';
    return /tenor/i.test(name) ? 'ukulele-tenor' : 'ukulele-soprano';
  }
  if (/double[ -]?bass|contrabass|upright bass/i.test(name) || (part.instrument === 'double-bass' && (switched || part.gmProgram === undefined || part.gmProgram < 33 || part.gmProgram > 40))) return 'double-bass';
  if (/viola/i.test(name) || part.instrument === 'viola') return 'viola';
  if (/violin|fiddle/i.test(name) || part.instrument === 'violin') return 'violin';
  if (/cello/i.test(name) || part.instrument === 'cello') return 'cello';
  if (/bass/i.test(name) || part.instrument === 'bassguitar') return 'bass4';
  if (/guitar/i.test(name) || part.instrument === 'guitar') return 'guitar';
  if (part.gmProgram !== undefined && part.gmProgram >= 33 && part.gmProgram <= 40) return 'bass4';
  if (part.gmProgram !== undefined && part.gmProgram >= 25 && part.gmProgram <= 32) return 'guitar';
}

/** Overrides use the exact part id reported by onReady; unknown keys/values are ignored. */
export function instrumentFor(score: TabScore, part: Part, switched = false) {
  return stringInstrument(part, score.tabSettings?.instruments?.[part.id], switched);
}
