// Chrome presets and settings mapping for the public PepperScore props (pure modules, run in Node).
import assert from 'node:assert/strict';
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
assert.deepEqual(settingsToPrefs({ semitones: 40, overlap: 9, barsPerLine: 7, concert: false, zoom: null }), { semitones: 12, overlap: 3, barsPerLine: 4, scorePitch: 'written', zoom: null });
assert.equal(viewToMode('vertical'), 'portrait'); assert.equal(viewToMode('endless'), 'landscape');
assert.equal(defaults.mode, 'portrait');

console.log('API: chrome presets, control overrides, settings mapping passed');
