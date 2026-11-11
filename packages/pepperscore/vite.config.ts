import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
// @ts-expect-error plain ESM helper without types
import { thirdPartyNotices, verovioBanner, verovioDist, verovioLicense } from './scripts/third-party-notices.mjs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string>; peerDependencies: Record<string, string> };
const externals = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.peerDependencies)];

/** Upstream Verovio files the worker imports at runtime (see src/runtime-files.ts and verovio-protocol.ts VerovioFiles). */
const VEROVIO_FILES = ['verovio-module.mjs', 'verovio.mjs'];

/** `new URL('./verovio/…' or './THIRD_PARTY_NOTICES.txt', import.meta.url)` as src/runtime-files.ts writes it, after lib mode. */
const RUNTIME_FILE_URL = /new URL\(\s*(?:\/\*\s*@vite-ignore\s*\*\/\s*)?((["'`])\.\/(?:verovio\/[\w.-]+|THIRD_PARTY_NOTICES\.txt)\2)\s*,\s*(?:(["'`])\3\s*\+\s*)?import\.meta\.url\s*\)/g;

/**
 * Verovio (LGPL-3.0-or-later) is not bundled: upstream's own files are copied into dist/verovio/ unmodified, under a
 * licence comment, next to a LICENSE, and the worker imports them at runtime (replaceable through `verovioBaseUrl`).
 * THIRD_PARTY_NOTICES.txt covers the runtime dependencies, Verovio and the fonts.
 */
// Keep the reader's static graph in its entry, including host-resolvable runtime URLs.
// Leave modules also needed by framework-free audio/instruments to automatic sharing;
// following importedIds (not dynamicallyImportedIds) keeps PDF entirely lazy.
const readerModules = new Set<string>();
const readerChunk: Plugin = {
  name: 'reader-chunk',
  buildEnd() {
    const ids = [...this.getModuleIds()];
    const collect = (suffix: string) => {
      const found = new Set<string>();
      const walk = (id: string) => {
        const info = this.getModuleInfo(id);
        if (!info || info.isExternal || found.has(id)) return;
        found.add(id);
        info.importedIds.forEach(walk);
      };
      const entry = ids.find(id => id.endsWith('/packages/pepperscore/src/' + suffix));
      if (entry) walk(entry);
      return found;
    };
    const shared = new Set([...collect('audio.ts'), ...collect('instruments.ts')]);
    for (const id of collect('index.ts')) if (!shared.has(id)) readerModules.add(id);
  },
};
const runtimeFiles: Plugin = {
  name: 'pepperscore-runtime-files',
  apply: 'build',
  generateBundle() {
    for (const file of VEROVIO_FILES) {
      this.emitFile({ type: 'asset', fileName: `verovio/${file}`, source: verovioBanner(file) + readFileSync(join(verovioDist(), file), 'utf8') });
    }
    this.emitFile({ type: 'asset', fileName: 'verovio/LICENSE', source: verovioLicense() });
    this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt', source: thirdPartyNotices() });
  },
  // src/runtime-files.ts: drop the `@vite-ignore` (and the `"" +` lib mode adds) so host bundlers see a plain asset URL.
  // The rewrite keeps the match's line count and the length of its last line, so the code after it does not move and
  // the sourcemap stays valid (`map: null`). scripts/finalize-dist.mjs accepts the whitespace before `)`.
  renderChunk(code) {
    const plain = code.replace(RUNTIME_FILE_URL, (match, path: string) => {
      const url = `new URL(${path}, import.meta.url`;
      const lines = match.split('\n');
      if (lines.length === 1) return `${url}${' '.repeat(Math.max(0, match.length - url.length - 1))})`;
      return `${url}${'\n'.repeat(lines.length - 1)}${' '.repeat(lines.at(-1)!.length - 1)})`;
    });
    return plain === code ? null : { code: plain, map: null };
  },
};

/** Library mode: three ESM entries, one stylesheet, the two workers as separate chunks, and the runtime files above. */
export default defineConfig({
  base: './',
  plugins: [runtimeFiles, readerChunk],
  build: {
    // Three entries: the reader (index.js), the framework-free audio engine (audio.js, `pepperscore/audio`) and the
    // framework-free instrument model (instruments.js, `pepperscore/instruments`). Code the entries share
    // (audio-engine's shared AudioContext and playback owner) lands in one shared chunk, so the two never hold
    // separate copies of that state.
    lib: { entry: { index: fileURLToPath(new URL('./src/index.ts', import.meta.url)), audio: fileURLToPath(new URL('./src/audio.ts', import.meta.url)), instruments: fileURLToPath(new URL('./src/instruments.ts', import.meta.url)) }, formats: ['es'], fileName: (_format, name) => `${name}.js`, cssFileName: 'style' },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: { preserveEntrySignatures: 'allow-extension', external: id => externals.some(dep => id === dep || id.startsWith(`${dep}/`)),
      // allow-extension permits private exports from the reader to its lazy PDF chunks.
      output: { codeSplitting: { groups: [{ name: 'reader', test: id => readerModules.has(id), includeDependenciesRecursively: false }] } },
    },
  },
  worker: { format: 'es', rolldownOptions: { output: { codeSplitting: false } } },
});
