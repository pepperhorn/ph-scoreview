# pepperscore

An embeddable, browser-only music score reader for React. It opens MusicXML (`.musicxml`, `.xml`), compressed MXL, MIDI, MEI and ABC. [Verovio](https://www.verovio.org/) 6.3 engraves the score in a Web Worker, so the page never blocks on layout. Verovio ships with the package as its own, replaceable file (see [Verovio](#verovio)). Playback follows one performance timeline that handles ties, dynamics, repeats, tempo changes and percussion, with a playhead, note highlighting and follow-scrolling. You can use it as a full reader page with a header, drawer and mixer, or as small inline snippets, several to a page.

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

- All styles are scoped under `.pepperscore` (no rules on `html`, `body` or bare `*`, no `position: fixed`, no viewport units). Tailwind's preflight does not change the reader, and the reader does not change the page.
- For a full reader page, give the island a sized parent (as above) or pass `height="100dvh"`.
- `?raw` imports work for MusicXML, MEI and ABC text. For binary MXL or MIDI, serve the file from `public/` and pass `scoreUrl`, or pass a `File` through `file` from a React component (see below).
- `output: 'server'` with `@astrojs/node` works with `client:visible` and `client:load`: importing pepperscore on the server touches no `window`, `document` or storage, and the server renders only the empty frame. The pack smoke test (`npm run test:pack`) builds and serves exactly that setup.

### Callbacks, `ref` and `File` need a React wrapper

Astro islands only pass serializable props across the island boundary. Functions (`onReady`, `onPlay`, `onStop`, `onError`), `ref` and `File` objects cannot be passed from an `.astro` file. Put them in a small React component and use that as the island:

```tsx
// src/components/ScoreSnippet.tsx
import { useRef, useState } from 'react';
import { PepperScore, type PepperScoreHandle, type PepperScoreProps } from 'pepperscore';
import 'pepperscore/style.css';

type Props = Pick<PepperScoreProps, 'musicXml' | 'abc' | 'scoreUrl' | 'height' | 'ariaLabel'>;

export default function ScoreSnippet(props: Props) {
  const score = useRef<PepperScoreHandle>(null);
  const [bars, setBars] = useState<number>();
  return (
    <figure className="score-snippet not-prose my-6">
      <div className="score-snippet-frame overflow-hidden rounded-xl border shadow-sm">
        <PepperScore
          ref={score}
          chrome="minimal"
          assetBaseUrl="/pepperscore-sounds/"
          onReady={info => setBars(info.measures)}
          onError={error => console.warn('Score failed to load:', error.message)}
          {...props}
        />
      </div>
      <figcaption className="score-snippet-actions mt-2 flex items-center gap-2 text-sm">
        <button type="button" className="score-snippet-play rounded-md border px-3 py-1" onClick={() => void score.current?.play()}>Play</button>
        <button type="button" className="score-snippet-transpose rounded-md border px-3 py-1" onClick={() => score.current?.transpose(2)}>Up a tone</button>
        {bars && <span className="score-snippet-bars text-muted-foreground">{bars} bars</span>}
      </figcaption>
    </figure>
  );
}
```

```astro
---
import ScoreSnippet from '../components/ScoreSnippet';
import tune from '../scores/tune.musicxml?raw';
---
<ScoreSnippet client:visible musicXml={tune} ariaLabel="Example 1: G major scale" />
```

A `File` from an `<input type="file">` works the same way: keep it in the wrapper's state and pass it as `file`.

### Tailwind v4

pepperscore's stylesheet is unlayered, while Tailwind v4 puts utilities in `@layer utilities`. Unlayered rules beat layered ones, so a utility passed through `className` loses when it sets a property the root already sets: `h-*`, `min-h-*`, `bg-*`, `flex`/`block`, `relative`, `overflow-*`. Utilities the root does not set (`rounded-*`, `border`, `shadow-*`, `ring-*`, `m-*`) do apply, but the reliable pattern is:

- put sizing, spacing and decoration on a **wrapper element**;
- set the height with the **`height` prop** (`height="420px"`, `height="calc(100dvh - 4rem)"`, or `height="fill"` inside a sized wrapper).

Inside Tailwind Typography's `prose`, add `not-prose` to the wrapper.

### becreative-style examples

A full reader page (`output: 'server'`, a shared layout, Tailwind v4):

```astro
---
// src/pages/scores/[slug].astro
import Layout from '../../layouts/Layout.astro';
import { PepperScore } from 'pepperscore';
import 'pepperscore/style.css';
const { slug } = Astro.params;
---
<Layout title="Score">
  <main class="score-page mx-auto max-w-6xl px-4 py-6">
    <div class="score-page-frame overflow-hidden rounded-xl border">
      <PepperScore client:load height="calc(100dvh - 8rem)" scoreUrl={`/scores/${slug}.musicxml`} assetBaseUrl="/pepperscore-sounds/" />
    </div>
  </main>
</Layout>
```

An inline snippet in a lesson:

```astro
---
// src/pages/lessons/scales.astro
import Layout from '../../layouts/Layout.astro';
import { PepperScore } from 'pepperscore';
import 'pepperscore/style.css';
import scale from '../../scores/g-major-scale.musicxml?raw';
---
<Layout title="Scales">
  <article class="lesson prose mx-auto max-w-3xl px-4 py-6">
    <p>Play the G major scale, then try it up a tone.</p>
    <div class="lesson-snippet not-prose my-6 overflow-hidden rounded-xl border shadow-sm">
      <PepperScore client:visible chrome="minimal" musicXml={scale} assetBaseUrl="/pepperscore-sounds/" ariaLabel="G major scale" />
    </div>
  </article>
</Layout>
```

Use the `ScoreSnippet` wrapper above when the page needs callbacks or `ref`.

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
- Do **not** add `optimizeDeps.exclude: ['pepperscore']`. It is not needed (the worker and Verovio URLs survive pre-bundling with Vite 8), and with pnpm it breaks `react/jsx-runtime`.
- Your layout should declare `<meta charset="utf-8">` (Astro's starter layouts do). Without it, the server-rendered frame of a `client:load`/`client:visible` island is decoded as Latin-1 and React reports a hydration mismatch.

## Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `musicXml` | `string` | | MusicXML text (partwise or timewise). Changing it loads the new score. |
| `file` | `File` | | MusicXML, MXL, MIDI, MEI or ABC. |
| `scoreUrl` | `string` | | A score to download. Relative URLs resolve against the page. Cross-origin URLs need CORS. |
| `abc` | `string` | | ABC notation. |
| `chrome` | `'full' \| 'minimal' \| 'none'` | `'full'` | See the chrome table below. |
| `controls` | `{ transport?, viewToggle?, openFile?, mixer?, drawer?, zoom?, tabToggle?, instrumentSwitch?, octaveTool? }` (booleans) | from `chrome` | Per-control overrides of the preset, see below. |
| `view` | `'vertical' \| 'endless'` | saved or `'vertical'` | Vertical scrolls down, Endless scrolls sideways. Changing the prop re-applies it. |
| `height` | `string` | natural | `"fill"`: the parent's height. Any CSS length (`"420px"`, `"60vh"`, `"100dvh"`) fixes it. Omitted: `full` fills its parent with a 480px floor, and `minimal`/`none` take the height of their score. |
| `className` | `string` | | Extra classes on the `.pepperscore` root. |
| `ariaLabel` | `string` | `"Score: <title>"`, or `"Score reader"` | Accessible name of the reader's landmark region. By default it is `Score: ` and the loaded score's title, or `Score reader` while there is no titled score. Give each snippet on a page a distinct name when titles repeat. |
| `settings` | `PepperScoreSettings` | | **Initial** reader settings: `noteNames`, `chordSymbols`, `inferChords`, `beatCounts`, `subdivisions` (booleans); `musicFont` (`'Bravura' \| 'Petaluma'`); `staveFont` (`'Sans' \| 'Serif' \| 'Mono'`); `barsPerLine` (`'auto' \| 1–8`, Vertical view; without a `zoom`, an explicit count also sets the on-load size: that many bars fill the width, see below); `zoom` (stave scale, `null` = device default; with a `zoom`, `barsPerLine` only sets the line breaks); `semitones` (−12…12); `concert` (concert vs written pitch); `keyFlip` (spell a transposed view in the enharmonic key, for example Gb major for F# major); `bpm` (initial tempo, 30–240; the score's own tempo otherwise); `overlap` (0–3 lines kept on a page turn); `tabView`, `tabTuning`, `capo` (guitar TAB, see [Guitar TAB](#guitar-tab)); `annotationSizes` (text size per add-on, see below); `instrument`, `instruments`, `rangeLevel`, `autoRange` (the instrument switch, see below). Changing a key in the prop re-applies that key. Drawer edits still work in between. With `persist` on, **a saved per-score record overrides `settings` and `view`** when that score is opened again. The record holds the settings, view, zoom, transposition, part sounds, hidden staves and instrument switches the reader stored for that exact file. The instrument settings are the exception: when they differ from the ones the record was saved under, they apply again (see [Instrument switch](#instrument-switch)). |
| `persist` | `string \| false` | `'pepperscore'` for `full`, `false` for `minimal`/`none` | Storage namespace, see below. `false` reads and writes nothing. |
| `assetBaseUrl` | `string` | jsDelivr copy of `pepperscore-sounds-<soundPack>` | Root of a sounds-package layout. Relative values resolve against the page, and a missing trailing slash is added. |
| `verovioBaseUrl` | `string` | the copy in `dist/verovio/` | A directory with an interface-compatible Verovio build to engrave with, laid out like the `verovio` npm package's `dist/` (`verovio-module.mjs`, `verovio.mjs`), e.g. `https://cdn.jsdelivr.net/npm/verovio@6.3.0/dist/`. Shared by every reader on the page: set it before the first score engraves (a reader applies it before it warms Verovio up on mount; with `preloadVerovio`, pass it the same value). See [Verovio](#verovio). |
| `soundPack` | `'core' \| 'complete'` | `'core'` | Picks the default `assetBaseUrl`. With your own `assetBaseUrl`, the `pack.json` found there decides which FluidR3 sounds exist. |
| `soundSources` | `SoundSource[]` | `[]` | Your own sounds for specific programs or the drum kit, see below. |
| `onReady` | `(info: { title, composer?, parts: { id, name, sourcePart, switchable }[], measures }) => void` | | Once per loaded score, after it is drawn. `parts` lists every staff (a grand staff's staves share one `sourcePart` number); `switchable` says whether the instrument switch applies. |
| `onPlay` / `onStop` | `() => void` | | Playback starts or stops, including when another instance takes over playback. |
| `onError` | `(error: Error) => void` | | Each error the reader shows: an unreadable file, a failed download or a renderer failure. |
| `clock` | `ExternalClock` | | A host clock that drives the playhead, see "Driving the playhead from your own clock". |
| `audio` | `boolean` | `true` | `false` never loads or schedules sound. Self-driven playback then runs silently on wall-clock time. |
| `onSeek` | `(seconds: number) => void` | | With a `clock`: a click on a note or measure (and `ref.seek`) reports its time here. The reader does not move. |
| `onTimeUpdate` | `(seconds: number) => void` | | About 10 times a second during self-driven playback. |
| `onElementClick` | `(info: PepperScoreClickInfo) => void` | | Any click on the engraving, see "Host hooks". |
| `highlights` | `PepperScoreHighlight[]` | | Classes on notes and measures, see "Host hooks". |
| `autoFocus` | `boolean` | `false` | Focus the reader on mount so the page-turn keys work before any click. Keyboard shortcuts belong to the focused reader only. Each reader is one Tab stop, and keyboard focus shows a focus ring on it (clicks do not). |
| `paintTransition` | `'reveal' \| 'none'` | `'reveal'` | How a new `musicXml` or `abc` replaces a score already on screen. `'reveal'` fades it out, shows the loading overlay, scrolls to the top and fades the new score in. `'none'` keeps the current engraving and scroll position until the new one replaces it in place, with no fade or overlay (for a host that edits the score it shows). The first paint, other sources and setting changes always reveal. |
| `ref` | `Ref<PepperScoreHandle>` | | `{ play(): Promise<void>; stop(): void; transpose(semitones: number): void; seek(seconds: number): void; currentTime(): number; scrollToMeasure(index: number): Promise<void>; seekToMeasure(index: number): void }`. `play` does nothing while playing, before a score has loaded, with `chrome="none"`, or with a `clock`. `stop` does nothing with a `clock`. `transpose` sets the **absolute** transposition (clamped to −12…12), the same as `settings.semitones`. It does not add to the current value. `seek` moves the playhead (and keeps playing from there when playing). With a `clock` it calls `onSeek` instead. `currentTime` returns the playhead seconds, or `clock.now()` with a `clock`. |

**The instrument switch.** `settings.instrument` (a `SwitchInstrumentId`: any `InstrumentId` but `'drum-kit'`) shows the first switchable part as that instrument: its clef, written pitch, range and sound. `settings.instruments` sets it per part and wins over `instrument`. A key is either the 1-based source part number as a string (`{ '2': 'trumpet' }`: parts in score order, a grand staff counted once, a drum kit counted too) or an `onReady` part id; a staff id of a grand staff switches the whole part. `onReady`'s `parts[].sourcePart` and `parts[].id` are both valid keys, and parts with `switchable: false` (drum kits, percussion) are ignored. `rangeLevel` (`RangeLevel`: `'beginner' | 'intermediate' | 'advanced'`, default `'intermediate'`) and `autoRange` (default `true`: phrases outside the range move by an octave) set how switched parts fit. They apply to a score without a saved record, and to a saved one when they differ from the host settings it was saved under (see [Instrument switch](#instrument-switch)). In `minimal` and `none` they switch the part without showing a switcher; set `controls.instrumentSwitch` for one.

**Text add-on sizes with `annotationSizes`.** Each text add-on has its own size, in six steps: `'xs' | 'sm' | 'md' | 'rg' | 'lg' | 'xl'` (type `AnnotationSize`). `'rg'` (regular) is the default and draws the size earlier versions drew; the steps scale it by 0.7, 0.8, 0.9, 1, 1.2 and 1.45. Keys: `noteNames`, `chordSymbols` (source chord symbols and inferred ones), `beatCounts` (on-beat counts) and `subdivisions` (the e/&/a counts between beats). Give only the add-ons you want to change, for example `settings={{ noteNames: true, annotationSizes: { noteNames: 'lg' } }}`; unknown sizes are ignored. The rows under the staff grow with their labels, and Verovio sizes and spaces source chord symbols itself; the stave size and bar layout do not change. In the full reader each add-on's size is also a segmented control beside its switch in the options drawer (shown while that add-on is on), saved with the other reader settings and in each score's record.

**Sizing a snippet with `barsPerLine`.** In Vertical view, `settings={{ barsPerLine: N }}` without a `zoom` picks the stave size at which exactly N bars fill the reader's width, so N is the simplest way to set how large an embed draws: on the same width, `barsPerLine: 2` draws larger staves than `barsPerLine: 4`. The size is bounded (at most stave scale 2.5, at least 0.2; a single bar on a very wide reader is stretched to fill rather than drawn huge), and lines always hold N bars. A score shorter than one line takes its share of the width, centred. `'auto'` keeps the device default (four bars across on desktop). Endless view ignores `barsPerLine`.

When more than one source prop is set, the first present wins, in this order: `musicXml`, `file`, `scoreUrl`, `abc`.

The component never reads `window.location`. To open `?score=…` links, read the query string yourself and pass it as `scoreUrl`.

`Reader` and `ReaderProps` are still exported as deprecated aliases of `PepperScore` and `PepperScoreProps` for one release. The package also exports the types `PepperScoreProps`, `PepperScoreHandle`, `PepperScoreReadyInfo`, `PepperScoreSettings`, `PepperScoreControls`, `ChromePreset`, `SoundSource`, `SoundPackName`, `ExternalClock`, `ClockEvent`, `PepperScoreClickInfo` and `PepperScoreHighlight`, plus `SOUNDS_VERSION` and `defaultAssetBaseUrl(pack)`.

### Driving the playhead from your own clock

Pass `clock` when something else owns time, such as your own audio engine, a video, or a practice app's transport. The reader then only shows where that clock is:

```tsx
import { PepperScore, type ExternalClock } from 'pepperscore';

// Adapt your transport once (keep the object stable: a new object re-subscribes).
const clock: ExternalClock = {
  now: () => transport.seconds,            // seconds from score beat 0; negative during a count-in
  get playing() { return transport.playing; },
  subscribe: listener => transport.on('change', event => listener({ type: event.type, time: transport.seconds })),
};

<PepperScore chrome="none" audio={false} musicXml={xml} clock={clock} onSeek={seconds => transport.seek(seconds)} />
```

- **Time mapping.** Seconds count from score beat 0 (the first beat of a pickup bar, if there is one). They follow the score's own tempo map, so every `<sound tempo>` / metronome change is included. The BPM setting is ignored. Repeats and jumps play in performed order. A fermata adds half its note's length.
- **Events.** `subscribe` should call the listener on `play`, `pause`, `seek` and `rate`. While `playing` is true, the reader reads `now()` every animation frame. Otherwise it reads it once per event.
- **No sound, no transport.** With a clock the reader never loads sound, whatever `audio` says. It also hides its own play, stop and BPM controls. The playhead, note highlight and Vertical/Endless follow work for every `chrome`, including `"none"`.
- **Seeking.** A click on a note reports that note's time (its performed occurrence nearest the clock), and a click elsewhere in a measure reports the measure's start. Both go through `onSeek`, and so does `ref.seek(seconds)`. Seek your clock there. The reader follows on the next `seek` event.
- `onPlay`/`onStop` are not called for clock play/pause.
- **Count-in.** A negative clock time shows no playhead and no highlighted note.
- Transposing while a `clock` is set does not move the playhead; it stays at `clock.now()`.
- `validation/fixtures/clock-contract.musicxml` with `clock-contract.expected.json` (in the repository) pins the onset seconds within 1 ms (a pickup bar, and tempo 120 → 60 → 180 mid-bar). Use them to check your own tempo map against the reader's.

### Host hooks

For hosts that build on the reader (selection, cursors, navigation):

- **`onElementClick(info)`** fires for any click on the engraving, with every `chrome` and with or without a `clock`. `info` is `{ noteId?, sourceId?, measureIndex?, fraction?, staff?, nearestNoteId?, nearestSourceId?, clientX, clientY }`: the note hit (and its MusicXML `id`, when known), the zero-based measure, the 0–1 position across that measure, and the 1-based nearest staff. A click anywhere in a note's drawn box (its notehead, stem, flag, accidental or dots, or the gaps between them) hits that note (overlapping boxes go to the nearest notehead; noteheads stacked at one x, as in two voices, to the nearer in y). When no note was hit, `nearestNoteId` and `nearestSourceId` name the note or rest on that staff in that measure whose notehead is nearest the click horizontally (stacked noteheads again split by y). Engraved spacing is not proportional to time, so this is a better guide than `fraction` to the event a click in staff space means. With a handler set, notes and measures show a pointer cursor.
- **`highlights`**: `{ ids?, measures?, className }[]`. Each entry adds `className` to those notes (note or MusicXML ids) and measures (zero-based), re-applied after every draw. Built-in classes: `ps-cursor`, `ps-selection` and `ps-transposed` (notes) and `ps-cursor-measure` (measures), coloured by `--ps-cursor`, `--ps-selection` (ink blue `#2f6a9a`) and `--ps-transposed` (orange `#d9741c`). Every highlighted measure, whatever its class, also gets a dashed box: a `<rect class="ps-measure-highlight" data-ps-class="...">` in a `<g class="ps-highlight-layer">` overlay beside the measures (so the measure's own bounds are unchanged), a few pixels outside the measure, with a 2px screen-space stroke (`vector-effect: non-scaling-stroke`) in `--ps-cursor`. Restyle it per class with `.ps-measure-highlight[data-ps-class~="my-class"] { stroke: ... }`. The box is removed when the highlight is cleared and redrawn with the measure.
- **`ref.scrollToMeasure(index)`** draws the measure's system if needed and scrolls it into view. **`ref.seekToMeasure(index)`** seeks to the measure's start, like `ref.seek` (with a `clock`, through `onSeek`).

### Chrome presets and `controls`

| Control | `full` | `minimal` | `none` |
| --- | --- | --- | --- |
| Header transport (stop, play, BPM, view toggle, open, mixer) | yes | no | no |
| Compact play/stop button (corner overlay) | no | yes | no |
| Playhead, note highlight, follow | yes | yes | no (yes with a `clock`) |
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
| `instrumentSwitch` | The instrument switcher: the Instrument choice in the mixer and the embed popover, the range-level and auto-range controls, and the phone bottom toolbar of embeds. On in `full`; off in `minimal` and `none` unless you set it. `settings.instrument` / `settings.instruments` alone still switch the part, but show no switcher. |
| `octaveTool` | The octave tool (select a note, passage or phrase and move it 8va/8vb). On in `full`; off in `minimal` and `none` unless you set it. |
| `tabToggle` | The Notation / TAB / Both switch, in the header (in the More panel on a phone) and in the drawer. With the drawer on, the header copy is left out between 761 and 1260px, where the full header has no room for it. It shows only for a score with a pitched part. |

The header appears when any of `transport`, `viewToggle`, `openFile`, `mixer`, `zoom` or `tabToggle` is on. For example, `<PepperScore chrome="minimal" controls={{ viewToggle: true }} … />` keeps the compact play button and adds a small header with only the view toggle.

### Guitar TAB

`settings.tabView` sets which staves guitar parts show: `'notation'` (default), `'tab'` or `'both'`. Readers switch with `controls.tabToggle` (on in `full`).

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `tabView` | `'notation' \| 'tab' \| 'both'` | `'notation'` | Notation only, TAB only (the notation staff is hidden and its chord symbols, tempo and directions move onto the TAB staff), or both. |
| `tabTuning` | `number[]` | `[40, 45, 50, 55, 59, 64]` | Open-string MIDI pitches, low to high, of generated TAB (EADGBE). |
| `capo` | `0`–`12` | `0` | Capo fret of generated TAB. Frets are relative to it. |

- **A score with a TAB staff** (MusicXML `<clef><sign>TAB</sign>` with `<staff-details>`, as MuseScore and Guitar Pro export) shows that staff in the TAB and Both views. The reader treats it as a view of its notation part: it is played once, has no note-name or count lanes, and the part controls and mixer list the instrument once.
- **Any other score** gets TAB generated from its sounding pitches (including ABC octave clefs and MusicXML octave transposition): for every guitar part (General MIDI programs 25–32, the guitar sound, or "guitar" in the part name), or else for the first pitched part's top staff. A fingering solver picks strings and frets for the whole passage (open strings, few position shifts, playable stretches). Notes out of range are moved by an octave. Chord notes that cannot all be fretted lose doubled notes first, then inner voices. MusicXML `<technical><string>`/`<fret>` on a note is kept as a fixed fingering.
- **Transposed views** regenerate TAB from the transposed pitches. An imported TAB staff is hidden then, because its frets no longer match.
- Tied continuations keep their rhythm on the TAB staff but show no fret.
- **Baked fingerings.** The repository's `npm run tab:bake` (`scripts/tab-bake.mjs`, see the root README) writes the solver's string/fret onto a score's notes ahead of time, and can add a TAB staff. The reader keeps those fingerings as they are.

### Instrument switch

Full behaviour: `docs/specs/instrument-switch.md`. Choose an instrument for a part and the reader changes its sound, clef and written transposition (B♭ and E♭ instruments read at written pitch, also in a concert-pitch score), then fits each phrase into the instrument's range for the chosen level.

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `instrument` | `SwitchInstrumentId` | | Shows the first switchable part as this instrument. |
| `instruments` | `Record<string, SwitchInstrumentId>` | | Per part: key is the 1-based source part number or an `onReady` part id. Wins over `instrument`. |
| `rangeLevel` | `RangeLevel` (`'beginner' \| 'intermediate' \| 'advanced'`) | `'intermediate'` | How wide a range the instrument is taken to have. |
| `autoRange` | `boolean` | `true` | Phrases outside the range move by an octave. `false` leaves them and marks them. |

- Notes moved by fitting get `ps-transposed` (`--ps-transposed`), notes still out of range get `ps-out-of-range` (`--ps-out-of-range`), and the octave tool's selection gets `ps-octave-selection`.
- A grand staff switches as one part. A piano part switched to guitar gets generated TAB, and a TAB staff that doubled the switched part is hidden or regenerated.
- The mixer lists Instrument (what the part is) and Sound (a playback override that keeps the notation).
- Embeds show a popover switcher with a short instrument list (`EMBED_INSTRUMENTS`), and on a phone a bottom toolbar.
- The octave tool (`controls.octaveTool`) selects a note and its tie chain, a passage (Shift-click) or a phrase, then moves it 8va or 8vb relative to its shown pitch. Reset clears the part's moves.
- The switcher shows in `full`, and in `minimal` or `none` only with `controls.instrumentSwitch: true`. Without it, `settings.instrument` / `settings.instruments` still switch the part.
- With `persist` on, saved records now hold instrument switches: each part's instrument, level, auto-range, octave moves and sound override, plus a fingerprint of the host's instrument settings (`instrument`, `instruments`, `rangeLevel`, `autoRange`). Records without a switch open as written.
- **Host settings vs saved choices.** Records are keyed by the score file, so one score embedded as piano in one lesson and as trumpet in another shares a record. When a score opens with a saved record, the reader compares the host's instrument settings with the ones saved in it. If they are the same, or the host gives none, the reader's saved choices win. If they differ (a teacher changed a block's instrument), the host's instrument, level and fit apply again; a part whose instrument changes loses its saved octave moves, and everything else in the record (other settings, zoom, sounds, hidden staves) is kept.
- `onReady` parts carry `sourcePart` and `switchable`.

**`pepperscore/instruments`** is a framework-free entry (no React, no Verovio) with the instrument model (`INSTRUMENTS`, `INSTRUMENT_IDS`, `EMBED_INSTRUMENTS`, levels, ranges, transpositions, clefs, `spellMidi`, `writtenPitch`, `transposePitchSpelled`, `writtenKeyFifths`) and the range-fit core (`joinRuns`, `tieChainOf`, `planShifts`, `applyOverrides`). The editor uses the same module. Its types include `InstrumentInfo` (one model entry; not the audio player's `Instrument` from `pepperscore/audio`), `InstrumentId`, `SwitchInstrumentId` and `RangeLevel`. `INSTRUMENTS` (`Readonly<Record<InstrumentId, Readonly<InstrumentInfo>>>`) and `EMBED_INSTRUMENTS` (`readonly InstrumentId[]`) are frozen.

### `persist`

Saved state lives under a namespace `<ns>`:

- localStorage: `<ns>-prefs` (global reader settings), `<ns>-file-v2:<hash>` and `<ns>-pending-v2:<hash>` (per-score records), and the legacy `<ns>-file-v1:<hash>`, which is read only.
- IndexedDB: `<ns>` (per-score records) and `<ns>-last-file` (the last opened file, kept on this device so it can be reopened).
- sessionStorage: `<ns>-reopen-dismissed`.

Set `persist` once per instance: prefs are read on mount, so changing the prop on a mounted reader writes its current prefs into the new namespace. To switch namespaces, remount the reader (for example `key={namespace}`). Readers that share a namespace share their state. The default is `"pepperscore"` for `chrome="full"` and `false` for `minimal` and `none`, so snippets never write storage unless you give them a namespace. With persistence on, host `settings` are written into `<ns>-prefs` like any other change, and they are re-applied on every mount.

**Diagnostic hooks exempt from `persist`.** The reader reads three localStorage keys whatever `persist` is, even with `persist={false}`. They are for tests and troubleshooting. Nothing sets them except a person or a test, and the reader only removes `scoreflow-simulate-oom` after it fires.

| Key | Effect |
| --- | --- |
| `scoreflow-chunking` | JSON `{ "force": true, "budget": 16, "recycleHeapBytes": … }`: force chunked engraving of MusicXML, or tune its measure budget and worker heap recycling. |
| `scoreflow-simulate-oom` | A positive integer N: the next N renders fail as out-of-memory (tests the restart path). |
| `scoreflow-large-file-bytes` | A byte count that replaces the large-file warning threshold. |

## Assets and self-hosting

Music fonts (Bravura, Petaluma, Petaluma Script) and sounds are not in this package (the instrument icons the UI shows are bundled). They load at runtime from `assetBaseUrl`, which points at the root of a `pepperscore-sounds-*` package:

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

### Verovio

Verovio is not bundled into pepperscore's code. The package ships upstream's own files from `verovio@6.3.0`, unmodified apart from a licence comment, in `dist/verovio/` (`verovio-module.mjs`, about 7.3 MB with its WebAssembly inlined, and `verovio.mjs`, the toolkit), and the Verovio worker imports them at runtime. A reader that has a score to show (or full chrome's sample) starts the worker when it mounts, so Verovio downloads and compiles while the score is still being read, not after. Host bundlers (Vite, Astro) copy them as assets like the worker chunks, so nothing needs configuring.

- Serve `.mjs` files as JavaScript (`text/javascript`). Most hosts do; a server that sends them as `application/octet-stream` makes the import fail, and the reader shows a "Could not load Verovio from …" error.
- To engrave with another build (a modified Verovio, a newer compatible version, or a CDN copy), pass `verovioBaseUrl`, a directory holding both files. A cross-origin directory must send CORS headers. Or replace the files your bundler emitted.
- **`preloadVerovio(base?)`** (from `pepperscore`) starts that download earlier still, before React hydrates, for example from a page script that runs before the island loads. Pass the same directory as `verovioBaseUrl` (omit both for the shipped copy). It does nothing on the server and is safe to call more than once; readers that mount later reuse the warm worker, and it stops when the last reader unmounts. A worker that has only warmed up is replaced if a reader then sets a different `verovioBaseUrl`.

  ```ts
  import { preloadVerovio } from 'pepperscore';
  preloadVerovio(); // or preloadVerovio('https://cdn.jsdelivr.net/npm/verovio@6.3.0/dist/')
  ```
- The interface pepperscore expects: `verovio-module.mjs` default-exports an async factory returning the Emscripten module (`createVerovioModule`), and `verovio.mjs` exports `VerovioToolkit` and `enableLogToBuffer`, as in `verovio@6.3.0`.

**If the assets cannot be loaded** (a wrong `assetBaseUrl`, or nothing published there yet), the reader keeps working: the score still engraves (Verovio's own glyphs; text glyphs fall back), playback runs silently with the usual "playing silently" notice and no error, and the console shows one warning naming the `assetBaseUrl` that failed. A failing `soundSources` entry of your own still reports through `onError`.

### Testing before the sounds packages are published

Until `pepperscore-sounds-core` is on npm, the default jsDelivr URL returns 404, so fonts fall back and playback is silent. Self-host the sounds instead. Install the local tarball (`npm run pack:local` in this repository writes `.packs/pepperscore-sounds-core-<version>.tgz`), or copy `packages/pepperscore-sounds-complete`, then:

```bash
pnpm add -D /path/to/.packs/pepperscore-sounds-core-0.1.0.tgz
cp -rL node_modules/pepperscore-sounds-core public/pepperscore-sounds   # -L follows pnpm's symlinks
```

and pass `assetBaseUrl="/pepperscore-sounds/"` on every instance (or in your wrapper component).

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

## Shared audio engine (`pepperscore/audio`)

The reader's audio engine is also a small, framework-free subpath (no React), so other music apps on the same page (a piano visualiser, a practice tool) share one `AudioContext`, one "who is playing" slot and the same sounds as every `PepperScore`:

```ts
import { claimPlayback, createMetronome, getSharedAudio, loadInstrument, releasePlayback, resumeAudio } from 'pepperscore/audio';

const shared = getSharedAudio();              // { context, master } or null without Web Audio
await resumeAudio(shared!.context);           // from a user gesture; resolves false if audio cannot start

const piano = await loadInstrument(1, { assetBaseUrl: '/pepperscore-sounds/' });   // GM program, FluidR3 name or 'drums'
const metronome = await createMetronome({ voice: 'woodblock', assetBaseUrl: '/pepperscore-sounds/' });

const owner = { stop: () => { piano.stop(); metronome.stop(); } };
claimPlayback(owner);                         // stops any PepperScore (or other owner) that is playing
const t = shared!.context.currentTime + .1;
for (let beat = 0; beat < 4; beat++) metronome.tick({ time: t + beat * .5, beat });   // beat 0 is accented
const stopNote = piano.start({ note: 60, time: t, duration: 1, velocity: 90 });
// later: stopNote() stops (or cancels) that note; owner.stop() stops everything still sounding or scheduled
releasePlayback(owner);                       // when your playback ends
```

| Export | Signature | |
| --- | --- | --- |
| `getSharedAudio` | `() => { context: AudioContext; master: DynamicsCompressorNode } \| null` | The page's audio graph, created on first use. Readers play through `master`. |
| `resumeAudio` | `(context) => Promise<boolean>` | Resume with a bounded wait (a pending `resume()` never hangs your code). |
| `claimPlayback` / `releasePlayback` | `(owner: { stop(): void }) => void` | One player at a time: claiming stops the previous owner. A reader claims it when it starts playing, so your app and the readers never play over each other. |
| `loadInstrument` | `(sound: number \| string, options?) => Promise<Instrument>` | `sound`: GM program 1-128, FluidR3 name (`'acoustic_grand_piano'`) or `'drums'`. |
| `loadDrumKit` | `(options?) => Promise<Instrument>` | `loadInstrument('drums', options)`. |
| `createMetronome` | `(options?) => Promise<Metronome>` | See below. |
| `METRONOME_VOICES`, `SOUNDS_VERSION`, `defaultAssetBaseUrl` | | Constants. |

The drum kit is `'drums'` (`'drum-kit'`, the score part id, is accepted as an alias).

Options (`InstrumentOptions`): `assetBaseUrl`, `soundPack` (`'core'` default, `'complete'`) and `sources` (`SoundSource[]`) work exactly like the reader's `assetBaseUrl`, `soundPack` and `soundSources` props. `context` and `destination` default to the shared context and its master compressor. `notes` lists the notes to load before the promise resolves (default 21-108 for an instrument, none for the kit; call `loadNotes(notes)` for more, since a note that is not loaded starts silently).

An `Instrument` is an `AudioPlayer` (`start({ note, time, duration, velocity, destination? }) => stop`, `stop()`, `dispose()`, `loadNotes(notes)`, `covers(note)`) plus `context`, `output` (its volume `GainNode`) and `plan` (read-only `{ kind, sourceId }`: which source plays it, for example `'builtin:fluidr3'`). `stop()` stops every sounding note **and cancels every scheduled one**. A note's `destination` is honoured by sample-pack and note-file sounds. SF2 sounds always play through `output`.

Sounds resolve exactly as in the reader (above): your `sources`, then the pack's FluidR3 sound, then `TimGM6mb.sf2`. Drums use Perfect Drums, with TimGM6mb's kit for the notes it lacks. Every built-in file comes from `assetBaseUrl`, so a self-hosted base means no requests to any other host.

**Metronome.** `createMetronome({ voice?, gain?, ...InstrumentOptions })` returns `{ voice, output, ready, tick({ time, beat, accent? }) => stop, setVoice(voice), stop(), dispose() }`. It resolves at once and loads the drum kit in the background: beats play the synthesized sound until the kit arrives (`await metronome.ready` to wait; `setVoice` resolves when its notes have loaded). A failed kit download is not remembered: the next `setVoice`, or a tick after 10 seconds, tries again. `beat` counts from 0 within the bar, and beat 0 is accented (louder, or higher for synth sounds) unless `accent` says otherwise. `gain` defaults to a gentle 0.5.

| Voice | Beat 1 | Other beats | Source |
| --- | --- | --- | --- |
| `'woodblock'` (default) | GM hi wood block (76) | GM low wood block (77) | The drum kit (Perfect Drums has no wood blocks, so TimGM6mb's kit plays them). **The default voice downloads Perfect Drums' manifest and `TimGM6mb.sf2` (about 6 MB, once, cached) from `assetBaseUrl` in the background; use `voice: 'click'` to load nothing.** Without a kit wood block: a soft synthesized knock. |
| `'drum-machine'` | Kick (36) | Closed hi-hat (42) | The drum kit (Perfect Drums). Without a kit: synthesized ticks. |
| `'click'` | Soft high tick | Soft tick | Synthesized, short and quiet. Loads nothing. |

## Known v1 limits

- **`deviceClass()` uses a viewport media query.** Layout sizes come from the reader's root element, but the choice between "desktop" (a fine pointer and a viewport wider than 850px) and "compact" defaults still queries the viewport. That choice sets the default stave scale and the large-file notice wording. So a narrow reader on a wide desktop page gets desktop defaults.
- **A many-stave score in a short fixed height engraves small.** The reader fits the whole staff stack of each system into the viewport. A five-stave score in `height="200px"` is tiny and uses only part of the width. Give such snippets more height, or pass `settings={{ zoom: … }}`.
- **No server-side engraving.** The server render is an empty frame. The SVG is drawn on the client.
- Settings are initial values, not fully controlled props.
- Many large scores on one page engrave one after another, because they share a single Verovio worker. It is slow, not broken.

- **Instrument switch.** A switched part's written transposition and key come from its first measure, so a mid-part transposition change is not reflected in the engraving. MEI-file imports do not group grand staves, so a piano switches one staff at a time. The octave tool moves a note at most one octave from as written (±12 in total), and fitting moves a phrase by one octave, so a phrase two octaves out of range stays flagged `ps-out-of-range`.

## Licenses

The package licence is `MIT AND LGPL-3.0-or-later`:

- **The pepperscore component code is MIT licensed** (see `LICENSE`).
- **The pepperscore worker chunks in `dist/assets/` are MIT licensed too**: they contain no Verovio code.
- **Verovio is LGPL-3.0-or-later** and stays a separate file. `dist/verovio/` holds Verovio 6.3.0's own `verovio-module.mjs` and `verovio.mjs` (unmodified, with a licence comment added) and a `LICENSE`; the worker loads them at runtime, and you can swap in your own build with `verovioBaseUrl` (see [Verovio](#verovio)). Source: [rism-digital/verovio, tag version-6.3.0](https://github.com/rism-digital/verovio/tree/version-6.3.0). The LGPL-3.0 and GPL-3.0 texts ship in `LICENSES/`. Hosts that deploy pepperscore redistribute these files; keep their notices with them.
- **Third-party notices**: `dist/THIRD_PARTY_NOTICES.txt` lists the runtime dependencies (MIT and ISC, with their licence texts), Verovio, the SIL OFL 1.1 music fonts Verovio embeds (Leipzig, Bravura, Gootville, Leland, Petaluma) and Poppins (OFL 1.1, through `@fontsource/poppins`). Host bundlers copy it as an asset, and the full reader's options drawer links it ("Licences", next to the soundfont credits).
- **Sound packs** (`pepperscore-sounds-core`, `pepperscore-sounds-complete`): each asset set keeps its own license, listed in the package's `LICENSES.md`:
  - TimGM6mb.sf2: GPL-2.0
  - FluidR3 GM sample packs: CC BY 3.0 (attribution in `soundfonts/fluidr3/ATTRIBUTION.txt`)
  - Bravura, Petaluma and Petaluma Script fonts: SIL Open Font License 1.1 (`fonts/Bravura-OFL.txt`, `fonts/Petaluma-OFL.txt`)
  - Perfect Drums samples: attribution in `soundfonts/perfect-drums/ATTRIBUTION.txt` (the source artifact states WTFPL)
  - Instrument icons: MIT


## ABC headers

ABC is parsed with abcjs and engraved through PepperScore's score model. Chord symbols, text annotations, accidentals, ties, beams and final/double barlines are retained. Use the checklist, rules and templates below when generating ABC for `<PepperScore abc={…}>`.

### Quick checklist

1. One tune per string. Start with `X:1`. Only the first tune is imported.
2. Header order: `X:` → `T:` → `C:` → `M:` → `L:` → `Q:` → `%%score`/`%%staves` (if grouping) → `V:` lines (with their `%%MIDI` lines right after each) → `K:` last. Put `%%score`/`%%staves` **before** the `V:` lines they group.
3. Keep `K:` after `X:` (a file-level `K:` before `X:` is tolerated but has no effect on voices).
4. Declare every voice with `V:<id> name="…" clef=…` (preferably in the tune header; body-only declarations also work), even a single voice, if you need a specific instrument, clef or transposition. `V:` lines before `X:` also work as file-wide defaults, but prefer the tune header.
5. Put `%%MIDI program|channel|transpose` **directly after the `V:` line it belongs to**. In the header, a `%%MIDI` line before any `V:` is a default for every voice.
6. Transposing instruments: write the notes **as the player reads them** and add `transpose=<semitones written→sounding>` on the `V:` line.
7. End the piece with `|]`.
8. Chord symbols in plain quotes (`"C7"`); text in quotes with a position prefix (`"^Swing"`, `"_rit."`).

### Rules

#### Tune and header

- Only the first tune (`X:` to the next `X:`) is read. Before the first `X:`, only `%%MIDI` and `V:` lines apply (as defaults); `M:`, `L:`, `Q:`, `C:` there are ignored, so put them after `X:`. A `K:` there doesn't end the tune header; the tune's own first `K:` does. A `V:` line before `X:` supplies defaults (clef, name, transposition) for that voice; a tune-header `V:` for the same id overrides each property it sets. If the body has music before any `[V:…]` selector, it goes to the first declared voice — which may be a file-header voice — so select voices explicitly in the body.
- Honoured: `T:` title, `C:` composer, `M:` meter, `L:` default length, `Q:` tempo, `K:` key (with `m`/`min` for minor).

#### Keys and accidentals

- Change key mid-tune with a `K:` line or inline `[K:Gb]`, including mid-bar. The new signature is drawn where it occurs.
- Write accidentals normally (`^F`, `_B`, `=F`). Per-bar rules apply: an accidental carries to later notes of the same pitch in that bar, and a tie (`^F- | F`) carries it into the next bar.
- Spelling is kept as written: `^E` in F♯ major and `_C` in G♭ major stay E♯ and C♭.

#### Clefs

- `clef=treble|bass|alto|tenor|treble-8|treble+8|bass-8|perc` on `V:` (or `K:`).
- Octave clefs: ABC note letters are the **sounding** pitch (ABC 2.1); `-8` draws them an octave higher and `+8` an octave lower. Guitar: `clef=treble-8`, and `G,` sounds G3 and is drawn as G4 on the second staff line, with the clef’s "8" retained when switching to guitar. TAB and playback use G3. Don't also add `transpose=-12`; the letters already specify sounding pitch.

#### Instruments and sound

- `name="…"` selects the instrument from its name (e.g. "Flute", "Cello", "Alto Saxophone") when no `%%MIDI program` is given. A name never implies transposition.
- `%%MIDI program N`: **zero-based** GM number (0–127), e.g. 0 piano, 40 violin, 42 cello, 65 alto sax, 73 flute. PepperScore stores GM programs as 1–128 internally.
- `%%MIDI channel 10` selects the drum kit and unpitched notation, taking precedence over the MIDI program. A voice named like "Drums" also imports as unpitched percussion when no MIDI program is supplied. Use `clef=perc`.
- Header MIDI directives before any `V:` declaration are tune-wide defaults; after a `V:` declaration, they apply only to that voice. Each voice inherits default properties it has not overridden. Body directives override that voice’s earlier MIDI settings, but explicit `V: transpose=` still wins.
- Body-only voices: a `%%MIDI` line after `[V:id]` / `V:id` in the body applies to that voice. One before any voice selector applies to the first voice, unless notes or a barline come before every selector: then it belongs to that implicit default voice and later voices don't inherit it. Safest: put each `%%MIDI` line right after its voice's `V:` line.

#### Transposing instruments

- `V:sax name="Alto Saxophone" transpose=-9` → written A4 sounds C4. Values are written→sounding semitones: B♭ clarinet/trumpet -2, tenor sax -14, alto sax -9, horn in F -7, baritone sax -21.
- `transpose=` wins over `%%MIDI transpose`, including an explicit `transpose=0`. Prefer `transpose=`.
- `%%MIDI transpose N` supplies written-to-sounding semitones when the voice has no explicit `transpose=`. Instrument intervals add to octave-clef intervals; instrument switching and concert-pitch display use the combined interval. Diatonic steps follow conventional intervals within each octave (0–11 semitones: unison, minor/major second, minor/major third, fourth, augmented fourth, fifth, minor/major sixth, minor/major seventh), with the same sign and seven steps per octave. Thus -9 maps to -5 diatonic steps.
- `score=` is **not** supported; don't use it.
- The written key goes in `K:`: for alto sax in concert C, write `K:A`.
- Don't send concert-pitch ABC *and* `transpose=`; pick written pitch + `transpose=`. (Alternative: concert-pitch ABC with no `transpose=`, and the host sets `settings.instrument`.)

#### Grand staff (piano, harp, organ)

- Group voices with braces using `%%score {RH | LH}` **before** their `V:` declarations; putting the grouping after the declarations leaves the staves separate. They become one part with one name and a brace. Name the first voice (`name="Piano"`); the second inherits the instrument. Pitched staves in a brace share one instrument and sound, taking an explicit MIDI sound when present, otherwise the named pitched voice’s instrument. Percussion remains specific to its own staff and never changes a pitched partner into drums.
- Without braces, voices stay separate parts.

#### Chord symbols, text and dyads

- `"C7"`, `"Am7b5"`, `"C/E"`: chord symbols (default position).
- `"^Swing"` above, `"_rit."` below: text, never a chord symbol. You can put text and a chord on the same note: `"^Swing""C7"c`.
- Dyads/chords: `[CE]` gives one stem with two pitches.

#### Barlines

- `|]` final barline, `||` double barline, `|:` `:|` `::` repeats, `[1` `[2` endings.

### Templates

**Single melody, concert pitch**

```abc
X:1
T:Scale study
M:4/4
L:1/8
Q:1/4=90
V:1 name="Flute"
K:D
DEFG ABcd | d2c2 B2A2 |]
```

**Transposing instrument (alto sax, concert C major)**

```abc
X:1
M:4/4
L:1/4
V:sax name="Alto Saxophone" transpose=-9
%%MIDI program 65
K:A
A B c d | e2 A2 |]
```

**Piano grand staff with text and chords**

```abc
X:1
M:4/4
L:1/4
%%score {RH | LH}
V:RH name="Piano" clef=treble
V:LH clef=bass
K:C
[V:RH] "^Swing""C7"c e g e | c4 |]
[V:LH] C, G, E, G, | C,4 |]
```

**Guitar**

```abc
X:1
M:4/4
L:1/4
V:gtr name="Guitar" clef=treble-8
%%MIDI program 24
K:G
G, A, B, C | D4 |]
```

### Known limits (don't rely on these)

- Lyrics, decorations, tuplet engraving, multi-tune files: outside the parity guarantee.
- `score=` on `V:` is ignored.
- Saved per-part reader settings reset for piano ABC scores first shown before 2026-11-10 (grand-staff regrouping).
