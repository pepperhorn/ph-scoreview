# pepperscore: embeddable component

Status: approved 2026-10-09

## Goal

Publish the reader as a public MIT npm package, `pepperscore`, that sites such as becreative (Astro 7 + React 19 + Tailwind/shadcn) install and render as `<PepperScore … />`, both as a full reader page and as several compact inline snippets per page. PepperHorn layers and other proprietary features come later as plugins or forks; v1 only leaves extension points (`soundSources`, callbacks, ref) that do not box that in.

The current Astro site keeps working as the demo/playground and consumes the package like any other host.

## Repository layout (npm workspaces)

```
packages/pepperscore/                 component library: Vite library mode, ESM + .d.ts + style.css
packages/pepperscore-sounds-core/     assets only (no JS)
packages/pepperscore-sounds-complete/ assets only (no JS)
apps/reader/                          today's Astro app; imports `pepperscore`
validation/                           stays at the root; runs against apps/reader's build
```

`tests/` and `examples/` remain gitignored at the root.

## Public API

```tsx
import { PepperScore } from 'pepperscore';
import 'pepperscore/style.css';

<PepperScore
  musicXml={xml} | file={file} | scoreUrl="…" | abc="X:1…"   // first present wins, in this order
  chrome="full" | "minimal" | "none"                          // default "full"
  controls={{ mixer, openFile, drawer, transport, viewToggle, zoom }} // overrides of the chrome preset
  view="vertical" | "endless"
  height="420px" | "fill"        // "fill": parent's height; omitted: natural height (full chrome: fills parent, min 480px)
  className="…"
  ariaLabel="…"                  // landmark name; default "Score: <title>", else "Score reader"
  settings={{ noteNames, chordSymbols, inferChords, beatCounts, subdivisions, musicFont, staveFont, barsPerLine, zoom, semitones, concert, overlap }}
  persist="pepperscore" | false  // storage namespace; default "pepperscore" for full, false otherwise
  assetBaseUrl="…"               // default: jsDelivr URL of the matching pepperscore-sounds-<pack> version
  soundPack="core" | "complete"  // default "core"
  soundSources={[…]}
  onReady={info => …} onPlay={() => …} onStop={() => …} onError={err => …}
  ref={handle}                   // { play(), stop(), transpose(semitones) }
/>
```

- With no source prop, `full` shows the built-in sample and the open-file UI; `minimal`/`none` render nothing but an empty frame.
- `settings` are initial values; changing a key in the prop re-applies that key. Drawer edits still work (full chrome).
- The component never reads `window.location`. The demo app maps `?score=` to `scoreUrl`.
- `ReaderProps`/`Reader` stay exported as aliases for one release for the existing `<Reader musicXml>` docs.

### Chrome presets

| Control | full | minimal | none |
| --- | --- | --- | --- |
| Header transport (stop, play, BPM, view toggle, open, mixer) | yes | — | — |
| Compact play/stop button (overlaid corner) | — | yes | — |
| Playhead, note highlight, follow | yes | yes | — |
| Bottom drawer + handle | yes | — | — |
| Part icons / instrument picker / stave eyes | yes | — | — |
| Page arrows / zoom buttons | yes | — | — |
| Score credits | yes | yes | yes |

`none` is engraving only: no audio is loaded.

## Layout and CSS isolation

- All selectors are scoped under a root `.pepperscore` class; no rules on `:root`, `html`, `body` or `*` other than `.pepperscore *`. Generic class names are prefixed (`ps-`) where they would collide (e.g. `.error`, `.range`, `.toast`, `.switch`). Contextual class names stay.
- Fonts (`@font-face` for Bravura, Petaluma, Petaluma Script) are injected at runtime from `assetBaseUrl`, not hardcoded in CSS. Poppins comes from `@fontsource/poppins` imported by the package CSS.
- Sizes derive from the root element (`ResizeObserver` + container units), not `100vh`/`100dvh`/`100vw`. The demo app gives the root `height: 100dvh`.
- Drawer, backdrop, toasts, notices, picker and dialogs are `position: absolute` inside the root (root is `position: relative; overflow: hidden; isolation: isolate`), so they never escape into the host page.
- Keyboard shortcuts are bound to the root element (it is focusable, `tabIndex=0`) instead of `window`; outside-click/escape handlers check containment in the root.

## Assets and sounds

`assetBaseUrl` points to the root of a sounds package layout:

```
fonts/Bravura.woff2, Bravura-OFL.txt, Petaluma.woff2, PetalumaScript.woff2, Petaluma-OFL.txt
instruments/*.svg
soundfonts/TimGM6mb.sf2, COPYING.txt
soundfonts/perfect-drums/manifest.json + *.mp3
soundfonts/fluidr3/<name>.json, ATTRIBUTION.txt
pack.json   { "pack": "core" | "complete", "fluidr3": ["acoustic_grand_piano", …] }
```

