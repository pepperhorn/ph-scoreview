import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const required = ['dist/index.js', 'dist/index.d.ts', 'dist/style.css'];

function newestSourceTime(dir) {
  return Math.max(...readdirSync(dir).map(name => {
    const path = join(dir, name);
    const stat = statSync(path);
    return stat.isDirectory() ? newestSourceTime(path) : stat.mtimeMs;
  }));
}

try {
  const sourceTime = newestSourceTime(join(root, 'src'));
  for (const file of required) {
    const path = join(root, file);
    let stat;
    try { stat = statSync(path); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw new Error(`${file} is missing`);
    }
    if (!stat.isFile()) throw new Error(`${file} is not a file`);
    if (stat.mtimeMs < sourceTime) throw new Error(`${file} is older than src/`);
  }
} catch (error) {
  console.error(`Editor prepublish guard: ${error.message}. Run npm run build -w @pepperhorn/pepperscore-editor before publishing.`);
  process.exitCode = 1;
}
