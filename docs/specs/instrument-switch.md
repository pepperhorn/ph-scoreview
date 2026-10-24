# Instrument switch

## Goal

A reader shows any pitched part as another instrument. Choosing one changes the part's sound, clef and written transposition, and fits each phrase into the instrument's range. The same instrument model and range-fit algorithm serve the editor, the full reader and embeds (`pepperscore/instruments`). Design: `docs/superpowers/specs/2026-10-24-instrument-switch-and-string-fingering-design.md`, Part 1.

## Public API (pepperscore 0.4.0)

`PepperScoreSettings` gains:

| Key | Type | Default | Meaning |
|---|---|---|---|
| `instrument` | `SwitchInstrumentId` | none | Shows the first switchable part as this instrument |
| `instruments` | `Record<string, SwitchInstrumentId>` | none | Per part. Key: 1-based source part number (grand staff counted once, drum kits counted) or an `onReady` part id (a grand staff's staff id switches the whole part). Wins over `instrument` |
| `rangeLevel` | `RangeLevel` | `'intermediate'` | `'beginner' \| 'intermediate' \| 'advanced'` |
| `autoRange` | `boolean` | `true` | Move out-of-range phrases by an octave |

Like other settings these apply to a score without a saved record. `SwitchInstrumentId` is any `InstrumentId` except `'drum-kit'`. `onReady` parts gain `sourcePart` (a grand staff's staves share it) and `switchable` (false for drums and percussion; ignored as keys).

`controls` gains `instrumentSwitch` (the Instrument choice, level and auto-range controls; embed popover and phone toolbar) and `octaveTool` (default on in `full`, off otherwise).

## Behaviour

- **Sound, clef, transposition.** The part's clef becomes the instrument's. A transposing instrument (B♭, E♭, F ...) is written at its written pitch by default, also when the score is in concert pitch. The Transposing / Concert control still flips it. Key signatures follow the written key (`writtenKeyFifths`); spelling uses `spellMidi` / `transposePitchSpelled`.
- **Range fitting.** After transposing, notes are grouped into phrases (`joinRuns`; tie chains stay whole, `tieChainOf`). `planShifts` moves a phrase by one octave when that brings it inside the range for `rangeLevel`; a phrase that fits neither way or still does not fit stays put. `autoRange: false` plans no shifts. `applyOverrides` layers manual octave moves on top.
- **Highlights.** `ps-transposed` marks moved notes (`--ps-transposed`), `ps-out-of-range` notes still outside the range (`--ps-out-of-range`), `ps-octave-selection` the octave tool's selection.
- **Grand staff.** Both staves of a piano part switch together.
- **TAB.** A TAB staff that doubled a switched part is hidden or regenerated for the new instrument. A part switched to guitar gets generated TAB (see `guitar-tab.md`); two staves of a switched piano each get their own TAB in Both view.
- **Mixer.** Instrument is what the part is (notation and sound). Sound is a playback-only override that keeps the notation.
- **Embeds.** A popover switcher offers `EMBED_INSTRUMENTS`; on a phone the frequent controls sit in a bottom toolbar. The full reader lists every instrument.
- **Part labels.** A switched part reads "→ Instrument".

## Octave tool

Toggle `.octave-tool-toggle` beside the instrument controls (embed menu, drawer Pitch panel). Toolbar `.octave-toolbar`: `.octave-up` (8va), `.octave-down` (8vb), `.octave-phrase`, `.octave-reset`, `.octave-done`.

- Click a note: its tie chain in its part. Shift-click, or a second click in the same part: every note between the two (all voices, each with its tie chain). Select phrase: the phrase(s) holding the selection.
- While the tool is on a note click selects instead of seeking or reporting.
- 8va / 8vb move relative to the shown pitch. Overrides are stored per note id as -12, 0 or +12; 0 pins a note as written against fitting. Reset clears the part's overrides.

## Saved state

`PartState.switch` in FileState v2: `{ instrument, level, autoRange, octaves, sound }` (octaves may hold 0). A record with a malformed `switch` (bad id, bad level, octave values other than -12, 0 or 12) opens that part as written. Records without it are unchanged.

## `pepperscore/instruments`

Framework-free entry (no React, no Verovio): `INSTRUMENTS`, `INSTRUMENT_IDS`, `EMBED_INSTRUMENTS`, `LEVELS`, `instrumentFor`, `instrumentName`, `pitchMidi`, `keyAlter`, `spellMidi`, `spelledSoundingMidi`, `writtenPitch`, `transposePitch`, `transposePitchSpelled`, `writtenKeyFifths`, and from the range-fit core `joinRuns`, `tieChainOf`, `planShifts`, `applyOverrides` (plus their types).

## Known limitations

- A switched part's MEI shift (written transposition and key) comes from its first measure; a mid-part transposition change is not reflected in the engraving.
- MEI-file imports do not group grand staves, so a piano switches one staff at a time.
