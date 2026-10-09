# Scoreflow

Scoreflow is the demo site for the `pepperscore` package (`packages/pepperscore`), a browser-only music score reader for React built on [Verovio](https://www.verovio.org/) 6.3 (bundled WASM, run in a Web Worker). The site (Astro 7 + React) consumes the package like any other host, so it doubles as the playground and as the page the validation suites drive. To embed the reader in your own site, see [packages/pepperscore/README.md](packages/pepperscore/README.md).

## Run

```bash
npm install
npm run dev   # binds to 0.0.0.0
```

Open the URL printed by Astro. To pick a port, run the reader workspace directly: `npm run dev -w pepperscore-reader -- --port 4400` (the root `dev` script does not forward extra arguments).

The repository is an npm workspace:

| Workspace | Contents |
| --- | --- |
| `packages/pepperscore` | The component library (published; Vite library build to `dist/`: ESM, `.d.ts`, `style.css`, worker chunks) |
| `packages/pepperscore-sounds-complete` | All assets: music fonts, instrument icons, Perfect Drums, TimGM6mb and all 128 FluidR3 sounds (published; the only copy of the assets in git) |
| `packages/pepperscore-sounds-core` | The core asset subset, generated from complete by `npm run sounds:core` (published) |
| `apps/reader` | This site (private). `astro dev` runs on the library sources; `astro build` uses the built `dist/` |

| Script | Purpose |
| --- | --- |
| `npm run check` | Astro and TypeScript checks |
| `npm run build` | The library (`packages/pepperscore/dist/`), then the static site (`apps/reader/dist/`) |
| `npm run sounds:core` | Regenerates `packages/pepperscore-sounds-core` (Git-ignored files) from the complete pack |
| `npm run pack:local` | Builds and writes `pepperscore-<version>.tgz` and `pepperscore-sounds-core-<version>.tgz` into the Git-ignored `.packs/`, for installing into another project by path (`pnpm add /path/to/.packs/pepperscore-0.1.0.tgz`) |
| `npm run test:manifest` | Verifies the bundled GM sound packs |
| `npm run test:api` | Chrome presets, control overrides and settings mapping (Node); also checks the library never reads `window.location` |
| `npm run test:css` | Every library CSS rule is scoped under `.pepperscore`, with no fixed positioning or viewport units |
| `npm run test:assets` | Asset base URL resolution (Node) |
| `npm run test:sounds` | Sound resolution order and `soundSources` plans (Node) |
| `npm run test:embed` | The `/embed-test` host page in Chromium: style isolation, containment, focused keyboard, shared engine, chrome presets, callbacks, ref, persist, custom asset base and sound sources (`BROWSER=firefox` or `webkit` for the others) |
| `npm run test:pack` | Packs `pepperscore`, installs the tarball into fresh Vite + React and Astro + React apps, builds both and checks the worker chunks and stylesheet. **Needs the network** (installs from the npm registry); publishes nothing |
| `npm run test:validation` | Tracked suites (all of the above except `test:pack`, plus): `test:document` (source retention, formats, identities), `test:parser-diff` (the streaming MusicXML reader against the former DOM importer), `test:score-db`, `test:performance` (playback timeline), `test:reader` (the built reader in Chromium) and `test:large` (a ~5 MB orchestral score). Run `npm run build` first. |
| `npm run test:reader:firefox`, `npm run test:reader:webkit` | Reader suite in Firefox or WebKit (`npm run test:browsers` installs the Playwright engines) |
| `npm run test:example` | Local-only check of the Cielito Lindo MusicXML in Chromium; needs the Git-ignored `examples/` and `tests/` files |

CI (`.github/workflows/ci.yml`) runs check, build, the manifest check, `test:validation` in Chromium and `test:pack`. It also runs the reader, chunked-engraving and embedding suites in Firefox and WebKit. The browser suites make no remote requests (the demo and test pages pass a local `assetBaseUrl`); `test:pack` is the only step that needs the network. The small original fixtures in `validation/fixtures/` are tracked. Private scores stay in the ignored directories.

## Reading

- Open `.musicxml`, `.xml`, `.mxl`, `.mei`, `.mid`, `.midi`, or `.abc` files from the header, or paste ABC notation in the bottom drawer.
- Vertical is a continuous score that scrolls downward. Endless is a continuous score that scrolls sideways. Page Up/Down, arrow keys, Space, the on-screen arrows, and touch swipes move one viewport with a configurable overlap.
- The sticky header offers Auto or 1–4 bars per line in Vertical view. Auto chooses a readable count; a fixed count scales the stave to fit the viewport. Scores with more than four playable staves initially fit the full staff stack vertically. Header +/− buttons and a two-finger pinch zoom in either view.
- The bottom drawer controls overlap, notation font, stave text font (Sans, Serif, or Mono), note names, chord symbols, beat counts, and subdivisions. The stave text choice applies to note letters, counts, bar numbers, lyrics, and chord labels. Chord note letters stack below the noteheads, with counts below them. Settings are saved in the browser; scores are not uploaded or saved.
- The Pitch panel in the bottom drawer transposes pitched staves up or down one semitone at a time, up to an octave either way. It also switches between transposing (written) and concert score views. Both score view and semitone offset are saved per file. Playback always uses concert pitch plus the chosen offset; percussion mappings stay fixed.
- Bravura and Petaluma music fonts are served locally, both for Verovio's engraving and for SMuFL glyphs inside score text (tempo marks, dynamics). With Petaluma, Verovio also gets Petaluma's published engraving defaults (heavier stems and lines) and Sans stave text switches to the local Petaluma Script face; Serif and Mono are kept. The interface font is Poppins, bundled through `@fontsource/poppins`; the app makes no remote font or asset requests.
- For scores with more than four staves, an eye after each instrument icon hides that stave and mutes its playback. Hidden staves can be restored at the start of the score, or all restored with **Reset score staves** in the drawer.
- Assign a playback sound by selecting the instrument icon beside a stave or opening the track mixer in the header. Both open the same icon picker with all 128 GM sounds plus Drum Kit, arranged in a four-column grid with sixteen sounds per page. Family filters and previous/next buttons navigate the list. The mixer lists every track, including hidden muted tracks, and has a volume slider for each track. The playhead line spans the full staff system, notes are highlighted, and the score follows the current note during playback.
- The first system shows each score part's name beside its instrument icon. Later Vertical systems use the full available width for their staves.
- The sticky transport holds Stop, Play/Pause, BPM, the Vertical/Endless switch, Open score file, and the track mixer. Supplied title, subtitle, composer, and other score credits appear with the notation rather than in the transport.

## Import scope

Verovio engraves every format. MusicXML (partwise or timewise), compressed MXL and MEI originals are imported by Verovio directly, so its native notation support applies. That includes voices, tuplets, grace notes, accidentals, ties, slurs, dynamics, hairpins, articulations, lyrics, barlines and endings. ABC (through abcjs), MIDI (quantized to sixteenth notes) and the built-in sample are converted to MEI from the shared score model. ABC voices are shown as separate staves, with source beaming, triplets and `w:` lyrics. MIDI cannot recover original spelling, beaming or articulations.

Files are read, hashed and, for MusicXML and MXL, parsed in a short-lived import worker, in one streaming pass that also takes the playback marks; the playback timeline is built there too. The page receives the score in small chunks, so opening a large file does not freeze it.

Hidden staves, bars-per-line breaks, transposition and the written/concert view are view transforms on Verovio's imported MEI. The original file is kept byte-for-byte and never modified. Bars are widened for dense notes and lyrics before a system scales to the viewport.

Playback follows a single performance timeline, which also drives highlighting and scrolling. It covers:

- tied notes, which sustain without re-attacking
- dynamics, including MusicXML `<sound dynamics>` values
- hairpins
- staccato, tenuto, accents and fermatas
- staggered grace notes and silent cue notes
- tempo changes, including mid-bar changes
- damper pedal
- unpitched percussion on the drum kit
- MusicXML repeats, endings, D.C., D.S., segno, coda and Fine

MusicXML `<transpose>` and concert-score `<for-part>` intervals, and MEI `trans.semi`/`trans.diat`, drive the written/concert view. MIDI and ABC files without transposition metadata display identically in both views. 

When chord symbols are enabled, source symbols from MusicXML, MEI, and ABC appear above the staff. The separate **Infer chord symbols** checkbox is off by default; enabling it also labels recognized pitch stacks that have no source symbol.

The demo page maps a `?score=<url>` query parameter (URL-encoded) to the component's `scoreUrl` prop; the component itself never reads `window.location`:

```
https://your-host/?score=https%3A%2F%2Fexample.com%2Fscores%2Fsong.mxl
```

The file is downloaded in the browser and opened like a chosen file, so any supported format works (MusicXML, MXL, MIDI, MEI, ABC). Its format comes from the URL's extension, or from the response's `Content-Type` when the URL has none. The host must allow cross-origin requests (CORS) unless it is the reader's own origin. Site-relative paths such as `?score=/scores/song.musicxml` also work.

Embedding the reader in another React or Astro site (`<PepperScore musicXml={xml} />`, inline snippets, props, assets) is documented in [packages/pepperscore/README.md](packages/pepperscore/README.md).

### Known limitations

- Lyrics always use Times. Verovio spaces lyric syllables with Times metrics, so the stave text font setting does not apply to them.
- Endless view is one unbroken system up to 160 bars. Longer scores are split into 120-bar sections that each repeat the clef and key.
- Scores encoded at concert pitch cannot show a written (transposing) view.
- Ornaments, tremolos, arpeggios, glissandi and the sostenuto pedal are not played back. Verovio engraves what it supports, and the timeline reports ornaments and sostenuto in its diagnostics.
- Repeat and navigation playback reads MusicXML only. MEI, ABC and MIDI play straight through.
- WebKit is validated only in CI. Many advanced notation families are engraved natively by Verovio but do not have tracked tests yet; see the capability ledger in [docs/verovio-migration-plan.md](docs/verovio-migration-plan.md#capability-ledger).

## Per-file state and sharing format

For an opened file, Scoreflow hashes its bytes with SHA-256 and saves the versioned [file settings schema](packages/pepperscore/src/lib/file-state.schema.json) in browser storage under that hash. Reopening the same bytes restores view, notation options, zoom, BPM, instrument assignments, track volumes, and stave visibility. Hiding a stave also mutes its playback; the source file stays untouched.

The [portable score envelope schema](packages/pepperscore/src/lib/score-share.schema.json) describes how a compressed score and its settings can travel together. It is a format for a future sharing flow, not a link service. A short URL for a large score would require hosted storage or a short-link backend; putting the score in a URL fragment would produce a long link.

## Soundfont

The [GM soundfont manifest](packages/pepperscore/src/lib/gm-soundfont-manifest.json) lists all 128 FluidR3 GM programs (numbered 1–128), each with a local sample pack, family, and the closest supplied SVG icon. Its `voices` section retains the original 16 common defaults. MIDI tracks use the program mapping to choose an icon. MusicXML parts whose `virtual-library` is `General MIDI` use a matching `virtual-name` for both icon and exact playback sound; a valid `midi-program` is used when no GM virtual name is supplied. Other libraries keep the normal part-name fallback. Run `npm run test:manifest` to check program order, icon files, and audio packs.

The 128 FluidR3 GM programs use local, reduced MP3 sample packs from [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts). The packs total about 47 MB on disk, but only sounds used by the current score load in the browser, and only their required samples are decoded. FluidR3 samples are CC BY 3.0; attribution and details of the reduction are in [`packages/pepperscore-sounds-complete/soundfonts/fluidr3/ATTRIBUTION.txt`](packages/pepperscore-sounds-complete/soundfonts/fluidr3/ATTRIBUTION.txt). To regenerate the packs from upstream, run `node scripts/prepare-fluidr3.mjs`.

The gleitz General MIDI set has no drum-kit bank. Drum notes 35–70 use a 2 MB local pack extracted from [Perfect Drums V2](https://musical-artifacts.com/artifacts/8466), the fixed hi-hat successor to the user's [V1 suggestion](https://musical-artifacts.com/artifacts/6554). The source SF2 is 244 MB and is not loaded by the browser. [Attribution and license](packages/pepperscore-sounds-complete/soundfonts/perfect-drums/ATTRIBUTION.txt) and the [preparation script](scripts/prepare-perfect-drums.mjs) are included. Other drum notes fall back to the local `TimGM6mb.sf2` kit through smplr; its GPL-2 license is in `packages/pepperscore-sounds-complete/soundfonts/COPYING.txt`. Pitched parts use Web Audio sample players. Playback schedules a short window ahead, and track gains feed a shared compressor. All playback assets are served from this app's origin.

## Publishing (manual)

```bash
npm run sounds:core
npm publish -w pepperscore-sounds-core
npm publish -w pepperscore-sounds-complete
npm publish -w pepperscore        # prepack builds dist
```

Bump `SOUNDS_VERSION` in `packages/pepperscore/src/lib/assets.ts` together with both sounds package versions (`npm run test:manifest` checks it). CI never publishes.

## License notes

Scoreflow (this viewer) is released under the [MIT License](LICENSE). Closed-source features are planned as separate plugins, outside this repository.

The score engraver is [Verovio](https://www.verovio.org/) (npm `verovio` 6.3.0), licensed under LGPL-3.0-or-later. It is bundled unmodified, with its WebAssembly module, into the Web Worker chunk. The Bravura, Petaluma and Petaluma Script fonts in `packages/pepperscore-sounds-complete/fonts/` are SIL Open Font License fonts from Steinberg; the Petaluma license text is in [`packages/pepperscore-sounds-complete/fonts/Petaluma-OFL.txt`](packages/pepperscore-sounds-complete/fonts/Petaluma-OFL.txt).
