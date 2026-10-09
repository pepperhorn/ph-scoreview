// Poppins stays an @fontsource import in dist/style.css (resolved by the host's bundler) instead of being inlined:
// library mode would otherwise embed every Poppins woff2 as base64.
import { readFile, writeFile } from 'node:fs/promises';

const file = new URL('../dist/style.css', import.meta.url);
const css = await readFile(file, 'utf8');
const imports = [400, 500, 600, 700].map(weight => `@import "@fontsource/poppins/${weight}.css";`).join('\n');
if (!css.includes('@fontsource/poppins/400.css')) {
  const charset = css.match(/^@charset "[^"]*";\s*/)?.[0] ?? '';
  await writeFile(file, `${charset}${imports}\n${css.slice(charset.length)}`);
}
