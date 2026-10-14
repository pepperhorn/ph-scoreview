// Publish hygiene for dist/, after vite build and tsc:
// - Worker chunks ship without sourcemaps. Host bundlers copy a worker as a plain asset without its .map (devtools would 404
//   on the sourceMappingURL), and the Verovio worker's map is ~17 MB of Emscripten glue. index.js keeps its map.
// - index.d.ts drops `import './styles.css'` (tsc copies it from src/index.ts; no styles.css exists beside it in dist).
// - Checks Verovio stays a separate file (LGPL-3.0-or-later; see src/runtime-files.ts): dist/verovio/ holds upstream's
//   files and a LICENSE, index.js refers to them (and to THIRD_PARTY_NOTICES.txt) in the plain `new URL('./…',
//   import.meta.url)` form host bundlers copy, and no Verovio code is bundled into the worker chunk.
import assert from 'node:assert/strict';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url);
const assets = new URL('assets/', dist);
for (const file of await readdir(assets)) {
  if (!/\.worker-[\w-]+\.js(\.map)?$/.test(file)) continue;
  const url = new URL(file, assets);
  if (file.endsWith('.map')) { await rm(url); continue; }
  const code = await readFile(url, 'utf8');
  await writeFile(url, code.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n'));
}
const types = new URL('index.d.ts', dist);
await writeFile(types, (await readFile(types, 'utf8')).replace(/^import '\.\/styles\.css';\n/m, ''));

const index = await readFile(new URL('index.js', dist), 'utf8');
for (const path of ['./verovio/verovio-module.mjs', './verovio/verovio.mjs', './THIRD_PARTY_NOTICES.txt']) {
  const plain = new RegExp(`new URL\\("${path.replaceAll('.', '\\.')}", import\\.meta\\.url\\s*\\)`);
  assert.match(index, plain, `dist/index.js refers to ${path} as a plain new URL(…, import.meta.url)`);
}
for (const file of ['verovio/verovio-module.mjs', 'verovio/verovio.mjs']) {
  assert.match(await readFile(new URL(file, dist), 'utf8'), /^\/\*!\n \* Verovio [\d.]+ .*LGPL-3\.0-or-later/s, `dist/${file} starts with its licence comment`);
}
assert.match(await readFile(new URL('verovio/LICENSE', dist), 'utf8'), /GNU LESSER GENERAL PUBLIC LICENSE/);
assert.match(await readFile(new URL('THIRD_PARTY_NOTICES.txt', dist), 'utf8'), /Verovio [\d.]+ \(LGPL-3\.0-or-later\)/);
for (const file of await readdir(assets)) {
  if (/^verovio\.worker-[\w-]+\.js$/.test(file)) assert.ok(!(await readFile(new URL(file, assets), 'utf8')).includes('vrvToolkit_constructor'), `${file} bundles no Verovio code`);
}
