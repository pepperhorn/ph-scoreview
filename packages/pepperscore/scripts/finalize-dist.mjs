// Publish hygiene for dist/, after vite build and tsc:
// - Worker chunks ship without sourcemaps. Host bundlers copy a worker as a plain asset without its .map (devtools would 404
//   on the sourceMappingURL), and the Verovio worker's map is ~17 MB of Emscripten glue. index.js keeps its map.
// - index.d.ts drops `import './styles.css'` (tsc copies it from src/index.ts; no styles.css exists beside it in dist).
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
