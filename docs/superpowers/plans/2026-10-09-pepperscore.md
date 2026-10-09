# pepperscore Embeddable Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-app Scoreflow reader into the public MIT npm package `pepperscore` (`<PepperScore … />`), plus two asset packages, while the Astro site keeps working as a demo that consumes the package like any other host.

**Architecture:** npm workspaces: `packages/pepperscore` (library: Vite library mode, ESM + `.d.ts` + `style.css`, workers as chunks), `packages/pepperscore-sounds-complete` (all assets, the only copy in git), `packages/pepperscore-sounds-core` (generated subset), `apps/reader` (today's Astro page). Work lands in four PR-sized phases: (1) move into workspaces with no behaviour change, (2) asset base URL and sound resolution, (3) CSS/layout isolation, multi-instance engine and persist namespaces, (4) the public `PepperScore` API, the library build, pack smoke test and docs.

**Tech Stack:** React 19, Astro 7, Vite 8 (library mode), TypeScript 5.9, Verovio 6.3.0 (WASM in a worker), smplr + soundfont2, playwright-core validation scripts with `node:assert`, Node 22, npm workspaces, GitHub Actions.

**Spec:** `docs/specs/pepperscore-embeddable-component.md` (approved 2026-10-09). Read it before every task.

## Global Constraints

- `react` and `react-dom` are **peer dependencies `>=19`** of `pepperscore`; every other runtime dependency is a regular `dependency`.
- `pepperscore` is **MIT** licensed (copy `LICENSE` into the package). The sounds packages declare their asset licenses (OFL fonts, CC BY 3.0 FluidR3, GPL-2 TimGM6mb, Perfect Drums attribution).
- UI font is **Poppins** via `@fontsource/poppins` (weights 400, 500, 600, 700). Do not add other UI fonts.
- Every new element gets a **contextual class name alongside any utility classes** (e.g. `className="ps-compact-play icon-button"`). Keep existing contextual class names, except the renames listed in Task 3.1.
- Any dev server is started with **`--host 0.0.0.0`** (`apps/reader` script: `astro dev --host 0.0.0.0`).
- **No npm publishing in CI.** Publishing is manual (`npm publish -w …`). Nothing in `.github/workflows` may run `npm publish`.
- **Existing users' saved state is preserved:** the demo passes `persist="scoreflow"`, which must produce exactly today's names: IndexedDB `scoreflow` and `scoreflow-last-file`; localStorage `scoreflow-prefs`, `scoreflow-file-v2:<hash>`, `scoreflow-pending-v2:<hash>`, `scoreflow-file-v1:<hash>`; sessionStorage `scoreflow-reopen-dismissed`.
- The component **never reads `window.location`**. The demo maps `?score=` to `scoreUrl`.
- All library CSS is scoped under **`.pepperscore`**; no rules on `:root`, `html`, `body` or bare `*` (`.pepperscore *` is allowed). No `position: fixed`, no `vh/dvh/vw` units, no viewport `@media` width/height queries.
- Default `assetBaseUrl` is exactly `https://cdn.jsdelivr.net/npm/pepperscore-sounds-${soundPack}@${SOUNDS_VERSION}/`; `soundPack` defaults to `"core"`.
- Verovio stays pinned at `6.3.0` with its WASM inlined in its worker.
- The browser suites (`validation/`) make no remote requests: the demo and test pages pass a local `assetBaseUrl` (`/` or `/custom-assets`). `validation/reader.mjs` asserts "Scores and resources stay local". `npm run test:pack` (`scripts/pack-smoke.mjs`) is the exception: it installs react, vite and astro from the npm registry, so it needs the network. It runs in CI and publishes nothing.
- Tests are **plain node scripts** under `validation/` (playwright-core + `node:assert/strict`), or node-only scripts importing pure `.ts` modules (Node 22 strips types; such modules may only have `import type` imports). No test framework.
- `tests/` and `examples/` stay gitignored and are never committed. Do not edit them.
- Each phase is one PR that leaves `main` green: `npm run check`, `npm run build`, `npm run test:manifest`, `npm run test:validation` (Chromium), and the Firefox/WebKit matrix (`test:reader`, `test:chunks`, plus `test:embed` from Phase 3).
- Workers run in git worktrees. **Do not start, stop or restart the dev server of the main checkout** (`/home/shaun/ph-vexflow-view`, port 4321). If you need a dev server, run it from your worktree on another port (`npm run dev -- --port 4400`), still with `--host 0.0.0.0`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Host page with Tailwind-preflight-style global element rules** (`*{margin:0;padding:0;border:0 solid}`, `button{background-color:transparent}`, `h1{font-size:inherit}`, `img,svg{display:block}`): the reader must look the same as on its own page (play button keeps its green background, the score title keeps 30px, the header fits). Pinned by the host stylesheet and assertions in Task 3.2.
2. **Host `settings` lost when a score loads with no saved record** (today `loadScore` resets `zoom`, `semitones`, `scorePitch`, `keyFlip`, `bpm`): a snippet with `settings={{ zoom: 1.5 }}` must render at 1.5 after its score loads and after its source changes. Pinned in Task 4.2.
3. **Unmounting one instance** (SPA navigation, a host removing a snippet): the shared Verovio worker and the shared AudioContext must survive for the other instances, which keep re-engraving and playing. Pinned in Task 3.3.
4. **`assetBaseUrl` given without a trailing slash or as a relative path** (`/custom-assets`, `assets`): assets must resolve under it, not beside it. Pinned in Task 2.1 (node) and Task 4.2 (the embed page uses `/custom-assets` with no slash).
5. **Duplicate DOM ids and ARIA references across instances** (`header-secondary-panel`, `overhang`): ids must be unique per page and each `aria-controls`/`htmlFor` must resolve inside its own root. Pinned in Task 3.2.

---

## File map (end state)

```
package.json                         root: private, workspaces, delegating scripts, devDeps (playwright-core, typescript, vite, postcss)
apps/reader/
  package.json, astro.config.mjs, tsconfig.json
  sounds.mjs                         Astro integration: serves/copies the sound pack at "/"
  src/pages/index.astro              demo page
  src/pages/embed-test.astro         host-styled page for validation/embed.mjs
  src/DemoReader.tsx                 maps ?score= to scoreUrl (Phase 4)
  src/embed/EmbedTest.tsx, src/embed/host.css
  src/demo.css, src/favicon.svg
packages/pepperscore/
  package.json, tsconfig.json, tsconfig.build.json, vite.config.ts, README.md, LICENSE
  scripts/finalize-css.mjs
  src/index.ts
  src/styles.css                     (moved from src/styles.css)
  src/components/PepperScore.tsx     (Reader.tsx renamed in Phase 4), OpenScoreDialog.tsx, open-score-dialog.css
  src/icons/*.svg
  src/lib/* (moved) + new: assets.ts, asset-fonts.ts, sounds.ts, sound-players.ts, sf2-player.ts,
          audio-engine.ts, storage.ts, prefs.ts, chrome.ts
packages/pepperscore-sounds-complete/  package.json, README.md, LICENSES.md, pack.json, fonts/, instruments/, soundfonts/
packages/pepperscore-sounds-core/      package.json, README.md, LICENSES.md (generated dirs + pack.json gitignored)
scripts/                             verify-gm-manifest.mjs, prepare-*.mjs, sound-packs.mjs, sounds-core.mjs, pack-smoke.mjs
validation/                          existing suites + assets.mjs, sound-packs.mjs, sounds.mjs, css-scope.mjs, api.mjs, embed.mjs, serve-dist.mjs
```

---

# Phase 1 — Workspaces move (PR `chore/workspaces`, no behaviour change)

### Task 1.1: Workspace skeleton, library source and Astro app

**Files:**
- Move (git mv): `src/lib/` → `packages/pepperscore/src/lib/`, `src/components/` → `packages/pepperscore/src/components/`, `src/icons/` → `packages/pepperscore/src/icons/`, `src/styles.css` → `packages/pepperscore/src/styles.css`, `src/pages/index.astro` → `apps/reader/src/pages/index.astro`, `src/favicon.svg` → `apps/reader/src/favicon.svg`, `astro.config.mjs` → `apps/reader/astro.config.mjs`
- Create: `packages/pepperscore/package.json`, `packages/pepperscore/tsconfig.json`, `packages/pepperscore/src/index.ts`, `apps/reader/package.json`, `apps/reader/tsconfig.json`
- Modify: `package.json` (root), `tsconfig.json` (root: delete it), `package-lock.json` (regenerated)

**Interfaces:**
- Consumes: nothing.
- Produces: package `pepperscore` whose `exports` are `"."` → `./src/index.ts` and `"./style.css"` → `./src/styles.css` (source exports until Task 4.3). `src/index.ts` exports `Reader` (default too) and `type ReaderProps`. Workspace names: `pepperscore`, `pepperscore-reader` (path `apps/reader`). Root scripts `dev`, `build`, `check` delegate to workspaces.

- [ ] **Step 1: Write the failing check**

Run from the worktree root (this is the test for this task; it must fail now because nothing exists yet):

```bash
test -f packages/pepperscore/src/index.ts && test -f apps/reader/src/pages/index.astro && npm run check && npm run build && test -f apps/reader/dist/index.html
```
Expected: FAIL (`packages/pepperscore/src/index.ts` missing).

- [ ] **Step 2: Move the sources**

```bash
mkdir -p packages/pepperscore/src apps/reader/src/pages
git mv src/lib packages/pepperscore/src/lib
git mv src/components packages/pepperscore/src/components
git mv src/icons packages/pepperscore/src/icons
git mv src/styles.css packages/pepperscore/src/styles.css
git mv src/pages/index.astro apps/reader/src/pages/index.astro
git mv src/favicon.svg apps/reader/src/favicon.svg
git mv astro.config.mjs apps/reader/astro.config.mjs
git rm -q tsconfig.json
```

- [ ] **Step 3: Create the library package**

`packages/pepperscore/package.json`:
```json
{
  "name": "pepperscore",
  "version": "0.1.0",
  "private": true,
  "description": "An embeddable, browser-only music score reader for React: MusicXML, MXL, MIDI, MEI and ABC, engraved by Verovio, with playback.",
  "license": "MIT",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./style.css": "./src/styles.css"
  },
  "scripts": {
    "check": "tsc --noEmit -p ."
  },
  "peerDependencies": {
    "react": ">=19",
    "react-dom": ">=19"
  },
  "dependencies": {
    "@fontsource/poppins": "^5.3.0",
    "@tonejs/midi": "^2.0.28",
    "abcjs": "^6.7.1",
    "fflate": "^0.8.3",
    "lucide-react": "^0.468.0",
    "smplr": "^1.0.0",
    "soundfont2": "^0.5.0",
    "verovio": "6.3.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "typescript": "^5.9.3",
    "vite": "^8.3.1"
  }
}
```
(`"private": true` prevents an accidental publish of the source-export layout; Task 4.3 removes it.)

`packages/pepperscore/tsconfig.json` (the options `astro/tsconfigs/strict` gave the old root config, without depending on Astro):
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "noEmit": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": true,
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "types": ["vite/client"]
  },
  "include": ["src/**/*"]
}
```

`packages/pepperscore/src/index.ts`:
```ts
export { default, default as Reader } from './components/Reader';
export type { ReaderProps } from './components/Reader';
```

- [ ] **Step 4: Create the Astro app package**

`apps/reader/package.json`:
```json
{
  "name": "pepperscore-reader",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev --host 0.0.0.0",
    "build": "astro build",
    "preview": "astro preview --host 0.0.0.0",
    "check": "astro check && tsc --noEmit"
  },
  "dependencies": {
    "@astrojs/react": "^7.0.0",
    "@fontsource/poppins": "^5.3.0",
    "astro": "^7.3.5",
    "pepperscore": "0.1.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@astrojs/check": "^0.9.5",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "typescript": "^5.9.3"
  }
}
```

`apps/reader/tsconfig.json`:
```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "react", "types": ["vite/client"] },
  "include": [".astro/types.d.ts", "src/**/*"]
}
```

Edit `apps/reader/src/pages/index.astro` frontmatter to import from the package:
```astro
---
import Reader from 'pepperscore';
import favicon from '../favicon.svg?url';
import 'pepperscore/style.css';
---
```
(the rest of the file is unchanged: `<body><Reader client:load /></body>`).

`apps/reader/astro.config.mjs` stays as moved (react integration, `devToolbar: { enabled: false }`, `vite.optimizeDeps.include: ['abcjs']`).

- [ ] **Step 5: Rewrite the root package.json**

Replace the root `package.json` with (all `test:*` scripts are unchanged from today):
```json
{
  "name": "pepperscore-monorepo",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "dev": "npm run dev -w pepperscore-reader",
    "build": "npm run build -w pepperscore-reader",
    "check": "npm run check -w pepperscore && npm run check -w pepperscore-reader",
    "test:manifest": "node scripts/verify-gm-manifest.mjs",
    "test:example": "npm run test:manifest && npm run build && node tests/cielito-import.mjs",
    "test:spelling": "node validation/spelling.mjs",
    "test:document": "node validation/document.mjs",
    "test:parser-diff": "node validation/parser-diff.mjs",
    "test:score-db": "node validation/score-db.mjs",
    "test:performance": "node validation/performance.mjs",
    "test:reader": "node validation/reader.mjs",
    "test:reader:firefox": "BROWSER=firefox node validation/reader.mjs",
    "test:reader:webkit": "BROWSER=webkit node validation/reader.mjs",
    "test:large": "node validation/large-score.mjs",
    "test:chunks": "node validation/chunks.mjs",
    "test:transpose": "node validation/transpose.mjs",
    "test:guardrails": "node validation/guardrails.mjs",
    "test:guardrails:firefox": "BROWSER=firefox node validation/guardrails.mjs",
    "test:validation": "npm run test:spelling && npm run test:transpose && npm run test:document && npm run test:parser-diff && npm run test:score-db && npm run test:performance && npm run test:reader && npm run test:chunks && npm run test:large && npm run test:guardrails",
    "test:browsers": "playwright-core install chromium firefox webkit"
  },
  "devDependencies": {
    "playwright-core": "^1.63.0",
    "typescript": "^5.9.3",
    "vite": "^8.3.1"
  }
}
```
`vite` is a root devDependency so `node_modules/vite/bin/vite.js` (spawned by several validation scripts) stays at the root.

- [ ] **Step 6: Install and regenerate the lockfile**

```bash
rm -rf node_modules && npm install
ls -la node_modules/pepperscore    # must be a symlink to ../packages/pepperscore
```

- [ ] **Step 7: Run the check from Step 1**

Run: `npm run check && npm run build && test -f apps/reader/dist/index.html`
Expected: PASS. (Assets are not served yet; that is Task 1.2.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: move the reader into npm workspaces (packages/pepperscore, apps/reader)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.2: Assets into pepperscore-sounds-complete, served by the demo

**Files:**
- Move (git mv): `public/fonts/`, `public/instruments/`, `public/soundfonts/` → `packages/pepperscore-sounds-complete/`
- Create: `packages/pepperscore-sounds-complete/package.json`, `packages/pepperscore-sounds-complete/LICENSES.md`, `apps/reader/sounds.mjs`
- Modify: `apps/reader/astro.config.mjs`, `scripts/verify-gm-manifest.mjs`, `scripts/prepare-fluidr3.mjs`, `scripts/prepare-perfect-drums.mjs`

**Interfaces:**
- Consumes: workspace layout from Task 1.1.
- Produces: `packages/pepperscore-sounds-complete/{fonts,instruments,soundfonts}` (single source of truth for assets). Astro integration `soundPack()` (default export of `apps/reader/sounds.mjs`) that serves `/fonts/**`, `/instruments/**`, `/soundfonts/**`, `/pack.json` from that directory in dev and copies them into `apps/reader/dist/` on build.

- [ ] **Step 1: Write the failing check**

```bash
npm run test:manifest && npm run build && test -f apps/reader/dist/soundfonts/TimGM6mb.sf2 && test -f apps/reader/dist/fonts/Bravura.woff2
```
Expected: FAIL (manifest script reads `public/…`, dist has no soundfonts).

- [ ] **Step 2: Move the assets**

```bash
mkdir -p packages/pepperscore-sounds-complete
git mv public/fonts packages/pepperscore-sounds-complete/fonts
git mv public/instruments packages/pepperscore-sounds-complete/instruments
git mv public/soundfonts packages/pepperscore-sounds-complete/soundfonts
```
`public/variations/` is untracked (listed in the main checkout's `.git/info/exclude`) and does not exist in your worktree; leave it alone.

`packages/pepperscore-sounds-complete/package.json`:
```json
{
  "name": "pepperscore-sounds-complete",
  "version": "0.1.0",
  "description": "All pepperscore assets: music fonts, instrument icons, Perfect Drums, TimGM6mb and all 128 FluidR3 GM sounds.",
  "license": "SEE LICENSE IN LICENSES.md",
  "files": ["fonts", "instruments", "soundfonts", "pack.json", "LICENSES.md", "README.md"]
}
```

`packages/pepperscore-sounds-complete/LICENSES.md`:
```markdown
# Asset licenses

This package contains only data files. Each set keeps its own license:

| Path | Contents | License |
| --- | --- | --- |
| `fonts/Bravura.woff2`, `fonts/Petaluma.woff2`, `fonts/PetalumaScript.woff2` | Steinberg SMuFL fonts | SIL Open Font License 1.1 (`fonts/Petaluma-OFL.txt`) |
| `soundfonts/fluidr3/*.json` | Reduced FluidR3 GM sample packs from gleitz/midi-js-soundfonts | CC BY 3.0 (`soundfonts/fluidr3/ATTRIBUTION.txt`) |
| `soundfonts/perfect-drums/*` | Samples extracted from Perfect Drums V2 | See `soundfonts/perfect-drums/ATTRIBUTION.txt` |
| `soundfonts/TimGM6mb.sf2` | TimGM6mb General MIDI soundfont | GPL-2.0 (`soundfonts/COPYING.txt`) |
| `instruments/*.svg` | Instrument icons | MIT (same as pepperscore) |
```

- [ ] **Step 3: Serve and copy the pack from the demo**

`apps/reader/sounds.mjs`:
```js
import { createReadStream } from 'node:fs';
import { cp, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOUNDS = fileURLToPath(new URL('../../packages/pepperscore-sounds-complete/', import.meta.url));
const ENTRIES = ['fonts', 'instruments', 'soundfonts', 'pack.json'];
const MIME = { '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.sf2': 'application/octet-stream', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8' };

/** The demo self-hosts the complete sound pack at the site root: served in dev, copied into the build. */
export default function soundPack() {
  return {
    name: 'pepperscore-sounds',
    hooks: {
      'astro:server:setup': ({ server }) => {
        server.middlewares.use(async (request, response, next) => {
          const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
          if (!ENTRIES.some(entry => pathname === `/${entry}` || pathname.startsWith(`/${entry}/`))) return next();
          const file = resolve(SOUNDS, `.${pathname}`);
          if (!file.startsWith(SOUNDS)) return next();
          try { if (!(await stat(file)).isFile()) return next(); } catch { return next(); }
          response.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
          createReadStream(file).pipe(response);
        });
      },
      'astro:build:done': async ({ dir }) => {
        const out = fileURLToPath(dir);
        for (const entry of ENTRIES) {
          try { await cp(join(SOUNDS, entry), join(out, entry), { recursive: true }); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      },
    },
  };
}
```

`apps/reader/astro.config.mjs`:
```js
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import soundPack from './sounds.mjs';

export default defineConfig({ integrations: [react(), soundPack()], devToolbar: { enabled: false }, vite: { optimizeDeps: { include: ['abcjs'] } } });
```

- [ ] **Step 4: Point the asset scripts at the new paths**

In `scripts/verify-gm-manifest.mjs`, replace the path setup and the three `resolve(root, …)` uses:
```js
const root = fileURLToPath(new URL('..', import.meta.url));
const lib = resolve(root, 'packages/pepperscore');
const sounds = resolve(root, 'packages/pepperscore-sounds-complete');
const manifest = JSON.parse(await readFile(resolve(lib, 'src/lib/gm-soundfont-manifest.json'), 'utf8'));
```
and inside the loops use `resolve(sounds, entry.localPack.slice(1))`, `resolve(lib, icon)` and `resolve(sounds, voice.localPack.replace(/^\//, ''))`.

In `scripts/prepare-fluidr3.mjs`: `resolve('packages/pepperscore/src/lib/gm-soundfont-manifest.json')` and `resolve('packages/pepperscore-sounds-complete/soundfonts/fluidr3')`.
In `scripts/prepare-perfect-drums.mjs`: `resolve('packages/pepperscore-sounds-complete/soundfonts/perfect-drums')`.

- [ ] **Step 5: Run the check from Step 1**

Run: `npm install && npm run test:manifest && npm run build && test -f apps/reader/dist/soundfonts/TimGM6mb.sf2 && test -f apps/reader/dist/fonts/Bravura.woff2`
Expected: PASS, manifest prints `GM manifest: 128 local packs, 16 icons and playable voices verified.`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: assets live in packages/pepperscore-sounds-complete; the demo serves them at /

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.3: Validation, docs and CI paths

**Files:**
- Modify: `validation/*.mjs` (path constants and module URLs), `validation/transpose-harness.ts`, `README.md`
- Verify unchanged: `.github/workflows/ci.yml` (root scripts delegate, so commands stay the same)

**Interfaces:**
- Consumes: Tasks 1.1–1.2.
- Produces: validation that builds against `apps/reader/dist` and imports library modules from `/packages/pepperscore/src/…` (Vite-served) or `../packages/pepperscore/src/…` (node).

- [ ] **Step 1: Run the suite to see it fail**

Run: `npm run build && npm run test:validation`
Expected: FAIL (`dist/index.html is missing` / 404 on `/src/lib/…`).

- [ ] **Step 2: Rewrite the paths**

```bash
sed -i "s#import('/src/#import('/packages/pepperscore/src/#g" validation/*.mjs
sed -i "s#from '\.\./src/#from '../packages/pepperscore/src/#g" validation/*.mjs validation/*.ts
sed -i "s#resolve(root, 'dist')#resolve(root, 'apps/reader/dist')#g" validation/*.mjs
sed -i "s#dist/index.html is missing#apps/reader/dist/index.html is missing#g" validation/*.mjs
sed -i "s#resolve(root, 'src/lib/header-controls.ts')#resolve(root, 'packages/pepperscore/src/lib/header-controls.ts')#; s#resolve(root, 'src/styles.css')#resolve(root, 'packages/pepperscore/src/styles.css')#" validation/reader.mjs
grep -rn "'/src/\|'\.\./src/\|'src/\|'dist'" validation || echo "no stale paths"
```
Expected last line: `no stale paths` (comments mentioning `src/lib/...` may remain; update them to the new path by hand).

- [ ] **Step 3: Update README paths**

In `README.md`: `public/soundfonts/…` → `packages/pepperscore-sounds-complete/soundfonts/…`, `public/fonts/…` → `packages/pepperscore-sounds-complete/fonts/…`, `src/lib/…` → `packages/pepperscore/src/lib/…`, "Static site in `dist/`" → "Static site in `apps/reader/dist/`". Add one line under "Run": "The repository is an npm workspace: `packages/pepperscore` (the component), `packages/pepperscore-sounds-complete` (assets), `apps/reader` (this site)."

- [ ] **Step 4: Run the whole CI sequence**

```bash
npm run check && npm run build && npm run test:manifest && npm run test:validation
BROWSER=firefox npm run test:reader && BROWSER=firefox npm run test:chunks
BROWSER=webkit npm run test:reader && BROWSER=webkit npm run test:chunks
```
Expected: all PASS (install engines with `npm run test:browsers` if missing).

- [ ] **Step 5: Commit and open PR 1**

```bash
git add -A
git commit -m "chore: validation and docs follow the workspace layout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Open the PR "chore: npm workspaces for pepperscore" (body ends with the Claude Code line from the repo's PR conventions). Note in the PR body: after merging, the maintainer moves their local untracked `public/variations/` to `apps/reader/public/variations/` and updates `.git/info/exclude`; local `tests/*.mjs` that read `dist/` must read `apps/reader/dist/`.

---

# Phase 2 — Assets and sounds (PR `feat/asset-base`)

### Task 2.1: assetBaseUrl plumbing and runtime music fonts

**Files:**
- Create: `packages/pepperscore/src/lib/assets.ts`, `packages/pepperscore/src/lib/asset-fonts.ts`, `validation/assets.mjs`
- Modify: `packages/pepperscore/src/styles.css:1-5` (delete the three `@font-face` rules and their comments), `packages/pepperscore/src/components/Reader.tsx` (props + font effect), `packages/pepperscore/src/index.ts`, `apps/reader/src/pages/index.astro`, `validation/reader.mjs`, `package.json` (scripts)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `assets.ts`: `type SoundPackName = 'core' | 'complete'`; `const SOUNDS_VERSION = '0.1.0'`; `defaultAssetBaseUrl(pack: SoundPackName): string`; `resolveAssetBase(base: string | undefined, pack?: SoundPackName, page?: string): string` (absolute, always ends with `/`); `assetUrl(base: string, path: string): string`; `type PackInfo = { pack: SoundPackName | 'unknown'; fluidr3: ReadonlySet<string> }`; `loadPackInfo(base: string): Promise<PackInfo>` (cached per base, never rejects).
  - `asset-fonts.ts`: `ensureMusicFonts(base: string): void` — injects one `<style data-pepperscore-fonts>` into `document.head`.
  - `ReaderProps` gains `assetBaseUrl?: string; soundPack?: SoundPackName`.

- [ ] **Step 1: Write the failing node test**

`validation/assets.mjs`:
```js
// Asset base resolution (packages/pepperscore/src/lib/assets.ts), run in Node: the module has no runtime imports.
import assert from 'node:assert/strict';
import { assetUrl, defaultAssetBaseUrl, resolveAssetBase, SOUNDS_VERSION } from '../packages/pepperscore/src/lib/assets.ts';

const page = 'https://example.com/songs/view.html';
assert.equal(defaultAssetBaseUrl('core'), `https://cdn.jsdelivr.net/npm/pepperscore-sounds-core@${SOUNDS_VERSION}/`);
assert.equal(defaultAssetBaseUrl('complete'), `https://cdn.jsdelivr.net/npm/pepperscore-sounds-complete@${SOUNDS_VERSION}/`);
assert.equal(resolveAssetBase(undefined, 'core', page), defaultAssetBaseUrl('core'));
assert.equal(resolveAssetBase(undefined, 'complete', page), defaultAssetBaseUrl('complete'));
assert.equal(resolveAssetBase('   ', 'core', page), defaultAssetBaseUrl('core'));
assert.equal(resolveAssetBase('/', 'core', page), 'https://example.com/');
// Review Focus 4: no trailing slash, and relative paths, still resolve under the base.
assert.equal(resolveAssetBase('/custom-assets', 'core', page), 'https://example.com/custom-assets/');
assert.equal(resolveAssetBase('assets', 'core', page), 'https://example.com/songs/assets/');
assert.equal(resolveAssetBase('https://cdn.example.org/s/', 'core', page), 'https://cdn.example.org/s/');
assert.equal(assetUrl('https://example.com/a/', '/soundfonts/fluidr3/flute.json'), 'https://example.com/a/soundfonts/fluidr3/flute.json');
assert.equal(assetUrl('https://example.com/a/', 'pack.json'), 'https://example.com/a/pack.json');
console.log('Asset base: defaults, relative and absolute bases, missing trailing slash and asset paths passed');
```
Add to root `package.json` scripts: `"test:assets": "node validation/assets.mjs"`, and prepend `npm run test:assets && ` to `test:validation`.

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:assets`
Expected: FAIL with `Cannot find module …/assets.ts`.

- [ ] **Step 3: Implement assets.ts**

`packages/pepperscore/src/lib/assets.ts`:
```ts
/**
 * Built-in assets (music fonts, instrument icons, sound packs) live at `assetBaseUrl` in the layout of a
 * pepperscore-sounds-<pack> package: fonts/, instruments/, soundfonts/ and pack.json
 * (docs/specs/pepperscore-embeddable-component.md, "Assets and sounds"). No runtime imports: validation/assets.mjs runs it in Node.
 */
export type SoundPackName = 'core' | 'complete';

/** Version of the pepperscore-sounds-* packages this build loads by default; validation/sound-packs.mjs keeps it in step. */
export const SOUNDS_VERSION = '0.1.0';

export const defaultAssetBaseUrl = (pack: SoundPackName): string => `https://cdn.jsdelivr.net/npm/pepperscore-sounds-${pack}@${SOUNDS_VERSION}/`;

const pageBase = (): string => (typeof document !== 'undefined' && document.baseURI) || 'http://localhost/';

/** The absolute asset base, always ending in `/`. A relative base resolves against the page; none means the CDN default. */
export function resolveAssetBase(base: string | undefined, pack: SoundPackName = 'core', page: string = pageBase()): string {
  const raw = base?.trim() || defaultAssetBaseUrl(pack);
  return new URL(raw.endsWith('/') ? raw : `${raw}/`, page).href;
}

/** A built-in asset under the base; a leading `/` (as in the GM manifest's `localPack`) is relative to the base too. */
export const assetUrl = (base: string, path: string): string => new URL(path.replace(/^\/+/, ''), base).href;

export type PackInfo = { pack: SoundPackName | 'unknown'; fluidr3: ReadonlySet<string> };
const packInfo = new Map<string, Promise<PackInfo>>();

/** The base's pack.json, cached per base. A missing or invalid one lists no FluidR3 sounds, so every program falls back to TimGM6mb. */
export function loadPackInfo(base: string): Promise<PackInfo> {
  let info = packInfo.get(base);
  if (!info) {
    info = fetch(assetUrl(base, 'pack.json'))
      .then(response => (response.ok ? response.json() : null) as Promise<{ pack?: unknown; fluidr3?: unknown } | null>)
      .then(json => ({
        pack: json?.pack === 'core' || json?.pack === 'complete' ? json.pack : 'unknown' as const,
        fluidr3: new Set(Array.isArray(json?.fluidr3) ? json.fluidr3.filter((name): name is string => typeof name === 'string') : []),
      }), () => ({ pack: 'unknown' as const, fluidr3: new Set<string>() }));
    packInfo.set(base, info);
  }
  return info;
}
```

`packages/pepperscore/src/lib/asset-fonts.ts`:
```ts
const MUSIC_FONTS = [['Bravura', 'fonts/Bravura.woff2'], ['Petaluma', 'fonts/Petaluma.woff2'], ['Petaluma Script', 'fonts/PetalumaScript.woff2']] as const;

/**
 * SMuFL fonts for Verovio's text glyphs (tempo marks, dynamics) and Petaluma Script stave text, loaded from the asset
 * base instead of hardcoded CSS. Font family names are page-global, so the first instance's base wins.
 */
export function ensureMusicFonts(base: string): void {
  if (typeof document === 'undefined' || document.head.querySelector('style[data-pepperscore-fonts]')) return;
  const style = document.createElement('style');
  style.dataset.pepperscoreFonts = base;
  style.textContent = MUSIC_FONTS.map(([family, path]) => `@font-face{font-family:'${family}';src:url('${new URL(path, base).href}') format('woff2');font-display:block}`).join('\n');
  document.head.appendChild(style);
}
```

- [ ] **Step 4: Wire it into Reader**

In `packages/pepperscore/src/components/Reader.tsx`:
```ts
import { resolveAssetBase, type SoundPackName } from '../lib/assets';
import { ensureMusicFonts } from '../lib/asset-fonts';
```
Extend the props type:
```ts
export type ReaderProps = {
  musicXml?: string;
  scoreUrl?: string;
  /** Root of a pepperscore-sounds-<pack> layout; default: the jsDelivr copy of pepperscore-sounds-<soundPack>. */
  assetBaseUrl?: string;
  soundPack?: SoundPackName;
};
export default function Reader({ musicXml, scoreUrl, assetBaseUrl, soundPack = 'core' }: ReaderProps) {
```
Directly after the `useState`/`useRef` block (before the first `useEffect`), add:
```ts
  const assetBase = useMemo(() => resolveAssetBase(assetBaseUrl, soundPack), [assetBaseUrl, soundPack]);
  useEffect(() => ensureMusicFonts(assetBase), [assetBase]);
```
Delete lines 1–5 of `packages/pepperscore/src/styles.css` (the comment and the three `@font-face` rules). Pass the base to the demo in `apps/reader/src/pages/index.astro`: `<Reader client:load assetBaseUrl="/" />`.

Export from `src/index.ts`:
```ts
export { SOUNDS_VERSION, defaultAssetBaseUrl } from './lib/assets';
export type { SoundPackName } from './lib/assets';
```

- [ ] **Step 5: Assert the fonts in the reader suite**

In `validation/reader.mjs`, in the main-page block right after the first `await ready();` of the `page` created at "const page = await browser.newPage({ viewport: { width: 390, height: 844 } …", add:
```js
  const musicFonts = await page.evaluate(() => document.querySelector('style[data-pepperscore-fonts]')?.textContent ?? '');
  for (const file of ['Bravura', 'Petaluma', 'PetalumaScript']) assert.ok(musicFonts.includes(`url('${url}/fonts/${file}.woff2')`), `${file} loads from the asset base: ${musicFonts}`);
  assert.doesNotMatch(await readFile(resolve(root, 'packages/pepperscore/src/styles.css'), 'utf8'), /@font-face/, 'Music fonts are not hardcoded in the stylesheet');
```

- [ ] **Step 6: Run the tests**

Run: `npm run test:assets && npm run check && npm run build && npm run test:reader`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: assetBaseUrl and runtime music fonts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2.2: pack.json, the core pack generator and version checks

**Files:**
- Create: `packages/pepperscore-sounds-complete/pack.json`, `packages/pepperscore-sounds-complete/README.md`, `packages/pepperscore-sounds-core/package.json`, `packages/pepperscore-sounds-core/README.md`, `packages/pepperscore-sounds-core/LICENSES.md` (copy of the complete one), `scripts/sound-packs.mjs`, `scripts/sounds-core.mjs`, `validation/sound-packs.mjs`
- Modify: `.gitignore`, `package.json` (scripts `sounds:core`, `test:manifest`)

**Interfaces:**
- Consumes: `SOUNDS_VERSION` in `assets.ts` (Task 2.1).
- Produces: `scripts/sound-packs.mjs` exports `CORE_FLUIDR3: string[]`, `COMPLETE_DIR: string`, `CORE_DIR: string`. `node scripts/sounds-core.mjs [outDir]` writes the core layout (default `packages/pepperscore-sounds-core`). `pack.json` shape `{ "pack": "core" | "complete", "fluidr3": string[] }`.

**Decision — generated core output is gitignored, not committed.** The spec says only the complete package holds the files in git; committing core would add ~15 MB of duplicate blobs that can drift. npm publish needs the files present, so `pepperscore-sounds-core` has `"prepack": "node ../../scripts/sounds-core.mjs ."`: `npm publish -w pepperscore-sounds-core` (and `npm pack`) always regenerates them first.

- [ ] **Step 1: Write the failing test**

`validation/sound-packs.mjs`:
```js
// The two sound packs: complete's pack.json matches its files, core is generated from complete (scripts/sounds-core.mjs),
// and both package versions match the SOUNDS_VERSION the library loads by default.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { COMPLETE_DIR, CORE_FLUIDR3 } from '../scripts/sound-packs.mjs';

const root = resolve(import.meta.dirname, '..');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const size = dir => readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory() ? size(join(dir, entry.name)) : statSync(join(dir, entry.name)).size), 0);
const gmNames = json(join(root, 'packages/pepperscore/src/lib/gm-soundfont-manifest.json')).programs.map(program => program.soundfont);

const complete = json(join(COMPLETE_DIR, 'pack.json'));
assert.equal(complete.pack, 'complete');
assert.deepEqual(complete.fluidr3, gmNames, 'complete pack.json lists all 128 FluidR3 sounds in GM order');
const onDisk = readdirSync(join(COMPLETE_DIR, 'soundfonts/fluidr3')).filter(file => file.endsWith('.json')).map(file => file.slice(0, -5)).sort();
assert.deepEqual(onDisk, [...gmNames].sort(), 'complete has a pack file for every GM program');

assert.equal(CORE_FLUIDR3.length, 19);
for (const name of CORE_FLUIDR3) assert.ok(gmNames.includes(name), `${name} is a GM FluidR3 sound`);
const out = mkdtempSync(join(tmpdir(), 'pepperscore-core-'));
try {
  execFileSync(process.execPath, [join(root, 'scripts/sounds-core.mjs'), out], { stdio: 'pipe' });
  assert.deepEqual(json(join(out, 'pack.json')), { pack: 'core', fluidr3: CORE_FLUIDR3 });
  assert.deepEqual(readdirSync(join(out, 'soundfonts/fluidr3')).sort(), [...CORE_FLUIDR3.map(name => `${name}.json`), 'ATTRIBUTION.txt'].sort());
  for (const file of ['fonts/Bravura.woff2', 'fonts/Petaluma.woff2', 'fonts/PetalumaScript.woff2', 'fonts/Petaluma-OFL.txt', 'instruments/piano.svg', 'soundfonts/TimGM6mb.sf2', 'soundfonts/COPYING.txt', 'soundfonts/perfect-drums/manifest.json']) {
    assert.ok(statSync(join(out, file)).size > 0, `core has ${file}`);
  }
  const bytes = size(out);
  assert.ok(bytes < 20 * 2 ** 20, `core is ${(bytes / 2 ** 20).toFixed(1)} MB, expected about 15 MB`);
} finally { rmSync(out, { recursive: true, force: true }); }

const soundsVersion = readFileSync(join(root, 'packages/pepperscore/src/lib/assets.ts'), 'utf8').match(/SOUNDS_VERSION = '([^']+)'/)[1];
for (const pack of ['core', 'complete']) assert.equal(json(join(root, `packages/pepperscore-sounds-${pack}/package.json`)).version, soundsVersion, `pepperscore-sounds-${pack} version matches SOUNDS_VERSION`);
console.log(`Sound packs: complete pack.json, generated core (${CORE_FLUIDR3.length} FluidR3 sounds) and versions passed`);
```
Change root script: `"test:manifest": "node scripts/verify-gm-manifest.mjs && node validation/sound-packs.mjs"` and add `"sounds:core": "node scripts/sounds-core.mjs"`.

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:manifest`
Expected: FAIL with `Cannot find module …/scripts/sound-packs.mjs`.

- [ ] **Step 3: Implement the pack list and generator**

`scripts/sound-packs.mjs`:
```js
import { fileURLToPath } from 'node:url';

/** FluidR3 sounds shipped in pepperscore-sounds-core; every other program falls back to TimGM6mb at runtime. */
export const CORE_FLUIDR3 = [
  'acoustic_grand_piano', 'electric_piano_1', 'acoustic_guitar_nylon', 'acoustic_guitar_steel', 'electric_guitar_clean',
  'electric_guitar_jazz', 'acoustic_bass', 'electric_bass_finger', 'string_ensemble_1', 'violin', 'cello', 'flute',
  'clarinet', 'alto_sax', 'tenor_sax', 'trumpet', 'trombone', 'choir_aahs', 'voice_oohs',
];
export const COMPLETE_DIR = fileURLToPath(new URL('../packages/pepperscore-sounds-complete/', import.meta.url));
export const CORE_DIR = fileURLToPath(new URL('../packages/pepperscore-sounds-core/', import.meta.url));
```

`scripts/sounds-core.mjs`:
```js
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
```

Generate the complete pack.json once and commit it:
```bash
node -e "const m=require('./packages/pepperscore/src/lib/gm-soundfont-manifest.json');require('fs').writeFileSync('packages/pepperscore-sounds-complete/pack.json',JSON.stringify({pack:'complete',fluidr3:m.programs.map(p=>p.soundfont)},null,2)+'\n')"
```

`packages/pepperscore-sounds-core/package.json`:
```json
{
  "name": "pepperscore-sounds-core",
  "version": "0.1.0",
  "description": "Core pepperscore assets (~15 MB): music fonts, instrument icons, Perfect Drums, TimGM6mb and 19 common FluidR3 GM sounds.",
  "license": "SEE LICENSE IN LICENSES.md",
  "files": ["fonts", "instruments", "soundfonts", "pack.json", "LICENSES.md", "README.md"],
  "scripts": { "prepack": "node ../../scripts/sounds-core.mjs ." }
}
```
`packages/pepperscore-sounds-core/README.md` and `packages/pepperscore-sounds-complete/README.md` (one each; adjust the pack name and size):
```markdown
# pepperscore-sounds-core

Assets for [pepperscore](https://www.npmjs.com/package/pepperscore): music fonts, instrument icons, Perfect Drums,
TimGM6mb.sf2 and the FluidR3 GM sounds listed in `pack.json`. No JavaScript.

pepperscore loads these from jsDelivr by default. To self-host, copy this package's directory into your site's public
folder and pass its URL as `assetBaseUrl`, e.g. `cp -r node_modules/pepperscore-sounds-core public/pepperscore-sounds`
and `<PepperScore assetBaseUrl="/pepperscore-sounds/" … />`.

In this repository the files are generated from `pepperscore-sounds-complete` by `npm run sounds:core` (and by `prepack`).
Licenses: see `LICENSES.md`.
```

Append to `.gitignore`:
```
/packages/pepperscore-sounds-core/fonts/
/packages/pepperscore-sounds-core/instruments/
/packages/pepperscore-sounds-core/soundfonts/
/packages/pepperscore-sounds-core/pack.json
```

- [ ] **Step 4: Run the tests**

Run: `npm install && npm run test:manifest && npm run sounds:core && git status --short packages/pepperscore-sounds-core`
Expected: tests PASS; `git status` shows only the committed files (package.json, README.md, LICENSES.md), not the generated ones.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: pack.json and the generated pepperscore-sounds-core package

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2.3: Sound resolution and the soundSources registry

**Files:**
- Create: `packages/pepperscore/src/lib/sounds.ts`, `packages/pepperscore/src/lib/sound-players.ts`, `packages/pepperscore/src/lib/sf2-player.ts`, `validation/sounds.mjs`
- Modify: `packages/pepperscore/src/lib/fluid-player.ts`, `packages/pepperscore/src/lib/drum-player.ts`, `packages/pepperscore/src/lib/score.ts` (add `gmProgramForSoundfont`), `packages/pepperscore/src/components/Reader.tsx` (`ensureAudio`, `play`, props), `packages/pepperscore/src/index.ts`, `validation/reader.mjs`, `package.json` (scripts)

**Interfaces:**
- Consumes: `assetUrl`, `loadPackInfo`, `resolveAssetBase` (Task 2.1).
- Produces:
  - `sounds.ts`: `type SoundSource` (exactly the spec's union), `type SoundRequest = { drums: true } | { drums: false; program: number; name: string }`, `type SoundPlan = { kind: 'sf2'; sourceId: string; url: string; drums: boolean; program?: number; preset?: string } | { kind: 'sample-pack'; sourceId: string; url: string; name: string } | { kind: 'note-files'; sourceId: string; manifest: string; drums: boolean }`, `planSound(request: SoundRequest, ctx: { sources?: readonly SoundSource[]; fluidr3: ReadonlySet<string>; base: string; page: string }): SoundPlan`, `planKey(plan: SoundPlan): string`, `fallbackSf2Url(base: string): string`, constants `BUILTIN_FLUIDR3`, `BUILTIN_DRUMS`, `BUILTIN_SF2`.
  - `sound-players.ts`: `type AudioPlayer` (moved from Reader, plus optional `covers(note)`), `loadPlayers(context: AudioContext, plan: SoundPlan, destination: AudioNode): Promise<AudioPlayer[]>`, `addDrumFallback(context: AudioContext, players: AudioPlayer[], notes: number[], fallbackSf2: string, destination: AudioNode): Promise<void>`.
  - `sf2-player.ts`: `loadSf2Player(context: AudioContext, options: { url: string; drums: boolean; program?: number; preset?: string; destination: AudioNode }): Promise<AudioPlayer>`.
  - `fluid-player.ts`: `loadFluidPlayer(context: AudioContext, url: string, name: string): Promise<FluidPlayer>`.
  - `drum-player.ts`: `loadNoteFilePlayer(context: AudioContext, manifestUrl: string): Promise<DrumPlayer>`; `DrumPlayer.covers(note: number): boolean`.
  - `score.ts`: `gmProgramForSoundfont(name: string): number | undefined`.
  - `ReaderProps` gains `soundSources?: SoundSource[]`.

- [ ] **Step 1: Write the failing node test**

`validation/sounds.mjs`:
```js
// Sound resolution (packages/pepperscore/src/lib/sounds.ts): soundSources first, then the pack's FluidR3 sound, then TimGM6mb.
import assert from 'node:assert/strict';
import { BUILTIN_DRUMS, BUILTIN_FLUIDR3, BUILTIN_SF2, planKey, planSound } from '../packages/pepperscore/src/lib/sounds.ts';

const base = 'https://cdn.example/pepperscore-sounds-core@0.1.0/';
const page = 'https://site.example/lessons/one.html';
const fluidr3 = new Set(['acoustic_grand_piano', 'flute']);
const piano = { drums: false, program: 1, name: 'acoustic_grand_piano' };
const harp = { drums: false, program: 47, name: 'orchestral_harp' };
const kit = { drums: true };
const ctx = extra => ({ fluidr3, base, page, ...extra });

assert.deepEqual(planSound(piano, ctx()), { kind: 'sample-pack', sourceId: BUILTIN_FLUIDR3, url: `${base}soundfonts/fluidr3/acoustic_grand_piano.json`, name: 'acoustic_grand_piano' });
assert.deepEqual(planSound(harp, ctx()), { kind: 'sf2', sourceId: BUILTIN_SF2, url: `${base}soundfonts/TimGM6mb.sf2`, drums: false, program: 47 }, 'a program missing from the pack falls back to TimGM6mb');
assert.deepEqual(planSound(kit, ctx()), { kind: 'note-files', sourceId: BUILTIN_DRUMS, manifest: `${base}soundfonts/perfect-drums/manifest.json`, drums: true });

const sources = [
  { id: 'brass', kind: 'sample-pack', url: '/sounds/{name}.json', programs: [57, 58] },
  { id: 'piano-sf2', kind: 'sf2', url: 'sf/piano.sf2', programs: [1], preset: 'Grand' },
  { id: 'also-piano', kind: 'sample-pack', url: '/never/{name}.json', programs: [1] },
  { id: 'kit', kind: 'note-files', manifest: 'https://kits.example/k/manifest.json', drums: true },
];
assert.deepEqual(planSound(piano, ctx({ sources })), { kind: 'sf2', sourceId: 'piano-sf2', url: 'https://site.example/lessons/sf/piano.sf2', drums: false, program: 1, preset: 'Grand' }, 'the first claiming source wins; relative URLs resolve against the page');
assert.deepEqual(planSound({ drums: false, program: 57, name: 'trumpet' }, ctx({ sources })), { kind: 'sample-pack', sourceId: 'brass', url: 'https://site.example/sounds/trumpet.json', name: 'trumpet' }, '{name} is filled in');
assert.deepEqual(planSound(kit, ctx({ sources })), { kind: 'note-files', sourceId: 'kit', manifest: 'https://kits.example/k/manifest.json', drums: true });
assert.deepEqual(planSound(kit, ctx({ sources: [{ id: 'sf', kind: 'sf2', url: '/gm.sf2', drums: true }] })), { kind: 'sf2', sourceId: 'sf', url: 'https://site.example/gm.sf2', drums: true });
assert.equal(planSound(kit, ctx({ sources: [{ id: 'x', kind: 'sample-pack', url: '/{name}.json', programs: [1] }] })).sourceId, BUILTIN_DRUMS, 'a sample pack never claims drums');
assert.equal(planSound(piano, ctx({ sources: [{ id: 'k', kind: 'note-files', manifest: '/m.json', drums: true }] })).sourceId, BUILTIN_FLUIDR3, 'a source without programs claims no melodic part');
assert.notEqual(planKey(planSound(harp, ctx())), planKey(planSound({ ...harp, program: 48, name: 'string_ensemble_1' }, ctx({ fluidr3: new Set() }))), 'sf2 programs get their own players');
console.log('Sound resolution: sources, pack sounds, TimGM6mb fallback and drums passed');
```
Add `"test:sounds": "node validation/sounds.mjs"` and prepend `npm run test:sounds && ` to `test:validation`.

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:sounds`
Expected: FAIL with `Cannot find module …/sounds.ts`.

- [ ] **Step 3: Implement sounds.ts**

`packages/pepperscore/src/lib/sounds.ts`:
```ts
/**
 * Where each part's sound comes from (docs/specs/pepperscore-embeddable-component.md, "Sound resolution"):
 * 1. the first `soundSources` entry that claims it, 2. the pack's FluidR3 sound if pack.json lists it,
 * 3. TimGM6mb.sf2 (always present). Drums use Perfect Drums note files unless a source claims them.
 * Pure: no fetching and no runtime imports (validation/sounds.mjs runs it in Node).
 */
export type SoundSource =
  | { id: string; kind: 'sf2'; url: string; programs?: number[]; drums?: boolean; preset?: string }
  | { id: string; kind: 'sample-pack'; url: string /* may contain {name} */; programs?: number[] }
  | { id: string; kind: 'note-files'; manifest: string; programs?: number[]; drums?: boolean };

/** A part's sound: the drum kit, or a GM program (1-128) and its FluidR3 name. */
export type SoundRequest = { drums: true } | { drums: false; program: number; name: string };

export type SoundPlan =
  | { kind: 'sf2'; sourceId: string; url: string; drums: boolean; program?: number; preset?: string }
  | { kind: 'sample-pack'; sourceId: string; url: string; name: string }
  | { kind: 'note-files'; sourceId: string; manifest: string; drums: boolean };

export const BUILTIN_FLUIDR3 = 'builtin:fluidr3';
export const BUILTIN_DRUMS = 'builtin:perfect-drums';
export const BUILTIN_SF2 = 'builtin:timgm6mb';

export type PlanContext = { sources?: readonly SoundSource[]; fluidr3: ReadonlySet<string>; base: string; page: string };

const claims = (source: SoundSource, request: SoundRequest) =>
  request.drums ? source.kind !== 'sample-pack' && source.drums === true : !!source.programs?.includes(request.program);

/** The built-in GM soundfont; it also plays drum notes a note-file kit lacks. */
export const fallbackSf2Url = (base: string) => new URL('soundfonts/TimGM6mb.sf2', base).href;

export function planSound(request: SoundRequest, { sources = [], fluidr3, base, page }: PlanContext): SoundPlan {
  const source = sources.find(item => claims(item, request));
  if (source?.kind === 'sf2') return { kind: 'sf2', sourceId: source.id, url: new URL(source.url, page).href, drums: request.drums, ...(request.drums ? {} : { program: request.program }), ...(source.preset ? { preset: source.preset } : {}) };
  if (source?.kind === 'sample-pack' && !request.drums) return { kind: 'sample-pack', sourceId: source.id, url: new URL(source.url.replaceAll('{name}', encodeURIComponent(request.name)), page).href, name: request.name };
  if (source?.kind === 'note-files') return { kind: 'note-files', sourceId: source.id, manifest: new URL(source.manifest, page).href, drums: request.drums };
  if (request.drums) return { kind: 'note-files', sourceId: BUILTIN_DRUMS, manifest: new URL('soundfonts/perfect-drums/manifest.json', base).href, drums: true };
  if (fluidr3.has(request.name)) return { kind: 'sample-pack', sourceId: BUILTIN_FLUIDR3, url: new URL(`soundfonts/fluidr3/${request.name}.json`, base).href, name: request.name };
  return { kind: 'sf2', sourceId: BUILTIN_SF2, url: fallbackSf2Url(base), drums: false, program: request.program };
}

/** Players are shared by parts with the same key (sample packs route each note to its part's gain; see Reader audioKey). */
export const planKey = (plan: SoundPlan): string =>
  plan.kind === 'sample-pack' ? `sample-pack:${plan.url}`
    : plan.kind === 'sf2' ? `sf2:${plan.url}#${plan.drums ? 'drums' : plan.program}:${plan.preset ?? ''}`
      : `note-files:${plan.manifest}`;
```

- [ ] **Step 4: Run the node test**

Run: `npm run test:sounds`
Expected: PASS.

- [ ] **Step 5: Implement the players**

`packages/pepperscore/src/lib/fluid-player.ts`: keep `FluidPlayer` as is; replace `loadFluidPlayer` with a URL-based, cached loader:
```ts
const packs = new Map<string, Promise<SamplePack>>();

/** A FluidR3-format sample pack (`{ name, samples: { midi: base64 mp3 } }`), fetched once per URL and shared by instances. */
export async function loadFluidPlayer(context: AudioContext, url: string, name: string) {
  let pack = packs.get(url);
  if (!pack) {
    pack = fetch(url).then(async response => {
      if (!response.ok) throw new Error(`Could not load ${name} sound samples.`);
      const json = await response.json() as SamplePack;
      if (!json.samples || !Object.keys(json.samples).length) throw new Error(`Invalid ${name} sound samples.`);
      return json;
    });
    pack.catch(() => packs.delete(url));
    packs.set(url, pack);
  }
  return new FluidPlayer(context, await pack);
}
```

`packages/pepperscore/src/lib/drum-player.ts`: the constructor takes the manifest URL; note files resolve against it; add `covers`; rename the loader:
```ts
  constructor(private context: AudioContext, private manifest: DrumManifest, private manifestUrl: string) {}

  /** Whether this kit has a sample for `note` (the GM soundfont plays the rest). */
  covers(note: number) { return Object.hasOwn(this.manifest.notes, String(note)); }

  async loadNotes(notes: number[]) {
    const needed = [...new Set(notes)].filter(note => this.covers(note) && !this.decoded.has(note));
    await Promise.all(needed.map(async note => {
      const response = await fetch(new URL(this.manifest.notes[note], this.manifestUrl));
      if (!response.ok) throw new Error(`Could not load drum sample ${note}.`);
      this.decoded.set(note, await this.context.decodeAudioData(await response.arrayBuffer()));
    }));
  }
```
```ts
/** A note-file kit: a manifest `{ name, notes: { midi: file } }` with files beside it (Perfect Drums, or a soundSources entry). */
export async function loadNoteFilePlayer(context: AudioContext, manifestUrl: string) {
  const response = await fetch(manifestUrl);
  if (!response.ok) throw new Error('Could not load the drum kit manifest.');
  const manifest = await response.json() as DrumManifest;
  if (!manifest.notes || !Object.keys(manifest.notes).length) throw new Error('The drum kit manifest is empty.');
  return new DrumPlayer(context, manifest, manifestUrl);
}
```

`packages/pepperscore/src/lib/sf2-player.ts`:
```ts
import type { AudioPlayer } from './sound-players';

type Sf2Preset = { header: { bank: number; preset: number }; zones: Array<{ instrument?: { header: { name: string } } }> };
const objectUrls = new Map<string, Promise<string>>();

/** Each SF2 is downloaded once per URL; every program and instance reads it through one object URL. */
function cachedObjectUrl(url: string): Promise<string> {
  let cached = objectUrls.get(url);
  if (!cached) {
    cached = fetch(url).then(response => {
      if (!response.ok) throw new Error(`Could not load the soundfont (${response.status}).`);
      return response.blob();
    }).then(blob => URL.createObjectURL(blob));
    cached.catch(() => objectUrls.delete(url));
    objectUrls.set(url, cached);
  }
  return cached;
}

/** The SF2 instrument behind a GM preset: bank 128 preset 0 for drums, else bank 0 preset `program - 1` (its first zone). */
function instrumentFor(presets: Sf2Preset[], drums: boolean, program = 1): string | undefined {
  const preset = presets.find(item => drums ? item.header.bank === 128 && item.header.preset === 0 : item.header.bank === 0 && item.header.preset === program - 1);
  return preset?.zones.find(zone => zone.instrument)?.instrument?.header.name;
}

export type Sf2Options = { url: string; drums: boolean; program?: number; preset?: string; destination: AudioNode };

export async function loadSf2Player(context: AudioContext, { url, drums, program, preset, destination }: Sf2Options): Promise<AudioPlayer> {
  const [{ Soundfont2 }, { default: soundfont2 }, objectUrl] = await Promise.all([import('smplr'), import('soundfont2'), cachedObjectUrl(url)]);
  let presets: Sf2Preset[] = [];
  const sampler = Soundfont2(context, { url: objectUrl, destination, createSoundfont: data => { const sf = new soundfont2.SoundFont2(data); presets = sf.presets as unknown as Sf2Preset[]; return sf; } });
  await sampler.ready;
  const name = preset ?? instrumentFor(presets, drums, program);
  if (!name || !sampler.instrumentNames.includes(name)) throw new Error(drums ? 'The soundfont has no standard drum kit.' : `The soundfont has no instrument for GM program ${program}.`);
  await sampler.loadInstrument(name);
  return { start: options => sampler.start(options), stop: () => sampler.stop(), dispose: () => sampler.dispose() };
}
```

`packages/pepperscore/src/lib/sound-players.ts`:
```ts
import type { SoundPlan } from './sounds';

export type AudioPlayer = {
  fallback?: boolean;
  start(options: { note: number; time: number; duration: number; velocity: number; destination?: AudioNode }): () => void;
  stop(): void;
  dispose(): void;
  loadNotes?(notes: number[]): Promise<void>;
  covers?(note: number): boolean;
};

/** The players for one plan (sf2 players are bound to `destination`, a part's track gain). */
export async function loadPlayers(context: AudioContext, plan: SoundPlan, destination: AudioNode): Promise<AudioPlayer[]> {
  if (plan.kind === 'sample-pack') {
    const { loadFluidPlayer } = await import('./fluid-player');
    return [await loadFluidPlayer(context, plan.url, plan.name)];
  }
  if (plan.kind === 'sf2') {
    const { loadSf2Player } = await import('./sf2-player');
    return [await loadSf2Player(context, { url: plan.url, drums: plan.drums, program: plan.program, preset: plan.preset, destination })];
  }
  const { loadNoteFilePlayer } = await import('./drum-player');
  return [await loadNoteFilePlayer(context, plan.manifest)];
}

/** A note-file drum kit plays the notes it lacks through the GM soundfont's standard kit, as before (added once). */
export async function addDrumFallback(context: AudioContext, players: AudioPlayer[], notes: number[], fallbackSf2: string, destination: AudioNode): Promise<void> {
  const kit = players[0];
  if (!kit?.covers || players.some(player => player.fallback) || notes.every(note => kit.covers!(note))) return;
  const { loadSf2Player } = await import('./sf2-player');
  const drums = await loadSf2Player(context, { url: fallbackSf2, drums: true, destination });
  players.push({ fallback: true, start: options => kit.covers!(options.note) ? () => {} : drums.start(options), stop: () => drums.stop(), dispose: () => drums.dispose() });
}
```

`packages/pepperscore/src/lib/score.ts` — add after `gmProgramForNumber`:
```ts
/** GM program (1-128) of a FluidR3 sound name. */
export function gmProgramForSoundfont(name: string): number | undefined {
  return manifest.programs.find(entry => entry.soundfont === name)?.program;
}
```

- [ ] **Step 6: Route Reader playback through plans**

In `Reader.tsx`:
1. Delete the local `type AudioPlayer` and the `audioKey` helper; import:
```ts
import { gmProgramForSoundfont } from '../lib/score';   // add to the existing score import list
import { loadPackInfo } from '../lib/assets';             // add to the existing assets import
import { fallbackSf2Url, planKey, planSound, type SoundPlan, type SoundRequest, type SoundSource } from '../lib/sounds';
import { addDrumFallback, loadPlayers, type AudioPlayer } from '../lib/sound-players';
```
2. Props: add `soundSources?: SoundSource[]` to `ReaderProps` and the destructuring.
3. Add module-level helpers below `playbackSound`:
```ts
const soundRequest = (part: Part): SoundRequest => {
  const sound = playbackSound(part);
  return sound === 'drum-kit' ? { drums: true } : { drums: false, program: gmProgramForSoundfont(sound) ?? 1, name: sound };
};
/** Sample packs route each note to its part's gain, so parts share them; sf2 and note-file players are bound to one part's gain. */
const audioKey = (plan: SoundPlan, part: Part) => plan.kind === 'sample-pack' ? planKey(plan) : `${planKey(plan)}|${part.id}`;
```
4. `audioRef` type gains `partKeys: Map<string, string>`; initialize it as `new Map()` where `audioRef.current` is created.
5. Replace the loop `for (const sound of [...new Set(visibleScore.parts.map(audioKey))]) { … }` in `ensureAudio` with:
```ts
    const pack = await loadPackInfo(assetBase);
    const page = document.baseURI;
    const plans = new Map(visibleScore.parts.map(part => [part.id, planSound(soundRequest(part), { sources: soundSources, fluidr3: pack.fluidr3, base: assetBase, page })]));
    audio.partKeys = new Map(visibleScore.parts.map(part => [part.id, audioKey(plans.get(part.id)!, part)]));
    for (const key of new Set(audio.partKeys.values())) {
      const matching = visibleScore.parts.filter(part => audio.partKeys.get(part.id) === key);
      const plan = plans.get(matching[0].id)!;
      const notes = playbackMidis(timeline, new Set(matching.map(part => part.id)), prefs.semitones);
      const destination = audio.trackGains.get(matching[0].id)!;
      let players = audio.players.get(key);
      if (!players) { players = await loadPlayers(audio.context, plan, destination); audio.players.set(key, players); }
      if (plan.kind === 'note-files' && plan.drums) await addDrumFallback(audio.context, players, notes, fallbackSf2Url(assetBase), destination);
      await Promise.all(players.map(player => player.loadNotes?.(notes)));
    }
```
6. In `play()`'s `schedule`, replace `audio.players.get(audioKey(part))` with `audio.players.get(audio.partKeys.get(event.partId) ?? '')`.
7. Export the type from `src/index.ts`: `export type { SoundSource } from './lib/sounds';`.

- [ ] **Step 7: Assert the built-in requests in the reader suite**

In `validation/reader.mjs` main page: next to `const errors = [], remote = [], consoleLines = [];` add `const assetPaths = [];`, and extend the `request` listener:
```js
  page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(url)) remote.push(r.url()); else if (r.url().startsWith(url)) assetPaths.push(new URL(r.url()).pathname); });
