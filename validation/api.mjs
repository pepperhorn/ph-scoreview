// Chrome presets and settings mapping for the public PepperScore props (pure modules, run in Node).
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveChrome } from '../packages/pepperscore/src/lib/chrome.ts';
import { readFileSync } from 'node:fs';
import { ANNOTATION_SCALE, ANNOTATION_SIZES, defaults, sanitizeSavedPrefs, settingsToPrefs, viewToMode } from '../packages/pepperscore/src/lib/prefs.ts';
import { nearestNote, noteInBox } from '../packages/pepperscore/src/lib/hit-test.ts';

const all = { header: true, transport: true, viewToggle: true, openFile: true, mixer: true, drawer: true, zoom: true, tabToggle: true, instrumentSwitch: true, octaveTool: true, compactPlay: false, playhead: true, partControls: true, audio: true };
assert.deepEqual(resolveChrome(), all, 'full is the default');
assert.deepEqual(resolveChrome('full'), all);
assert.deepEqual(resolveChrome('minimal'), { header: false, transport: false, viewToggle: false, openFile: false, mixer: false, drawer: false, zoom: false, tabToggle: false, instrumentSwitch: false, octaveTool: false, compactPlay: true, playhead: true, partControls: false, audio: true });
assert.deepEqual(resolveChrome('none'), { header: false, transport: false, viewToggle: false, openFile: false, mixer: false, drawer: false, zoom: false, tabToggle: false, instrumentSwitch: false, octaveTool: false, compactPlay: false, playhead: false, partControls: false, audio: false });
assert.deepEqual(resolveChrome('full', { mixer: false, openFile: false }), { ...all, mixer: false, openFile: false, partControls: false });
const minimalWithToggle = resolveChrome('minimal', { viewToggle: true });
assert.equal(minimalWithToggle.header, true); assert.equal(minimalWithToggle.compactPlay, true);
const minimalWithTransport = resolveChrome('minimal', { transport: true });
assert.equal(minimalWithTransport.compactPlay, false, 'header transport replaces the compact button');
assert.equal(resolveChrome('none', { transport: true }).audio, true, 'a host can opt none into playback');
const minimalWithTab = resolveChrome('minimal', { tabToggle: true });
assert.equal(minimalWithTab.tabToggle, true); assert.equal(minimalWithTab.header, true, 'the TAB switch alone shows the header');
assert.equal(resolveChrome('full', { tabToggle: false }).tabToggle, false, 'full can hide the TAB switch');
{
  const hidden = resolveChrome('full', { instrumentSwitch: false, octaveTool: false });
  assert.deepEqual([hidden.instrumentSwitch, hidden.octaveTool], [false, false], 'full can hide the instrument switcher and the octave tool');
  const shown = resolveChrome('minimal', { instrumentSwitch: true, octaveTool: true });
  assert.deepEqual([shown.instrumentSwitch, shown.octaveTool], [true, true], 'minimal can show them');
}
// Instrument switch settings and controls are public (type text), and the saved switch schema lists the model's ids and levels.
{
  const prefsSource = readFileSync(new URL('../packages/pepperscore/src/lib/prefs.ts', import.meta.url), 'utf8');
  const settingsType = prefsSource.slice(prefsSource.indexOf('export type PepperScoreSettings'), prefsSource.indexOf('}>;', prefsSource.indexOf('export type PepperScoreSettings')));
  for (const key of ['instrument: SwitchInstrumentId', 'instruments: Record<string, SwitchInstrumentId>', 'rangeLevel: Level', 'autoRange: boolean']) assert.ok(settingsType.includes(key), `PepperScoreSettings has ${key}`);
  const chromeSource = readFileSync(new URL('../packages/pepperscore/src/lib/chrome.ts', import.meta.url), 'utf8');
  const controlsType = chromeSource.slice(chromeSource.indexOf('export type PepperScoreControls'), chromeSource.indexOf('\n', chromeSource.indexOf('export type PepperScoreControls')));
  for (const key of ["'instrumentSwitch'", "'octaveTool'"]) assert.ok(controlsType.includes(key), `PepperScoreControls has ${key}`);
  assert.deepEqual(settingsToPrefs({ instrument: 'alto-saxophone', instruments: { 1: 'flute' }, rangeLevel: 'beginner', autoRange: false }), {}, 'instrument settings are per-part state, not prefs');
  const { INSTRUMENT_IDS, LEVELS } = await import('../packages/pepperscore/src/lib/instrument-model.ts');
  const partSchema = JSON.parse(readFileSync(new URL('../packages/pepperscore/src/lib/file-state.schema.json', import.meta.url), 'utf8')).properties.parts.additionalProperties;
  const switchSchema = partSchema.properties.switch;
  assert.ok(switchSchema && !partSchema.required.includes('switch'), 'parts[].switch is optional in the schema');
  assert.deepEqual(switchSchema.properties.instrument.enum, [...INSTRUMENT_IDS], 'switch.instrument lists INSTRUMENT_IDS');
  assert.deepEqual(switchSchema.properties.level.enum, [...LEVELS], 'switch.level lists LEVELS');
  assert.deepEqual(switchSchema.properties.octaves.additionalProperties.enum, [12, -12], 'octave moves are ±12');
  assert.equal(switchSchema.additionalProperties, false);
  assert.deepEqual(switchSchema.properties.sound?.properties.instrument.enum, [...INSTRUMENT_IDS], 'switch.sound.instrument lists INSTRUMENT_IDS (a GM sound\'s icon id)');
  assert.deepEqual(switchSchema.properties.sound.properties.gmSoundfont, partSchema.properties.gmSoundfont, 'switch.sound.gmSoundfont matches parts[].gmSoundfont');
  const index = readFileSync(new URL('../packages/pepperscore/src/index.ts', import.meta.url), 'utf8');
  assert.match(index, /export type \{[^}]*\bInstrumentId\b[^}]*\bLevel as RangeLevel\b[^}]*\bSwitchInstrumentId\b[^}]*\} from '\.\/lib\/instrument-model'/, 'index.ts exports InstrumentId, RangeLevel and SwitchInstrumentId');
  assert.doesNotMatch(index, /\bLevel\b(?! as RangeLevel)/, 'index.ts exports no bare Level');
  const modelSource = readFileSync(new URL('../packages/pepperscore/src/lib/instrument-model.ts', import.meta.url), 'utf8');
  assert.match(modelSource, /export type SwitchInstrumentId = Exclude<InstrumentId, 'drum-kit'>;/, 'SwitchInstrumentId excludes the drum kit');
  const readyType = readFileSync(new URL('../packages/pepperscore/src/components/PepperScore.tsx', import.meta.url), 'utf8');
  assert.match(readyType, /parts: Array<\{ id: string; name: string; sourcePart: number; switchable: boolean \}>/, 'onReady parts carry sourcePart and switchable');
}

