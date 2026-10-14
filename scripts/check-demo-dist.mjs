// The demo must build against the library's dist like any host (apps/reader/astro.config.mjs turns tsconfig paths off for
// builds). If it silently compiled src again, its worker would not be the library's dist worker: compare the hashed names.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workers = readdirSync(resolve(root, 'packages/pepperscore/dist/assets')).filter(file => /^(verovio|import)\.worker-[\w-]+\.js$/.test(file));
const demo = readdirSync(resolve(root, 'apps/reader/dist/_astro'));
assert.equal(workers.length, 2, `the library dist has both workers: ${workers}`);
for (const worker of workers) assert.ok(demo.some(file => file.startsWith(worker.replace(/\.js$/, '.'))), `the demo ships the library's ${worker}`);
// Verovio stays its own file (LGPL): the host build copies the library's dist/verovio/ files byte for byte, and the
// demo ships its own third-party notices at the site root.
for (const file of ['verovio-module.mjs', 'verovio.mjs']) {
  const shipped = readFileSync(resolve(root, 'packages/pepperscore/dist/verovio', file));
  const copies = demo.filter(name => name.startsWith(file.replace(/\.mjs$/, '.')) && name.endsWith('.mjs'));
  assert.equal(copies.length, 1, `the demo ships one copy of ${file}: ${copies}`);
  assert.ok(readFileSync(resolve(root, 'apps/reader/dist/_astro', copies[0])).equals(shipped), `the demo's ${copies[0]} is the library's ${file}`);
}
assert.match(readFileSync(resolve(root, 'apps/reader/dist/THIRD_PARTY_NOTICES.txt'), 'utf8'), /Verovio [\d.]+ \(LGPL-3\.0-or-later\)/, 'the demo ships THIRD_PARTY_NOTICES.txt');
console.log('Demo build uses the library dist (worker chunks and Verovio files match) and ships its notices');