```
After the "Audible playback starts audio sources" assertion add:
```js
  assert.ok(assetPaths.includes('/pack.json'), 'Playback reads pack.json from the asset base');
  assert.ok(assetPaths.includes('/soundfonts/fluidr3/acoustic_grand_piano.json'), `The sample's piano comes from the pack: ${assetPaths.filter(path => path.startsWith('/soundfonts')).join(', ')}`);
```

- [ ] **Step 8: Run the tests**

Run: `npm run check && npm run build && npm run test:sounds && npm run test:reader && npm run test:guardrails`
Expected: PASS.

- [ ] **Step 9: Run the full CI sequence, commit, open PR 2**

```bash
npm run test:manifest && npm run test:validation && BROWSER=firefox npm run test:reader && BROWSER=webkit npm run test:reader
git add -A
git commit -m "feat: sound resolution with soundSources, pack sounds and a TimGM6mb fallback for any program

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Open PR "feat: asset base URL, sound packs and sound resolution".

---

# Phase 3 — Isolation and multiple instances (PR `feat/embed-isolation`)

### Task 3.1: Scope the CSS under .pepperscore, container sizing, root element and height prop

**Files:**
- Create: `validation/css-scope.mjs`, `apps/reader/src/demo.css`
- Modify: `packages/pepperscore/src/styles.css`, `packages/pepperscore/src/components/open-score-dialog.css`, `packages/pepperscore/src/components/Reader.tsx`, `packages/pepperscore/src/components/OpenScoreDialog.tsx` (class renames only, if any match), `apps/reader/src/pages/index.astro`, `validation/reader.mjs`, `validation/guardrails.mjs`, `validation/*.mjs` (selector renames), root `package.json` (devDependency `postcss`, script `test:css`)