assert.deepEqual(settingsToPrefs({ noteNames: true, chordSymbols: true, inferChords: true, beatCounts: true, subdivisions: false, musicFont: 'Petaluma', staveFont: 'Serif', barsPerLine: 3, zoom: 1.5, semitones: 2, concert: true, overlap: 2 }),
  { names: true, chordSymbols: true, inferChordSymbols: true, counts: true, subdivisions: false, notationFont: 'Petaluma', annotationFont: 'Serif', barsPerLine: 3, zoom: 1.5, semitones: 2, scorePitch: 'concert', overlap: 2 });
assert.deepEqual(settingsToPrefs({}), {}, 'only given keys are applied');
assert.deepEqual(settingsToPrefs({ semitones: 40, overlap: 9, barsPerLine: 7, concert: false, zoom: null }), { semitones: 12, overlap: 3, barsPerLine: 7, scorePitch: 'written', zoom: null });
assert.equal(settingsToPrefs({ barsPerLine: 12 }).barsPerLine, 8, 'barsPerLine is clamped to 1-8');
assert.equal(settingsToPrefs({ barsPerLine: 0 }).barsPerLine, 1, 'barsPerLine is clamped to 1-8');
assert.deepEqual(settingsToPrefs({ tabView: 'tab', tabTuning: [38, 45, 50, 55, 59, 64], capo: 2, bpm: 132, keyFlip: true }), { tabView: 'tab', tabTuning: [38, 45, 50, 55, 59, 64], capo: 2, bpm: 132, keyFlip: true }, 'TAB settings, BPM and key flip map to prefs');
assert.deepEqual(settingsToPrefs({ tabView: 'lute', tabTuning: [40, 300], capo: 20, bpm: 999 }), { capo: 12, bpm: 240 }, 'unusable TAB settings are ignored, capo and BPM clamped');
assert.equal(defaults.tabView, 'notation'); assert.deepEqual(defaults.tabTuning, [40, 45, 50, 55, 59, 64]); assert.equal(defaults.capo, 0);
assert.equal(viewToMode('vertical'), 'portrait'); assert.equal(viewToMode('endless'), 'landscape');
assert.equal(defaults.mode, 'portrait');

