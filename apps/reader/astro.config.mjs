import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import soundPack from './sounds.mjs';
import { thirdPartyNotices } from '../../packages/pepperscore/scripts/third-party-notices.mjs';
import runtimeFilesDev from '../../packages/pepperscore/scripts/dev-runtime-files.mjs';

const librarySource = fileURLToPath(new URL('../../packages/pepperscore/src/', import.meta.url));
const editorSource = fileURLToPath(new URL('../../packages/pepperscore-editor/src/', import.meta.url));
/**
 * `astro dev` works on the library sources (HMR, no rebuild); `astro build` uses the built package like any host.
 * tsconfig.json maps `pepperscore` to the sources for type checks, and Astro hands tsconfig `paths` to Vite, so builds turn that off.
 * On the sources, the files the library loads at runtime (Verovio, the notices) come from runtimeFilesDev.
 */
const devSource = {
  name: 'pepperscore-dev-source',
  hooks: {
    'astro:config:setup': ({ command, updateConfig }) => {
      if (command !== 'dev') { updateConfig({ vite: { resolve: { tsconfigPaths: false } } }); return; }
      updateConfig({ vite: { plugins: [runtimeFilesDev()], resolve: { alias: [{ find: /^pepperscore$/, replacement: `${librarySource}index.ts` }, { find: /^pepperscore\/instruments$/, replacement: `${librarySource}instruments.ts` }, { find: /^pepperscore\/style\.css$/, replacement: `${librarySource}styles.css` }, { find: /^pepperscore-editor$/, replacement: `${editorSource}index.ts` }, { find: /^pepperscore-editor\/style\.css$/, replacement: `${editorSource}style.css` }] } } });
    },
  },
};

const library = JSON.parse(await readFile(new URL('../../packages/pepperscore/package.json', import.meta.url), 'utf8'));
const editor = JSON.parse(await readFile(new URL('../../packages/pepperscore-editor/package.json', import.meta.url), 'utf8'));
/** The demo's own third-party notices at /THIRD_PARTY_NOTICES.txt: pepperscore's, plus the editor's dependencies and React. */
const notices = {
  name: 'pepperscore-reader-notices',
  hooks: {
    'astro:build:done': async ({ dir }) => {
      await writeFile(join(fileURLToPath(dir), 'THIRD_PARTY_NOTICES.txt'), thirdPartyNotices({
        title: 'the pepperscore demo reader',
        packages: [...Object.keys(library.dependencies), ...Object.keys(editor.dependencies), 'react', 'react-dom'],
        from: [fileURLToPath(new URL('../../packages/pepperscore/', import.meta.url)), fileURLToPath(new URL('../../packages/pepperscore-editor/', import.meta.url))],
      }));
    },
  },
};

export default defineConfig({ integrations: [react(), soundPack(), devSource, notices], devToolbar: { enabled: false }, vite: { optimizeDeps: { include: ['abcjs'] } } });