**Interfaces:**
- Consumes: nothing new.
- Produces: the root element `<div class="pepperscore …" data-ps-height="auto|fill|fixed|natural">` wrapping `main.app-shell`; size attributes `data-ps-short` (root height ≤ 500px), `data-ps-tiny` (≤ 360px), `data-ps-wide` (width ≥ height) maintained by a ResizeObserver; `ReaderProps.height?: string` (`"fill"` or any CSS length) and `ReaderProps.className?: string`; renamed classes: `.toast`→`.ps-toast`, `.toast-text`→`.ps-toast-text`, `.toast-dismiss`→`.ps-toast-dismiss`, `.error`→`.ps-error`, `.error-text`→`.ps-error-text`, `.range`→`.ps-range`, `.switch`→`.ps-switch`, `.switch-row`→`.ps-switch-row`, `.selected`→`.is-selected`, `.open`→`.is-open`, `.on`→`.is-on`, `.portrait`→`.ps-portrait`, `.landscape`→`.ps-landscape`, `.eyebrow`→`.ps-eyebrow`. Container name `pepperscore` (inline-size) on the root.

- [ ] **Step 1: Write the failing CSS lint**

Add `"postcss": "^8.5.28"` to root `devDependencies` (`npm install`). `validation/css-scope.mjs`:
```js
// Static checks on the library stylesheets: everything is scoped under .pepperscore, nothing targets the page,
// sizes come from the root (container queries / data-ps-* attributes), and generic class names are prefixed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const files = ['packages/pepperscore/src/styles.css', 'packages/pepperscore/src/components/open-score-dialog.css'];
const GENERIC = ['toast', 'toast-text', 'toast-dismiss', 'error', 'error-text', 'range', 'switch', 'switch-row', 'selected', 'open', 'on', 'portrait', 'landscape', 'eyebrow'];
const problems = [];
for (const file of files) {
  const root = postcss.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { from: file });
  root.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
    for (const selector of rule.selectors) {
      if (!/^\.pepperscore(?![\w-])/.test(selector)) problems.push(`${file}: unscoped selector "${selector}"`);
      if (/(^|[\s,>+~(])(html|body)(?![\w-])|:root/.test(selector)) problems.push(`${file}: page-level selector "${selector}"`);
      for (const name of GENERIC) if (new RegExp(`\\.${name}(?![\\w-])`).test(selector)) problems.push(`${file}: generic class .${name} in "${selector}"`);
    }
  });
  root.walkAtRules(rule => {
    if (rule.name === 'media' && /width|height|orientation|aspect/.test(rule.params)) problems.push(`${file}: viewport query @media ${rule.params}`);
    if (/keyframes$/.test(rule.name) && !rule.params.startsWith('ps-')) problems.push(`${file}: @keyframes ${rule.params} must start with ps-`);
    if (rule.name === 'font-face') problems.push(`${file}: @font-face belongs in asset-fonts.ts`);
  });
  root.walkDecls(decl => {
    if (decl.prop === 'position' && decl.value === 'fixed') problems.push(`${file}: position:fixed in ${decl.parent.selector}`);
    if (/\d(d|s|l)?v(h|w|min|max)\b/.test(decl.value)) problems.push(`${file}: viewport unit in ${decl.parent.selector} { ${decl.prop}: ${decl.value} }`);
  });
}
assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
console.log('CSS scope: every rule under .pepperscore, no page selectors, viewport units, fixed positions or generic names');
```
Add `"test:css": "node validation/css-scope.mjs"` and prepend `npm run test:css && ` to `test:validation`.

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:css`
Expected: FAIL listing hundreds of unscoped selectors, the 8 `position:fixed` rules and the `vh/vw/dvh` declarations.

- [ ] **Step 3: Apply the mechanical transform (one-off script, not committed)**

Save as `/tmp/scope-css.mjs` and run from the worktree root: `node /tmp/scope-css.mjs packages/pepperscore/src/styles.css packages/pepperscore/src/components/open-score-dialog.css`.
```js
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const postcss = createRequire(`${process.cwd()}/package.json`)('postcss');
const RENAMES = [['toast-dismiss', 'ps-toast-dismiss'], ['toast-text', 'ps-toast-text'], ['toast', 'ps-toast'], ['error-text', 'ps-error-text'], ['error', 'ps-error'], ['switch-row', 'ps-switch-row'], ['switch', 'ps-switch'], ['range', 'ps-range'], ['selected', 'is-selected'], ['open', 'is-open'], ['on', 'is-on'], ['portrait', 'ps-portrait'], ['landscape', 'ps-landscape'], ['eyebrow', 'ps-eyebrow']];
const rename = selector => RENAMES.reduce((text, [from, to]) => text.replace(new RegExp(`\\.${from}(?![\\w-])`, 'g'), `.${to}`), selector);
const PAGE = new Set([':root', 'html', 'body', '#root']);
for (const file of process.argv.slice(2)) {
  const root = postcss.parse(readFileSync(file, 'utf8'));
  root.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
    const selectors = rule.selectors.map(s => s.trim());
    if (selectors.length > 1 && selectors.every(s => PAGE.has(s))) { rule.remove(); return; } // html,body,#root{…}: page rules move to the demo
    rule.selectors = [...new Set(selectors.flatMap(s => PAGE.has(s) ? ['.pepperscore'] : s === '*' ? ['.pepperscore', '.pepperscore *'] : [`.pepperscore ${rename(s)}`]))];
  });
  root.walkAtRules('media', rule => {
    const params = rule.params.replace(/\s+/g, '');
    if (/pointer|prefers-|hover/.test(params)) return;
    if (/height/.test(params)) {
      const size = /max-height:360px/.test(params) ? '[data-ps-tiny]' : '[data-ps-short]';
      const wide = /orientation:landscape/.test(params) ? '[data-ps-wide]' : '';
      rule.walkRules(inner => { inner.selectors = inner.selectors.map(s => s.replace(/^\.pepperscore /, `.pepperscore${size}${wide} `)); });
      rule.replaceWith(rule.nodes);
      return;
    }
    rule.name = 'container';
    rule.params = `pepperscore ${rule.params.trim()}`;
  });
  root.walkAtRules(/keyframes$/, rule => { rule.params = `ps-${rule.params}`; });
  root.walkDecls(/^animation(-name)?$/, decl => { decl.value = decl.value.replace(/\b(score-loading-spin|font-loading-sweep)\b/g, 'ps-$1'); });
  root.walkDecls('position', decl => { if (decl.value === 'fixed') decl.value = 'absolute'; });
  root.walkDecls(decl => { if (/\d(d|s|l)?v[hw]\b/.test(decl.value)) console.log(`MANUAL ${file}: ${decl.parent.selector} { ${decl.prop}: ${decl.value} }`); });
  writeFileSync(file, root.toString());
}
```

- [ ] **Step 4: Fix the remaining viewport units by hand**

Edit each `MANUAL` line the script printed with this table (selectors shown after scoping):

| Rule | Old | New |
| --- | --- | --- |
| `.pepperscore .app-shell` (first) | `min-height:100vh` | delete the declaration |
| `.pepperscore .app-shell` (`height:100dvh;…flex…` rule) | `height:100dvh` | delete the declaration |
| every `.pepperscore … .score-viewport` with `height:calc(100vh - Npx)` (5 rules) | that `height` | delete the declaration (the later `.score-viewport{flex:1;height:auto;min-height:0}` sizes it) |
| `.pepperscore .bottom-drawer` | `calc((100vw - 1330px)/2)`, `max-height:min(82vh,780px)` | `calc((100cqw - 1330px)/2)`, `max-height:min(82%,780px)` |
| `.pepperscore .drawer-handle.is-open` | `bottom:min(82vh,780px)` | `bottom:min(82%,780px)` |
| `.pepperscore .playback-notice` | `max-width:calc(100vw - 32px)` | `max-width:calc(100% - 32px)` |
| `.pepperscore .ps-landscape .score-meta` | `calc(100vw - 120px)` | `calc(100cqw - 120px)` |
| `.pepperscore .mixer-panel` | `min(82vh,720px)` | `min(82%,720px)` |
| `.pepperscore .instrument-picker-panel` | `min(88dvh,760px)` | `min(88%,760px)` |
| `.pepperscore[data-ps-short] .instrument-picker-panel` | `calc(100dvh - 16px)` | `calc(100% - 16px)` |
| `.pepperscore .header-secondary-panel` | `calc(100vw - 16px)` | `calc(100cqw - 16px)` |
| `.pepperscore .reader-notices` | `calc(100vw - 32px)` | `calc(100% - 32px)` |
| `.pepperscore .ps-toast.is-out-of-memory` | `calc(100vw - 40px)` | `calc(100% - 40px)` |
| `.pepperscore .open-dialog` | `min(88dvh,760px)` | `min(88%,760px)` |
| `.pepperscore .open-dialog` inside `@container pepperscore (max-width:480px)` | `calc(100dvh - 20px)` | `calc(100% - 20px)` |
| `.pepperscore .open-dialog-choice-list` | `min(40dvh,320px)` | `320px` |

Percentages work because the overlays are `position:absolute` inside the root (their containing block is the root) and the panels sit in `inset:0` backdrops.

Then insert this block at the top of `packages/pepperscore/src/styles.css`:
```css
/* ===== pepperscore root. Every rule in this file is scoped to it (validation/css-scope.mjs). ===== */
.pepperscore{position:relative;display:flex;flex-direction:column;overflow:hidden;isolation:isolate;container:pepperscore / inline-size;font-family:Poppins,Arial,sans-serif;color:#242824;background:#fff;font-synthesis:none;line-height:normal;text-align:left;outline:none}
.pepperscore[data-ps-height=auto]{height:100%;min-height:480px}
.pepperscore[data-ps-height=fill]{height:100%}
.pepperscore[data-ps-height=natural]{height:auto}
.pepperscore .app-shell{flex:1 1 auto;min-height:0}
.pepperscore[data-ps-height=natural] .score-viewport{flex:none;height:auto}
```
Keep the existing comment `/* HEADER BREAKPOINT (mobile): … */` directly above the converted `@container pepperscore (max-width:760px){` block, and update the comment text "HEADER BREAKPOINT: 760px must equal MOBILE_HEADER_BREAKPOINT" so it says "@container pepperscore (max-width:760px)".

- [ ] **Step 5: Run the lint**

Run: `npm run test:css`
Expected: PASS. If a generic name is reported in a selector the transform missed, rename it by hand.

- [ ] **Step 6: Root element, height prop and class renames in Reader**

In `Reader.tsx`:
1. Props: add `height?: string; className?: string` to `ReaderProps` and the destructuring.
2. Imports: add `MOBILE_HEADER_BREAKPOINT` to the `header-controls` import; remove `MOBILE_HEADER_QUERY`.
3. Add `const rootRef = useRef<HTMLDivElement>(null);` with the other refs, and module-level:
```ts
const flag = (element: HTMLElement, key: 'psShort' | 'psTiny' | 'psWide', on: boolean) => { if (on) element.dataset[key] = ''; else delete element.dataset[key]; };
```
4. Replace the `moreOpen` effect's `matchMedia` part (lines "const compact = window.matchMedia(MOBILE_HEADER_QUERY); …") with nothing, and add one root observer effect:
```ts
  // Sizes come from the root, not the viewport: short/tiny/wide replace the old max-height/orientation media queries,
  // and a root wider than the header breakpoint closes the More panel.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => {
      const width = root.clientWidth, height = root.clientHeight, natural = root.dataset.psHeight === 'natural';
      flag(root, 'psShort', !natural && height <= 500);
      flag(root, 'psTiny', !natural && height <= 360);
      flag(root, 'psWide', width >= height);
      if (width > MOBILE_HEADER_BREAKPOINT) setMoreOpen(false);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
```
5. Wrap the returned `<main className="app-shell">…</main>`:
```tsx
  const heightMode = height === 'fill' ? 'fill' : height ? 'fixed' : 'auto';
  return <div ref={rootRef} className={`pepperscore ${className ?? ''}`.trim()} data-ps-height={heightMode} style={heightMode === 'fixed' ? { height } : undefined}>
    <main className="app-shell">…unchanged children…</main>
  </div>;
```
6. JSX class renames (exact): `className={`reader-area ${prefs.mode} …`}` → `` `reader-area ps-${prefs.mode} …` ``; every `'selected'` produced in a `className` → `'is-selected'`; `drawer-handle ${drawer ? 'open' : ''}` → `'is-open'`; `bottom-drawer ${drawer ? 'open' : ''}` → `'is-open'`; `header-more-toggle ${moreOpen ? 'open' : ''}` → `'is-open'`; `switch ${prefs.x ? 'on' : ''}` → `` `ps-switch ${prefs.x ? 'is-on' : ''}` `` (5 switches); `className="switch-row"` and `"switch-row inference-row"` → `ps-switch-row`; `className="range"` → `ps-range`; `className="error"` → `ps-error`, `error-text` → `ps-error-text`; `` `toast ${…}` `` → `` `ps-toast ${…}` ``, `toast-text` → `ps-toast-text`, `toast-dismiss` → `ps-toast-dismiss`; `className="eyebrow"` → `ps-eyebrow`. Then check nothing is left:
```bash
grep -nE "className=[{\"\`][^>]*\b(toast|error|range|switch|selected|open|on|eyebrow|portrait|landscape)\b" packages/pepperscore/src/components/*.tsx || echo clean
grep -rn "closest('\.\(landscape\|portrait\)\|querySelector('\.\(toast\|selected\)" packages/pepperscore/src || echo clean
```
Expected: `clean` twice (class names like `ps-toast`, `is-open`, `open-dialog-*` do not match the word-boundary pattern only when prefixed; inspect any hit by hand).

7. Demo page: `apps/reader/src/demo.css`:
```css
/* The demo page owns the page: the component never styles html or body. */
html,body{margin:0;height:100%;overflow:hidden;background:#fff}
```
`apps/reader/src/pages/index.astro`: add `import '../demo.css';` and render `<Reader client:load assetBaseUrl="/" height="100dvh" />`.

- [ ] **Step 7: Update the validation selectors**

```bash
sed -i "s/'\.toast-text/'.ps-toast-text/g; s/'\.toast/'.ps-toast/g; s/\.mode-toggle-endless\.selected/.mode-toggle-endless.is-selected/g; s/\.mode-toggle-vertical\.selected/.mode-toggle-vertical.is-selected/g" validation/reader.mjs validation/guardrails.mjs validation/large-score.mjs validation/chunks.mjs
grep -nE "\.(toast|error|range|switch|selected|open|on|landscape|portrait|eyebrow)\b" validation/*.mjs
```
Fix every remaining hit by hand to the new names (keep `.open-dialog*`, `ps-*` and `is-*`). Then in `validation/reader.mjs` replace the header breakpoint assertion (line 30) with:
```js
  assert.match(await readFile(resolve(root, 'packages/pepperscore/src/styles.css'), 'utf8'), new RegExp(`/\\* HEADER BREAKPOINT \\(mobile\\)[^*]*\\*/\\s*@container pepperscore \\(max-width:${breakpoint}px\\)`), `The header's container breakpoint matches MOBILE_HEADER_BREAKPOINT (${breakpoint}px)`);
```
The demo root fills the viewport with no scrollbar, so container widths equal the viewport widths the suite already tests (760/761, 900/901, 1140/1141).

- [ ] **Step 8: Run the tests**

Run: `npm run test:css && npm run check && npm run build && npm run test:reader && npm run test:guardrails && npm run test:large && npm run test:chunks`
Expected: PASS. If a layout assertion fails, compare against `main` with a screenshot at the failing size before changing thresholds.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: scope all styles under .pepperscore; size from the root instead of the viewport

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3.2: Embed test page, root-scoped keyboard and unique ids

**Files:**
- Create: `apps/reader/src/pages/embed-test.astro`, `apps/reader/src/embed/EmbedTest.tsx`, `apps/reader/src/embed/host.css`, `validation/serve-dist.mjs`, `validation/embed.mjs`
- Modify: `packages/pepperscore/src/components/Reader.tsx`, `packages/pepperscore/src/components/OpenScoreDialog.tsx`, `apps/reader/src/pages/index.astro`, `validation/reader.mjs` (ids), root `package.json` (scripts), `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root element and renamed classes (Task 3.1).
- Produces: `ReaderProps.autoFocus?: boolean` (focus the root on mount; the demo passes it so Page Down works before any click, as today). Root has `tabIndex={0}`, `role="region"`, `aria-label="Score reader"`, `onKeyDown`. `validation/serve-dist.mjs` exports `serveDist(): Promise<{ url: string; close(): Promise<void> }>`. Embed page at `/embed-test` exposing `window.__embed` (filled in Task 3.3/4.2).

- [ ] **Step 1: Build the embed page (Phase 3 composition: two full readers)**

`apps/reader/src/embed/host.css` (a host page with Tailwind-preflight-style globals, and generic class names a host might use):
```css
*,::before,::after{box-sizing:border-box;border:0 solid;margin:0;padding:0}
html{font-family:Georgia,serif;line-height:1.5}
body{background:rgb(253,246,227);color:rgb(51,51,51);padding:24px}
h1,h2,h3,p{font-size:inherit;font-weight:inherit}
img,svg{display:block;vertical-align:middle}
img{max-width:100%;height:auto}
button,input,select,textarea{font:inherit;color:inherit;background-color:transparent}
.host-probe{margin:13px 0;font-family:Georgia,serif;font-size:17px}
.host-box{width:600px;height:600px;margin:24px 0;border:1px solid #999}
.host-box-short{height:auto}
.host-snippet{width:600px;margin:24px 0}
.toast,.error,.switch,.range,.selected,.open,.on{outline:5px solid red}
```

`apps/reader/src/embed/EmbedTest.tsx` (this task's version; Task 3.3 gives B `musicXml={expressive}`, Task 3.4 adds `persist`):
```tsx
import { useState } from 'react';
import { Reader } from 'pepperscore';
import ensemble from '../../../../validation/fixtures/ensemble.musicxml?raw';

/** Host page for validation/embed.mjs: several readers on one page, inside host-styled boxes. */
export default function EmbedTest() {
  const [second, setSecond] = useState(true);
  return <div className="embed-test">
    <div className="host-box embed-box-a"><Reader className="embed-a" height="fill" assetBaseUrl="/" musicXml={ensemble} /></div>
    <button type="button" className="host-unmount" onClick={() => setSecond(false)}>Remove the second reader</button>
    {second && <div className="host-box host-box-short embed-box-b"><Reader className="embed-b" height="400px" assetBaseUrl="/" /></div>}
  </div>;
}
```
(B shows the built-in sample for now: two concurrent imports supersede each other until Task 3.3 fixes it.)

`apps/reader/src/pages/embed-test.astro`:
```astro
---
import EmbedTest from '../embed/EmbedTest';
import 'pepperscore/style.css';
import '../embed/host.css';
---
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>pepperscore embed test</title></head>
  <body class="host-page">
    <h1 class="host-title">Host page</h1>
    <p class="host-probe" id="host-probe">Host text keeps its own font and margins.</p>
    <button class="host-button" type="button">Host button</button>
    <EmbedTest client:load />
    <p class="host-footer">End of the host page.</p>
  </body>
</html>
```

`validation/serve-dist.mjs`:
```js
// Static server for the built demo (apps/reader/dist) with Astro's directory pages (/embed-test → embed-test/index.html).
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const dist = resolve(root, 'apps/reader/dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.mp3': 'audio/mpeg' };

export async function serveDist() {
  if (!existsSync(resolve(dist, 'index.html'))) throw new Error('apps/reader/dist/index.html is missing: run `npm run build` first');
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let path = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (path !== dist && !path.startsWith(`${dist}${sep}`)) { response.writeHead(403).end(); return; }
    if (!extname(path)) path = resolve(path, 'index.html');
    try { response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' }).end(await readFile(path)); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(done => server.close(done)) };
}
```

- [ ] **Step 2: Write the failing embed test**

`validation/embed.mjs`:
```js
// Several readers embedded in a host-styled page (apps/reader /embed-test). Runs against the build. BROWSER=chromium|firefox|webkit.
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright-core';
import { serveDist } from './serve-dist.mjs';

const engine = process.env.BROWSER || 'chromium';
const launcher = { chromium, firefox, webkit }[engine];
if (!launcher) throw new Error(`BROWSER must be chromium, firefox or webkit (got "${engine}")`);
const server = await serveDist();
const browser = await launcher.launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}) });
const inside = (outer, inner) => inner.left >= outer.left - 1 && inner.top >= outer.top - 1 && inner.right <= outer.right + 1 && inner.bottom <= outer.bottom + 1;
const rect = (page, selector) => page.locator(selector).first().evaluate(element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; });
const rendered = (page, root) => page.waitForFunction(root => { const element = document.querySelector(root); return element && element.querySelector('.score-system svg') && !element.querySelector('.score-loading'); }, root, { timeout: 60000 });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/poppins/i, route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.url}/embed-test`);
  await rendered(page, '.pepperscore.embed-a');
  await rendered(page, '.pepperscore.embed-b');

  // No styles leak out into the host page.
  const host = await page.evaluate(() => {
    const probe = getComputedStyle(document.getElementById('host-probe'));
    return { font: probe.fontFamily, margin: probe.marginTop, size: probe.fontSize, body: getComputedStyle(document.body).backgroundColor, html: getComputedStyle(document.documentElement).fontFamily, button: getComputedStyle(document.querySelector('.host-button')).fontFamily };
  });
  assert.match(host.font, /Georgia/); assert.equal(host.margin, '13px'); assert.equal(host.size, '17px');
  assert.equal(host.body, 'rgb(253, 246, 227)'); assert.match(host.html, /Georgia/); assert.match(host.button, /Georgia/);

  // Review Focus 1: host preflight-style globals don't leak in.
  const look = await page.evaluate(() => {
    const root = document.querySelector('.pepperscore.embed-a');
    const style = selector => getComputedStyle(root.querySelector(selector));
    const topbar = root.querySelector('.topbar');
    return { play: style('.play-button').backgroundColor, title: style('.score-meta h1').fontSize, font: getComputedStyle(root).fontFamily, fits: topbar.scrollWidth <= topbar.clientWidth, selectedOutline: style('.mode-toggle .is-selected').outlineStyle };
  });
  assert.deepEqual(look, { play: 'rgb(52, 86, 66)', title: '30px', font: look.font, fits: true, selectedOutline: 'none' }, JSON.stringify(look));
  assert.match(look.font, /Poppins/);

  // Review Focus 5: ids are unique, and each ARIA reference resolves inside its own root.
  const ids = await page.evaluate(() => [...document.querySelectorAll('[id]')].map(element => element.id));
  assert.equal(new Set(ids).size, ids.length, `Duplicate ids: ${ids}`);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.pepperscore')].map(root => {
    const toggle = root.querySelector('.header-more-toggle');
    return !!toggle && !!root.querySelector(`#${CSS.escape(toggle.getAttribute('aria-controls'))}`);
  })), [true, true], 'More toggles control their own panels');

  // The drawer, its backdrop, dialogs and toasts stay inside the root box.
  const boxA = await rect(page, '.pepperscore.embed-a');
  await page.locator('.embed-a .drawer-handle').click();
  await page.waitForTimeout(450);
  assert.ok(inside(boxA, await rect(page, '.embed-a .bottom-drawer')), 'Drawer stays inside the root');
  assert.ok(inside(boxA, await rect(page, '.embed-a .drawer-backdrop')), 'Drawer backdrop stays inside the root');
  await page.locator('.embed-a button[aria-label="Close options"]').first().click();
  await page.locator('.embed-a .header-more-toggle').click();
  await page.locator('.embed-a').getByRole('button', { name: 'Track mixer', exact: true }).click();
  assert.ok(inside(boxA, await rect(page, '.embed-a .mixer-backdrop')), 'Mixer stays inside the root');
  await page.locator('.embed-a').getByRole('button', { name: 'Close track mixer', exact: true }).click();
  await page.locator('.embed-a input[type=file]').setInputFiles({ name: 'broken.musicxml', mimeType: 'application/xml', buffer: Buffer.from('<score-partwise><part') });
  await page.locator('.embed-a .ps-toast').waitFor({ timeout: 30000 });
  assert.ok(inside(boxA, await rect(page, '.embed-a .ps-toast')), 'Toast stays inside the root');
  await page.locator('.embed-a .ps-toast-dismiss').click();
  await rendered(page, '.pepperscore.embed-a');

  // Keyboard shortcuts only affect the focused instance; Escape elsewhere leaves another instance's More panel open.
  const scrollTop = root => page.evaluate(root => document.querySelector(`${root} .score-viewport`).scrollTop, root);
  await page.locator('.embed-a .score-viewport').click({ position: { x: 300, y: 40 } });
  await page.keyboard.press('PageDown');
  await page.waitForFunction(() => document.querySelector('.embed-a .score-viewport').scrollTop > 0, null, { timeout: 5000 });
  assert.equal(await scrollTop('.embed-b'), 0, 'Page Down in A does not scroll B');
  const aTop = await scrollTop('.embed-a');
  await page.locator('.embed-b .score-viewport').click({ position: { x: 300, y: 40 } });
  await page.keyboard.press('PageDown');
  await page.waitForFunction(() => document.querySelector('.embed-b .score-viewport').scrollTop > 0, null, { timeout: 5000 });
  assert.equal(await scrollTop('.embed-a'), aTop, 'Page Down in B does not scroll A');
  await page.locator('.embed-a .header-more-toggle').click();
  await page.locator('.embed-b .score-viewport').click({ position: { x: 300, y: 40 } });
  assert.equal(await page.locator('.embed-a .header-more-toggle').getAttribute('aria-expanded'), 'false', 'A click in B closes A\'s More panel (outside click)');
  await page.locator('.embed-a .header-more-toggle').click();
  await page.locator('.embed-b').focus();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.embed-a .header-more-toggle').getAttribute('aria-expanded'), 'true', 'Escape in B leaves A\'s More panel open');

  assert.deepEqual(errors, []);
  await context.close();
  console.log(`${engine}: embedding (style isolation, containment, unique ids, focused keyboard) passed`);
} finally { await browser.close(); await server.close(); }
```
Add `"test:embed": "node validation/embed.mjs"`, `"test:embed:firefox": "BROWSER=firefox node validation/embed.mjs"`, `"test:embed:webkit": "BROWSER=webkit node validation/embed.mjs"`; append ` && npm run test:embed` to `test:validation`.

Note: both readers must be tall enough to scroll in their boxes (A: ensemble in 600px; B: the sample in 400px). When Task 3.3 gives B `musicXml={expressive}`, check it still scrolls; if not, swap the fixtures between A and B.

- [ ] **Step 3: Run it to see it fail**

Run: `npm run build && npm run test:embed`
Expected: FAIL at "Duplicate ids" (`header-secondary-panel`, `overhang`) or at the keyboard section (window-level listener scrolls both).

- [ ] **Step 4: Root-scoped keyboard, outside click, ids and autoFocus**

In `Reader.tsx`:
1. Import `useId` from React. Add `autoFocus?: boolean` to props. `const uid = useId(); const panelId = `${uid}-more`; const overhangId = `${uid}-overhang`;` Replace `aria-controls="header-secondary-panel"` and `id="header-secondary-panel"` with `panelId`; `htmlFor="overhang"`/`id="overhang"` with `overhangId`.
2. Replace the window keydown effect (`window.addEventListener('keydown', key)`) with a root handler:
```ts
  const onRootKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && pickerPartId) { setPickerPartId(null); return; }
    if (event.key === 'Escape' && mixer) { setMixer(false); return; }
    if (pickerPartId || mixer || openDialog) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName)) return;
    if (['PageDown', 'ArrowRight', 'ArrowDown', ' '].includes(event.key)) { event.preventDefault(); turn(1); }
    if (['PageUp', 'ArrowLeft', 'ArrowUp'].includes(event.key)) { event.preventDefault(); turn(-1); }
  };
