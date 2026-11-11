import { gmProgramForNumber, instrumentForName, type Part, type Score } from '../score';

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
  if (/sax/i.test(name)) return;
  if (/\b(?:voice|vocal|choir|singer|satb)\b/i.test(name)) return;
  if (/\b(?:ukulele|ukelele)\b/i.test(name)) {
    if (/\bbaritone\b/i.test(name)) return 'ukulele-baritone';
    if (/\bbass\b/i.test(name)) return 'ukulele-bass';
    return /\btenor\b/i.test(name) ? 'ukulele-tenor' : 'ukulele-soprano';
  }
  if (/\b(?:double[ -]?bass|contrabass|upright bass|string bass)\b/i.test(name)) return 'double-bass';
  if (/\b(?:bass[ -]?guitar|(?:electric|acoustic|fretless)[ -]+bass|e-bass)\b/i.test(name)) return 'bass4';
  if (/\bguitar\b/i.test(name)) return 'guitar';
  if (/\bbass\b/i.test(name) && instrumentForName(name) === 'bassguitar') return 'bass4';
};

/** Switched target ids are exact; source programs gate name-based classification before a switch. */
export function stringInstrument(part: Part, override?: TabInstrument | 'none', switched = false): TabInstrument | undefined {
  if (part.tab || part.clef === 'percussion') return;
  // A reader instrument switch replaces the host's initial TAB identity, as well as its source name.
  if (!switched) {
    if (override === 'none') return;
    if (validTabInstrument(override)) return override;
  } else {
    // Target ids are authoritative after a switch: Double Bass shares GM 33 with acoustic bass guitar.
    switch (part.instrument) {
      case 'bassguitar': return 'bass4';
      case 'guitar':
      case 'double-bass':
      case 'violin':
      case 'viola':
      case 'cello': return part.instrument;
    }
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
  if (part.instrument === 'microphone') return;
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


/** Name-only voices are explicit; ambiguous bass needs choir context without guitar/drum evidence. */
export function resolveChoirNames(score: Score): Score {
  const letters = new Set(score.parts.map(part => part.name.trim().toUpperCase()).filter(name => /^[SATB]$/.test(name)));
  const guitarOrDrums = score.parts.some(part => {
    const gm = part.gmProgram;
    if (part.clef === 'percussion' || part.instrument === 'drum-kit') return true;
    if (gm !== undefined) return (gm >= 25 && gm <= 32) || (gm >= 34 && gm <= 40);
    return /guitar|drum|percussion/i.test(part.name);
  });
  const letterChoir = letters.size >= 3 && !guitarOrDrums;
  const voiceContext = letterChoir || score.parts.some(part => instrumentForName(part.name) === 'microphone'
    && (part.gmProgram === undefined || part.instrument === 'microphone'));
  for (const part of score.parts) {
    if (part.gmProgram !== undefined || part.tab || part.clef === 'percussion') continue;
    const named = instrumentForName(part.name);
    if (/sax/i.test(part.name)) {
      // GM has a soprano sound even though the reader's icon registry groups it with alto sax.
      if (/\bsoprano\b/i.test(part.name)) {
        part.gmProgram = 65;
        part.gmSoundfont = gmProgramForNumber(65)?.soundfont ?? undefined;
      }
      continue;
    }
    if (named === 'microphone' || (letterChoir && /^[SATB]$/i.test(part.name.trim()))
      || (named === 'bassguitar' && voiceContext && !guitarOrDrums)) part.instrument = 'microphone';
  }
  return score;
}
