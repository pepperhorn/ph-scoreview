import manifest from './gm-soundfont-manifest.json';
import type { SourceDocument } from './notation/document';
import type { InstrumentId as ModelInstrumentId } from './instrument-model';
const iconUrls = import.meta.glob('../icons/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export type Pitch = { step: string; octave: number; alter: number; midi: number; sourceId?: string; unpitched?: boolean; displayStep?: string; displayOctave?: number; accidental?: string; cautionary?: boolean; tieStart?: boolean; tieStop?: boolean };
/** Key mode from the source (MusicXML <mode>, MEI @mode); absent means major. */
export type KeyMode = 'major' | 'minor';
export type Transposition = { semitones: number; diatonic?: number };
export type ScoreNote = { id: string; sourceId?: string; start: number; duration: number; pitches: Pitch[]; transposition?: Transposition; chordSymbol?: string; lyric?: string; beamStart?: boolean; beamEnd?: boolean; rest?: boolean; dotted?: boolean; dots?: number; writtenType?: string; voice?: string; stem?: string; grace?: boolean; tuplet?: { actual: number; normal: number; number: string; start?: boolean; stop?: boolean }; slurStart?: string[]; slurStop?: string[]; tieStart?: boolean; tieStop?: boolean };
export type ScoreDirection = { start: number; symbols?: string[]; text?: string; placement?: 'above' | 'below'; voice?: string; wedge?: { type: string; number: string }; soundDynamics?: number; tempo?: number };
/** A repeat barline inside a bar, at an exact quarter-note offset from the bar start ("3", "5/2"). */
export type BarlineNavigation = { beat: string; repeatStart?: boolean; repeatEnd?: boolean; repeatTimes?: number };
/**
 * Format-neutral written navigation of one measure, filled by every importer.
 * Bar-level marks apply at the bar start (repeatStart, segno, coda) or the bar
 * end (repeatEnd, toCoda, daCapo, dalSegno, fine); `barlines` holds repeats
 * that fall inside the bar. JSON-serializable.
 */
export type MeasureNavigation = {
  repeatStart?: boolean; repeatEnd?: boolean;
  /** Total plays of a repeatEnd; omitted means 2, or the last ending number when the repeat ends inside an ending. */
  repeatTimes?: number;
  /** Volta numbers of the ending bracket this measure belongs to. */
  endings?: number[];
  segno?: boolean; coda?: boolean; toCoda?: boolean; daCapo?: boolean; dalSegno?: boolean; fine?: boolean;
  barlines?: BarlineNavigation[];
};
export type Measure = { index: number; beats: number; notes: ScoreNote[]; dynamics?: { start: number; symbol: string }[]; directions?: ScoreDirection[]; nominalBeats?: number; number?: string; implicit?: boolean; key?: number; keyMode?: KeyMode; clef?: string; beatsPerBar?: number; beatType?: number; transposition?: Transposition; navigation?: MeasureNavigation };
export type Part = { id: string; name: string; clef: string; key?: number; keyMode?: KeyMode; instrument: InstrumentId; gmProgram?: number; gmSoundfont?: string; pitchBasis?: 'written' | 'concert'; transposition?: Transposition; measures: Measure[];
  /** A tablature staff (MusicXML clef sign TAB), imported by Verovio as a `tab.guitar` staff. */
  tab?: boolean;
  /**
   * The part this TAB staff doubles (its notation staff). A doubling TAB part is engraved but never performed, has no
   * annotation lanes and is not listed in part controls, so the instrument shows and plays once (lib/tab/tab-parts.ts).
   */
  tabOf?: string };
export type Score = { title: string; subtitle?: string; composer?: string; credits?: string[]; source: string; tempo: number; beats: number; beatType: number; key: number; keyMode?: KeyMode; parts: Part[];
  /** Set on a transposed or flipped view of a score (transpose.ts `scoreForView`). */
  pitchView?: import('./transpose').PitchView; document?: SourceDocument };
export type InstrumentId = ModelInstrumentId;
export const GM_FAMILIES = ['Keyboard', 'Guitar', 'Voice', 'Percussion', 'Drums', 'Woodwinds', 'Brass', 'Strings', 'FX / Other'] as const;
export type GmFamily = typeof GM_FAMILIES[number];
export type GmSound = { program: number | null; label: string; soundfont: string | null; iconId: InstrumentId; icon: string; family: GmFamily };
const iconFor = (id: InstrumentId) => iconUrls[`../icons/${manifest.icons[id].split('/').at(-1)}`];
export const GM_SOUNDS: GmSound[] = [
  { program: null, label: 'Drum Kit', soundfont: null, iconId: 'drum-kit', icon: iconFor('drum-kit'), family: 'Drums' },
  ...manifest.programs.map(entry => ({ program: entry.program, label: gmSoundfontLabel(entry.soundfont), soundfont: entry.soundfont, iconId: entry.icon as InstrumentId, icon: iconFor(entry.icon as InstrumentId), family: entry.family as GmFamily })),
];

export const INSTRUMENTS: { id: InstrumentId; label: string; program: number; icon: string; soundfont: string | null; localPack: string }[] = manifest.voices.map(voice => ({
  id: voice.id as InstrumentId,
  label: voice.label,
  program: voice.program === null ? 0 : voice.program - 1,
  icon: iconFor(voice.icon as InstrumentId),
  soundfont: voice.program === null ? null : manifest.programs[voice.program - 1].soundfont,
  localPack: voice.localPack,
}));
export function instrumentForProgram(program: number): InstrumentId {
  return (manifest.programs[program]?.icon || 'piano') as InstrumentId;
}
export function gmProgramForVirtualName(library: string, name: string) {
  if (library.toLowerCase().replace(/[^a-z]/g, '') !== 'generalmidi') return undefined;
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return manifest.programs.find(entry => entry.soundfont.replace(/[^a-z0-9]/g, '') === normalized);
}
export function gmProgramForNumber(program: number) {
  return Number.isInteger(program) && program >= 1 && program <= 128 ? manifest.programs[program - 1] : undefined;
}
/** GM program (1-128) of a FluidR3 sound name. */
export function gmProgramForSoundfont(name: string): number | undefined {
  return manifest.programs.find(entry => entry.soundfont === name)?.program;
}
export function isGmSoundfont(name: string) {
  return manifest.programs.some(entry => entry.soundfont === name);
}
export function gmSoundfontLabel(name: string) {
  return name.split('_').filter(Boolean).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}
export const instrumentDetails = (id: InstrumentId) => INSTRUMENTS.find(item => item.id === id)!;
export const ucfirst = (name: string) => name ? name.charAt(0).toLocaleUpperCase() + name.slice(1) : name;

const semitones: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function pitch(step: string, octave: number, alter = 0): Pitch {
  const s = step.toUpperCase();
  return { step: s, octave, alter, midi: (octave + 1) * 12 + semitones[s] + alter };
}
export function midiPitch(midi: number): Pitch {
  const names = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
  const altered = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
  const pc = ((midi % 12) + 12) % 12;
  return pitch(names[pc], Math.floor(midi / 12) - 1, altered[pc]);
}
export function noteName(p: Pitch): string { return `${p.step}${p.alter === 1 ? '♯' : p.alter === -1 ? '♭' : ''}${p.octave}`; }
export function instrumentForName(name: string): InstrumentId {
  const n = name.toLowerCase();
  if (/drum|percussion/.test(n)) return 'drum-kit';
  if (/bass guitar|bassguitar|electric bass/.test(n)) return 'bassguitar';
  if (/double bass|contrabass|acoustic bass|upright bass|\bbass\b/.test(n)) return 'double-bass';
  if (/guitar/.test(n)) return 'guitar';
  if (/baritone sax|bari sax/.test(n)) return 'bari-saxophone';
  if (/tenor sax/.test(n)) return 'tenor-saxophone';
  if (/sax/.test(n)) return 'alto-saxophone';
  if (/flute/.test(n)) return 'flute';
  if (/clarinet/.test(n)) return 'clarinet';
  if (/trumpet/.test(n)) return 'trumpet';
  if (/trombone/.test(n)) return 'trombone';
  if (/violin/.test(n)) return 'violin';
  if (/viola/.test(n)) return 'viola';
  if (/cello/.test(n)) return 'cello';
  if (/voice|vocal|choir|singer/.test(n)) return 'microphone';
  return 'piano';
}
export function exampleScore(): Score {
  const notes = [
    [[60, 64, 67], [62, 65, 69], [64, 67, 72], [65, 69, 72]],
    [[67, 71, 74], [65, 69, 72], [64, 67, 72], [62, 65, 69]],
    [[60, 64, 67], [64, 67, 72], [67, 72, 76], [64, 67, 72]],
    [[62, 65, 69], [65, 69, 74], [67, 71, 74], [60, 64, 67]],
  ];
  return { title: 'A little room to play', composer: 'Sample score', source: 'sample', tempo: 96, beats: 4, beatType: 4, key: 0, parts: [
    { id: 'p1', name: 'Piano', clef: 'treble', instrument: 'piano', measures: Array.from({ length: 24 }, (_, index) => ({ index, beats: 4, notes: notes[index % 4].map((chord, beat) => ({ id: `p1-${index}-${beat}`, start: beat, duration: 1, pitches: chord.map(midiPitch) })) })) },
  ] };
}