```
and on the root: `tabIndex={0} role="region" aria-label="Score reader" onKeyDown={onRootKeyDown}`.
3. In the `moreOpen` effect, make Escape only count inside this root: `const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && rootRef.current?.contains(event.target as Node)) { … } };` (the pointerdown outside check already uses `moreRef` containment).
4. Focus on mount when asked:
```ts
  useEffect(() => { if (autoFocus) rootRef.current?.focus({ preventScroll: true }); }, []);
```
5. `OpenScoreDialog.tsx`: its capture-phase document keydown handles Escape/Tab only when focus is inside the dialog: at the top of `key`, add `if (!panelRef.current?.contains(document.activeElement)) return;` (the dialog focuses its textarea on open, so a single open dialog keeps working).
6. Demo: `<Reader client:load assetBaseUrl="/" height="100dvh" autoFocus />`.
7. `validation/reader.mjs`: replace `getElementById('header-secondary-panel')` checks with the toggle's `aria-controls` (`document.getElementById(document.querySelector('.header-more-toggle').getAttribute('aria-controls'))`) and the `controls` expectation `'header-secondary-panel'` with `assert.ok(layout.controls?.endsWith('-more'))`; replace `#overhang` with `.drawer-panel input.ps-range` and `label[for=overhang] span` with `.drawer-panel .field-label span`.

