// In-page harness for validation/tab.mjs: runs a score through the reader's guitar TAB pipeline as the Verovio worker
// does (MusicXML → MEI baseline, Verovio transposition and the spelling pass, TAB injection, the view MEI) with the
// staff plan renderScore uses (render.ts planStaves), engraves it with Verovio and reports what was drawn. Also the
// parser's TAB staff flags, the playback timeline and the settings round trip (prefs.ts, file-state.ts).
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { parseAbc, parseMusicXml } from '../packages/pepperscore/src/lib/import';
import { buildViewMei, scanBaseline } from '../packages/pepperscore/src/lib/notation/mei-view';
import { spellBaseline } from '../packages/pepperscore/src/lib/notation/mei-spelling';
import { injectTab, type FretMemory } from '../packages/pepperscore/src/lib/notation/mei-tab';
import { indexMusicXml, sliceMusicXml } from '../packages/pepperscore/src/lib/notation/musicxml-chunks';
import { planStaves } from '../packages/pepperscore/src/lib/render';
import { scoreForView } from '../packages/pepperscore/src/lib/transpose';
import { buildBaseTimeline } from '../packages/pepperscore/src/lib/playback/timeline';
import { canShowTab, type TabView } from '../packages/pepperscore/src/lib/tab/tab-parts';
import { defaults, sanitizeSavedPrefs, settingsToPrefs, type PepperScoreSettings } from '../packages/pepperscore/src/lib/prefs';
import { buildFileState, parseFileState, textSource } from '../packages/pepperscore/src/lib/file-state';
import type { Score } from '../packages/pepperscore/src/lib/score';

type Toolkit = InstanceType<typeof VerovioToolkit>;
let toolkit: Promise<Toolkit> | undefined;
const verovio = () => toolkit ??= createVerovioModule().then(module => new VerovioToolkit(module));
function load(target: Toolkit, data: string, options: Record<string, unknown>) {
  target.resetOptions(); target.setOptions(options);
  if (!target.loadData(data)) throw new Error('Verovio could not load the document');
}
async function convert(text: string): Promise<string> { const target = await verovio(); load(target, text, { breaks: 'none', inputFrom: 'auto', xmlIdChecksum: true }); return target.getMEI(); }
const transposer = async (mei: string, options: { transpose: string; transposeToSoundingPitch: boolean }) => {
  const target = await verovio(); load(target, mei, { breaks: 'none', xmlIdChecksum: true, ...options }); return target.getMEI();
};

export type Source = string | { abc: string };
const scores = new Map<string, { score: Score; baseline: string }>();
async function prepare(source: Source) {
  const key = typeof source === 'string' ? source : source.abc;
  let entry = scores.get(key);
  if (!entry) {
    const score = typeof source === 'string' ? parseMusicXml(source) : await parseAbc(source.abc);
    entry = { score, baseline: await convert(new TextDecoder().decode(score.document!.engravingBytes())) };
    scores.set(key, entry);
  }
  return entry;
}

/** The parsed parts (TAB flags) and the playback timeline's note events. */
export async function parts(source: Source) {
  const { score } = await prepare(source);
  const timeline = buildBaseTimeline(score);
  return {
    parts: score.parts.map(part => ({ id: part.id, name: part.name, clef: part.clef, tab: !!part.tab, tabOf: part.tabOf ?? null })),
    canShowTab: canShowTab(score),
    timelineNotes: timeline.events.length,
    timelineParts: [...new Set(timeline.events.map(event => event.partId))],
    /** Sounding pitches per part (non-grace notes, one per pitch, ties counted once). */
    pitches: Object.fromEntries(score.parts.map(part => [part.id, part.measures.reduce((sum, measure) => sum + measure.notes.reduce((count, note) => count + (note.grace ? 0 : note.pitches.filter(pitch => !pitch.tieStop).length), 0), 0)])),
  };
}

export type ViewCase = { view: TabView; semitones?: number; capo?: number; tuning?: number[]; chordSymbols?: boolean; hidden?: string[]; slices?: number };
type TabNote = { id: string; course: number; fret: number };

function readDrawn(mei: string, svg: string) {
  const staves = [...new Set([...svg.matchAll(/<g [^>]*class="staff"[^>]*data-n="(\d+)"/g)].map(match => match[1]))];
  const tabGroups = (mei.match(/<tabGrp\b/g) || []).length;
  const tabNotes: TabNote[] = [...mei.matchAll(/<note\b([^>]*?)\/?>/g)].map(([, attributes]) => {
    const course = /\stab\.course="(\d+)"/.exec(attributes)?.[1], fret = /\stab\.fret="(\d+)"/.exec(attributes)?.[1], id = /\sxml:id="([^"]*)"/.exec(attributes)?.[1] || '';
    return course && fret && /-tabn?$/.test(id) ? { id, course: Number(course), fret: Number(fret) } : null;
  }).filter((note): note is TabNote => !!note);
  // Notes drawn on each staff, in the SVG.
  const notesByStaff: Record<string, number> = {};
  for (const part of svg.split(/(?=<g [^>]*class="staff")/).slice(1)) {
    const n = /data-n="(\d+)"/.exec(part)?.[1]; if (!n) continue;
    const body = part.split(/(?=<g [^>]*class="(?:measure|system|harm|tempo|dir)")/)[0];
    notesByStaff[n] = (notesByStaff[n] || 0) + (body.match(/<g [^>]*class="note"/g) || []).length;
  }
  const harm = [...mei.matchAll(/<harm\b[^>]*\sstaff="([^"]*)"/g)].map(match => match[1]);
  return { staves, tabGroups, tabNotes, notesByStaff, harm, drawnHarm: (svg.match(/class="harm"/g) || []).length, svgTabGroups: (svg.match(/class="tabGrp"/g) || []).length };
}

