// The two sound packs: complete's pack.json matches its files, core is generated from complete (scripts/sounds-core.mjs),
// and both package versions match the SOUNDS_VERSION the library loads by default.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { COMPLETE_DIR, CORE_FLUIDR3 } from '../scripts/sound-packs.mjs';

const root = resolve(import.meta.dirname, '..');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const size = dir => readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory() ? size(join(dir, entry.name)) : statSync(join(dir, entry.name)).size), 0);
const gmNames = json(join(root, 'packages/pepperscore/src/lib/gm-soundfont-manifest.json')).programs.map(program => program.soundfont);

const complete = json(join(COMPLETE_DIR, 'pack.json'));
assert.equal(complete.pack, 'complete');
assert.deepEqual(complete.fluidr3, gmNames, 'complete pack.json lists all 128 FluidR3 sounds in GM order');
const onDisk = readdirSync(join(COMPLETE_DIR, 'soundfonts/fluidr3')).filter(file => file.endsWith('.json')).map(file => file.slice(0, -5)).sort();
assert.deepEqual(onDisk, [...gmNames].sort(), 'complete has a pack file for every GM program');

assert.equal(CORE_FLUIDR3.length, 19);
for (const name of CORE_FLUIDR3) assert.ok(gmNames.includes(name), `${name} is a GM FluidR3 sound`);
const out = mkdtempSync(join(tmpdir(), 'pepperscore-core-'));
try {
  execFileSync(process.execPath, [join(root, 'scripts/sounds-core.mjs'), out], { stdio: 'pipe' });
  assert.deepEqual(json(join(out, 'pack.json')), { pack: 'core', fluidr3: CORE_FLUIDR3 });
  assert.deepEqual(readdirSync(join(out, 'soundfonts/fluidr3')).sort(), [...CORE_FLUIDR3.map(name => `${name}.json`), 'ATTRIBUTION.txt'].sort());
  for (const file of ['fonts/Bravura.woff2', 'fonts/Petaluma.woff2', 'fonts/PetalumaScript.woff2', 'fonts/Petaluma-OFL.txt', 'instruments/piano.svg', 'soundfonts/TimGM6mb.sf2', 'soundfonts/COPYING.txt', 'soundfonts/perfect-drums/manifest.json']) {
    assert.ok(statSync(join(out, file)).size > 0, `core has ${file}`);
  }
  const bytes = size(out);
  assert.ok(bytes < 20 * 2 ** 20, `core is ${(bytes / 2 ** 20).toFixed(1)} MB, expected about 15 MB`);
} finally { rmSync(out, { recursive: true, force: true }); }

const soundsVersion = readFileSync(join(root, 'packages/pepperscore/src/lib/assets.ts'), 'utf8').match(/SOUNDS_VERSION = '([^']+)'/)[1];
for (const pack of ['core', 'complete']) assert.equal(json(join(root, `packages/pepperscore-sounds-${pack}/package.json`)).version, soundsVersion, `pepperscore-sounds-${pack} version matches SOUNDS_VERSION`);
console.log(`Sound packs: complete pack.json, generated core (${CORE_FLUIDR3.length} FluidR3 sounds) and versions passed`);
