# Changelog

## Unreleased

### Added

- `onElementClick(info)` (`PepperScoreClickInfo`): every click on the engraving, with every chrome, reports the note (`noteId`, `sourceId`), measure (`measureIndex`), position across it (`fraction`), nearest staff (`staff`) and `clientX`/`clientY`. With a `clock`, `onSeek` still fires as before. While it is set, notes and measures show a pointer cursor.
- `highlights` prop (`PepperScoreHighlight[]`): host classes on notes and measures, re-applied after every draw. New styles `ps-cursor`, `ps-selection` and `ps-cursor-measure` (`--ps-cursor`, `--ps-selection`).
- Handle: `scrollToMeasure(index)` (draws the measure's system if needed and scrolls it into view) and `seekToMeasure(index)` (seeks to the measure's first performed occurrence).
- Type exports `PepperScoreClickInfo` and `PepperScoreHighlight`.
- `PepperScoreClickInfo.nearestNoteId` / `nearestSourceId`: for a click that hits no note, the note or rest on the clicked staff in that measure whose notehead is nearest the click horizontally. A click anywhere in a note's drawn box (notehead, stem, flag, accidental, dots and the gaps between them) now reports that note as `noteId` (before, only the ink under the pointer did); where boxes overlap the nearest notehead wins, and noteheads stacked at one x (two voices, a chord) are split by the nearer in y. With a `clock`, such a click therefore seeks to that note (`onSeek`) where it used to seek to the start of the measure.
- `verovioBaseUrl` prop: engrave with another interface-compatible Verovio build (a directory laid out like the `verovio` package's `dist/`).
- `paintTransition` prop (`'reveal'` default, or `'none'`): with `'none'`, a new `musicXml` or `abc` for a score already on screen is swapped in place, with no fade, loading overlay or scroll reset.
- `dist/THIRD_PARTY_NOTICES.txt` (runtime dependencies, Verovio, the OFL fonts), linked as "Licences" in the full reader's options drawer.

### Changed

- A highlighted measure (`highlights` with `measures`, any class) now shows a dashed box: a `.ps-measure-highlight` `<rect>` (in a `.ps-highlight-layer` overlay, so measure bounds are unchanged) with a 2px non-scaling stroke in `--ps-cursor`. The old `ps-cursor-measure` CSS outline was drawn in viewBox units and was nearly invisible.
- New highlight class `ps-transposed` (`--ps-transposed`, default `#d9741c`) for notes.
- `ps-selection` defaults to ink blue `#2f6a9a` (was green `#1f9d55`), so it does not clash with `ps-transposed`.
- A new score source draws immediately; the redraw fade only applies to setting changes.
- During playback the next two systems are drawn ahead of the playhead (`LOOKAHEAD_SYSTEMS = 2`), so a system is ready before its bar starts. Before, a system was requested only when the playhead entered it, and on a large score at a fast tempo the bar could end before the draw finished.
- With no `highlights` set and none applied, the highlight effect does no DOM queries and does not subscribe to redraws.
- Verovio is no longer bundled into the worker chunk. Its own unmodified files ship in `dist/verovio/` (with a licence comment and a `LICENSE`) and the worker imports them at runtime; host bundlers copy them like the worker chunks. Serve `.mjs` as JavaScript. The LICENSE's relink offer now points at upstream Verovio 6.3.0 source and `verovioBaseUrl`.

### Fixed

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
