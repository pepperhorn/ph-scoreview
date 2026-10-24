/**
 * Which staves show guitar TAB (docs/specs/guitar-tab.md, "Which staves get TAB"). Main-thread only: the reader
 * decides from its Score which notation staves get a generated TAB staff, which imported TAB staves show, and what is
 * hidden; the Verovio worker then injects the TAB staves (notation/mei-tab.ts).
 */
import type { Measure, Part, Pitch, Score, ScoreNote } from '../score';
import type { TabSpec } from '../notation/mei-tab';
import type { PartState } from '../file-state';

export type TabView = 'notation' | 'tab' | 'both';
/** A generated TAB staff's number: 100 + its notation staff's number. */
export const tabStaffNumber = (n: string) => String(100 + Number(n));

const isTabPart = (part: Part) => part.clef === 'tab' || part.measures.some(measure => measure.clef === 'tab');
const sourceOf = (id: string) => id.replace(/-\d+$/, '');
const pitched = (part: Part) => part.clef !== 'percussion' && !part.tab && part.measures.some(measure => measure.notes.some(note => note.pitches.some(pitch => !pitch.unpitched)));
/**
 * A pitch as it sounds: a written part's MIDI plus its transposition (a guitar is written an octave above sounding; a
 * TAB staff is at sounding pitch), so a notation part and the TAB part that doubles it compare equal.
 */
const soundingOf = (part: Part, measure: Measure, pitch: Pitch) => pitch.midi + (part.clef === 'percussion' || part.pitchBasis === 'concert' ? 0 : (measure.transposition || part.transposition)?.semitones ?? 0);
/** A note's onset and sounding pitches as one key (`measure:start:midis`, or `r` for a rest). */
export const soundingKeyOf = (part: Part, measure: Measure, note: ScoreNote) => `${measure.index}:${Math.round(note.start * 96)}:${note.rest ? 'r' : note.pitches.map(pitch => soundingOf(part, measure, pitch)).sort((a, b) => a - b).join(',')}`;
/** A part's sounding notes as `measure:start:midi` keys (to tell whether a TAB part doubles another part). */
const noteKeys = (part: Part) => part.measures.flatMap(measure => measure.notes.flatMap(note => note.grace ? [] : note.pitches.map(pitch => `${measure.index}:${Math.round(note.start * 96)}:${soundingOf(part, measure, pitch)}`)));

/**
 * Flag TAB parts (`tab`) and link each to the notation part it doubles (`tabOf`): a sibling staff of the same
 * MusicXML part, or else the nearest pitched part before it with (nearly) the same notes. A TAB part that doubles
 * nothing (a TAB-only score) stays a normal, performed part. Mutates and returns `score`.
 */
export function linkTabParts(score: Score): Score {
  const parts = score.parts;
  for (const part of parts) if (isTabPart(part)) part.tab = true;
  parts.forEach((part, index) => {
    if (!part.tab) return;
    const sibling = parts.find(other => other !== part && !other.tab && sourceOf(other.id) === sourceOf(part.id) && /-\d+$/.test(other.id) && pitched(other));
    if (sibling) { part.tabOf = sibling.id; return; }
    const own = noteKeys(part);
    if (!own.length) return;
    for (let at = index - 1; at >= 0; at--) {
      const other = parts[at];
      if (!pitched(other)) continue;
      const theirs = new Set(noteKeys(other));
      const shared = own.filter(key => theirs.has(key)).length;
      if (shared >= own.length * .9 && theirs.size <= own.length * 1.25 + 2) { part.tabOf = other.id; return; }
    }
  });
  return score;
}

const guitarSound = (part: Part) => (part.gmProgram !== undefined && part.gmProgram >= 25 && part.gmProgram <= 32) || part.instrument === 'guitar';
/** A guitar part: GM programs 25-32 (1-based; nylon to guitar harmonics), the guitar sound, or "guitar" in its name. */
export const isGuitarPart = (part: Part) => !part.tab && part.clef !== 'percussion' && (guitarSound(part) || (/guitar/i.test(part.name) && !/bass/i.test(part.name)));
/** Parts an instrument switch rewrote as another instrument (instrument-view.ts; an octave move alone keeps the instrument). */
const switchedParts = (score: Score) => new Set(Object.entries(score.instrumentView?.staves ?? {}).filter(([, staff]) => staff.clef).map(([id]) => id));
/**
 * Parts whose imported TAB frets no longer match their notes: every part of an instrument view's staves (switched or
 * octave-moved). Their TAB is generated again, or hidden when the part was switched to another instrument.
 */
const staleTabOf = (score: Score) => new Set(Object.keys(score.instrumentView?.staves ?? {}));

/**
 * Notation parts that take TAB: every guitar part (and every part an imported TAB doubles), else the first pitched
 * part. A part switched to another instrument (instrument-view.ts) takes TAB only if its new instrument is a guitar
 * (its name and its imported TAB no longer count).
 */