- [ ] **Step 5: Add embed to CI**

In `.github/workflows/ci.yml`, job `reader`, after "Chunked engraving":
```yaml
      - name: Embedding
        run: npm run test:embed
        timeout-minutes: 4
        env:
          BROWSER: ${{ matrix.browser }}
```
(Chromium runs it through `test:validation`.)

- [ ] **Step 6: Run the tests**

Run: `npm run check && npm run build && npm run test:embed && npm run test:reader && BROWSER=firefox npm run test:embed && BROWSER=webkit npm run test:embed`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: keyboard and outside clicks scoped to the reader root; unique ids; embed test page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3.3: Multi-instance engine: Verovio channels, per-instance imports, shared audio

**Files:**
- Create: `packages/pepperscore/src/lib/audio-engine.ts`
- Modify: `packages/pepperscore/src/lib/verovio-protocol.ts`, `packages/pepperscore/src/lib/verovio-runtime.ts`, `packages/pepperscore/src/lib/verovio.worker.ts`, `packages/pepperscore/src/lib/render.ts`, `packages/pepperscore/src/lib/import.ts`, `packages/pepperscore/src/components/Reader.tsx`, `apps/reader/src/embed/EmbedTest.tsx`, `validation/embed.mjs`

**Interfaces:**
- Consumes: embed page and test (Task 3.2).
- Produces:
  - `verovio-runtime.ts`: `openVerovioChannel(): number`, `closeVerovioChannel(channel: number): void` (the worker stops when the last channel closes), `isRestarted(error: unknown): boolean`; `prepareVerovio(document, channel = 0)`, `verovioBaseline(document, channel = 0)`, `probeVerovio(document, channel, renderTicket, view, options, measures)`, `renderVerovioPages(document, channel, renderTicket, view, options, pages)`. `disposeVerovio` is removed.
  - `verovio-protocol.ts`: `probe`/`render` requests carry `channel: number`; `VerovioReply.code` adds `'restarted'`.
  - `render.ts`: `RenderOptions.channel?: number` (default 0) passed to every Verovio call, including on-demand system draws.
  - `import.ts`: `importScoreFile(file: File, channel = 0)`, `importMusicXmlText(text: string, name = 'MusicXML', channel = 0)` — a newer import only supersedes imports on the same channel.
  - `audio-engine.ts`: `type SharedAudio = { context: AudioContext; master: DynamicsCompressorNode }`, `getSharedAudio(): SharedAudio | null`, `resumeAudio(context: AudioContext): Promise<boolean>`, `type PlaybackOwner = { stop(): void }`, `claimPlayback(owner: PlaybackOwner): void`, `releasePlayback(owner: PlaybackOwner): void`.

- [ ] **Step 1: Extend the embed page and write the failing assertions**

`EmbedTest.tsx`: both readers get `musicXml` (A `ensemble`, B `expressive`), so two imports run at once. Insert into `validation/embed.mjs` (new context, before the existing one) — this block fails today because B's import supersedes A's, and because both readers create their own AudioContext:
```js
  // Two readers importing and engraving at once both render; one AudioContext; playing B stops A; unmounting B leaves A working.
  {
    const multi = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await multi.route(/poppins/i, route => route.abort());
    await multi.addInitScript(() => {
      window.__contexts = [];
      const Native = window.AudioContext;
      window.AudioContext = class extends Native { constructor(...args) { super(...args); window.__contexts.push(this); } };
    });
    const tab = await multi.newPage();
    const tabErrors = [];
    tab.on('pageerror', error => tabErrors.push(error.message));
    await tab.goto(`${server.url}/embed-test`);
    await rendered(tab, '.pepperscore.embed-a');
    await rendered(tab, '.pepperscore.embed-b');
    const label = root => tab.locator(`${root} .play-button`).getAttribute('aria-label');
    await tab.locator('.embed-a .play-button').click();
    await tab.waitForFunction(() => document.querySelector('.embed-a .play-button').getAttribute('aria-label') === 'Pause playback', null, { timeout: 30000 });
    await tab.locator('.embed-b .play-button').click();
    await tab.waitForFunction(() => document.querySelector('.embed-b .play-button').getAttribute('aria-label') === 'Pause playback', null, { timeout: 30000 });
    await tab.waitForFunction(() => document.querySelector('.embed-a .play-button').getAttribute('aria-label') === 'Play score', null, { timeout: 5000 });
    assert.equal(await label('.embed-a'), 'Play score', 'Playing B stops A');
    await tab.locator('.embed-b .stop-button').click();
    assert.equal(await tab.evaluate(() => window.__contexts.length), 1, 'Instances share one AudioContext');
    // Review Focus 3: unmounting B keeps the shared worker and AudioContext for A.
    await tab.locator('.host-unmount').click();
    await tab.waitForFunction(() => !document.querySelector('.embed-b'));
    await tab.locator('.embed-a').getByRole('button', { name: 'Endless view', exact: true }).click();
    await tab.waitForFunction(() => document.querySelector('.embed-a .score-content.is-painting') === null && document.querySelector('.embed-a .ps-landscape .score-system svg'), null, { timeout: 60000 });
    assert.notEqual(await tab.evaluate(() => window.__contexts[0].state), 'closed', 'The shared AudioContext stays open');
    await tab.locator('.embed-a .play-button').click();
    await tab.waitForFunction(() => document.querySelector('.embed-a .play-button').getAttribute('aria-label') === 'Pause playback', null, { timeout: 30000 });
    await tab.locator('.embed-a .stop-button').click();
    assert.deepEqual(tabErrors, []);
    await multi.close();
  }
  // A worker restart (out of memory in one reader) does not blank the other reader.
  {
    const oom = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await oom.route(/poppins/i, route => route.abort());
    await oom.addInitScript(() => { if (!sessionStorage.getItem('oom-armed')) { sessionStorage.setItem('oom-armed', '1'); localStorage.setItem('scoreflow-simulate-oom', '1'); } });
    const tab = await oom.newPage();
    await tab.goto(`${server.url}/embed-test`);
    await tab.waitForFunction(() => [...document.querySelectorAll('.pepperscore')].every(root => root.querySelector('.ps-toast.is-out-of-memory') || (root.querySelector('.score-system svg') && !root.querySelector('.score-loading'))), null, { timeout: 60000 });
    const outcome = await tab.evaluate(() => [...document.querySelectorAll('.pepperscore')].map(root => root.querySelector('.ps-toast.is-out-of-memory') ? 'oom' : 'rendered').sort());
    assert.deepEqual(outcome, ['oom', 'rendered'], `One reader reports the failure, the other still renders: ${outcome}`);
    await oom.close();
  }
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && npm run test:embed`
Expected: FAIL (A never renders, or `__contexts.length` is 2, or A keeps playing).

- [ ] **Step 3: Channel-keyed Verovio requests**

`verovio-protocol.ts`: add `channel: number` to the `probe` and `render` request members, and change the reply code to `code?: 'superseded' | 'missing' | 'oom' | 'restarted';` (document: "`restarted`: the worker was recycled under this request; the runtime retries it once").

`verovio.worker.ts`: replace `let latestTicket = 0;` with `const latestTickets = new Map<number, number>();`; in `step()` use
```ts
  if (request.kind !== 'import' && request.kind !== 'release' && request.ticket < (latestTickets.get(request.channel) ?? 0)) {
```
and in `self.onmessage`:
```ts
  if (request.kind === 'probe' || request.kind === 'render') latestTickets.set(request.channel, Math.max(latestTickets.get(request.channel) ?? 0, request.ticket));
```
Change `const BASELINE_LIMIT = 2;` to `const BASELINE_LIMIT = 12;` with the comment "Safety cap; the runtime releases baselines no channel uses (verovio-runtime.ts releaseUnused)."

`verovio-runtime.ts`:
1. Add:
```ts
export const isRestarted = (error: unknown) => error instanceof VerovioError && error.code === 'restarted';
const restarted = () => new VerovioError('Verovio restarted.', 'restarted');

/** One channel per reader instance: its own render tickets, current/previous revisions and import in flight. */
type Channel = { current: number; previous: number; importing?: number };
const channels = new Map<number, Channel>();
let nextChannel = 0;
const channelState = (id: number): Channel => { let state = channels.get(id); if (!state) { state = { current: 0, previous: 0 }; channels.set(id, state); } return state; };
export function openVerovioChannel(): number { const id = ++nextChannel; channelState(id); return id; }
/** A reader unmounted: forget what only it used; the worker (and its WASM heap) goes when the last channel closes. */
export function closeVerovioChannel(id: number): void {
  channels.delete(id);
  if (!channels.size) { stopWorker(new VerovioError('Verovio renderer disposed.')); return; }
  releaseUnused();
}
const inUse = (revision: number) => [...channels.values()].some(state => state.current === revision || state.previous === revision || state.importing === revision);
/** Keep at least BASELINE_LIMIT baselines; beyond that drop (and release in the worker) the oldest no channel uses. */
function releaseUnused(): void {
  for (const revision of [...baselines.keys()]) {
    if (baselines.size <= BASELINE_LIMIT) return;
    if (inUse(revision)) continue;
    baselines.delete(revision);
    if (worker) request({ kind: 'release', revision }).catch(() => {});
  }
}
```
2. Replace the three recycle calls `stopWorker(new VerovioError('Superseded score render.', 'superseded'))` (in `reduceChunkSize`, in `onmessage`, and before import in `prepareVerovio`) with `stopWorker(restarted())`. `disposeVerovio` is deleted.
3. Replace the global `importing`/`current` uses: keep a module counter `let importsInFlight = 0;` for the idle-recycle check (`const idle = !pending.size && item.kind !== 'import' && importsInFlight === 0 && currentChunked;`).
4. `prepareVerovio(document: SourceDocument, channel = 0)`:
```ts
export function prepareVerovio(document: SourceDocument, channel = 0): Promise<BaselineInfo> {
  const revision = verovioRevision(document);
  const state = channelState(channel);
  let cached = baselines.get(revision);
  if (cached) { baselines.delete(revision); baselines.set(revision, cached); return cached.then(info => { adopt(state, revision); return info; }); }
  if (heap > RECYCLE_BEFORE_IMPORT_BYTES && worker) stopWorker(restarted());
  // A copy of the bytes per attempt: they are transferred, and a restart under the import sends them again.
  const send = () => { const bytes = document.engravingBytes().slice(); return request<BaselineInfo>({ kind: 'import', revision, bytes: bytes.buffer, chunking: { force: forceChunks } }, [bytes.buffer]); };
  cached = send().catch(error => isRestarted(error) ? send() : Promise.reject(error));
  baselines.set(revision, cached);
  state.importing = revision;
  importsInFlight++;
  const settled = () => { importsInFlight--; if (state.importing === revision) state.importing = undefined; };
  cached.then(info => { adopt(state, revision); currentChunked = !!info.chunked; settled(); releaseUnused(); }, () => { settled(); if (baselines.get(revision) === cached) baselines.delete(revision); });
  return cached;
}
const adopt = (state: Channel, revision: number) => { if (state.current !== revision) { state.previous = state.current; state.current = revision; } };
```
5. `verovioBaseline(document, channel = 0)`: reject `superseded` only when `channelState(channel).importing` is a different revision (same logic as today, per channel), then `return prepareVerovio(document, channel)`.
6. `withBaseline(document, channel, run)`: retry once when `error.code === 'missing' && revision === channelState(channel).current`, or when `isRestarted(error)`:
```ts
async function withBaseline<T>(document: SourceDocument, channel: number, run: (revision: number) => Promise<T>): Promise<T> {
  const revision = verovioRevision(document);
  await verovioBaseline(document, channel);
  try { return await run(revision); }
  catch (error) {
    const retry = isRestarted(error) || (error instanceof VerovioError && error.code === 'missing' && revision === channelState(channel).current);
    if (!retry) throw error;
    baselines.delete(revision);
    await verovioBaseline(document, channel);
    return run(revision);
  }
}
export function probeVerovio(document: SourceDocument, channel: number, renderTicket: number, view: ViewSpec, options: Record<string, unknown>, measures: number): Promise<ProbeResult> {
  return withBaseline(document, channel, revision => request<ProbeResult>({ kind: 'probe', channel, ticket: renderTicket, revision, view, options, measures, chunkBudget, simulateOom: takeSimulatedOom() || undefined }));
}
export function renderVerovioPages(document: SourceDocument, channel: number, renderTicket: number, view: ViewSpec, options: Record<string, unknown>, pages: number[]): Promise<PagesResult> {
  return withBaseline(document, channel, revision => request<PagesResult>({ kind: 'render', channel, ticket: renderTicket, revision, view, options, pages, chunkBudget, simulateOom: takeSimulatedOom() || undefined }));
}
```
7. `render.ts`: add `channel?: number` to `RenderOptions`; in `renderScore` read `const channel = options.channel ?? 0;` and pass it to `verovioBaseline(source, channel)`, `probeVerovio(source, channel, ticket, …)` and every `renderVerovioPages(source, channel, ticket, …)` call (including the on-demand `pump` path).

- [ ] **Step 4: Per-channel imports**

`import.ts`: replace `let parsing: … | undefined;` with `const parsing = new Map<number, { worker: Worker; fail: (error: Error) => void }>();`. `runImport(request, file, channel)` does `parsing.get(channel)?.fail(new Error('Superseded import.'))`, `parsing.set(channel, { worker, fail })`, and in `stop`/`done` deletes the entry only when `parsing.get(channel)?.worker === worker`. Signatures: `importScoreFile(file: File, channel = 0)` → `runImport({ kind: 'file', file }, file, channel)`; `importMusicXmlText(text: string, name = 'MusicXML', channel = 0)` → `runImport({ kind: 'text', text }, undefined, channel)`.

- [ ] **Step 5: Shared audio and stop-others**

`packages/pepperscore/src/lib/audio-engine.ts`:
```ts
/** One AudioContext and master compressor for every reader on the page, and one playing reader at a time. */
export type SharedAudio = { context: AudioContext; master: DynamicsCompressorNode };
let shared: SharedAudio | undefined;

/** The page's audio graph, created on first use; null when the device has no Web Audio (playback then runs silently). */
export function getSharedAudio(): SharedAudio | null {
  if (shared && shared.context.state !== 'closed') return shared;
  let context: AudioContext;
  try { context = new AudioContext(); } catch { return null; }
  const master = context.createDynamicsCompressor();
  master.threshold.value = -15; master.knee.value = 12; master.ratio.value = 4; master.attack.value = .003; master.release.value = .18;
  master.connect(context.destination);
  return shared = { context, master };
}

const RESUME_TIMEOUT_MS = 1000;
/** AudioContext.resume() can stay pending forever (no output device, autoplay policy), so give it a bounded wait. */
export async function resumeAudio(context: AudioContext): Promise<boolean> {
  if (context.state === 'running') return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([context.resume(), new Promise(resolve => { timer = setTimeout(resolve, RESUME_TIMEOUT_MS); })]); }
  catch { /* a rejected resume means no sound */ }
  finally { clearTimeout(timer); }
  return (context.state as AudioContextState) === 'running';
}

export type PlaybackOwner = { stop(): void };
let owner: PlaybackOwner | null = null;
/** Starting playback in one reader stops whichever other reader is playing (also in silent wall-clock playback). */
export function claimPlayback(next: PlaybackOwner): void { if (owner && owner !== next) owner.stop(); owner = next; }
export function releasePlayback(who: PlaybackOwner): void { if (owner === who) owner = null; }
```

