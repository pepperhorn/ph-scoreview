// Chrome presets and settings mapping for the public PepperScore props (pure modules, run in Node).
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveChrome } from '../packages/pepperscore/src/lib/chrome.ts';
import { defaults, settingsToPrefs, viewToMode } from '../packages/pepperscore/src/lib/prefs.ts';

const all = { header: true, transport: true, viewToggle: true, openFile: true, mixer: true, drawer: true, zoom: true, compactPlay: false, playhead: true, partControls: true, audio: true };
assert.deepEqual(resolveChrome(), all, 'full is the default');
assert.deepEqual(resolveChrome('full'), all);
assert.deepEqual(resolveChrome('minimal'), { header: false, transport: false, viewToggle: false, openFile: false, mixer: false, drawer: false, zoom: false, compactPlay: true, playhead: true, partControls: false, audio: true });
assert.deepEqual(resolveChrome('none'), { header: false, transport: false, viewToggle: false, openFile: false, mixer: false, drawer: false, zoom: false, compactPlay: false, playhead: false, partControls: false, audio: false });
assert.deepEqual(resolveChrome('full', { mixer: false, openFile: false }), { ...all, mixer: false, openFile: false, partControls: false });
const minimalWithToggle = resolveChrome('minimal', { viewToggle: true });
assert.equal(minimalWithToggle.header, true); assert.equal(minimalWithToggle.compactPlay, true);
const minimalWithTransport = resolveChrome('minimal', { transport: true });
assert.equal(minimalWithTransport.compactPlay, false, 'header transport replaces the compact button');
assert.equal(resolveChrome('none', { transport: true }).audio, true, 'a host can opt none into playback');

assert.deepEqual(settingsToPrefs({ noteNames: true, chordSymbols: true, inferChords: true, beatCounts: true, subdivisions: false, musicFont: 'Petaluma', staveFont: 'Serif', barsPerLine: 3, zoom: 1.5, semitones: 2, concert: true, overlap: 2 }),
  { names: true, chordSymbols: true, inferChordSymbols: true, counts: true, subdivisions: false, notationFont: 'Petaluma', annotationFont: 'Serif', barsPerLine: 3, zoom: 1.5, semitones: 2, scorePitch: 'concert', overlap: 2 });
assert.deepEqual(settingsToPrefs({}), {}, 'only given keys are applied');
assert.deepEqual(settingsToPrefs({ semitones: 40, overlap: 9, barsPerLine: 7, concert: false, zoom: null }), { semitones: 12, overlap: 3, barsPerLine: 7, scorePitch: 'written', zoom: null });
assert.equal(settingsToPrefs({ barsPerLine: 12 }).barsPerLine, 8, 'barsPerLine is clamped to 1-8');
assert.equal(settingsToPrefs({ barsPerLine: 0 }).barsPerLine, 1, 'barsPerLine is clamped to 1-8');
assert.equal(viewToMode('vertical'), 'portrait'); assert.equal(viewToMode('endless'), 'landscape');
assert.equal(defaults.mode, 'portrait');

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
console.log('API: chrome presets, control overrides, settings mapping, exported host-hook types and no page URL reads passed');
