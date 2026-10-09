// Local tarballs for manual testing in another project: pepperscore and pepperscore-sounds-core into the gitignored .packs/.
// Install with e.g. `pnpm add /path/to/.packs/pepperscore-0.1.0.tgz`. Nothing is published.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, '.packs');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
mkdirSync(out, { recursive: true });
for (const file of readdirSync(out)) if (/^pepperscore-.*\.tgz$/.test(file)) rmSync(join(out, file));
// What the prepack scripts do, run up front so their output stays out of the --json result: build dist/, generate the core subset.
execFileSync(npm, ['run', 'build', '-w', 'pepperscore'], { cwd: root, stdio: ['ignore', 2, 'inherit'] });
execFileSync(npm, ['run', 'sounds:core'], { cwd: root, stdio: ['ignore', 2, 'inherit'] });
const packed = JSON.parse(execFileSync(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', out, '-w', 'pepperscore', '-w', 'pepperscore-sounds-core'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }));
for (const { filename, size, entryCount } of packed) console.log(`.packs/${filename}  ${(size / 1e6).toFixed(1)} MB, ${entryCount} files`);
