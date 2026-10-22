# Changelog

## 0.3.0

### Added

- `pepperscore/audio`: the reader's audio engine as a framework-free subpath (`dist/audio.js` + `audio.d.ts`), so other apps on the page share one `AudioContext`, one playback owner and the same sounds. Exports `getSharedAudio`, `resumeAudio`, `claimPlayback`, `releasePlayback`, `loadInstrument(program | name | 'drums', { assetBaseUrl, soundPack, sources, context, destination, notes })`, `loadDrumKit`, `createMetronome({ voice: 'woodblock' | 'drum-machine' | 'click', gain })` and their types (`Instrument`, `AudioPlayer`, `Metronome`, `MetronomeVoice`, ...). Instruments resolve exactly as the reader does (sources, the pack's FluidR3 sound, TimGM6mb.sf2; drums from Perfect Drums plus TimGM6mb's kit), all from the asset base. The main entry's exports are unchanged, and both entries import the same chunk for the shared state. See README, "Shared audio engine".
- Text add-on sizes. Note names, chord symbols (source and inferred), beat counts and count subdivisions each have a size: `xs`, `sm`, `md`, `rg`, `lg` or `xl` (0.7x to 1.45x). `rg` (regular) is the default and draws exactly the earlier size. Hosts set them with `settings.annotationSizes` (`{ noteNames?, chordSymbols?, beatCounts?, subdivisions? }`, type `PepperScoreAnnotationSizes`; `AnnotationSize` is exported too); the full reader's options drawer has a segmented size control beside each add-on's switch while it is on. Lane rows and offsets grow with the labels, and source chord symbols are sized by Verovio (MEI `<rend fontsize>`), so it spaces them. Sizes are saved in the global prefs and in each score's record (`namesSize`, `chordSymbolsSize`, `countsSize`, `subdivisionsSize`; optional on read, so earlier records read as `rg`).
- `onElementClick(info)` (`PepperScoreClickInfo`): every click on the engraving, with every chrome, reports the note (`noteId`, `sourceId`), measure (`measureIndex`), position across it (`fraction`), nearest staff (`staff`) and `clientX`/`clientY`. With a `clock`, `onSeek` still fires as before. While it is set, notes and measures show a pointer cursor.
- `highlights` prop (`PepperScoreHighlight[]`): host classes on notes and measures, re-applied after every draw. New styles `ps-cursor`, `ps-selection` and `ps-cursor-measure` (`--ps-cursor`, `--ps-selection`).
- Handle: `scrollToMeasure(index)` (draws the measure's system if needed and scrolls it into view) and `seekToMeasure(index)` (seeks to the measure's first performed occurrence).
- Type exports `PepperScoreClickInfo` and `PepperScoreHighlight`.
- `PepperScoreClickInfo.nearestNoteId` / `nearestSourceId`: for a click that hits no note, the note or rest on the clicked staff in that measure whose notehead is nearest the click horizontally. A click anywhere in a note's drawn box (notehead, stem, flag, accidental, dots and the gaps between them) now reports that note as `noteId` (before, only the ink under the pointer did); where boxes overlap the nearest notehead wins, and noteheads stacked at one x (two voices, a chord) are split by the nearer in y. With a `clock`, such a click therefore seeks to that note (`onSeek`) where it used to seek to the start of the measure.
- Handle: `scrollIntoView(target, options)` brings notes (`ids`) or a measure (`measure`) into view with the least scroll. Nothing moves when the target is already inside `margin`. `lead` (0..1 of the view) adds room ahead in the direction of travel, and `bounds` (client coordinates) keeps the target clear of a host's overlays. `interactedSince` skips the scroll when the reader has scrolled, wheeled, touched or pressed on the score since that time (a momentum or smooth scroll that carries on from their wheel or flick counts until it stops). It does nothing while playback follows the playhead. Vertically it keeps the target's whole system in view. It draws the measure's system if needed, scrolls smoothly unless the user prefers reduced motion, and resolves `true` when it scrolled. New types: `PepperScoreScrollTarget`, `PepperScoreScrollOptions` and `PepperScoreInsets`.
- `onRender()` prop: called after every draw lands (the first paint, a re-layout or an in-place swap), once `highlights` are applied.
- `verovioBaseUrl` prop: engrave with another interface-compatible Verovio build (a directory laid out like the `verovio` package's `dist/`).
- `paintTransition` prop (`'reveal'` default, or `'none'`): with `'none'`, a new `musicXml` or `abc` for a score already on screen is swapped in place, with no fade, loading overlay or scroll reset.
- `dist/THIRD_PARTY_NOTICES.txt` (runtime dependencies, Verovio, the OFL fonts), linked as "Licences" in the full reader's options drawer.

### Changed

- The options drawer uses the reader's width: its cards (Reading, a new Annotations card holding the add-on switches and sizes, Pitch and ABC notation) sit in as many ~272px columns as fit, so on a desktop they sit side by side and the drawer is short; on a phone they stack in one column.
- A highlighted measure (`highlights` with `measures`, any class) now shows a dashed box: a `.ps-measure-highlight` `<rect>` (in a `.ps-highlight-layer` overlay, so measure bounds are unchanged) with a 2px non-scaling stroke in `--ps-cursor`. The old `ps-cursor-measure` CSS outline was drawn in viewBox units and was nearly invisible.
- New highlight class `ps-transposed` (`--ps-transposed`, default `#d9741c`) for notes.
- `ps-selection` defaults to ink blue `#2f6a9a` (was green `#1f9d55`), so it does not clash with `ps-transposed`.
- A new score source draws immediately; the redraw fade only applies to setting changes.
- During playback the next two systems are drawn ahead of the playhead (`LOOKAHEAD_SYSTEMS = 2`), so a system is ready before its bar starts. Before, a system was requested only when the playhead entered it, and on a large score at a fast tempo the bar could end before the draw finished.
- With no `highlights` set and none applied, the highlight effect does no DOM queries and does not subscribe to redraws.
- Verovio is no longer bundled into the worker chunk. Its own unmodified files ship in `dist/verovio/` (with a licence comment and a `LICENSE`) and the worker imports them at runtime; host bundlers copy them like the worker chunks. Serve `.mjs` as JavaScript. The LICENSE's relink offer now points at upstream Verovio 6.3.0 source and `verovioBaseUrl`.

### Fixed

- Stopping playback now cancels SF2 (TimGM6mb and `kind: 'sf2'` source) notes already scheduled more than 200 ms ahead. smplr queues those in its own scheduler, and its argument-less `stop()` only stops sounding voices, so a queued note could still play after Stop. Each SF2 note now keeps its own stop handle (with a unique id: smplr's handle stopped every voice of the same pitch) and `stop()` calls them all.
- An ending (volta) that starts a line is drawn whole on that line. The page break went inside the `<ending>`, so Verovio drew a stub on the line before and labelled the bracket "(1)" as a continuation.

## 0.2.0

### Added

- `clock` prop (`ExternalClock`: `{ now(): number; playing: boolean; subscribe(listener): unsubscribe }`). A host clock drives the playhead, note highlight and Vertical/Endless follow. Its seconds map to the score at the score's own tempo map (tempo changes included, pickup bar starting at 0). The BPM setting is ignored. With a clock the reader plays no sound and hides its own play, stop and BPM controls. The playhead shows for every `chrome` preset, `"none"` included. A negative time (count-in) shows no playhead. Transposing keeps the playhead at `clock.now()`.
- `onSeek(seconds)`: with a `clock`, a click on a note (nearest performed occurrence) or anywhere in a measure (its start) reports the time instead of seeking.
- `audio` prop (default `true`). `false` never loads or schedules sound, and self-driven playback runs silently.
- `onTimeUpdate(seconds)`: about 10 Hz during self-driven playback.
- Handle: `seek(seconds)` and `currentTime()`. With a `clock`, `seek` reports through `onSeek` and `currentTime` returns `clock.now()`.
- Type exports `ExternalClock` and `ClockEvent`.

### Changed

- `handle.play()` and `handle.stop()` do nothing while a `clock` is set.

## 0.1.1

- Initial public release.
