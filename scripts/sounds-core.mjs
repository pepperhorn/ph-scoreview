// Generate pepperscore-sounds-core from pepperscore-sounds-complete (the only copy of the assets in git).
// Usage: node scripts/sounds-core.mjs [outDir]   (default packages/pepperscore-sounds-core; prepack runs it there)
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { COMPLETE_DIR, CORE_DIR, CORE_FLUIDR3 } from './sound-packs.mjs';

const out = resolve(process.argv[2] ?? CORE_DIR);
for (const entry of ['fonts', 'instruments', 'soundfonts', 'pack.json']) await rm(join(out, entry), { recursive: true, force: true });
await mkdir(join(out, 'soundfonts/fluidr3'), { recursive: true });
await cp(join(COMPLETE_DIR, 'fonts'), join(out, 'fonts'), { recursive: true });
await cp(join(COMPLETE_DIR, 'instruments'), join(out, 'instruments'), { recursive: true });
await cp(join(COMPLETE_DIR, 'soundfonts/perfect-drums'), join(out, 'soundfonts/perfect-drums'), { recursive: true });
for (const file of ['TimGM6mb.sf2', 'COPYING.txt']) await cp(join(COMPLETE_DIR, 'soundfonts', file), join(out, 'soundfonts', file));
await cp(join(COMPLETE_DIR, 'soundfonts/fluidr3/ATTRIBUTION.txt'), join(out, 'soundfonts/fluidr3/ATTRIBUTION.txt'));
for (const name of CORE_FLUIDR3) await cp(join(COMPLETE_DIR, 'soundfonts/fluidr3', `${name}.json`), join(out, 'soundfonts/fluidr3', `${name}.json`));
await writeFile(join(out, 'pack.json'), `${JSON.stringify({ pack: 'core', fluidr3: CORE_FLUIDR3 }, null, 2)}\n`);
console.log(`pepperscore-sounds-core: ${CORE_FLUIDR3.length} FluidR3 sounds written to ${out}`);
