# Scoreflow

A quiet, browser-only music reader built with Astro 7, React, and [Verovio](https://www.verovio.org/) 6.3 (bundled WASM, run in a Web Worker).

## Run

```bash
npm install
npm run dev   # binds to 0.0.0.0
```

Open the URL printed by Astro.

| Script | Purpose |
| --- | --- |
| `npm run check` | Astro and TypeScript checks |
| `npm run build` | Static site in `dist/` |
| `npm run test:manifest` | Verifies the bundled GM sound packs |
| `npm run test:validation` | Tracked suites: `test:document` (source retention, formats, identities), `test:performance` (playback timeline) and `test:reader` (the built reader in Chromium). Run `npm run build` first. |
| `npm run test:reader:firefox`, `npm run test:reader:webkit` | Reader suite in Firefox or WebKit (`npm run test:browsers` installs the Playwright engines) |
| `npm run test:example` | Local-only check of the Cielito Lindo MusicXML in Chromium; needs the Git-ignored `examples/` and `tests/` files |

CI (`.github/workflows/ci.yml`) runs check, build, the manifest check and `test:validation` in Chromium. It also runs the reader suite in Firefox and WebKit. The small original fixtures in `validation/fixtures/` are tracked. Private scores stay in the ignored directories.

## Reading

- Open `.musicxml`, `.xml`, `.mxl`, `.mei`, `.mid`, `.midi`, or `.abc` files from the header, or paste ABC notation in the bottom drawer.
- Vertical is a continuous score that scrolls downward. Endless is a continuous score that scrolls sideways. Page Up/Down, arrow keys, Space, the on-screen arrows, and touch swipes move one viewport with a configurable overlap.
- The sticky header offers Auto or 1–4 bars per line in Vertical view. Auto chooses a readable count; a fixed count scales the stave to fit the viewport. Scores with more than four playable staves initially fit the full staff stack vertically. Header +/− buttons and a two-finger pinch zoom in either view.
- The bottom drawer controls overlap, notation font, stave text font (Sans, Serif, or Mono), note names, chord symbols, beat counts, and subdivisions. The stave text choice applies to note letters, counts, bar numbers, lyrics, and chord labels. Chord note letters stack below the noteheads, with counts below them. Settings are saved in the browser; scores are not uploaded or saved.
- The Pitch panel in the bottom drawer transposes pitched staves up or down one semitone at a time, up to an octave either way. It also switches between transposing (written) and concert score views. Both score view and semitone offset are saved per file. Playback always uses concert pitch plus the chosen offset; percussion mappings stay fixed.
- Bravura and Petaluma music fonts are served locally, both for Verovio's engraving and for SMuFL glyphs inside score text (tempo marks, dynamics). The interface font is Poppins, bundled through `@fontsource/poppins`; the app makes no remote font or asset requests.
- For scores with more than four staves, an eye after each instrument icon hides that stave and mutes its playback. Hidden staves can be restored at the start of the score, or all restored with **Reset score staves** in the drawer.
- Assign a playback sound by selecting the instrument icon beside a stave or opening the track mixer in the header. Both open the same icon picker with all 128 GM sounds plus Drum Kit, arranged in a four-column grid with sixteen sounds per page. Family filters and previous/next buttons navigate the list. The mixer lists every track, including hidden muted tracks, and has a volume slider for each track. The playhead line spans the full staff system, notes are highlighted, and the score follows the current note during playback.
- The first system shows each score part's name beside its instrument icon. Later Vertical systems use the full available width for their staves.
- The sticky transport holds Stop, Play/Pause, BPM, the Vertical/Endless switch, Open score file, and the track mixer. Supplied title, subtitle, composer, and other score credits appear with the notation rather than in the transport.

## Import scope

Verovio engraves every format. MusicXML (partwise or timewise), compressed MXL and MEI originals are imported by Verovio directly, so its native notation support applies. That includes voices, tuplets, grace notes, accidentals, ties, slurs, dynamics, hairpins, articulations, lyrics, barlines and endings. ABC (through abcjs), MIDI (quantized to sixteenth notes) and the built-in sample are converted to MEI from the shared score model. ABC voices are shown as separate staves, with source beaming, triplets and `w:` lyrics. MIDI cannot recover original spelling, beaming or articulations.

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

To open a song when mounting the React reader, pass MusicXML text directly through the `musicXml` prop. No base64 or URL encoding is needed:

```tsx
import Reader from './components/Reader';
import songXml from './scores/song.musicxml?raw';

<Reader musicXml={songXml} />
```

For a `File` selected elsewhere in your app, use `await file.text()` and pass that string. Changing the prop loads the new score and resets playback.

### Known limitations

- Lyrics always use Times. Verovio spaces lyric syllables with Times metrics, so the stave text font setting does not apply to them.
- Endless view is one unbroken system up to 160 bars. Longer scores are split into 120-bar sections that each repeat the clef and key.
- Scores encoded at concert pitch cannot show a written (transposing) view.
- Ornaments, tremolos, arpeggios, glissandi and the sostenuto pedal are not played back. Verovio engraves what it supports, and the timeline reports ornaments and sostenuto in its diagnostics.
- Repeat and navigation playback reads MusicXML only. MEI, ABC and MIDI play straight through.
- WebKit is validated only in CI. Many advanced notation families are engraved natively by Verovio but do not have tracked tests yet; see the capability ledger in [docs/verovio-migration-plan.md](docs/verovio-migration-plan.md#capability-ledger).

## Per-file state and sharing format

For an opened file, Scoreflow hashes its bytes with SHA-256 and saves the versioned [file settings schema](src/lib/file-state.schema.json) in browser storage under that hash. Reopening the same bytes restores view, notation options, zoom, BPM, instrument assignments, track volumes, and stave visibility. Hiding a stave also mutes its playback; the source file stays untouched.

The [portable score envelope schema](src/lib/score-share.schema.json) describes how a compressed score and its settings can travel together. It is a format for a future sharing flow, not a link service. A short URL for a large score would require hosted storage or a short-link backend; putting the score in a URL fragment would produce a long link.

## Soundfont

The [GM soundfont manifest](src/lib/gm-soundfont-manifest.json) lists all 128 FluidR3 GM programs (numbered 1–128), each with a local sample pack, family, and the closest supplied SVG icon. Its `voices` section retains the original 16 common defaults. MIDI tracks use the program mapping to choose an icon. MusicXML parts whose `virtual-library` is `General MIDI` use a matching `virtual-name` for both icon and exact playback sound; a valid `midi-program` is used when no GM virtual name is supplied. Other libraries keep the normal part-name fallback. Run `npm run test:manifest` to check program order, icon files, and audio packs.

The 128 FluidR3 GM programs use local, reduced MP3 sample packs from [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts). The packs total about 47 MB on disk, but only sounds used by the current score load in the browser, and only their required samples are decoded. FluidR3 samples are CC BY 3.0; attribution and details of the reduction are in [`public/soundfonts/fluidr3/ATTRIBUTION.txt`](public/soundfonts/fluidr3/ATTRIBUTION.txt). To regenerate the packs from upstream, run `node scripts/prepare-fluidr3.mjs`.

The gleitz General MIDI set has no drum-kit bank. Drum notes 35–70 use a 2 MB local pack extracted from [Perfect Drums V2](https://musical-artifacts.com/artifacts/8466), the fixed hi-hat successor to the user's [V1 suggestion](https://musical-artifacts.com/artifacts/6554). The source SF2 is 244 MB and is not loaded by the browser. [Attribution and license](public/soundfonts/perfect-drums/ATTRIBUTION.txt) and the [preparation script](scripts/prepare-perfect-drums.mjs) are included. Other drum notes fall back to the local `TimGM6mb.sf2` kit through smplr; its GPL-2 license is in `public/soundfonts/COPYING.txt`. Pitched parts use Web Audio sample players. Playback schedules a short window ahead, and track gains feed a shared compressor. All playback assets are served from this app's origin.

## License notes

The score engraver is [Verovio](https://www.verovio.org/) (npm `verovio` 6.3.0), licensed under LGPL-3.0-or-later. It is bundled unmodified, with its WebAssembly module, into the Web Worker chunk. The Bravura and Petaluma fonts in `public/fonts/` are SIL Open Font License fonts from Steinberg.