In `Reader.tsx`:
1. Delete `RESUME_TIMEOUT_MS` and `resumeAudio`; import `claimPlayback, getSharedAudio, releasePlayback, resumeAudio` from `../lib/audio-engine`, and `openVerovioChannel, closeVerovioChannel` from `../lib/verovio-runtime` (drop `disposeVerovio`).
2. Channel, first effect in the component (StrictMode-safe: opened in an effect, closed in its cleanup):
```ts
  const channelRef = useRef(0);
  useEffect(() => { const channel = openVerovioChannel(); channelRef.current = channel; return () => closeVerovioChannel(channel); }, []);
```
Pass `channelRef.current` to `importMusicXmlText(musicXml, 'MusicXML', channelRef.current)`, `importScoreFile(file, channelRef.current)`, `prepareVerovio(doc, channelRef.current)` (two places), and `renderScore(…, { …, channel: channelRef.current })`.
3. `audioRef` becomes `useRef<{ context: AudioContext; master: DynamicsCompressorNode; players: Map<string, AudioPlayer[]>; trackGains: Map<string, GainNode>; partKeys: Map<string, string>; mixScale: number } | null>(null)`; in `ensureAudio` replace the context creation block with:
```ts
    if (!audioRef.current) {
      const sharedAudio = getSharedAudio();
      if (!sharedAudio) return null;
      audioRef.current = { ...sharedAudio, players: new Map(), trackGains: new Map(), partKeys: new Map(), mixScale: 1 };
    }
```
4. Owner token and claim:
```ts
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const playbackOwner = useMemo(() => ({ stop: () => stopRef.current(true) }), []);
```
In `play()` call `claimPlayback(playbackOwner);` right after `const run = ++playRunRef.current;`, and in `stop` call `releasePlayback(playbackOwner)` (define `playbackOwner` above `stop`, or call through a ref).
5. Unmount cleanup (the effect currently ending with `audioRef.current?.context.close()`): remove `disposeVerovio()` and `context.close()`; instead dispose this instance's players, disconnect its track gains, and release:
```ts
  useEffect(() => () => { importRunRef.current++; playRunRef.current++; renderRef.current?.dispose(); if (playRef.current) { cancelAnimationFrame(playRef.current.frame); clearInterval(playRef.current.interval); } scheduledStopsRef.current.splice(0).forEach(item => item.stop()); audioRef.current?.players.forEach(players => players.forEach(p => p.dispose())); audioRef.current?.trackGains.forEach(gain => gain.disconnect()); releasePlayback(playbackOwner); }, []);
```

- [ ] **Step 6: Run the tests**

Run: `npm run check && npm run build && npm run test:embed && npm run test:reader && npm run test:chunks && npm run test:large && npm run test:guardrails && npm run test:transpose`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: readers share the Verovio worker, import workers and AudioContext without superseding each other

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3.4: persist namespaces

**Files:**
- Create: `packages/pepperscore/src/lib/storage.ts`, `packages/pepperscore/src/lib/prefs.ts`
- Modify: `packages/pepperscore/src/lib/score-db.ts`, `packages/pepperscore/src/lib/file-state.ts`, `packages/pepperscore/src/lib/last-file.ts`, `packages/pepperscore/src/components/Reader.tsx`, `apps/reader/src/pages/index.astro`, `apps/reader/src/embed/EmbedTest.tsx`, `validation/score-db.mjs`, `validation/embed.mjs`

**Interfaces:**
- Consumes: embed page (Task 3.3).
- Produces:
  - `file-state.ts`: `legacyStorageKey(hash: string, prefix = 'scoreflow')` → `` `${prefix}-file-v1:${hash}` ``.
  - `score-db.ts`: `ScoreDbOptions.keyPrefix?: string` (default `'scoreflow'`) used for `${prefix}-file-v2:`, `${prefix}-pending-v2:` and the legacy key; `scoreDb` (default instance) unchanged.
  - `last-file.ts`: `createLastFileStore(dbName: string | null): LastFileStore` with `readInfo(): Promise<LastFileInfo | null>`, `read(): Promise<LastFileRecord | null>`, `remember(file: File): Promise<LastFileInfo | null>`, `forget(): Promise<void>`; `isSameFile`, `lastFileToFile`, `LAST_FILE_STORE` kept; `LAST_FILE_DB_NAME` kept as `'scoreflow-last-file'`.
  - `prefs.ts`: `type Prefs`, `const defaults: Prefs`, `sanitizeSavedPrefs(raw: unknown): Prefs` (moved from Reader's mount effect, logic unchanged).
  - `storage.ts`: `type PersistNamespace = string | false`, `type ReaderStorage = { namespace: PersistNamespace; readPrefs(): unknown; writePrefs(prefs: object): void; reopenDismissed(): boolean; dismissReopen(): void; scoreDb: ScoreDb; lastFile: LastFileStore }`, `readerStorage(ns: PersistNamespace): ReaderStorage` (cached per namespace).
  - `ReaderProps.persist?: string | false` (default `'pepperscore'` in this phase; Task 4.2 makes it depend on `chrome`).

- [ ] **Step 1: Write the failing tests**

In `validation/score-db.mjs`, inside the first `page.evaluate` (after the `noStorage` checks), add:
```js
    const prefixed = createScoreDb({ indexedDB: null, keyPrefix: 'nsx', debounceMs: 0 });
    prefixed.write(state(hex(9)));
    await prefixed.flush();
    out.prefixedKeys = Object.keys(localStorage).filter(key => key.includes(hex(9)));
```
(use the same record builder the file already uses for `hex(1)`; if it is named differently, reuse that helper), and after the evaluate:
```js
  assert.deepEqual(result.prefixedKeys, [`nsx-file-v2:${'9'.repeat(64)}`], 'keyPrefix namespaces the localStorage fallback');
```
(adjust the expected hash to whatever `hex(9)` returns in that file).

In `validation/embed.mjs`, at the end of the first context block (before `assert.deepEqual(errors, [])`):
```js
  // persist: A writes only under "embedtest", B (persist={false}) writes nothing; nothing under the default names.
  await page.locator('.embed-b').getByRole('button', { name: 'Endless view', exact: true }).click();
  await page.locator('.embed-a').getByRole('button', { name: 'Endless view', exact: true }).click();
  await page.waitForTimeout(800);
  const stored = await page.evaluate(async () => ({ local: Object.keys(localStorage).sort(), dbs: (await indexedDB.databases?.() ?? []).map(db => db.name).sort() }));
  assert.ok(stored.local.length > 0 && stored.local.every(key => key.startsWith('embedtest-')), `Only embedtest-* keys: ${stored.local}`);
  assert.ok(stored.local.includes('embedtest-prefs'));
  assert.ok(stored.dbs.every(name => name === 'embedtest' || name === 'embedtest-last-file'), `Only embedtest databases: ${stored.dbs}`);
```
and pass `persist="embedtest"` to A and `persist={false}` to B in `EmbedTest.tsx`.

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:score-db; npm run build && npm run test:embed`
Expected: FAIL (`keyPrefix` ignored; `scoreflow-prefs` and `scoreflow` database written).

- [ ] **Step 3: Namespaced stores**

`file-state.ts`: `export const legacyStorageKey = (hash: string, prefix = 'scoreflow') => `${prefix}-file-v1:${hash}`;`

`score-db.ts`: add `keyPrefix?: string;` to `ScoreDbOptions` and, inside `createScoreDb`, replace the module-level key helpers with per-instance ones:
```ts
  const prefix = options.keyPrefix ?? 'scoreflow';
  const fallbackPrefix = `${prefix}-file-v2:`;
  const fallbackKey = (hash: string) => `${fallbackPrefix}${hash}`;
  const pendingKey = (hash: string) => `${prefix}-pending-v2:${hash}`;
  const legacyKey = (hash: string) => legacyStorageKey(hash, prefix);
```
(delete the module-level `fallbackKey`, `FALLBACK_PREFIX`, `pendingKey`; use `legacyKey` where `legacyStorageKey(...)` is called; `localKeys` uses `fallbackPrefix`).

`last-file.ts`: wrap the existing functions in a factory keyed by database name (bodies unchanged except `open` uses `dbName`, and a `null` name returns nothing):
```ts
export type LastFileStore = {
  readInfo(): Promise<LastFileInfo | null>;
  read(): Promise<LastFileRecord | null>;
  remember(file: File): Promise<LastFileInfo | null>;
  forget(): Promise<void>;
};
const disabled: LastFileStore = { readInfo: async () => null, read: async () => null, remember: async () => null, forget: async () => {} };
export function createLastFileStore(dbName: string | null): LastFileStore {
  if (!dbName) return disabled;
  let opening: Promise<IDBDatabase | null> | undefined;
  const open = () => opening ??= /* the existing open() body with factory.open(dbName, 1) */;
  return { readInfo: /* readLastFileInfo body */, read: /* readLastFile body */, remember: /* rememberLastFile body */, forget: /* forgetLastFile body */ };
}
```
Remove the old top-level `readLastFileInfo`, `readLastFile`, `rememberLastFile`, `forgetLastFile` exports.

`prefs.ts`:
```ts
import type { FileSettings } from './file-state';

/** Reader settings; `zoom` is the score's explicit stave scale, or null for the device default (see stave-scale.ts). */
export type Prefs = FileSettings & { zoom: number | null };
export const defaults: Prefs = { mode: 'portrait', notationFont: 'Bravura', barsPerLine: 'auto', overlap: 1, names: false, chordSymbols: false, inferChordSymbols: false, counts: false, subdivisions: false, annotationFont: 'Sans', bpm: 96, zoom: null, semitones: 0, scorePitch: 'written', keyFlip: false };

/** Saved global prefs, repaired. Zoom is per score (score-db), so a legacy global zoom is ignored. */
export function sanitizeSavedPrefs(raw: unknown): Prefs {
  const { zoom: _legacyZoom, ...saved } = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const next = { ...defaults, ...saved, zoom: null } as Prefs;
  if (typeof next.barsPerLine === 'number') next.barsPerLine = Math.max(1, Math.min(4, next.barsPerLine));
  if (!Number.isInteger(next.semitones)) next.semitones = 0;
  next.semitones = Math.max(-12, Math.min(12, next.semitones));
  if (!['written', 'concert'].includes(next.scorePitch)) next.scorePitch = 'written';
  if (typeof next.keyFlip !== 'boolean') next.keyFlip = false;
  if (!['Sans', 'Serif', 'Mono'].includes(next.annotationFont)) next.annotationFont = 'Sans';
  return next;
}
```

`storage.ts`:
```ts
import { createScoreDb, type ScoreDb } from './score-db';
import { createLastFileStore, type LastFileStore } from './last-file';

/**
 * Where a reader keeps its state: `persist` names the namespace (`<ns>-prefs`, `<ns>-file-v2:<hash>`, IndexedDB `<ns>` and
 * `<ns>-last-file`, sessionStorage `<ns>-reopen-dismissed`). `persist="scoreflow"` gives exactly the original Scoreflow
 * names, so existing visitors keep their settings. `false` reads and writes nothing.
 */
export type PersistNamespace = string | false;
export type ReaderStorage = {
  namespace: PersistNamespace;
  readPrefs(): unknown;
  writePrefs(prefs: object): void;
  reopenDismissed(): boolean;
  dismissReopen(): void;
  scoreDb: ScoreDb;
  lastFile: LastFileStore;
};

const stores = new Map<string, ReaderStorage>();
const none: ReaderStorage = {
  namespace: false,
  readPrefs: () => null, writePrefs: () => {}, reopenDismissed: () => false, dismissReopen: () => {},
  scoreDb: createScoreDb({ indexedDB: null, storage: null }),
  lastFile: createLastFileStore(null),
};

export function readerStorage(ns: PersistNamespace): ReaderStorage {
  if (ns === false || !ns.trim()) return none;
  let store = stores.get(ns);
  if (!store) {
    const prefsKey = `${ns}-prefs`, dismissedKey = `${ns}-reopen-dismissed`;
    store = {
      namespace: ns,
      readPrefs: () => { try { return JSON.parse(localStorage.getItem(prefsKey) || 'null'); } catch { return null; } },
      writePrefs: prefs => { try { localStorage.setItem(prefsKey, JSON.stringify(prefs)); } catch { /* storage full or blocked */ } },
      reopenDismissed: () => { try { return sessionStorage.getItem(dismissedKey) === '1'; } catch { return false; } },
      dismissReopen: () => { try { sessionStorage.setItem(dismissedKey, '1'); } catch { /* hidden for this page only */ } },
      scoreDb: createScoreDb({ dbName: ns, keyPrefix: ns }),
      lastFile: createLastFileStore(`${ns}-last-file`),
    };
    stores.set(ns, store);
  }
  return store;
}
```
Check that `persist="scoreflow"` reproduces every original name: `scoreflow` (IDB), `scoreflow-last-file`, `scoreflow-prefs`, `scoreflow-file-v2:`, `scoreflow-pending-v2:`, `scoreflow-file-v1:`, `scoreflow-reopen-dismissed`.

- [ ] **Step 4: Use the storage in Reader**

1. Delete `defaults`, `type Prefs`, `REOPEN_DISMISSED_KEY`, `reopenDismissed` from Reader; import `defaults, sanitizeSavedPrefs, type Prefs` from `../lib/prefs` and `readerStorage, type PersistNamespace` from `../lib/storage`; drop the `last-file` function imports except `isSameFile, lastFileToFile, type LastFileInfo`, and `scoreDb` from the score-db import (keep `sampleSource`).
2. Props: `persist?: PersistNamespace`, default `'pepperscore'`. `const storage = useMemo(() => readerStorage(persist), [persist]);` and `const storageRef = useRef(storage); storageRef.current = storage;`
3. Replacements: `scoreDb.` → `storage.scoreDb.` (the write effect, `persistPending`, `flush`; `readScoreRecord` becomes `const readScoreRecord = (source: FileSource) => Promise.race([storageRef.current.scoreDb.read(source).catch(() => null), …])` inside the component, or pass the db as a parameter); the mount effect's prefs block becomes `setPrefs(sanitizeSavedPrefs(storage.readPrefs()));`; the prefs write effect becomes `storage.writePrefs(global)`; `readLastFileInfo()` → `storage.lastFile.readInfo()`; `readLastFile()` → `storage.lastFile.read()`; `rememberLastFile(file)` → `storage.lastFile.remember(file)`; `forgetLastFile()` → `storage.lastFile.forget()`; `reopenDismissed()` → `storage.reopenDismissed()`; the `sessionStorage.setItem(REOPEN_DISMISSED_KEY, '1')` in `dismissReopen` → `storage.dismissReopen()`.
4. Demo: `<Reader client:load assetBaseUrl="/" height="100dvh" persist="scoreflow" autoFocus />`.

- [ ] **Step 5: Run the tests**

Run: `npm run check && npm run test:score-db && npm run build && npm run test:embed && npm run test:reader && npm run test:guardrails && npm run test:document`
Expected: PASS (`reader.mjs`, `guardrails.mjs`, `chunks.mjs`, `large-score.mjs` still use `scoreflow-prefs` and the `scoreflow-last-file` database: that is the proof that existing users keep their state).

- [ ] **Step 6: Full CI sequence, commit, PR 3**

```bash
npm run test:manifest && npm run test:validation
for b in firefox webkit; do BROWSER=$b npm run test:reader && BROWSER=$b npm run test:chunks && BROWSER=$b npm run test:embed; done
git add -A
git commit -m "feat: persist namespaces; the demo keeps the scoreflow names

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Open PR "feat: CSS isolation, multiple instances and persist namespaces".

---

# Phase 4 — Public API, library build and docs (PR `feat/pepperscore-api`)

### Task 4.1: Chrome presets and settings mapping (pure modules)

**Files:**
- Create: `packages/pepperscore/src/lib/chrome.ts`, `validation/api.mjs`
- Modify: `packages/pepperscore/src/lib/prefs.ts`, `packages/pepperscore/src/lib/header-controls.ts`, root `package.json` (script `test:api`)

**Interfaces:**
- Consumes: `Prefs`, `defaults` (Task 3.4).
- Produces:
  - `chrome.ts`: `type ChromePreset = 'full' | 'minimal' | 'none'`; `type PepperScoreControls = Partial<Record<'mixer' | 'openFile' | 'drawer' | 'transport' | 'viewToggle' | 'zoom', boolean>>`; `type ResolvedChrome = { header: boolean; transport: boolean; viewToggle: boolean; openFile: boolean; mixer: boolean; drawer: boolean; zoom: boolean; compactPlay: boolean; playhead: boolean; partControls: boolean; audio: boolean }`; `resolveChrome(preset?: ChromePreset, controls?: PepperScoreControls): ResolvedChrome`.
  - `prefs.ts`: `type PepperScoreSettings` (spec keys), `settingsToPrefs(settings?: PepperScoreSettings): Partial<Prefs>`, `viewToMode(view: 'vertical' | 'endless'): Prefs['mode']`.
  - `header-controls.ts`: `HEADER_CONTROL_GROUP: Record<HeaderControlId, 'transport' | 'viewToggle' | 'openFile' | 'zoom' | 'mixer'>`.

**Resolved spec ambiguities (encode exactly this):** `controls.transport` covers stop, play, BPM, transpose, key flip and bars; `viewToggle` the Vertical/Endless toggle; `openFile` the Open button, file input, open dialog and reopen offer; `mixer` the mixer button and dialog plus the part icons / instrument picker / stave eyes row; `zoom` the stave-scale slider, pinch zoom and the page arrows row ("Page arrows / zoom buttons"); `drawer` the bottom drawer and handle. The compact play button shows for `minimal` unless `transport` is overridden on. `none` loads no audio unless the host overrides `transport: true`.

- [ ] **Step 1: Write the failing node test**

`validation/api.mjs`:
```js
// Chrome presets and settings mapping for the public PepperScore props (pure modules, run in Node).
import assert from 'node:assert/strict';
import { resolveChrome } from '../packages/pepperscore/src/lib/chrome.ts';
import { defaults, settingsToPrefs, viewToMode } from '../packages/pepperscore/src/lib/prefs.ts';

const all = { header: true, transport: true, viewToggle: true, openFile: true, mixer: true, drawer: true, zoom: true, compactPlay: false, playhead: true, partControls: true, audio: true };
assert.deepEqual(resolveChrome(), all, 'full is the default');
assert.deepEqual(resolveChrome('full'), all);
assert.deepEqual(resolveChrome('minimal'), { header: false, transport: false, viewToggle: false, openFile: false, mixer: false, drawer: false, zoom: false, compactPlay: true, playhead: true, partControls: false, audio: true });
assert.deepEqual(resolveChrome('none'), { header: false, transport: false, viewToggle: false, openFile: false, mixer: false, drawer: false, zoom: false, compactPlay: false, playhead: false, partControls: false, audio: false });
assert.deepEqual(resolveChrome('full', { mixer: false, openFile: false }), { ...all, mixer: false, openFile: false, partControls: false });
const minimalWithToggle = resolveChrome('minimal', { viewToggle: true });
assert.equal(minimalWithToggle.header, true); assert.equal(minimalWithToggle.compactPlay, true);
const minimalWithTransport = resolveChrome('minimal', { transport: true });
assert.equal(minimalWithTransport.compactPlay, false, 'header transport replaces the compact button');
assert.equal(resolveChrome('none', { transport: true }).audio, true, 'a host can opt none into playback');

assert.deepEqual(settingsToPrefs({ noteNames: true, chordSymbols: true, inferChords: true, beatCounts: true, subdivisions: false, musicFont: 'Petaluma', staveFont: 'Serif', barsPerLine: 3, zoom: 1.5, semitones: 2, concert: true, overlap: 2 }),
  { names: true, chordSymbols: true, inferChordSymbols: true, counts: true, subdivisions: false, notationFont: 'Petaluma', annotationFont: 'Serif', barsPerLine: 3, zoom: 1.5, semitones: 2, scorePitch: 'concert', overlap: 2 });
assert.deepEqual(settingsToPrefs({}), {}, 'only given keys are applied');
assert.deepEqual(settingsToPrefs({ semitones: 40, overlap: 9, barsPerLine: 7, concert: false, zoom: null }), { semitones: 12, overlap: 3, barsPerLine: 4, scorePitch: 'written', zoom: null });
assert.equal(viewToMode('vertical'), 'portrait'); assert.equal(viewToMode('endless'), 'landscape');
assert.equal(defaults.mode, 'portrait');
console.log('API: chrome presets, control overrides and settings mapping passed');
```
Add `"test:api": "node validation/api.mjs"` and prepend `npm run test:api && ` to `test:validation`.

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:api`
Expected: FAIL with `Cannot find module …/chrome.ts`.

- [ ] **Step 3: Implement**

`packages/pepperscore/src/lib/chrome.ts`:
```ts
/** Chrome presets (docs/specs/pepperscore-embeddable-component.md, "Chrome presets") and per-control overrides. No runtime imports. */
export type ChromePreset = 'full' | 'minimal' | 'none';
export type PepperScoreControls = Partial<Record<'mixer' | 'openFile' | 'drawer' | 'transport' | 'viewToggle' | 'zoom', boolean>>;
export type ResolvedChrome = {
  header: boolean; transport: boolean; viewToggle: boolean; openFile: boolean; mixer: boolean; drawer: boolean; zoom: boolean;
  /** The overlaid play/stop button of `minimal`. */
  compactPlay: boolean;
  /** Playhead, note highlight and follow. */
  playhead: boolean;
  /** Part icons, instrument picker and stave eyes (they follow `mixer`). */
  partControls: boolean;
  /** Whether playback (and so any audio asset) can load at all. */
  audio: boolean;
};

export function resolveChrome(preset: ChromePreset = 'full', controls: PepperScoreControls = {}): ResolvedChrome {
  const on = (key: keyof PepperScoreControls) => controls[key] ?? preset === 'full';
  const transport = on('transport'), viewToggle = on('viewToggle'), openFile = on('openFile'), mixer = on('mixer'), drawer = on('drawer'), zoom = on('zoom');
  return {
    header: transport || viewToggle || openFile || mixer || zoom,
    transport, viewToggle, openFile, mixer, drawer, zoom,
    compactPlay: preset === 'minimal' && !transport,
    playhead: preset !== 'none' || transport,
    partControls: mixer,
    audio: preset !== 'none' || transport,
  };
}
```

Append to `packages/pepperscore/src/lib/prefs.ts`:
```ts
/** Initial reader settings a host passes as `settings` (spec names). Changing a key in the prop re-applies that key. */
export type PepperScoreSettings = Partial<{
  noteNames: boolean; chordSymbols: boolean; inferChords: boolean; beatCounts: boolean; subdivisions: boolean;
  musicFont: 'Bravura' | 'Petaluma'; staveFont: 'Sans' | 'Serif' | 'Mono'; barsPerLine: 'auto' | number;
  /** Explicit stave scale (clamped to the slider range when applied), or null for the device default. */
  zoom: number | null;
  semitones: number; concert: boolean; overlap: number;
}>;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, Math.round(value)));

