import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string>; peerDependencies: Record<string, string> };
const externals = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.peerDependencies)];

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
  worker: { format: 'es' },
});