/** Engrave one TAB view of a score (whole, or in `slices` measures per chunk with one fret memory, as the worker does). */
export async function engraveTab(source: Source, test: ViewCase) {
  const { score, baseline } = await prepare(source);
  const view = scoreForView(score, 'written', test.semitones ?? 0, false);
  const plan = planStaves(scanBaseline(baseline), view, new Set(test.hidden ?? []), { view: test.view, tuning: test.tuning, capo: test.capo });
  const target = await verovio();
  const options = { breaks: 'none', xmlIdChecksum: true, pageWidth: 60000, adjustPageHeight: true, svgAdditionalAttribute: ['staff@n'] };
  const engrave = (mei: string) => { load(target, mei, options); return { mei: target.getMEI(), svg: target.renderToSVG(1) }; };
  const viewSpec = { breakEvery: 0, hiddenStaves: plan.hiddenStaves, chordSymbols: test.chordSymbols ?? true, spelling: plan.spelling, ...(plan.tabPlan.spec ? { tab: plan.tabPlan.spec } : {}) };
  const spelled = await spellBaseline(baseline, plan.spelling, transposer);
  const injected = plan.tabPlan.spec ? injectTab(spelled, plan.tabPlan.spec) : spelled;
  const whole = engrave(buildViewMei(injected, viewSpec));
  const drawn = readDrawn(whole.mei, whole.svg);
  const result = { ...drawn, hiddenStaves: plan.hiddenStaves, display: Object.fromEntries(plan.tabPlan.display), generate: plan.tabPlan.spec?.generate ?? [], staffCount: plan.staffCount, svg: whole.svg, chunks: null as null | { tabNotes: TabNote[] } };
  if (test.slices) {
    // Chunked engraving: overlapping slices (one bar of overlap), fingerings remembered by note ID across them.
    const index = indexMusicXml(new TextDecoder().decode(score.document!.engravingBytes()))!;
    const memory: FretMemory = new Map();
    const notes = new Map<string, TabNote>();
    for (let from = 0; from < index.measureCount; from += test.slices - 1) {
      const to = Math.min(index.measureCount, from + test.slices);
      const chunk = await spellBaseline(await convert(sliceMusicXml(index, from, to)), plan.spelling, transposer, from);
      const out = engrave(buildViewMei(plan.tabPlan.spec ? injectTab(chunk, plan.tabPlan.spec, memory) : chunk, viewSpec, Infinity, from));
      for (const note of readDrawn(out.mei, out.svg).tabNotes) if (!notes.has(note.id)) notes.set(note.id, note); else if (notes.get(note.id)!.fret !== note.fret || notes.get(note.id)!.course !== note.course) notes.set(note.id, { ...note, id: `${note.id} (changed)` });
      if (to >= index.measureCount) break;
    }
    result.chunks = { tabNotes: [...notes.values()] };
  }
  return result;
}

/** Host settings → reader prefs → saved per-score record → read back. */
export function settingsRoundTrip(settings: PepperScoreSettings, xml: string) {
  const score = parseMusicXml(xml);
  const prefs = { ...defaults, ...settingsToPrefs(settings) };
  const source = textSource('musicxml', xml, 'tab.musicxml');
  const saved = JSON.parse(JSON.stringify(buildFileState(source, prefs, score, [])));
  const read = parseFileState(saved, source.sha256);
  // A record saved before the TAB settings existed reads with their defaults.
  const legacy = structuredClone(saved); delete legacy.settings.tabView; delete legacy.settings.tabTuning; delete legacy.settings.capo;
  const invalid = structuredClone(saved); invalid.settings.tabView = 'lute'; invalid.settings.tabTuning = [40, 'x']; invalid.settings.capo = 30;
  return {
    mapped: settingsToPrefs(settings),
    read: read && { tabView: read.settings.tabView, tabTuning: read.settings.tabTuning, capo: read.settings.capo, bpm: read.settings.bpm, keyFlip: read.settings.keyFlip },
    legacy: (({ tabView, tabTuning, capo }) => ({ tabView, tabTuning, capo }))(parseFileState(legacy, source.sha256)!.settings),
    invalid: (({ tabView, tabTuning, capo }) => ({ tabView, tabTuning, capo }))(parseFileState(invalid, source.sha256)!.settings),
    sanitized: (({ tabView, tabTuning, capo, bpm }) => ({ tabView, tabTuning, capo, bpm }))(sanitizeSavedPrefs({ tabView: 'x', tabTuning: 'EADGBE', capo: -1, bpm: 900 })),
  };
}
