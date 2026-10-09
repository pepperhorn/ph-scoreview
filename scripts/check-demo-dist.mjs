// The demo must build against the library's dist like any host (apps/reader/astro.config.mjs turns tsconfig paths off for
// builds). If it silently compiled src again, its worker would not be the library's dist worker: compare the hashed names.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workers = readdirSync(resolve(root, 'packages/pepperscore/dist/assets')).filter(file => /^(verovio|import)\.worker-[\w-]+\.js$/.test(file));
const demo = readdirSync(resolve(root, 'apps/reader/dist/_astro'));
assert.equal(workers.length, 2, `the library dist has both workers: ${workers}`);
for (const worker of workers) assert.ok(demo.some(file => file.startsWith(worker.replace(/\.js$/, '.'))), `the demo ships the library's ${worker}`);
console.log('Demo build uses the library dist (worker chunks match)');
