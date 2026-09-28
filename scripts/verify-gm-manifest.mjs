import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, 'src/lib/gm-soundfont-manifest.json'), 'utf8'));
assert.equal(manifest.version, 1);
assert.equal(manifest.programNumbering, 'GM 1-128');
assert.equal(manifest.programs.length, 128);
assert.equal(manifest.voices.length, 16);
const families = ['Keyboard', 'Guitar', 'Voice', 'Percussion', 'Drums', 'Woodwinds', 'Brass', 'Strings', 'FX / Other'];

for (const [index, entry] of manifest.programs.entries()) {
  assert.equal(entry.program, index + 1, 'GM programs must stay in order');
  assert.match(entry.soundfont, /^[a-z0-9_]+$/);
  assert.ok(manifest.icons[entry.icon], `Missing icon mapping for ${entry.soundfont}`);
  assert.ok(families.includes(entry.family), `Missing family for ${entry.soundfont}`);
  assert.equal(entry.localPack, `/soundfonts/fluidr3/${entry.soundfont}.json`);
  const pack = JSON.parse(await readFile(resolve(root, 'public', entry.localPack.slice(1)), 'utf8'));
  assert.equal(pack.name, entry.soundfont);
  assert.ok(Object.keys(pack.samples).length > 0, `Empty audio pack for ${entry.soundfont}`);
}
for (const [id, icon] of Object.entries(manifest.icons)) {
  assert.equal(icon, `src/icons/${id}.svg`);
  await stat(resolve(root, icon));
}
for (const voice of manifest.voices) {
  assert.ok(manifest.icons[voice.icon], `Missing icon for ${voice.id}`);
  const packPath = resolve(root, 'public', voice.localPack.replace(/^\//, ''));
  assert.ok((await stat(packPath)).size > 1000, `Missing audio pack for ${voice.id}`);
  if (voice.program === null) {
    assert.equal(voice.id, 'drum-kit');
    assert.match(voice.localPack, /\.sf2$/);
  } else {
    const gm = manifest.programs[voice.program - 1];
    assert.equal(voice.icon, gm.icon, `Voice icon differs from GM program ${voice.program}`);
    assert.equal(voice.localPack, `/soundfonts/fluidr3/${gm.soundfont}.json`);
    assert.ok(Object.keys(JSON.parse(await readFile(packPath, 'utf8')).samples).length > 0);
  }
}
console.log('GM manifest: 128 local packs, 16 icons and playable voices verified.');
