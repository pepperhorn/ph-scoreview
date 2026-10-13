# Changelog

## Unreleased

### Added

- `onElementClick(info)` (`PepperScoreClickInfo`): every click on the engraving, with every chrome, reports the note (`noteId`, `sourceId`), measure, position across it (`fraction`) and nearest staff.
- `highlights` prop (`PepperScoreHighlight[]`): host classes on notes and measures, re-applied after every draw. New styles `ps-cursor`, `ps-selection` and `ps-cursor-measure` (`--ps-cursor`, `--ps-selection`).
- Handle: `scrollToMeasure(index)` and `seekToMeasure(index)`.
- Type exports `PepperScoreClickInfo` and `PepperScoreHighlight`.

### Changed

- A new score source draws immediately; the redraw fade only applies to setting changes.

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
