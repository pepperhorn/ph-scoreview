import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string>; peerDependencies: Record<string, string> };
const externals = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.peerDependencies)];

/**
 * Verovio's Emscripten glue imports `node:module` only on its Node branch. A stub keeps it inside the worker chunk instead
 * of a separate browser-external chunk that hosts would never copy next to the worker.
 */
const nodeModuleStub = {
  name: 'pepperscore-node-module-stub',
  enforce: 'pre' as const,
  resolveId: (id: string) => (id === 'node:module' ? '\0node-module-stub' : null),
  load: (id: string) => (id === '\0node-module-stub' ? 'export const createRequire = () => { throw new Error("node:module is not available in the browser"); }; export default { createRequire };' : null),
};

/** Library mode: one ESM entry, one stylesheet, and the two workers as separate chunks (Verovio's WASM stays inlined in its worker). */
export default defineConfig({
  base: './',
  build: {
    lib: { entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)), formats: ['es'], fileName: () => 'index.js', cssFileName: 'style' },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: { external: id => externals.some(dep => id === dep || id.startsWith(`${dep}/`)) },
  },
  worker: { format: 'es', plugins: () => [nodeModuleStub], rolldownOptions: { output: { codeSplitting: false } } },
});
