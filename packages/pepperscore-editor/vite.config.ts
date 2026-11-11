import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.peerDependencies)];
export default defineConfig({
  build: {
    lib: { entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)), formats: ['es'], fileName: () => 'index.js', cssFileName: 'style' },
    target: 'es2022',
    rollupOptions: { external: id => external.some(dep => id === dep || id.startsWith(`${dep}/`)) },
  },
});