export function tabParts(score: Score): Part[] {
  const switched = switchedParts(score);
  const doubled = new Set(score.parts.flatMap(part => part.tabOf ? [part.tabOf] : []));
  const guitars = score.parts.filter(part => !part.tab && (switched.has(part.id) ? part.clef !== 'percussion' && guitarSound(part) : isGuitarPart(part) || doubled.has(part.id)));
  if (guitars.length) return guitars;
  const first = score.parts.find(part => pitched(part) && !switched.has(part.id));
  return first ? [first] : [];
}
/** Whether the Notation / TAB / Both switch has anything to switch. */
export const canShowTab = (score: Score) => tabParts(score).length > 0;

export type TabPlan = {
  /** For the worker; absent when nothing is injected or retargeted. */
  spec?: TabSpec;
  /** Staff numbers hidden by the view (notation staves in TAB view, imported TAB staves when unused). */
  hidden: string[];
  /** Staff numbers the view adds or shows that are not in the baseline's staffDefs (generated TAB staves). */
  added: string[];
  /** The staff a notation part is read from in this view (its TAB staff in TAB view); defaults to its own. */
  display: Map<string, string>;
  /** Imported TAB part shown for a notation part (highlights map the notation part's notes onto it). */
  importedFor: Map<string, Part>;
};

/**
 * The reader parts a saved record hides (`parts`: saved part states by ID). Only parts the reader lists can be hidden:
 * a TAB part that doubles a guitar never is (an older reader listed it), and a guitar whose notation was hidden while
 * its TAB part showed stays shown (the guitar was being read from its TAB).
 */
export function hiddenReaderParts(score: Score, parts: Record<string, PartState | undefined>): string[] {
  const tabOf = new Map(score.parts.filter(part => part.tabOf).map(part => [part.tabOf!, part.id]));
  return score.parts.filter(part => !part.tabOf && parts[part.id]?.visible === false && parts[tabOf.get(part.id) ?? '']?.visible !== true).map(part => part.id);
}

/**
 * Plan a view: `staffOf` maps parts to baseline staff numbers, `hiddenIds` are parts the reader hid, `stale` is true
 * when the view moves sounding pitches (transposition: imported `tab.fret`s no longer match, so imported TAB is replaced
 * by generated TAB and a TAB-only staff is re-fingered). A concert view moves written notes to the pitches they already
 * sound, so it never makes TAB stale. A part of the Score's instrument view (switched or octave-moved,
 * `score.instrumentView`) makes its own TAB stale: generated (its fingerings not fixed) while it is a guitar, else
 * none (it is no longer a TAB part, and its imported TAB staff is hidden). `sounding` lists staves whose spelled notes are at sounding pitch (their
 * `trans.semi` no longer applies).
 */
export function planTab(score: Score, staffOf: Map<string, string>, view: TabView, options: { tuning: number[]; capo: number; stale: boolean; semitones?: number; sounding?: string[]; hiddenIds?: Set<string> }): TabPlan {
  const hiddenIds = options.hiddenIds ?? new Set<string>();
  const plan: TabPlan = { hidden: [], added: [], display: new Map(), importedFor: new Map() };
  const imported = score.parts.filter(part => part.tabOf);
  const partnerOf = new Map(imported.map(part => [part.tabOf!, part]));
  const hide = (n?: string) => { if (n && !plan.hidden.includes(n)) plan.hidden.push(n); };
  // A doubling TAB staff shows only for its partner in a TAB view (and not when hidden with its partner).
  const used = new Set<Part>();
  const generate: string[] = [];
  const retarget: Record<string, string> = {};
  // Switched or octave-moved parts: their imported TAB and the fingerings on their notes are stale.
  const stale = staleTabOf(score);
  const unfixed: string[] = [];
  if (view !== 'notation') {
    for (const part of tabParts(score)) {
      const n = staffOf.get(part.id);
      if (!n || hiddenIds.has(part.id)) continue;
      const partner = partnerOf.get(part.id);
      const partnerN = partner && staffOf.get(partner.id);
      let tabN: string;
      if (partner && partnerN && !options.stale && !stale.has(part.id)) { tabN = partnerN; used.add(partner); plan.importedFor.set(part.id, partner); }
      else { tabN = tabStaffNumber(n); generate.push(n); plan.added.push(tabN); if (stale.has(part.id)) unfixed.push(n); }
      if (view === 'tab') { hide(n); retarget[n] = tabN; plan.display.set(part.id, tabN); }
    }
  }
  for (const part of imported) if (!used.has(part)) hide(staffOf.get(part.id));
  // A TAB staff that doubles nothing (a TAB-only score) shows in every view; transposed, its frets are solved again.
  const refret: Record<string, number> = {};
  if (options.stale && options.semitones) for (const part of score.parts) {
    const n = staffOf.get(part.id);
    if (part.tab && !part.tabOf && n) refret[n] = options.semitones;
  }
  const sounding = (options.sounding ?? []).filter(n => generate.includes(n));
  if (generate.length || Object.keys(retarget).length || Object.keys(refret).length) {
    plan.spec = { generate, retarget, tuning: options.tuning, capo: options.capo, fixed: !options.stale, ...(sounding.length ? { sounding } : {}), ...(unfixed.length && !options.stale ? { unfixed } : {}), ...(Object.keys(refret).length ? { refret } : {}) };
  }
  return plan;
}
