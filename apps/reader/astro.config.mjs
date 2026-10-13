import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { fileURLToPath } from 'node:url';
import soundPack from './sounds.mjs';

const librarySource = fileURLToPath(new URL('../../packages/pepperscore/src/', import.meta.url));
const editorSource = fileURLToPath(new URL('../../packages/pepperscore-editor/src/', import.meta.url));
/**
 * `astro dev` works on the library sources (HMR, no rebuild); `astro build` uses the built package like any host.
 * tsconfig.json maps `pepperscore` to the sources for type checks, and Astro hands tsconfig `paths` to Vite, so builds turn that off.
 */
const devSource = {
  name: 'pepperscore-dev-source',
  hooks: {
    'astro:config:setup': ({ command, updateConfig }) => {
      if (command !== 'dev') { updateConfig({ vite: { resolve: { tsconfigPaths: false } } }); return; }
      updateConfig({ vite: { resolve: { alias: [{ find: /^pepperscore$/, replacement: `${librarySource}index.ts` }, { find: /^pepperscore\/style\.css$/, replacement: `${librarySource}styles.css` }, { find: /^pepperscore-editor$/, replacement: `${editorSource}index.ts` }, { find: /^pepperscore-editor\/style\.css$/, replacement: `${editorSource}style.css` }] } } });
    },
  },
};

export default defineConfig({ integrations: [react(), soundPack(), devSource], devToolbar: { enabled: false }, vite: { optimizeDeps: { include: ['abcjs'] } } });
