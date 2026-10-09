# pepperscore

An embeddable, browser-only music score reader for React. It opens MusicXML (`.musicxml`, `.xml`), compressed MXL, MIDI, MEI and ABC. [Verovio](https://www.verovio.org/) 6.3 engraves the score in a Web Worker, with its WASM bundled, so the page never blocks on layout. Playback follows one performance timeline that handles ties, dynamics, repeats, tempo changes and percussion, with a playhead, note highlighting and follow-scrolling. You can use it as a full reader page with a header, drawer and mixer, or as small inline snippets, several to a page.

## Install

```bash
npm install pepperscore
# pnpm add pepperscore
```

`react` and `react-dom` 19 or later are peer dependencies. Everything else, including Verovio, comes with the package. Import the stylesheet once, next to the component:

```tsx
import { PepperScore } from 'pepperscore';
import 'pepperscore/style.css';
```

## Full reader

```tsx
import { PepperScore } from 'pepperscore';
import 'pepperscore/style.css';

export default function ScorePage({ xml }: { xml: string }) {
  return <PepperScore musicXml={xml} height="100dvh" />;
}
```

`chrome="full"` is the default. It gives you the sticky transport (stop, play, BPM, Vertical/Endless view, open file, mixer), per-part instrument icons and stave eyes, page arrows and zoom, and the bottom drawer with notation settings. With no source prop it shows a built-in sample and the open-file UI. Without a `height`, the full reader fills its parent's height with a 480px floor, so give the parent a definite height (or pass `height`).

## Inline snippets

```tsx
<PepperScore chrome="minimal" abc={'X:1\nT:Scale\nK:G\nGABc|defg|'} />
<PepperScore chrome="minimal" musicXml={tuneXml} settings={{ noteNames: true }} />
<PepperScore chrome="none" abc={'X:1\nK:D\nd2fa|'} />
```

- `chrome="minimal"` shows the notation, the score credits and a round play/stop button in the corner. The playhead, note highlighting and follow still work. Without `height`, a snippet takes the height of its engraved score (natural height).
- `chrome="none"` engraves only. It loads no audio assets and shows no controls.
- Put as many as you like on one page. They share one Verovio worker, one import worker pool and one `AudioContext`. Starting playback in one stops any other that is playing. Unmounting one leaves the others working.
- `minimal` and `none` with no source render an empty frame.

## Astro (for example becreative: Astro 7 + React 19 + Tailwind/shadcn)

Add `@astrojs/react` (already present in a React-island site) and use the component as an island:

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

- `client:visible` and `client:load` render the component on the server too, which is safe: it outputs an empty `.pepperscore` frame and engraves on the client. `client:only="react"` skips the server render altogether, which suits pages with `output: 'server'` where you would rather not run the component per request:

  ```astro
  <PepperScore client:only="react" chrome="minimal" musicXml={tune} />
  ```

- All styles are scoped under `.pepperscore` (no rules on `html`, `body` or bare `*`, no `position: fixed`, no viewport units). Tailwind's preflight does not change the reader, and the reader does not change the page. Add your own classes to the root with `className`.
- For a full reader page, give the island a sized parent (as above) or pass `height="100dvh"`.
- `?raw` imports work for MusicXML, MEI and ABC text. For binary MXL or MIDI, serve the file from `public/` and pass `scoreUrl`, or pass a `File` through `file`.

### Dev server note (Astro)

Astro's dev server does not pre-bundle pepperscore's lazily loaded CommonJS dependencies (abcjs for ABC, @tonejs/midi for MIDI, soundfont2 for the GM soundfont). Without the lines below, `astro dev` fails with "require is not defined" on ABC snippets and "exports is not defined" on MIDI files, and parts without a sample-pack sound do not play. Add to `astro.config.mjs`:

```js
// astro.config.mjs
export default defineConfig({
  integrations: [react()],
  vite: {
    optimizeDeps: { include: ['pepperscore > abcjs', 'pepperscore > @tonejs/midi', 'pepperscore > soundfont2'] },
  },
});
```

- Production builds (`astro build`) need nothing.
- A plain Vite + React app needs nothing either, because Vite's dependency scan finds these from the app's entry. The same `include` is harmless there.
- Do **not** add `optimizeDeps.exclude: ['pepperscore']`. It is not needed (the worker URLs survive pre-bundling with Vite 8), and with pnpm it breaks `react/jsx-runtime`.
- Your layout should declare `<meta charset="utf-8">` (Astro's starter layouts do). Without it, the server-rendered frame of a `client:load`/`client:visible` island is decoded as Latin-1 and React reports a hydration mismatch.

## Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `musicXml` | `string` | | MusicXML text (partwise or timewise). Changing it loads the new score. |
| `file` | `File` | | MusicXML, MXL, MIDI, MEI or ABC. |
| `scoreUrl` | `string` | | A score to download. Relative URLs resolve against the page. Cross-origin URLs need CORS. |
| `abc` | `string` | | ABC notation. |
| `chrome` | `'full' \| 'minimal' \| 'none'` | `'full'` | See the chrome table below. |
| `controls` | `{ transport?, viewToggle?, openFile?, mixer?, drawer?, zoom? }` (booleans) | from `chrome` | Per-control overrides of the preset, see below. |
| `view` | `'vertical' \| 'endless'` | saved or `'vertical'` | Vertical scrolls down, Endless scrolls sideways. Changing the prop re-applies it. |
| `height` | `string` | natural | `"fill"`: the parent's height. Any CSS length (`"420px"`, `"60vh"`, `"100dvh"`) fixes it. Omitted: `full` fills its parent with a 480px floor, and `minimal`/`none` take the height of their score. |
| `className` | `string` | | Extra classes on the `.pepperscore` root. |
| `settings` | `PepperScoreSettings` | | **Initial** reader settings: `noteNames`, `chordSymbols`, `inferChords`, `beatCounts`, `subdivisions` (booleans); `musicFont` (`'Bravura' \| 'Petaluma'`); `staveFont` (`'Sans' \| 'Serif' \| 'Mono'`); `barsPerLine` (`'auto' \| 1–4`); `zoom` (stave scale, `null` = device default); `semitones` (−12…12); `concert` (concert vs written pitch); `overlap` (0–3 lines kept on a page turn). Changing a key in the prop re-applies that key. Drawer edits still work in between. With `persist` on, **a saved per-score record overrides `settings` and `view`** when that score is opened again. The record holds the settings, view, zoom, transposition, part sounds and hidden staves the reader stored for that exact file. |
| `persist` | `string \| false` | `'pepperscore'` for `full`, `false` for `minimal`/`none` | Storage namespace, see below. `false` reads and writes nothing. |
| `assetBaseUrl` | `string` | jsDelivr copy of `pepperscore-sounds-<soundPack>` | Root of a sounds-package layout. Relative values resolve against the page, and a missing trailing slash is added. |
| `soundPack` | `'core' \| 'complete'` | `'core'` | Picks the default `assetBaseUrl`. With your own `assetBaseUrl`, the `pack.json` found there decides which FluidR3 sounds exist. |
| `soundSources` | `SoundSource[]` | `[]` | Your own sounds for specific programs or the drum kit, see below. |
| `onReady` | `(info: { title, composer?, parts: { id, name }[], measures }) => void` | | Once per loaded score, after it is drawn. |
| `onPlay` / `onStop` | `() => void` | | Playback starts or stops, including when another instance takes over playback. |
| `onError` | `(error: Error) => void` | | Each error the reader shows: an unreadable file, a failed download or a renderer failure. |
| `autoFocus` | `boolean` | `false` | Focus the reader on mount so the page-turn keys work before any click. Keyboard shortcuts belong to the focused reader only. |
| `ref` | `Ref<PepperScoreHandle>` | | `{ play(): Promise<void>; stop(): void; transpose(semitones: number): void }`. `play` does nothing while playing, before a score has loaded, or with `chrome="none"`. `transpose` sets the **absolute** transposition (clamped to −12…12), the same as `settings.semitones`. It does not add to the current value. |

When more than one source prop is set, the first present wins, in this order: `musicXml`, `file`, `scoreUrl`, `abc`.

The component never reads `window.location`. To open `?score=…` links, read the query string yourself and pass it as `scoreUrl`.

`Reader` and `ReaderProps` are still exported as deprecated aliases of `PepperScore` and `PepperScoreProps` for one release. The package also exports the types `PepperScoreProps`, `PepperScoreHandle`, `PepperScoreReadyInfo`, `PepperScoreSettings`, `PepperScoreControls`, `ChromePreset`, `SoundSource` and `SoundPackName`, plus `SOUNDS_VERSION` and `defaultAssetBaseUrl(pack)`.

### Chrome presets and `controls`

| Control | `full` | `minimal` | `none` |
| --- | --- | --- | --- |
| Header transport (stop, play, BPM, view toggle, open, mixer) | yes | no | no |
| Compact play/stop button (corner overlay) | no | yes | no |
| Playhead, note highlight, follow | yes | yes | no |
| Bottom drawer and handle | yes | no | no |
| Part icons, instrument picker, stave eyes | yes | no | no |
| Page arrows and zoom | yes | no | no |
| Score credits | yes | yes | yes |
| Audio | yes | yes | no (no audio assets load) |

`controls` turns single controls on or off on top of the preset. A control you leave out follows the preset (on for `full`, off otherwise):

| Key | Covers |
| --- | --- |
| `transport` | Stop, play, BPM, transpose, key flip and bars per line in the header. On `minimal` it replaces the compact play button. On `none` it also turns audio and the playhead on. |
| `viewToggle` | The Vertical/Endless toggle. |
| `openFile` | The Open button, file input, open dialog and the offer to reopen the last file. |
| `mixer` | The track mixer, plus the part icons, instrument picker and stave eyes. |
| `zoom` | The stave-scale slider, pinch zoom and the page arrows row. |
| `drawer` | The bottom drawer and its handle. |

The header appears when any of `transport`, `viewToggle`, `openFile`, `mixer` or `zoom` is on. For example, `<PepperScore chrome="minimal" controls={{ viewToggle: true }} … />` keeps the compact play button and adds a small header with only the view toggle.

### `persist`

Saved state lives under a namespace `<ns>`:

- localStorage: `<ns>-prefs` (global reader settings), `<ns>-file-v2:<hash>` and `<ns>-pending-v2:<hash>` (per-score records), and the legacy `<ns>-file-v1:<hash>`, which is read only.
- IndexedDB: `<ns>` (per-score records) and `<ns>-last-file` (the last opened file, kept on this device so it can be reopened).
- sessionStorage: `<ns>-reopen-dismissed`.

Readers that share a namespace share their state. The default is `"pepperscore"` for `chrome="full"` and `false` for `minimal` and `none`, so snippets never write storage unless you give them a namespace. With persistence on, host `settings` are written into `<ns>-prefs` like any other change, and they are re-applied on every mount.

**Diagnostic hooks exempt from `persist`.** The reader reads three localStorage keys whatever `persist` is, even with `persist={false}`. They are for tests and troubleshooting. Nothing sets them except a person or a test, and the reader only removes `scoreflow-simulate-oom` after it fires.

| Key | Effect |
| --- | --- |
| `scoreflow-chunking` | JSON `{ "force": true, "budget": 16, "recycleHeapBytes": … }`: force chunked engraving of MusicXML, or tune its measure budget and worker heap recycling. |
| `scoreflow-simulate-oom` | A positive integer N: the next N renders fail as out-of-memory (tests the restart path). |
| `scoreflow-large-file-bytes` | A byte count that replaces the large-file warning threshold. |

## Assets and self-hosting

Music fonts (Bravura, Petaluma, Petaluma Script), instrument icons and sounds are not in this package. They load at runtime from `assetBaseUrl`, which points at the root of a `pepperscore-sounds-*` package:

```
fonts/  instruments/  soundfonts/  pack.json
```

- **Default:** `https://cdn.jsdelivr.net/npm/pepperscore-sounds-core@<SOUNDS_VERSION>/` (`soundPack="core"`), or `pepperscore-sounds-complete` with `soundPack="complete"`. `SOUNDS_VERSION` is fixed at build time, so a given pepperscore version always loads the assets it was built against.
- **Core** (~15 MB): fonts, icons, Perfect Drums, TimGM6mb.sf2 and 19 common FluidR3 sounds (piano, electric piano, guitars, basses, strings, violin, cello, flute, clarinet, saxes, trumpet, trombone, choir and voice).
- **Complete** (~54 MB): the same plus all 128 FluidR3 GM sounds.

Only the files a score needs are downloaded: the music font in use and the sounds of its parts. `chrome="none"` downloads only the music font.

To self-host (no CDN requests, or an offline site), install a sounds package and copy it into `public/`:

```bash
npm install -D pepperscore-sounds-core      # or pepperscore-sounds-complete
cp -rL node_modules/pepperscore-sounds-core public/pepperscore-sounds   # -L: pnpm installs packages as symlinks
```

```tsx
<PepperScore musicXml={xml} assetBaseUrl="/pepperscore-sounds/" />
// all 128 FluidR3 sounds: copy pepperscore-sounds-complete instead (assetBaseUrl decides; soundPack only picks the CDN default)
```

Use the sounds package version that matches `SOUNDS_VERSION` (exported by this package). A base on another origin must send CORS headers (`Access-Control-Allow-Origin`), because fonts and sounds are fetched.

### Sound resolution and `soundSources`

For each part's sound (a GM program, or the drum kit):

1. the first `soundSources` entry that claims it (`programs` includes the program, or `drums: true` for a kit);
2. the pack's FluidR3 sound, if `pack.json` at `assetBaseUrl` lists it;
3. TimGM6mb.sf2, which is always present and also plays drum notes a note-file kit lacks.

Drums use the Perfect Drums note files unless a source claims them. `soundSources` URLs resolve against the page, not against `assetBaseUrl`. One example of each kind:

```tsx
<PepperScore
  musicXml={xml}
  soundSources={[
    // A SoundFont 2 file: bank 0 preset (program - 1), bank 128 preset 0 for drums, or a preset by name.
    { id: 'grand', kind: 'sf2', url: '/sounds/grand-piano.sf2', programs: [1, 2], preset: 'Grand Piano' },
    // A FluidR3-style sample pack: JSON { name, samples: { "<midi note>": "<base64 mp3>" } }. {name} becomes the GM sound name, e.g. "trumpet".
    { id: 'brass', kind: 'sample-pack', url: 'https://cdn.example.com/packs/{name}.json', programs: [57, 58, 61] },
    // Note files: a manifest { name, notes: { "<midi note>": "file.mp3" } } with the files beside it.
    { id: 'kit', kind: 'note-files', manifest: '/sounds/kit/manifest.json', drums: true },
  ]}
/>
```

## Known v1 limits

- **`deviceClass()` uses a viewport media query.** Layout sizes come from the reader's root element, but the choice between "desktop" (a fine pointer and a viewport wider than 850px) and "compact" defaults still queries the viewport. That choice sets the default stave scale and the large-file notice wording. So a narrow reader on a wide desktop page gets desktop defaults.
- **A many-stave score in a short fixed height engraves small.** The reader fits the whole staff stack of each system into the viewport. A five-stave score in `height="200px"` is tiny and uses only part of the width. Give such snippets more height, or pass `settings={{ zoom: … }}`.
- **No server-side engraving.** The server render is an empty frame. The SVG is drawn on the client.
- Settings are initial values, not fully controlled props.
- Many large scores on one page engrave one after another, because they share a single Verovio worker. It is slow, not broken.

## Licenses

- **pepperscore** is MIT licensed (see `LICENSE`).
- **Verovio** 6.3.0 is bundled unmodified in `dist/assets/verovio.worker-*.js` under **LGPL-3.0-or-later**.
- **Sound packs** (`pepperscore-sounds-core`, `pepperscore-sounds-complete`): each asset set keeps its own license, listed in the package's `LICENSES.md`:
  - TimGM6mb.sf2: GPL-2.0
  - FluidR3 GM sample packs: CC BY 3.0 (attribution in `soundfonts/fluidr3/ATTRIBUTION.txt`)
  - Bravura, Petaluma and Petaluma Script fonts: SIL Open Font License 1.1
  - Perfect Drums samples: attribution in `soundfonts/perfect-drums/ATTRIBUTION.txt` (the source artifact states WTFPL)
  - Instrument icons: MIT