- `pepperscore-sounds-core` (~15 MB): fonts, instruments, Perfect Drums, TimGM6mb.sf2, and FluidR3 for: acoustic_grand_piano, electric_piano_1, acoustic_guitar_nylon, acoustic_guitar_steel, electric_guitar_clean, electric_guitar_jazz, acoustic_bass, electric_bass_finger, string_ensemble_1, violin, cello, flute, clarinet, alto_sax, tenor_sax, trumpet, trombone, choir_aahs, voice_oohs.
- `pepperscore-sounds-complete` (~54 MB): everything, all 128 FluidR3 instruments.
- Default `assetBaseUrl` = `https://cdn.jsdelivr.net/npm/pepperscore-sounds-${soundPack}@${SOUNDS_VERSION}/` where `SOUNDS_VERSION` is baked in at build time. Self-hosters copy the package directory into `public/` and set `assetBaseUrl`.
- Asset sources are the single source of truth in `packages/pepperscore-sounds-complete/`; core is generated from it by a script (`npm run sounds:core`) so the two cannot drift. Only the complete package holds the files in git.

### Sound resolution

For each part sound (GM program or drum kit):

1. The first `soundSources` entry that claims it (`programs` includes the program, or `drums: true` for a kit).
2. The pack's FluidR3 sound, if listed in `pack.json`.
3. TimGM6mb.sf2 via smplr `Soundfont2` (always present; also the out-of-range drum fallback as today).

```ts
type SoundSource =
  | { id: string; kind: 'sf2'; url: string; programs?: number[]; drums?: boolean; preset?: string }
  | { id: string; kind: 'sample-pack'; url: string /* may contain {name} */; programs?: number[] }
  | { id: string; kind: 'note-files'; manifest: string; programs?: number[]; drums?: boolean };
```

The three kinds map to the existing players (smplr Soundfont2, `FluidPlayer`, the note-file drum player). Relative URLs resolve against the page; `assetBaseUrl` only applies to built-in assets.

## State and multiple instances

- One Verovio worker and one import worker pool are module-level singletons shared by all instances (already the case for Verovio; requests are keyed per instance).
- One shared `AudioContext`; starting playback in one instance stops any other playing instance.
- `persist` namespaces localStorage keys and the IndexedDB database name (`<ns>-…`). The demo app passes `persist="scoreflow"` so existing users keep their saved state. `persist={false}` reads and writes nothing.

## Build and publish

- `packages/pepperscore` builds with Vite library mode: `dist/index.js` (ESM), `dist/index.d.ts`, `dist/style.css`; workers are emitted as separate chunks referenced through `new URL(…, import.meta.url)`, which host bundlers copy as assets. Vite and Astro hosts are tested (`npm run test:pack`); webpack 5 and Next are untested. Verovio (LGPL-3.0-or-later) is not bundled: upstream's `verovio-module.mjs` (WASM inlined) and `verovio.mjs` are copied unmodified, under a licence comment, to `dist/verovio/` with a `LICENSE`, referenced from `dist/index.js` the same `new URL(…, import.meta.url)` way, and imported by the worker at runtime. `verovioBaseUrl` points the (shared) worker at another interface-compatible build. `dist/THIRD_PARTY_NOTICES.txt` covers the runtime dependencies, Verovio and the OFL fonts.
- `react`/`react-dom` are peer dependencies (>=19); other deps are regular dependencies.
- Publishing is manual (`npm publish -w …`); nothing in CI publishes.

## Testing

- Existing validation suites keep passing against `apps/reader` (same behaviour, `persist="scoreflow"`).
- New `validation/embed.mjs` (Chromium in CI, plus Firefox/WebKit in the reader matrix) loads an `apps/reader` page `/embed-test` that mounts, inside a host-styled page: one full reader in a 600px box and three minimal snippets. It asserts:
  - no styles leak (a host element's computed font/margins unchanged);
  - drawer/toasts stay inside the root box;
  - keyboard shortcuts only affect the focused instance;
  - playing a second snippet stops the first;
  - `chrome="none"` loads no audio assets;
  - assets load from a custom `assetBaseUrl`;
  - a `soundSources` entry is fetched for its program.
- `scripts/pack-smoke.mjs`: `npm pack` the library, install the tarball into a temporary Vite + React app, build it, and check the build output contains the worker chunks.

## Out of scope for v1

Fully controlled settings, a layer/overlay plugin API, SSR rendering of SVG, web-component wrapper, automated npm publishing.
