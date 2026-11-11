# Changelog

## 0.5.0 - 2026-11-11

### Added

- `skin` prop (`PepperScoreSkin`): theme colours by interface role, an ordered `bar` of built-in controls, and an optional complete 12-pitch palette. Exports `mergeSkins`, `CRF_PITCH_COLOURS`, `ThemeToken`, `BarItemId`, `PitchClass` and `PitchPalette`. Theme values can reference host CSS variables; changing colours does not re-engrave the score. Without a skin, existing colours and header defaults are retained.
- Composable bars in full and minimal chrome, including note-name, beat-count and chord-symbol toggles and the instrument switcher. Explicit `controls` values of `false` still hide their controls. Annotation toggles stay in sync with the drawer and saved preferences; the chord-symbol tile switches authored and inferred symbols together.
- A Playback and view drawer panel for stop, view mode, bars per line, zoom, mixer and file opening when those actions are omitted from the header. On phones, full chrome's playback controls move to a wrapping bottom toolbar.
- Pitch-coloured noteheads from `skin.pitchColours`, enabled with `settings.pitchColours`, the bar/drawer tile or `handle.setPitchColours(on)`. Off by default, saved per score, and based on displayed pitch after transposition; enharmonic equivalents share a colour. Playback, selection and range marks retain priority. Colour and palette changes do not re-engrave.
- Generated fret-number TAB for guitar, four-/five-string bass guitar and soprano, tenor, baritone and bass ukulele, with instrument-specific tunings and re-entrant string order. `settings.tabInstruments` maps exact `onReady` part ids to a TAB identity (for example `bass5`) or `'none'`; it changes TAB identity without changing sound. A reader instrument switch replaces that initial override. Unqualified bass uses four strings; unqualified ukulele uses soprano GCEA. Finger/position TAB for fretless strings is not yet integrated.
- ABC authoring rules and copyable templates in the package README, covering voice/header order, clefs, transposition, MIDI directives, grouping and current limitations.
- Internal PDF groundwork: page planning and vector composition with embedded fonts and shared annotation/pitch-colour painting. This release has no PDF export UI or public export API. `jspdf` and `svg2pdf.js` are runtime dependencies loaded dynamically by the internal composer.

### Changed

- Instrument names without an explicit MIDI program now distinguish voices from instruments: Alto/Tenor labels (including numbering and divisi) are voices unless an instrument noun such as Sax, Flute or Trombone is present. Choir labels include solo, plural, Mezzo-Soprano, Contralto, Countertenor and split slash/ampersand staves. Treble needs a vocal hint or another named choir range; Treble/Bass alone stays piano plus bass guitar. Three distinct S/A/T/B letters establish choir context when no guitar/drum evidence is present. Explicit MIDI programs retain precedence.
- Name-only ukulele parts use nylon-guitar sound. Horn names distinguish English Horn/Cor Anglais, Basset Horn and Flugelhorn/Flügelhorn from French Horn; soprano sax, recorder and banjo names select their corresponding GM sounds.

### Fixed

- ABC accidentals follow bar state and ties across barlines; E♯/C♭ and other source spellings survive engraving. Key changes, including mid-bar changes, draw at their onset once per staff, including when layer 1 has no onset there.
- ABC positioned text (`"^Swing"`, `"_rit."`) stays separate from chord symbols; final and double barlines, alto/tenor clefs and octave clefs are preserved.
- ABC `%%score`/`%%staves` grouping produces grand staves. Per-voice `transpose=` and `%%MIDI transpose|program|channel` affect sounding pitch and sound; channel 10 or a drum name selects percussion. Only the first tune is imported. Directives work with body-only voice declarations, a file-header `K:` no longer ends the tune header, and `V:` defaults before `X:` keep their clef/name/transposition while preserving grouping.
- Octave-clef ABC and MusicXML now agree on staff position, playback and sounding-pitch TAB. MusicXML written-octave notes with a matching clef/transpose octave are normalized in the import copy while preserving original source bytes and residual instrument transposition. Switching to guitar retains the octave clef's 8.

