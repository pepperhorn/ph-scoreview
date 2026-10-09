// Sound resolution (packages/pepperscore/src/lib/sounds.ts): soundSources first, then the pack's FluidR3 sound, then TimGM6mb.
import assert from 'node:assert/strict';
import { BUILTIN_DRUMS, BUILTIN_FLUIDR3, BUILTIN_SF2, planKey, planSound } from '../packages/pepperscore/src/lib/sounds.ts';

const base = 'https://cdn.example/pepperscore-sounds-core@0.1.0/';
const page = 'https://site.example/lessons/one.html';
const fluidr3 = new Set(['acoustic_grand_piano', 'flute']);
const piano = { drums: false, program: 1, name: 'acoustic_grand_piano' };
const harp = { drums: false, program: 47, name: 'orchestral_harp' };
const kit = { drums: true };
const ctx = extra => ({ fluidr3, base, page, ...extra });

assert.deepEqual(planSound(piano, ctx()), { kind: 'sample-pack', sourceId: BUILTIN_FLUIDR3, url: `${base}soundfonts/fluidr3/acoustic_grand_piano.json`, name: 'acoustic_grand_piano' });
assert.deepEqual(planSound(harp, ctx()), { kind: 'sf2', sourceId: BUILTIN_SF2, url: `${base}soundfonts/TimGM6mb.sf2`, drums: false, program: 47 }, 'a program missing from the pack falls back to TimGM6mb');
assert.deepEqual(planSound(kit, ctx()), { kind: 'note-files', sourceId: BUILTIN_DRUMS, manifest: `${base}soundfonts/perfect-drums/manifest.json`, drums: true });

const sources = [
  { id: 'brass', kind: 'sample-pack', url: '/sounds/{name}.json', programs: [57, 58] },
  { id: 'piano-sf2', kind: 'sf2', url: 'sf/piano.sf2', programs: [1], preset: 'Grand' },
  { id: 'also-piano', kind: 'sample-pack', url: '/never/{name}.json', programs: [1] },
  { id: 'kit', kind: 'note-files', manifest: 'https://kits.example/k/manifest.json', drums: true },
];
assert.deepEqual(planSound(piano, ctx({ sources })), { kind: 'sf2', sourceId: 'piano-sf2', url: 'https://site.example/lessons/sf/piano.sf2', drums: false, program: 1, preset: 'Grand' }, 'the first claiming source wins; relative URLs resolve against the page');
assert.deepEqual(planSound({ drums: false, program: 57, name: 'trumpet' }, ctx({ sources })), { kind: 'sample-pack', sourceId: 'brass', url: 'https://site.example/sounds/trumpet.json', name: 'trumpet' }, '{name} is filled in');
assert.deepEqual(planSound(kit, ctx({ sources })), { kind: 'note-files', sourceId: 'kit', manifest: 'https://kits.example/k/manifest.json', drums: true });
assert.deepEqual(planSound(kit, ctx({ sources: [{ id: 'sf', kind: 'sf2', url: '/gm.sf2', drums: true }] })), { kind: 'sf2', sourceId: 'sf', url: 'https://site.example/gm.sf2', drums: true });
assert.equal(planSound(kit, ctx({ sources: [{ id: 'x', kind: 'sample-pack', url: '/{name}.json', programs: [1] }] })).sourceId, BUILTIN_DRUMS, 'a sample pack never claims drums');
assert.equal(planSound(piano, ctx({ sources: [{ id: 'k', kind: 'note-files', manifest: '/m.json', drums: true }] })).sourceId, BUILTIN_FLUIDR3, 'a source without programs claims no melodic part');
assert.notEqual(planKey(planSound(harp, ctx())), planKey(planSound({ ...harp, program: 48, name: 'string_ensemble_1' }, ctx({ fluidr3: new Set() }))), 'sf2 programs get their own players');
console.log('Sound resolution: sources, pack sounds, TimGM6mb fallback and drums passed');