// Text add-on sizes: six steps around regular (today's size), one pref per add-on, applied only for the add-ons given.
assert.deepEqual(ANNOTATION_SIZES, ['xs', 'sm', 'md', 'rg', 'lg', 'xl']);
assert.equal(ANNOTATION_SCALE.rg, 1, 'Regular draws the existing size');
assert.ok(ANNOTATION_SIZES.every((size, index) => !index || ANNOTATION_SCALE[size] > ANNOTATION_SCALE[ANNOTATION_SIZES[index - 1]]), 'Size steps grow monotonically');
assert.deepEqual([defaults.namesSize, defaults.chordSymbolsSize, defaults.countsSize, defaults.subdivisionsSize], ['rg', 'rg', 'rg', 'rg'], 'Every add-on defaults to regular');
assert.deepEqual(settingsToPrefs({ annotationSizes: { noteNames: 'xl', chordSymbols: 'sm', beatCounts: 'lg', subdivisions: 'xs' } }), { namesSize: 'xl', chordSymbolsSize: 'sm', countsSize: 'lg', subdivisionsSize: 'xs' });
assert.deepEqual(settingsToPrefs({ annotationSizes: { noteNames: 'lg' } }), { namesSize: 'lg' }, 'Only the add-ons given are applied');
assert.deepEqual(settingsToPrefs({ annotationSizes: { noteNames: 'huge', beatCounts: 3 } }), {}, 'Unknown sizes are ignored');
assert.deepEqual(settingsToPrefs({ annotationSizes: {} }), {});
{
  const old = sanitizeSavedPrefs({ names: true, counts: true });
  assert.deepEqual([old.namesSize, old.chordSymbolsSize, old.countsSize, old.subdivisionsSize], ['rg', 'rg', 'rg', 'rg'], 'Saved prefs from before sizes read as regular');
  const saved = sanitizeSavedPrefs({ namesSize: 'xl', countsSize: 'bogus' });
  assert.equal(saved.namesSize, 'xl', 'A saved size is kept'); assert.equal(saved.countsSize, 'rg', 'An unknown saved size is repaired to regular');
  // The per-score schema lists the same steps for every size key (optional on read).
  const schema = JSON.parse(readFileSync(new URL('../packages/pepperscore/src/lib/file-state.schema.json', import.meta.url), 'utf8')).properties.settings;
  for (const key of ['namesSize', 'chordSymbolsSize', 'countsSize', 'subdivisionsSize']) {
    assert.deepEqual(schema.properties[key]?.enum, [...ANNOTATION_SIZES], `file-state.schema.json settings.${key} lists the size steps`);
    assert.ok(!schema.required.includes(key), `settings.${key} is optional in the schema`);
  }
}

