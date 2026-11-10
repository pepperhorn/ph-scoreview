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

const namedFretted = (name: string): TabInstrument | undefined => {
  if (/\b(?:ukulele|ukelele)\b/i.test(name)) {
    if (/\bbaritone\b/i.test(name)) return 'ukulele-baritone';
    if (/\bbass\b/i.test(name)) return 'ukulele-bass';
    return /\btenor\b/i.test(name) ? 'ukulele-tenor' : 'ukulele-soprano';
  }
  if (/\b(?:double[ -]?bass|contrabass|upright bass)\b/i.test(name)) return 'double-bass';
  if (/\b(?:bass[ -]?guitar|(?:electric|acoustic|fretless)[ -]+bass|e-bass)\b/i.test(name)) return 'bass4';
  if (/\bguitar\b/i.test(name)) return 'guitar';
};

/** Programs are authoritative; names only refine fretted strings or identify a part without a program. */
export function stringInstrument(part: Part, override?: TabInstrument | 'none', switched = false): TabInstrument | undefined {
  if (part.tab || part.clef === 'percussion') return;
  // A reader instrument switch replaces the host's initial TAB identity, as well as its source name.
  if (!switched) {
    if (override === 'none') return;
    if (validTabInstrument(override)) return override;
  }
  const name = switched ? '' : part.name;
  const gm = part.gmProgram;
  if (gm !== undefined) {
    if (gm >= 25 && gm <= 40) return namedFretted(name) ?? (gm <= 32 ? 'guitar' : 'bass4');
    if (gm === 41) return 'violin';
    if (gm === 42) return 'viola';
    if (gm === 43) return 'cello';
    if (gm === 44) return 'double-bass';
    return;
  }
  const fretted = namedFretted(name);
  if (fretted) return fretted;
  if (/\b(?:violin|fiddle)\b/i.test(name)) return 'violin';
  if (/\bviola\b/i.test(name)) return 'viola';
  if (/\bcello\b/i.test(name)) return 'cello';
}

/** Overrides use the exact part id reported by onReady; unknown keys/values are ignored. */
export function instrumentFor(score: TabScore, part: Part, switched = false) {
  return stringInstrument(part, score.tabSettings?.instruments?.[part.id], switched);
}