export function settingsToPrefs(settings: PepperScoreSettings = {}): Partial<Prefs> {
  const out: Partial<Prefs> = {};
  if (settings.noteNames !== undefined) out.names = settings.noteNames;
  if (settings.chordSymbols !== undefined) out.chordSymbols = settings.chordSymbols;
  if (settings.inferChords !== undefined) out.inferChordSymbols = settings.inferChords;
  if (settings.beatCounts !== undefined) out.counts = settings.beatCounts;
  if (settings.subdivisions !== undefined) out.subdivisions = settings.subdivisions;
  if (settings.musicFont !== undefined) out.notationFont = settings.musicFont;
  if (settings.staveFont !== undefined) out.annotationFont = settings.staveFont;
  if (settings.barsPerLine !== undefined) out.barsPerLine = settings.barsPerLine === 'auto' ? 'auto' : clamp(settings.barsPerLine, 1, 4);
  if (settings.zoom !== undefined) out.zoom = settings.zoom;
  if (settings.semitones !== undefined) out.semitones = clamp(settings.semitones, -12, 12);
  if (settings.concert !== undefined) out.scorePitch = settings.concert ? 'concert' : 'written';
  if (settings.overlap !== undefined) out.overlap = clamp(settings.overlap, 0, 3);
  return out;
}
export const viewToMode = (view: 'vertical' | 'endless'): Prefs['mode'] => view === 'endless' ? 'landscape' : 'portrait';
```
If `FileSettings['barsPerLine']` or `overlap` are narrower literal types, cast the clamped values (`as Prefs['barsPerLine']`).

Append to `header-controls.ts`:
```ts
/** Which `controls` key shows each header control (see chrome.ts). */
export const HEADER_CONTROL_GROUP: Record<HeaderControlId, 'transport' | 'viewToggle' | 'openFile' | 'zoom' | 'mixer'> = {
  stop: 'transport', play: 'transport', bpm: 'transport', transpose: 'transport', keyFlip: 'transport', bars: 'transport',
  mode: 'viewToggle', openFile: 'openFile', staveScale: 'zoom', mixer: 'mixer',
};
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:api && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: chrome presets, control overrides and settings mapping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.2: The PepperScore component

**Files:**
- Rename (git mv): `packages/pepperscore/src/components/Reader.tsx` → `packages/pepperscore/src/components/PepperScore.tsx`
- Create: `apps/reader/src/DemoReader.tsx`
- Modify: `packages/pepperscore/src/components/PepperScore.tsx`, `packages/pepperscore/src/styles.css` (compact play button), `packages/pepperscore/src/index.ts`, `packages/pepperscore/src/lib/remote-score.ts` (delete `scoreUrlFromSearch` and `SCORE_URL_PARAM` if unused after this task), `apps/reader/src/pages/index.astro`, `apps/reader/src/embed/EmbedTest.tsx`, `validation/embed.mjs`

**Interfaces:**
- Consumes: `resolveChrome`, `settingsToPrefs`, `viewToMode`, `HEADER_CONTROL_GROUP` (Task 4.1); storage, channels, audio engine (Phase 3); `planSound` (Task 2.3).
- Produces (public, exported from `pepperscore`):
```ts
export type PepperScoreReadyInfo = { title: string; composer?: string; parts: Array<{ id: string; name: string }>; measures: number };
export type PepperScoreHandle = { play(): Promise<void>; stop(): void; transpose(semitones: number): void };
export type PepperScoreProps = {
  musicXml?: string; file?: File; scoreUrl?: string; abc?: string;          // first present wins, in this order
  chrome?: ChromePreset; controls?: PepperScoreControls; view?: 'vertical' | 'endless';
  height?: string; className?: string; settings?: PepperScoreSettings;
  persist?: string | false; assetBaseUrl?: string; soundPack?: SoundPackName; soundSources?: SoundSource[];
  onReady?(info: PepperScoreReadyInfo): void; onPlay?(): void; onStop?(): void; onError?(error: Error): void;
  autoFocus?: boolean; ref?: React.Ref<PepperScoreHandle>;
};
export default function PepperScore(props: PepperScoreProps): JSX.Element;
export const Reader = PepperScore; export type ReaderProps = PepperScoreProps;   // deprecated aliases, one release
```
`transpose(semitones)` sets the absolute offset (clamped to −12…12), like `settings.semitones`. `persist` defaults to `'pepperscore'` for `chrome="full"` and `false` otherwise.

- [ ] **Step 1: Rewrite the embed page to the spec composition**

`apps/reader/src/embed/EmbedTest.tsx`:
```tsx
import { useRef, useState } from 'react';
import { PepperScore, type PepperScoreHandle } from 'pepperscore';
import ensemble from '../../../../validation/fixtures/ensemble.musicxml?raw';

const ASSETS = '/custom-assets'; // no trailing slash on purpose (Review Focus 4)
const tune = (title: string, bars: number) => `X:1\nT:${title}\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\n${Array.from({ length: bars }, (_, i) => (i % 2 ? 'E D C D |' : 'C E G E |')).join(' ')}`;
const pianoSource = [{ id: 'embed-piano', kind: 'sample-pack' as const, url: '/embed-sounds/{name}.json', programs: [1] }];
type Events = Array<[string, string, unknown?]>;
declare global { interface Window { __embed: Record<string, unknown>; __events: Events } }

/** Host page for validation/embed.mjs: one full reader in a 600px box, three minimal snippets and an engraving-only one. */
export default function EmbedTest() {
  const [abcA, setAbcA] = useState(tune('Snippet A', 4));
  const [showNone, setShowNone] = useState(true);
  const refs = { full: useRef<PepperScoreHandle>(null), a: useRef<PepperScoreHandle>(null), b: useRef<PepperScoreHandle>(null), none: useRef<PepperScoreHandle>(null) };
  if (typeof window !== 'undefined') {
    window.__events ??= [];
    window.__embed = { refs, setAbcA, unmountNone: () => setShowNone(false) };
  }
  const log = (who: string) => ({
    onReady: (info: unknown) => window.__events.push([who, 'ready', info]),
    onPlay: () => window.__events.push([who, 'play']),
    onStop: () => window.__events.push([who, 'stop']),
    onError: (error: Error) => window.__events.push([who, 'error', error.message]),
  });
  return <div className="embed-test">
    <div className="host-box embed-box-full"><PepperScore ref={refs.full} className="embed-full" height="fill" assetBaseUrl={ASSETS} {...log('full')} /></div>
    <div className="host-snippet"><PepperScore ref={refs.a} className="embed-a" chrome="minimal" abc={abcA} assetBaseUrl={ASSETS} soundSources={pianoSource} settings={{ zoom: 1.5 }} {...log('a')} /></div>
    <div className="host-snippet"><PepperScore ref={refs.b} className="embed-b" chrome="minimal" musicXml={ensemble} height="200px" assetBaseUrl={ASSETS} {...log('b')} /></div>
    <div className="host-snippet"><PepperScore className="embed-c" chrome="minimal" musicXml="<score-partwise><part" assetBaseUrl={ASSETS} {...log('c')} /></div>
    {showNone && <div className="host-snippet"><PepperScore ref={refs.none} className="embed-none" chrome="none" view="endless" abc={tune('Engraving only', 8)} assetBaseUrl={ASSETS} {...log('none')} /></div>}
  </div>;
}
```

- [ ] **Step 2: Rewrite validation/embed.mjs for the new page**

Keep the helpers (`inside`, `rect`, `rendered`) and the server/browser setup. Every page context routes the asset base and the soundSources URL to local files, and records requests:
```js
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './serve-dist.mjs';
const sounds = join(root, 'packages/pepperscore-sounds-complete');
async function hostContext(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
  await context.route(/poppins/i, route => route.abort());
  const requests = [];
  context.on('request', request => requests.push(request.url()));
  // The custom asset base serves the complete pack, but with an empty FluidR3 list: every melodic program falls back to TimGM6mb.
  await context.route('**/custom-assets/**', async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/custom-assets\//, ''));
    if (path === 'pack.json') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pack: 'core', fluidr3: [] }) });
    try { return route.fulfill({ status: 200, body: await readFile(join(sounds, path)) }); } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await context.route('**/embed-sounds/*.json', async route => route.fulfill({ status: 200, contentType: 'application/json', body: await readFile(join(sounds, 'soundfonts/fluidr3', new URL(route.request().url()).pathname.split('/').pop())) }));
  await context.addInitScript(() => {
    window.__contexts = [];
    const Native = window.AudioContext;
    window.AudioContext = class extends Native { constructor(...args) { super(...args); window.__contexts.push(this); } };
  });
  return { context, requests };
}
```
Then these blocks, in order (each in its own `hostContext()`; close each context at the end):

1. **Engraving-only loads no audio** (fresh context, nothing played yet):
```js
  await page.goto(`${server.url}/embed-test`);
  await rendered(page, '.pepperscore.embed-none');
  await page.evaluate(() => window.__embed.refs.none.current.play());
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => window.__contexts.length), 0, 'chrome="none" creates no AudioContext');
  assert.deepEqual(requests.filter(url => /soundfonts|pack\.json|embed-sounds/.test(url)), [], 'chrome="none" loads no audio assets');
  assert.equal(await page.locator('.embed-none .play-button, .embed-none .ps-compact-play, .embed-none .topbar, .embed-none .drawer-handle').count(), 0, 'no controls at all');
```
2. **All instances render; style isolation; preflight; unique ids; containment** — the Task 3.2 assertions, retargeted: wait for `rendered` on `.embed-full`, `.embed-a`, `.embed-b`, `.embed-none`; host-leak and look checks on `.embed-full`; ids unique; drawer/backdrop/mixer inside `.embed-full`; the error toast of snippet C inside `.embed-c`:
```js
  await page.locator('.embed-c .ps-toast').waitFor({ timeout: 30000 });
  assert.ok(inside(await rect(page, '.pepperscore.embed-c'), await rect(page, '.embed-c .ps-toast')), 'Snippet C\'s error toast stays inside it');
  assert.ok((await page.evaluate(() => window.__events)).some(([who, kind]) => who === 'c' && kind === 'error'), 'onError fires');
  for (const who of ['full', 'a', 'b', 'none']) assert.ok((await page.evaluate(() => window.__events)).some(([w, kind, info]) => w === who && kind === 'ready' && info.parts.length > 0), `onReady fires for ${who}`);
  assert.equal(await page.locator('.embed-a .topbar, .embed-a .drawer-handle, .embed-a .part-controls .part-control, .embed-a .page-controls').count(), 0, 'minimal has no header, drawer, part icons or page arrows');
  assert.equal(await page.locator('.embed-a .ps-compact-play').count(), 1);
  assert.ok(await page.locator('.embed-a .score-meta h1').textContent() === 'Snippet A', 'credits show in minimal');
```
3. **Natural height and settings** (Review Focus 2):
```js
  const a = await page.evaluate(() => { const root = document.querySelector('.pepperscore.embed-a'); const viewport = root.querySelector('.score-viewport'); return { height: root.getBoundingClientRect().height, fits: viewport.scrollHeight <= viewport.clientHeight + 1, scale: root.querySelector('.score-content').dataset.staveScale }; });
  assert.ok(a.height > 100 && a.fits, `minimal without height sizes to its score: ${JSON.stringify(a)}`);
  assert.equal(a.scale, '1.5', 'settings.zoom survives the score load');
  assert.ok((await rect(page, '.pepperscore.embed-none')).height > 60, 'an Endless snippet with natural height is not collapsed');
  await page.evaluate(() => window.__embed.setAbcA('X:1\nT:Snippet A two\nM:4/4\nL:1/4\nK:G\nG B d B | c A F A | G4 |'));
  await page.waitForFunction(() => document.querySelector('.embed-a .score-meta h1')?.textContent === 'Snippet A two' && !document.querySelector('.embed-a .score-loading'), null, { timeout: 30000 });
  assert.equal(await page.locator('.embed-a .score-content').getAttribute('data-stave-scale'), '1.5', 'settings.zoom survives a source change');
```
4. **Keyboard only affects the focused instance**: as in Task 3.2 but between `.embed-full` and `.embed-b` (`height="200px"`).
5. **Playback: stop-others, soundSources, sf2 fallback, custom asset base, one AudioContext**:
```js
  await page.locator('.embed-a .ps-compact-play').click();
  await page.waitForFunction(() => document.querySelector('.embed-a .ps-compact-play').getAttribute('aria-label') === 'Stop playback', null, { timeout: 30000 });
  await page.locator('.embed-b .ps-compact-play').click();
  await page.waitForFunction(() => document.querySelector('.embed-b .ps-compact-play').getAttribute('aria-label') === 'Stop playback', null, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('.embed-a .ps-compact-play').getAttribute('aria-label') === 'Play score', null, { timeout: 5000 });
  await page.locator('.embed-b .ps-compact-play').click();
  const events = await page.evaluate(() => window.__events.map(([who, kind]) => `${who}:${kind}`));
  assert.ok(events.indexOf('a:stop') > events.indexOf('a:play') && events.includes('b:play'), `onPlay/onStop: ${events}`);
  const paths = requests.filter(url => url.startsWith(server.url)).map(url => new URL(url).pathname);
  assert.ok(paths.includes('/embed-sounds/acoustic_grand_piano.json'), 'A\'s soundSources entry is fetched for its program');
  assert.ok(!paths.includes('/custom-assets/soundfonts/fluidr3/acoustic_grand_piano.json'), 'the source wins over the pack');
  assert.ok(paths.includes('/custom-assets/soundfonts/TimGM6mb.sf2'), 'programs missing from the pack fall back to TimGM6mb');
  assert.ok(paths.includes('/custom-assets/fonts/Bravura.woff2') || (await page.evaluate(() => document.querySelector('style[data-pepperscore-fonts]').textContent)).includes('/custom-assets/fonts/Bravura.woff2'), 'fonts come from the custom asset base');
  assert.deepEqual(paths.filter(path => /^\/(fonts|soundfonts|instruments|pack\.json)/.test(path)), [], 'nothing loads from the default "/" base');
  assert.deepEqual(requests.filter(url => !url.startsWith(server.url) && /^https?:/.test(url) && !/poppins/i.test(url)), [], 'no remote requests (no CDN default)');
  assert.equal(await page.evaluate(() => window.__contexts.length), 1, 'one shared AudioContext');
```
6. **Unmount survival** (Review Focus 3): `await page.evaluate(() => window.__embed.unmountNone())`, then switch `.embed-full` to Endless and wait for `.embed-full .ps-landscape .score-system svg`; then `await page.evaluate(() => window.__embed.refs.full.current.play())` and wait for `.embed-full .play-button[aria-label="Pause playback"]`; then `refs.full.current.stop()`.
7. **persist**: `.embed-full` (default persist for full = `pepperscore`) and snippets (default `false`): after the blocks above, `Object.keys(localStorage)` all start with `pepperscore-` (and include `pepperscore-prefs`); `indexedDB.databases()` names ⊆ `{'pepperscore', 'pepperscore-last-file'}`.
8. **ref.transpose**: `await page.evaluate(() => window.__embed.refs.full.current.transpose(2))` then the header readout (`.embed-full .header-transpose-readout`, visible after opening More at 600px) starts with `+2`.
9. **OOM isolation**: the Task 3.3 block, with the expected outcome computed over `.pepperscore` roots that have a source (`full` shows the sample): every root ends either `rendered` or with `.ps-toast.is-out-of-memory`, exactly one `oom`.

- [ ] **Step 3: Run it to see it fail**

Run: `npm run build && npm run test:embed`
Expected: FAIL at compile time of the embed page (`PepperScore` not exported) — first failure is the build.

- [ ] **Step 4: Implement PepperScore**