// The component never reads the page URL (the demo maps ?score= to scoreUrl): no location reads anywhere in the library source.
const src = new URL('../packages/pepperscore/src/', import.meta.url).pathname;
const locationReads = [];
for (const entry of await readdir(src, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
  const path = join(entry.parentPath, entry.name);
  (await readFile(path, 'utf8')).split('\n').forEach((line, index) => { if (/\b(window|document|globalThis|self)\.location\b|(^|[^.\w])location\.\w/.test(line)) locationReads.push(`${path.slice(src.length)}:${index + 1}: ${line.trim()}`); });
}
assert.deepEqual(locationReads, [], 'packages/pepperscore/src never reads the page location (window/document/globalThis.location, location.*)');
// The public entry exports the host-hook types (type-only, so checked in the source).
const entry = await readFile(new URL('../packages/pepperscore/src/index.ts', import.meta.url), 'utf8');
for (const name of ['PepperScoreProps', 'PepperScoreHandle', 'PepperScoreReadyInfo', 'PepperScoreClickInfo', 'PepperScoreHighlight', 'PepperScoreInsets', 'PepperScoreScrollTarget', 'PepperScoreScrollOptions']) {
  assert.match(entry, new RegExp(`export type \\{[^}]*\\b${name}\\b[^}]*\\} from './components/PepperScore'`), `index.ts exports type ${name}`);
}
// Click hit testing over drawn note boxes (client px). Boxes overlap; the click goes to the nearest notehead, and
// noteheads stacked at the same x (two voices, a staff-1 note whose lyric hangs over staff 2) are split by y.
{
  const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
  const drawn = (id, box, head) => ({ id, box, heads: [head] });
  // Two adjacent eighths whose boxes overlap (a wide accidental on b): x decides.
  const a = drawn('a', rect(100, 0, 30, 100), rect(100, 80, 10, 8));
  const b = drawn('b', rect(115, 0, 30, 100), rect(132, 70, 10, 8));
  assert.equal(noteInBox([a, b], 108, 50, 2)?.id, 'a', 'the nearer notehead wins an overlap');
  assert.equal(noteInBox([a, b], 128, 50, 2)?.id, 'b');
  assert.equal(noteInBox([a, b], 200, 50, 2), undefined, 'outside every box hits nothing');
  assert.equal(noteInBox([a, b], 131, 101, 2)?.id, 'b', 'a slop of 2 px around the box still hits');
  // Voice 1 (stem up, lyric below: a tall box) over voice 2 (stem down) at the same x: the click near voice 2's head
  // (inside both boxes) goes to voice 2, not to whichever was drawn first.
  const v1 = drawn('v1', rect(100, 0, 12, 160), rect(100, 50, 12, 8));
  const v2 = drawn('v2', rect(100, 70, 12, 60), rect(100, 70, 12, 8));
  assert.equal(noteInBox([v1, v2], 106, 90, 2)?.id, 'v2', 'same x: the notehead nearer in y wins');
  assert.equal(noteInBox([v2, v1], 106, 40, 2)?.id, 'v1');
  // A chord: the distance runs to its nearest notehead.
  const chord = { id: 'chord', box: rect(100, 0, 12, 160), heads: [rect(100, 20, 12, 8), rect(100, 100, 12, 8)] };
  assert.equal(noteInBox([v2, chord], 106, 104, 2)?.id, 'chord', 'a chord counts its nearest notehead');
  assert.equal(nearestNote([a, b], 300, 50)?.id, 'b', 'the nearest notehead across the bar');
  assert.equal(nearestNote([v1, v2], 106, 75)?.id, 'v2', 'nearest splits same-x noteheads by y');
  assert.equal(nearestNote([], 0, 0), undefined);
}
console.log('API: chrome presets, control overrides, settings mapping, exported host-hook types, click hit testing and no page URL reads passed');