### Behaviour changes

- Bare **Bass** now means bass guitar with four-string TAB, except in choir context without guitar/drums or with an explicit vocal label/program. Explicit bass-guitar names remain instrumental; Double Bass/Contrabass/Upright/String Bass remain double bass. **Bass Solo** and **Basses** are voices even in a band: supply a MIDI program for an instrumental bass solo.
- **Alto 1** / **Tenor II** now mean voices; include **Sax** for saxophones. Instrument nouns and explicit MIDI programs take precedence over voice-range words.
- Generated TAB is restricted to supported fretted string parts: the first-pitched-part fallback is removed, so piano and other non-string parts no longer acquire guitar TAB. Authored imported TAB remains available. Violin/cello finger TAB and viola/double-bass TAB are not enabled.
- `tabTuning` (including saved tunings) applies only to generated parts with the same string count; other parts keep their instrument defaults. A six-string tuning no longer replaces bass/ukulele defaults. String order is physical, not sorted by pitch.
- Octave-clef ABC letters are stored at **sounding pitch**: `G,` with `clef=treble-8` sounds G3, draws as G4 and generates sounding-pitch TAB. Do not add `transpose=-12` to compensate for the clef; an explicit instrument transpose still applies independently.

## 0.4.1 - 2026-10-30

### Added

- `preloadVerovio(base?: string)` (main entry): start the Verovio worker and its download, compile and instantiation before any reader mounts (for example before React hydrates). `base` is the same directory as `verovioBaseUrl`. See README, "Verovio".

### Changed