```bash
git mv packages/pepperscore/src/components/Reader.tsx packages/pepperscore/src/components/PepperScore.tsx
```
In `PepperScore.tsx`:
1. Signature and props (types from the Interfaces block; import `resolveChrome, type ChromePreset, type PepperScoreControls` from `../lib/chrome`, `settingsToPrefs, viewToMode, type PepperScoreSettings` from `../lib/prefs`, `HEADER_CONTROL_GROUP` from `../lib/header-controls`, `clampStaveScale` from `../lib/stave-scale`, `useImperativeHandle` from React):
```tsx
export default function PepperScore({ musicXml, file, scoreUrl, abc, chrome: preset = 'full', controls, view, height, className, settings, persist, assetBaseUrl, soundPack = 'core', soundSources, onReady, onPlay, onStop, onError, autoFocus, ref }: PepperScoreProps) {
  const chrome = useMemo(() => resolveChrome(preset, controls), [preset, controls?.mixer, controls?.openFile, controls?.drawer, controls?.transport, controls?.viewToggle, controls?.zoom]);
  const storage = useMemo(() => readerStorage(persist ?? (preset === 'full' ? 'pepperscore' : false)), [persist, preset]);
  const settingsKey = JSON.stringify(settings ?? {});
  const hostPrefs = useMemo(() => {
    const mapped = settingsToPrefs(settings);
    if (mapped.zoom != null) mapped.zoom = clampStaveScale(mapped.zoom);
    return { ...mapped, ...(view ? { mode: viewToMode(view) } : {}) };
  }, [settingsKey, view]);
  const hostPrefsRef = useRef(hostPrefs);
  const callbacks = useRef({ onReady, onPlay, onStop, onError });
  callbacks.current = { onReady, onPlay, onStop, onError };
```
2. Loaded flag (first render depends only on `chrome`, never on source props, so the demo's client-only `scoreUrl` cannot cause a hydration mismatch): `const [loaded, setLoaded] = useState(preset === 'full');` set `setLoaded(true)` in `loadScore`. Render `.score-content` only when `loaded`.
3. Mount effect: `setPrefs({ ...sanitizeSavedPrefs(storage.readPrefs()), ...hostPrefs })`; remove `scoreUrlFromSearch(window.location.search)` (the component never reads the URL): `const hasSource = Boolean(musicXml || file || scoreUrl || abc);`; reopen offer only when `chrome.openFile && info && !hasSource && importRunRef.current === 0 && !storage.reopenDismissed()`; if `hasSource` → `setReady(true)` and return; if `preset !== 'full'` → return (empty frame, never `ready`, nothing engraved); otherwise the existing sample path.
4. One source effect replacing the `musicXml` effect and the `scoreUrl` effect:
```tsx
  useEffect(() => {
    if (musicXml) { void readMusicXml(musicXml); return () => { importRunRef.current++; }; }
    if (file) { void readFile(file); return; }
    if (scoreUrl) { void readUrl(scoreUrl); return; }
    if (abc) { void readAbc(abc); }
  }, [musicXml, file, scoreUrl, abc]);
```
where `readMusicXml(text)` is the body of the old `musicXml` effect moved into a function (same run counter, `importMusicXmlText(text, 'MusicXML', channelRef.current)`), each `read*` calls `setReady(true)` before loading, and `readUrl` uses `fetchScoreFile(url, document.baseURI)`.
5. Host settings: re-apply only changed keys:
```tsx
  useEffect(() => {
    const previous = hostPrefsRef.current;
    hostPrefsRef.current = hostPrefs;
    const changed = Object.fromEntries(Object.entries(hostPrefs).filter(([key, value]) => previous[key as keyof Prefs] !== value));
    if (Object.keys(changed).length && ready) update(changed as Partial<Prefs>);
  }, [hostPrefs]);
```
and in `loadScore`, the no-saved-record branch keeps the host's keys (Review Focus 2):
```tsx
    setPrefs(prev => saved ? { ...prev, ...saved.settings, zoom } : { ...prev, bpm: clampBpm(Math.round(next.tempo)), zoom: null, semitones: 0, keyFlip: false, scorePitch: next.parts.some(part => part.pitchBasis === 'concert') ? 'concert' : 'written', ...hostPrefsRef.current });
```
6. Callbacks:
```tsx
  useEffect(() => { if (error) callbacks.current.onError?.(new Error(error)); }, [error]);
  const wasPlaying = useRef(false);
  useEffect(() => { if (playing && !wasPlaying.current) callbacks.current.onPlay?.(); if (!playing && wasPlaying.current) callbacks.current.onStop?.(); wasPlaying.current = playing; }, [playing]);
```
`onReady`: in the render effect's success path, after `setError('')`, once per `scoreRevision`:
```tsx
        if (readyRevisionRef.current !== scoreRevision) { readyRevisionRef.current = scoreRevision; callbacks.current.onReady?.({ title: score.title, composer: score.composer, parts: score.parts.map(part => ({ id: part.id, name: part.name })), measures: score.parts[0]?.measures.length ?? 0 }); }
```
(`const readyRevisionRef = useRef(-1);`).
7. Ref handle:
```tsx
  const playingRef = useRef(false); playingRef.current = playing || loadingAudio;
  useImperativeHandle(ref, () => ({
    play: async () => { if (chrome.audio && !playingRef.current) await playRef2.current(); },
    stop: () => stopRef.current(true),
    transpose: semitones => changePitchRef.current({ semitones: clampSemitones(Math.round(semitones)) }),
  }), [chrome.audio]);
```
with `playRef2.current = play` and `changePitchRef.current = changePitch` assigned each render. `play()` itself returns early when `!chrome.audio`.
8. Chrome gating in JSX: header `{chrome.header && <header className="topbar" …>}` with `HEADER_CONTROLS.filter(control => chrome[HEADER_CONTROL_GROUP[control.id]])` inside `renderControls`; the hidden file input, open dialog and reopen banner only with `chrome.openFile`; mixer dialog only with `chrome.mixer`; part controls and the instrument picker only with `chrome.partControls`, and when hidden `metricsFor` returns `{ ...metrics, gutter: 0 }` so the score uses the full width; page arrows and pinch zoom only with `chrome.zoom`; drawer, handle and backdrop only with `chrome.drawer`; playback line, highlight and follow effect body only when `chrome.playhead`; `data-ps-height`: `height === 'fill' ? 'fill' : height ? 'fixed' : preset === 'full' ? 'auto' : 'natural'`; in natural mode the render effect uses `availableHeight = 4000` (no height fit against a content-sized viewport).
9. Compact play button (minimal):
```tsx
    {chrome.compactPlay && <button type="button" className={`ps-compact-play icon-button ${loadingAudio ? 'is-loading' : ''}`} aria-label={playing || loadingAudio ? 'Stop playback' : 'Play score'} title={playing || loadingAudio ? 'Stop playback' : 'Play score'} onClick={() => { if (playing || loadingAudio) stop(true); else void play(); }}>{playing || loadingAudio ? <Square size={15} fill="currentColor"/> : <Play size={15} fill="currentColor"/>}</button>}
```
and in `styles.css`:
```css
.pepperscore .ps-compact-play{position:absolute;top:8px;right:8px;z-index:9;width:36px;height:36px;border-radius:50%;background:#345642;color:#fff;box-shadow:0 3px 8px #34564233}
.pepperscore .ps-compact-play:hover{background:#254633}
.pepperscore .ps-compact-play.is-loading{opacity:.75}
```
10. `src/index.ts`:
```ts
import './styles.css';
import PepperScore from './components/PepperScore';
import type { PepperScoreProps } from './components/PepperScore';

export { PepperScore };
export default PepperScore;
export type { PepperScoreProps, PepperScoreHandle, PepperScoreReadyInfo } from './components/PepperScore';
export type { ChromePreset, PepperScoreControls } from './lib/chrome';
export type { PepperScoreSettings } from './lib/prefs';
export type { SoundSource } from './lib/sounds';
export type { SoundPackName } from './lib/assets';
export { SOUNDS_VERSION, defaultAssetBaseUrl } from './lib/assets';
/** @deprecated Use PepperScore. Kept for one release. */
export const Reader = PepperScore;
/** @deprecated Use PepperScoreProps. Kept for one release. */
export type ReaderProps = PepperScoreProps;
```
11. Demo: `apps/reader/src/DemoReader.tsx`:
```tsx
import { useState } from 'react';
import { PepperScore } from 'pepperscore';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';

/**
 * The demo maps `?score=<url>` to scoreUrl (the component never reads the page URL). It is read on the client's first
 * render; PepperScore's first render does not depend on its source props, so hydration still matches the server HTML.
 */
const linkedScore = () => typeof window === 'undefined' ? undefined : new URLSearchParams(window.location.search).get('score')?.trim() || undefined;

export default function DemoReader() {
  const [scoreUrl] = useState(linkedScore);
  return <PepperScore className="scoreflow-demo" height="100dvh" persist="scoreflow" assetBaseUrl="/" scoreUrl={scoreUrl} autoFocus />;
}
```
`apps/reader/src/pages/index.astro`: `import DemoReader from '../DemoReader';` and `<body><DemoReader client:load /></body>`. Remove the four `@fontsource/poppins` imports from `PepperScore.tsx` (the library CSS imports Poppins from Task 4.3 on; the demo imports it itself for dev). Delete `scoreUrlFromSearch`/`SCORE_URL_PARAM` from `remote-score.ts` if `grep -rn scoreUrlFromSearch packages validation apps` finds no other use.

- [ ] **Step 5: Run the tests**

Run: `npm run check && npm run build && npm run test:embed && npm run test:reader && npm run test:guardrails && npm run test:api`
Expected: PASS (the reader suite's `?score=` block proves the demo mapping).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: PepperScore component with chrome presets, sources, settings, callbacks and ref

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.3: Library build (ESM, d.ts, style.css, worker chunks) consumed by the demo

**Files:**
- Create: `packages/pepperscore/vite.config.ts`, `packages/pepperscore/tsconfig.build.json`, `packages/pepperscore/scripts/finalize-css.mjs`, `packages/pepperscore/LICENSE`
- Modify: `packages/pepperscore/package.json`, `apps/reader/astro.config.mjs`, `apps/reader/tsconfig.json`, root `package.json` (`build`), `.github/workflows/ci.yml` (nothing to add: `npm run build` now builds the library first)

**Interfaces:**
- Consumes: `src/index.ts` (Task 4.2).
- Produces: `packages/pepperscore/dist/index.js` (ESM, externals = dependencies + peer dependencies), `dist/index.d.ts` (+ per-module `.d.ts`), `dist/style.css` (starts with the four `@fontsource/poppins` `@import`s), `dist/assets/verovio.worker-<hash>.js`, `dist/assets/import.worker-<hash>.js`. Package `exports`: `"."` → `{ types: ./dist/index.d.ts, import: ./dist/index.js }`, `"./style.css"` → `./dist/style.css`. The demo builds against `dist` (so the reader and embed suites exercise the real library output) and develops against `src` (dev-only alias).

- [ ] **Step 1: Write the failing check**

```bash
npm run build -w pepperscore && ls packages/pepperscore/dist/index.js packages/pepperscore/dist/index.d.ts packages/pepperscore/dist/style.css && ls packages/pepperscore/dist/assets | grep -E '^(verovio|import)\.worker-.*\.js$' && head -c 200 packages/pepperscore/dist/style.css | grep -q '@fontsource/poppins/400.css'
```
Expected: FAIL (`Missing script: "build"`).

- [ ] **Step 2: Library build config**

`packages/pepperscore/vite.config.ts`:
```ts
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
```

`packages/pepperscore/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "declaration": true, "emitDeclarationOnly": true, "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.worker.ts"]
}
```

`packages/pepperscore/scripts/finalize-css.mjs`:
```js
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
```

`packages/pepperscore/LICENSE`: copy the root `LICENSE` verbatim, then append:
```
---
dist/assets/verovio.worker-*.js bundles Verovio 6.3.0 (https://www.verovio.org/), unmodified, under LGPL-3.0-or-later.
```

`packages/pepperscore/package.json` — remove `"private": true` and set:
```json
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./style.css": "./dist/style.css",
    "./package.json": "./package.json"
  },
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist", "README.md", "LICENSE"],
  "sideEffects": ["*.css"],
  "scripts": {
    "build": "vite build && tsc -p tsconfig.build.json && node scripts/finalize-css.mjs",
    "check": "tsc --noEmit -p .",
    "prepack": "npm run build"
  },
```
Root `package.json`: `"build": "npm run build -w pepperscore && npm run build -w pepperscore-reader"`.

- [ ] **Step 3: Demo: dist in builds, src in dev and in type checks**

`apps/reader/astro.config.mjs`:
```js
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { fileURLToPath } from 'node:url';
import soundPack from './sounds.mjs';

const librarySource = fileURLToPath(new URL('../../packages/pepperscore/src/', import.meta.url));
/** `astro dev` works on the library sources (HMR, no rebuild); `astro build` uses the built package like any host. */
const devSource = {
  name: 'pepperscore-dev-source',
  hooks: {
    'astro:config:setup': ({ command, updateConfig }) => {
      if (command !== 'dev') return;
      updateConfig({ vite: { resolve: { alias: [{ find: /^pepperscore$/, replacement: `${librarySource}index.ts` }, { find: /^pepperscore\/style\.css$/, replacement: `${librarySource}styles.css` }] } } });
    },
  },
};

export default defineConfig({ integrations: [react(), soundPack(), devSource], devToolbar: { enabled: false }, vite: { optimizeDeps: { include: ['abcjs'] } } });
```
`apps/reader/tsconfig.json` — add to `compilerOptions`: `"paths": { "pepperscore": ["../../packages/pepperscore/src/index.ts"] }` (so `astro check` in CI does not need a built `dist`).

- [ ] **Step 4: Run the check from Step 1, then the suites against the built library**

```bash
npm install
npm run build -w pepperscore && ls packages/pepperscore/dist/index.js packages/pepperscore/dist/index.d.ts packages/pepperscore/dist/style.css && ls packages/pepperscore/dist/assets | grep -E '^(verovio|import)\.worker-.*\.js$' && head -c 200 packages/pepperscore/dist/style.css | grep -q '@fontsource/poppins/400.css' && echo LIB-OK
grep -c "data:font/woff2" packages/pepperscore/dist/style.css   # expected 0: Poppins is not inlined
npm run check && npm run build && npm run test:reader && npm run test:embed && npm run test:chunks
```
Expected: `LIB-OK`, `0`, then all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "build: pepperscore library build (ESM, d.ts, style.css, worker chunks); the demo builds against it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.4: Pack smoke test, CI and documentation

**Files:**
- Create: `scripts/pack-smoke.mjs`, `packages/pepperscore/README.md`
- Modify: root `package.json` (script `test:pack`), `.github/workflows/ci.yml`, `README.md`

**Interfaces:**
- Consumes: the library build (Task 4.3).
- Produces: `npm run test:pack` — packs the library, installs the tarball into a fresh Vite + React app, builds it and checks the worker chunks; run in CI (validate job). No publishing anywhere.

- [ ] **Step 1: Write the smoke test**

`scripts/pack-smoke.mjs`:
```js
// npm pack the library, install the tarball into a temporary Vite + React app, build it, and check the output.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args, cwd) => execFileSync(npm, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
const work = mkdtempSync(join(tmpdir(), 'pepperscore-smoke-'));
try {
  const [packed] = JSON.parse(run(['pack', '--json', '--pack-destination', work, '-w', 'pepperscore'], root));
  const files = packed.files.map(file => file.path);
  for (const expected of ['dist/index.js', 'dist/index.d.ts', 'dist/style.css', 'package.json', 'README.md', 'LICENSE']) assert.ok(files.includes(expected), `tarball has ${expected}`);
  assert.ok(files.some(file => /^dist\/assets\/verovio\.worker-[\w-]+\.js$/.test(file)), 'tarball has the Verovio worker chunk');
  assert.ok(files.some(file => /^dist\/assets\/import\.worker-[\w-]+\.js$/.test(file)), 'tarball has the import worker chunk');
  assert.ok(!files.some(file => file.startsWith('src/')), 'tarball ships no sources');
  const manifest = JSON.parse(readFileSync(join(root, 'packages/pepperscore/package.json'), 'utf8'));
  assert.deepEqual(manifest.peerDependencies, { react: '>=19', 'react-dom': '>=19' });
  assert.equal(manifest.license, 'MIT');

  const app = join(work, 'app');
  mkdirSync(join(app, 'src'), { recursive: true });
  const vite = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies.vite;
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'pepperscore-smoke', private: true, type: 'module' }));
  writeFileSync(join(app, 'index.html'), '<!doctype html><div id="app"></div><script type="module" src="/src/main.js"></script>');
  writeFileSync(join(app, 'src/main.js'), [
    "import { createElement } from 'react';",
    "import { createRoot } from 'react-dom/client';",
    "import { PepperScore } from 'pepperscore';",
    "import 'pepperscore/style.css';",
    "createRoot(document.getElementById('app')).render(createElement(PepperScore, { chrome: 'minimal', abc: 'X:1\\nK:C\\nCDEF|' }));",
  ].join('\n'));
  run(['install', '--no-audit', '--no-fund', '--prefer-offline', join(work, packed.filename), 'react@^19.2.0', 'react-dom@^19.2.0', `vite@${vite}`], app);
  run(['exec', '--', 'vite', 'build'], app);
  const assets = readdirSync(join(app, 'dist/assets'));
  assert.ok(assets.some(file => /verovio\.worker.*\.js$/.test(file)), `host build emits the Verovio worker: ${assets}`);
  assert.ok(assets.some(file => /import\.worker.*\.js$/.test(file)), 'host build emits the import worker');
  assert.ok(assets.some(file => file.endsWith('.css')), 'host build emits the stylesheet');
  assert.ok(assets.some(file => /poppins.*\.woff2$/i.test(file)), 'Poppins arrives through @fontsource');
  console.log('Pack smoke: tarball contents and a fresh Vite + React host build passed');
} finally { rmSync(work, { recursive: true, force: true }); }
```
Add `"test:pack": "node scripts/pack-smoke.mjs"`.

- [ ] **Step 2: Run it**

Run: `npm run test:pack`
Expected: PASS. If the host build lacks a worker, inspect `node_modules/pepperscore/dist/index.js` in the temp app (keep the dir by commenting out `rmSync`) for the `new Worker(new URL(…, import.meta.url))` form and fix `vite.config.ts` (`base: './'`, `worker.format: 'es'`) before changing the test.

- [ ] **Step 3: CI**

`.github/workflows/ci.yml`, job `validate`, after "Validation suite …":
```yaml
      - name: Pack smoke test (npm pack into a fresh Vite app; nothing is published)
        run: npm run test:pack
        timeout-minutes: 6
```
Confirm `grep -n "publish" .github/workflows/ci.yml` prints nothing.

- [ ] **Step 4: Package README**

`packages/pepperscore/README.md` must contain these sections (write real prose and code, verified against the implementation):
1. **What it is** — one paragraph; formats (MusicXML/MXL/MIDI/MEI/ABC), Verovio engraving in a worker, playback.
2. **Install** — `npm install pepperscore` (React ≥ 19 peer).
3. **Full reader**:
```tsx
import { PepperScore } from 'pepperscore';
import 'pepperscore/style.css';

export default function ScorePage({ xml }: { xml: string }) {
  return <PepperScore musicXml={xml} height="100dvh" />;
}
```
4. **Inline snippets** — `chrome="minimal"` with `abc`/`musicXml`, natural height, several per page; `chrome="none"` engraving only, no audio.
5. **Astro (e.g. becreative: Astro 7 + React 19 + Tailwind/shadcn)**:
```astro
---
import { PepperScore } from 'pepperscore';
import 'pepperscore/style.css';
import tune from '../scores/tune.musicxml?raw';
---
<PepperScore client:visible chrome="minimal" abc={`X:1\nK:G\nGABc|d4|`} />
<PepperScore client:visible chrome="minimal" musicXml={tune} />
<div style="height: 80vh"><PepperScore client:load height="fill" scoreUrl="/scores/tune.musicxml" /></div>
```
Note that the component renders an empty frame on the server and engraves on the client; styles are scoped under `.pepperscore`, so Tailwind preflight does not change it and it does not change the page.
6. **Vite dev note** — add `optimizeDeps: { exclude: ['pepperscore'], include: ['pepperscore > abcjs'] }` to the host's Vite config (pre-bundling rewrites `import.meta.url`, which breaks the worker URLs; abcjs is CommonJS).
7. **Props** — a table with every prop from the spec's Public API (types, defaults, notes: source precedence; chrome table; `controls` mapping as resolved in Task 4.1; `height` values; `settings` are initial values; `persist` default and names; `assetBaseUrl`/`soundPack`; `soundSources` with one example of each kind; callbacks; `ref` handle with `transpose` = absolute semitones; `autoFocus`; `Reader`/`ReaderProps` deprecated aliases).
8. **Assets and self-hosting** — default jsDelivr URL; self-host: `cp -r node_modules/pepperscore-sounds-core public/pepperscore-sounds` and `assetBaseUrl="/pepperscore-sounds/"`; `soundPack="complete"` for all 128 FluidR3 sounds; sound resolution order; CORS needed for cross-origin bases.
9. **Licenses** — MIT; Verovio LGPL-3.0-or-later bundled in the worker chunk; asset licenses in the sounds packages.

Root `README.md`: replace the intro with "Scoreflow is the demo site for the `pepperscore` package (`packages/pepperscore`)…", list the workspace packages, add `npm run test:pack`, `test:embed`, `test:css`, `test:assets`, `test:sounds`, `test:api`, `sounds:core` to the scripts table, and a "Publishing (manual)" section:
```bash
npm run sounds:core
npm publish -w pepperscore-sounds-core
npm publish -w pepperscore-sounds-complete
npm publish -w pepperscore        # prepack builds dist
```
with "Bump `SOUNDS_VERSION` in `packages/pepperscore/src/lib/assets.ts` together with both sounds package versions (`npm run test:manifest` checks it). CI never publishes."

- [ ] **Step 5: Full CI sequence, commit, PR 4**

```bash
npm run check && npm run build && npm run test:manifest && npm run test:validation && npm run test:pack
for b in firefox webkit; do BROWSER=$b npm run test:reader && BROWSER=$b npm run test:chunks && BROWSER=$b npm run test:embed; done
git add -A
git commit -m "docs: pepperscore README; pack smoke test in CI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Open PR "feat: public PepperScore API, library build and docs".

---

## Self-review

**Spec coverage**

| Spec requirement | Task |
| --- | --- |
| npm workspaces layout (packages/pepperscore, sounds-core, sounds-complete, apps/reader; validation at root) | 1.1, 1.2, 2.2 |
| Public API props, source precedence, chrome/controls, view, height, className, settings, persist, assetBaseUrl, soundPack, soundSources, callbacks, ref | 4.1, 4.2 (assetBaseUrl/soundPack 2.1, soundSources 2.3, height 3.1, persist 3.4) |
| No source: full shows sample + open UI; minimal/none empty frame | 4.2 (step 4.3) |
| Settings are initial values; changed key re-applied; drawer edits still work | 4.2 (step 4.5) |
| Never reads window.location; demo maps ?score= | 4.2 (DemoReader) |
| Reader/ReaderProps aliases | 4.2 (index.ts) |
| Chrome preset table, none loads no audio | 4.1, 4.2, embed block 1 |
| CSS scoped under .pepperscore; ps- prefixes; contextual names kept | 3.1 (+ lint) |
| Fonts injected at runtime from assetBaseUrl; Poppins from @fontsource via package CSS | 2.1, 4.3 (finalize-css) |
| Sizes from the root (ResizeObserver + container units); demo root 100dvh | 3.1 |
| Overlays absolute inside a relative/overflow-hidden/isolated root | 3.1 |
| Keyboard on focusable root; outside-click/escape containment | 3.2 |
| Assets layout, pack.json, core (~15 MB) and complete (~54 MB), default jsDelivr URL with baked SOUNDS_VERSION, self-hosting | 2.1, 2.2, 4.4 |
| Core generated from complete by `npm run sounds:core`; only complete in git | 2.2 |
| Sound resolution order and SoundSource kinds mapped to existing players | 2.3 |
| Shared Verovio worker keyed per instance; shared import workers | 3.3 |
| Shared AudioContext; playing one stops others | 3.3 |
| persist namespaces localStorage + IndexedDB; demo persist="scoreflow"; false writes nothing | 3.4 |
| Vite library build: index.js, index.d.ts, style.css, worker chunks; WASM inlined | 4.3 |
| react/react-dom peers >=19, other deps regular | 1.1, 4.3, pack smoke |
| Manual publishing only | Global Constraints, 4.4 |
| Existing suites pass against apps/reader with persist="scoreflow" | 1.3, every task's run step |
| validation/embed.mjs: leaks, containment, keyboard, stop-others, none no audio, custom assetBaseUrl, soundSources fetch; Chromium + Firefox/WebKit matrix | 3.2, 3.3, 4.2 |
| scripts/pack-smoke.mjs | 4.4 |

No gaps found.

**Placeholder scan:** the README section list in Task 4.4 names its required content and code. No TBD/TODO.

**Type consistency:** `resolveAssetBase`, `assetUrl`, `loadPackInfo`, `ensureMusicFonts` (2.1) are used with the same signatures in 2.3 and 4.2. `planSound`/`planKey`/`fallbackSf2Url`/`SoundPlan` (2.3) match their uses in Reader. `loadPlayers(context, plan, destination)` and `addDrumFallback(context, players, notes, fallbackSf2, destination)` match the Reader snippet. Channel functions (`openVerovioChannel`, `closeVerovioChannel`, `probeVerovio(document, channel, ticket, …)`, `renderVerovioPages(document, channel, ticket, …)`) match `render.ts` changes. `importScoreFile(file, channel)` / `importMusicXmlText(text, name, channel)` match Reader. `readerStorage(ns)` fields match Reader replacements. `resolveChrome` fields (`header`, `compactPlay`, `partControls`, `audio`, …) match Task 4.2 gating; `HEADER_CONTROL_GROUP` values are keys of `ResolvedChrome`. `settingsToPrefs`/`viewToMode`/`PepperScoreSettings` live in `prefs.ts` and are imported from there in 4.2 and `index.ts`.

**Review Focus:** each of the five lines has its test in the owning task (3.2 preflight + ids, 4.2 settings zoom, 3.3/4.2 unmount, 2.1/4.2 asset base without slash).

## Risks and notes for the executor

- **Indefinite parent height.** `chrome="full"` without `height` uses `height:100%; min-height:480px`; inside a parent with no definite height the inner percentage heights (Endless centring) may not resolve. Documented in the README; the embed page uses a 600px box.
- **Host Vite dev pre-bundling** breaks `new URL('./assets/*.worker-*.js', import.meta.url)`; the README tells hosts to exclude `pepperscore` from `optimizeDeps`. `pack-smoke` only covers production builds.
- **Bare `@import "@fontsource/poppins/…"` in `dist/style.css`** relies on the host bundler resolving CSS imports from `node_modules` (Vite and Astro do; check webpack/Next before promising it).
- **Licensing:** the MIT package bundles LGPL Verovio in its worker chunk (noted in `LICENSE`); `pepperscore-sounds-*` carry GPL-2 TimGM6mb and CC BY 3.0 samples — confirm the maintainer is happy publishing them.
- **jsDelivr limits:** confirm `pepperscore-sounds-complete` (~54 MB unpacked) is served by jsDelivr's npm endpoint before making it a documented default.
- **Multi-instance Verovio:** the worker serializes all channels; four instances engrave one after another. A page with many large scores is slow, not broken.
- **Local, untracked files:** `public/variations/` (excluded in `.git/info/exclude`) and gitignored `tests/*.mjs` that read `dist/` need manual updates by the maintainer after Phase 1.
