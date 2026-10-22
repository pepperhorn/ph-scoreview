/**
 * Which staves show guitar TAB (docs/specs/guitar-tab.md, "Which staves get TAB"). Main-thread only: the reader
 * decides from its Score which notation staves get a generated TAB staff, which imported TAB staves show, and what is
 * hidden; the Verovio worker then injects the TAB staves (notation/mei-tab.ts).
 */
import type { Part, Score } from '../score';
import type { TabSpec } from '../notation/mei-tab';

export type TabView = 'notation' | 'tab' | 'both';
/** A generated TAB staff's number: 100 + its notation staff's number. */
export const tabStaffNumber = (n: string) => String(100 + Number(n));

const isTabPart = (part: Part) => part.clef === 'tab' || part.measures.some(measure => measure.clef === 'tab');
const sourceOf = (id: string) => id.replace(/-\d+$/, '');
const pitched = (part: Part) => part.clef !== 'percussion' && !part.tab && part.measures.some(measure => measure.notes.some(note => note.pitches.some(pitch => !pitch.unpitched)));
/** A part's sounding notes as `measure:start:midi` keys (to tell whether a TAB part doubles another part). */
const noteKeys = (part: Part) => part.measures.flatMap(measure => measure.notes.flatMap(note => note.grace ? [] : note.pitches.map(pitch => `${measure.index}:${Math.round(note.start * 96)}:${pitch.midi}`)));

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

/** A guitar part: GM programs 25-32 (1-based; nylon to guitar harmonics), the guitar sound, or "guitar" in its name. */
export const isGuitarPart = (part: Part) => !part.tab && part.clef !== 'percussion' && ((part.gmProgram !== undefined && part.gmProgram >= 25 && part.gmProgram <= 32) || part.instrument === 'guitar' || (/guitar/i.test(part.name) && !/bass/i.test(part.name)));

/** Notation parts that take TAB: every guitar part (and every part an imported TAB doubles), else the first pitched part. */
export function tabParts(score: Score): Part[] {
  const doubled = new Set(score.parts.flatMap(part => part.tabOf ? [part.tabOf] : []));
  const guitars = score.parts.filter(part => !part.tab && (isGuitarPart(part) || doubled.has(part.id)));
  if (guitars.length) return guitars;
  const first = score.parts.find(pitched);
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
 * Plan a view: `staffOf` maps parts to baseline staff numbers, `hiddenIds` are parts the reader hid, `stale` is true
 * when the view moves pitches (imported `tab.fret`s no longer match, so imported TAB is replaced by generated TAB).
 */
export function planTab(score: Score, staffOf: Map<string, string>, view: TabView, options: { tuning: number[]; capo: number; stale: boolean; hiddenIds?: Set<string> }): TabPlan {
  const hiddenIds = options.hiddenIds ?? new Set<string>();
  const plan: TabPlan = { hidden: [], added: [], display: new Map(), importedFor: new Map() };
  const imported = score.parts.filter(part => part.tabOf);
  const partnerOf = new Map(imported.map(part => [part.tabOf!, part]));
  const hide = (n?: string) => { if (n && !plan.hidden.includes(n)) plan.hidden.push(n); };
  // A doubling TAB staff shows only for its partner in a TAB view (and not when hidden with its partner).
  const used = new Set<Part>();
  const generate: string[] = [];
  const retarget: Record<string, string> = {};
  if (view !== 'notation') {
    for (const part of tabParts(score)) {
      const n = staffOf.get(part.id);
      if (!n || hiddenIds.has(part.id)) continue;
      const partner = partnerOf.get(part.id);
      const partnerN = partner && staffOf.get(partner.id);
      let tabN: string;
      if (partner && partnerN && !options.stale) { tabN = partnerN; used.add(partner); plan.importedFor.set(part.id, partner); }
      else { tabN = tabStaffNumber(n); generate.push(n); plan.added.push(tabN); }
      if (view === 'tab') { hide(n); retarget[n] = tabN; plan.display.set(part.id, tabN); }
    }
  }
  for (const part of imported) if (!used.has(part)) hide(staffOf.get(part.id));
  if (generate.length || Object.keys(retarget).length) plan.spec = { generate, retarget, tuning: options.tuning, capo: options.capo, fixed: !options.stale };
  return plan;
}