- Faster first engraving: a reader with a score (or full chrome's sample) starts the Verovio worker on mount, and the worker begins importing and instantiating Verovio as soon as it is configured, in parallel with the score's import instead of after it. The worker still stops when the last reader unmounts. `verovioBaseUrl` is applied before the warm-up; a worker that has only warmed up (no request yet) is replaced if the base URL then changes.
- The notation font (Bravura, or Petaluma with Petaluma Script) starts downloading on mount, and a draw waits up to 1.5 s for it so the SMuFL text it measures uses the font's metrics. The music fonts keep `font-display: block` (their glyphs are Private Use Area code points; a fallback would show boxes).

## 0.4.0 - 2026-10-30

Published from main before the first-engrave warm-up merged; that ships in 0.4.1.

### Added

- Instrument switch (docs/specs/instrument-switch.md). `settings.instrument`, `settings.instruments` (per part, keyed by 1-based source part number or `onReady` part id), `settings.rangeLevel` (`'beginner' | 'intermediate' | 'advanced'`, default `'intermediate'`) and `settings.autoRange` (default `true`). A switched part changes sound, clef and written transposition (B♭ and E♭ instruments read at written pitch, also in a concert-pitch score) and each phrase is fitted into the instrument's range. A grand staff switches together. A piano part switched to guitar gets generated TAB, and a TAB staff doubling a switched part is hidden or regenerated.
- Highlights `ps-transposed` (moved by fitting or the octave tool), `ps-out-of-range` (`--ps-out-of-range`) and `ps-octave-selection`.
- `controls.instrumentSwitch` and `controls.octaveTool`: both on in `full`, off in `minimal` and `none` unless set. In `minimal` and `none`, `settings.instrument` / `settings.instruments` alone switch the part but show no switcher. The octave tool selects a note (with its tie chain), a passage or a phrase and moves it 8va/8vb relative to the shown pitch; a 0 override pins a note as written; Reset clears.
- The mixer separates Instrument from Sound (a playback override). Embeds get a popover switcher and, on a phone, a bottom toolbar. Part labels read "→ Instrument".
- `pepperscore/instruments`: the instrument model and range-fit core (`INSTRUMENTS`, `INSTRUMENT_IDS`, `EMBED_INSTRUMENTS`, levels, ranges, transpositions, clefs, spelling helpers, `writtenKeyFifths`, `joinRuns`, `tieChainOf`, `planShifts`, `applyOverrides`), shared with the editor.
- `onReady` parts gain `sourcePart` and `switchable`. Types `RangeLevel` and `SwitchInstrumentId` (from both `pepperscore` and `pepperscore/instruments`). The model's instrument type is `InstrumentInfo`, named apart from `pepperscore/audio`'s `Instrument`; `INSTRUMENTS` and `EMBED_INSTRUMENTS` are typed read-only and frozen.
- Saved per-score records (still version 2) keep each part's switch (`PartState.switch`: instrument, level, autoRange, octaves, sound) and a fingerprint of the host's instrument settings (`hostInstruments`, optional). Records without a switch open as written.
- Host instrument settings vs saved choices: a saved record's switches win while the host's instrument settings (`instrument`, `instruments`, `rangeLevel`, `autoRange`) are the ones it was saved under, or the host gives none. When they differ (the same score embedded as another instrument, or a block changed to another instrument), the host's apply again over the record; a part whose instrument changes loses its saved octave moves, and the rest of the record is kept.

### Changed

- Space on a focused button inside the reader now presses that button instead of turning the page (affects all embeds).

### Compatibility

- A reader's "keep as written" octave pin (8vb on an auto-raised phrase) is dropped once a transpose, key flip, level, instrument or fit change means auto-fit no longer moves that note, and it is not restored when transposing back.
- Saved records can now contain an octave override of 0. An older pepperscore reader sharing the same site storage accepts only +-12 and drops that part's whole saved switch.

### Known limitations

- A switched part's written transposition and key come from its first measure; a mid-part transposition change is not reflected in the engraving.
- MEI-file imports do not group grand staves.
- The octave tool moves a note at most one octave from as written (±12 in total), so a phrase two octaves out of range stays flagged.

## 0.3.0 - 2026-10-23

### Added

- `pepperscore/audio`: the reader's audio engine as a framework-free subpath (`dist/audio.js` + `audio.d.ts`), so other apps on the page share one `AudioContext`, one playback owner and the same sounds. Exports `getSharedAudio`, `resumeAudio`, `claimPlayback`, `releasePlayback`, `loadInstrument(program | name | 'drums', { assetBaseUrl, soundPack, sources, context, destination, notes })`, `loadDrumKit`, `createMetronome({ voice: 'woodblock' | 'drum-machine' | 'click', gain })` and their types (`Instrument`, `AudioPlayer`, `Metronome`, `MetronomeVoice`, ...). Instruments resolve exactly as the reader does (sources, the pack's FluidR3 sound, TimGM6mb.sf2; drums from Perfect Drums plus TimGM6mb's kit), all from the asset base. The main entry's exports are unchanged, and both entries import the same chunk for the shared state. See README, "Shared audio engine".
- Text add-on sizes. Note names, chord symbols (source and inferred), beat counts and count subdivisions each have a size: `xs`, `sm`, `md`, `rg`, `lg` or `xl` (0.7x to 1.45x). `rg` (regular) is the default and draws exactly the earlier size. Hosts set them with `settings.annotationSizes` (`{ noteNames?, chordSymbols?, beatCounts?, subdivisions? }`, type `PepperScoreAnnotationSizes`; `AnnotationSize` is exported too); the full reader's options drawer has a segmented size control beside each add-on's switch while it is on. Lane rows and offsets grow with the labels, and source chord symbols are sized by Verovio (MEI `<rend fontsize>`), so it spaces them. Sizes are saved in the global prefs and in each score's record (`namesSize`, `chordSymbolsSize`, `countsSize`, `subdivisionsSize`; optional on read, so earlier records read as `rg`).
- Guitar TAB (docs/specs/guitar-tab.md). `settings.tabView` (`'notation'` default, `'tab'`, `'both'`), `settings.tabTuning` (open-string MIDI, low to high, default `[40, 45, 50, 55, 59, 64]`) and `settings.capo` (0–12). A score's own TAB staff (MusicXML clef `TAB`) shows in the TAB and Both views. Other scores get TAB generated by a fingering solver for their guitar parts, or for the first pitched part's top staff. Transposed views regenerate the frets. In TAB view the notation staff is hidden and its chord symbols, tempo and directions move to the TAB staff, and the playhead highlights the TAB.
- `controls.tabToggle`: a Notation / TAB / Both switch in the header (in the More panel on a phone) and in the drawer. With the drawer on, the header copy is left out between 761 and 1260px, where the full header has no room. On in the `full` preset, and shown only for a score with a pitched part.
- `settings.bpm` (initial tempo, 30–240) and `settings.keyFlip` (enharmonic spelling of a transposed view), which were reader-only settings before. Like `semitones`, they apply on each score load unless a saved per-score record has its own values.
- Saved per-score records (still version 2) keep `tabView`, `tabTuning` and `capo`. Records without them read with the defaults.
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
- A MusicXML TAB staff that doubles a notation part is no longer a part of its own: it is not played (playback had every note twice), has no annotation lanes, and is not listed in the part controls, mixer or `onReady` parts. A TAB-only score still plays its TAB staff.
- A highlighted measure (`highlights` with `measures`, any class) now shows a dashed box: a `.ps-measure-highlight` `<rect>` (in a `.ps-highlight-layer` overlay, so measure bounds are unchanged) with a 2px non-scaling stroke in `--ps-cursor`. The old `ps-cursor-measure` CSS outline was drawn in viewBox units and was nearly invisible.
- New highlight class `ps-transposed` (`--ps-transposed`, default `#d9741c`) for notes.
- `ps-selection` defaults to ink blue `#2f6a9a` (was green `#1f9d55`), so it does not clash with `ps-transposed`.
- A new score source draws immediately; the redraw fade only applies to setting changes.
- During playback the next two systems are drawn ahead of the playhead (`LOOKAHEAD_SYSTEMS = 2`), so a system is ready before its bar starts. Before, a system was requested only when the playhead entered it, and on a large score at a fast tempo the bar could end before the draw finished.
- With no `highlights` set and none applied, the highlight effect does no DOM queries and does not subscribe to redraws.
- Verovio is no longer bundled into the worker chunk. Its own unmodified files ship in `dist/verovio/` (with a licence comment and a `LICENSE`) and the worker imports them at runtime; host bundlers copy them like the worker chunks. Serve `.mjs` as JavaScript. The LICENSE's relink offer now points at upstream Verovio 6.3.0 source and `verovioBaseUrl`.

### Fixed

- `pepperscore/audio`: the metronome no longer leaks drum kits (overlapping `setVoice` calls share one load, a kit or TimGM6mb fallback that arrives after `dispose()` is released) and retries after a failed drum download. `createMetronome` resolves at once and plays the synthesized sound until the kit arrives (new `metronome.ready`); the default `'woodblock'` voice's ~6 MB download is documented. `Instrument.plan` is now the read-only `{ kind, sourceId }` (`InstrumentPlan`) and the internal `AudioPlayer.fallback` is no longer in the declarations.
- Chord-symbol sizing no longer scans to the end of the document for every symbol. The size buttons have accessible names ("Extra small" ... "Extra large"). Regular size draws an SVG with no `is-subdivision` class.
- Stopping playback now cancels SF2 (TimGM6mb and `kind: 'sf2'` source) notes already scheduled more than 200 ms ahead. smplr queues those in its own scheduler, and its argument-less `stop()` only stops sounding voices, so a queued note could still play after Stop. Each SF2 note now keeps its own stop handle (with a unique id: smplr's handle stopped every voice of the same pitch) and `stop()` calls them all.
- An ending (volta) that starts a line is drawn whole on that line. The page break went inside the `<ending>`, so Verovio drew a stub on the line before and labelled the bracket "(1)" as a continuation.

### Known follow-ups

- the default `loadInstrument` note range 21-108 decodes up to 88 buffers up front; `instruments.ts` and the reader assemble sounds separately; a pre-0.3 per-score record resets the four sizes to `rg`; the shared audio chunk is named after sound-players.

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
