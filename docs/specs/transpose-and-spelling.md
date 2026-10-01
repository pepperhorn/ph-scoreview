# Global transpose and enharmonic spelling

Date: 2026-10-01 · Status: approved plan (decisions recorded 2026-10-01)

## Today
- **Transposition control:** the Options drawer can transpose by ±12 semitones. Verovio does the work, given a semitone count (`transpose: "3"`), and Verovio picks the spelling. Notes, key signatures and `<harm>` chord symbols all move together, and playback transposes once.
- **Verovio's spelling controls:**
  - it accepts an interval with a quality (`+A4` vs `+d5`), which controls the spelling;
  - or a target key (`"f#"`, `"gb"`), which also chooses the direction, as the nearest octave.
- **Percussion:**
  - **Handled:** MusicXML, MEI and MIDI drum parts get a real percussion clef. MusicXML unpitched notes are placed by staff position, so Verovio's transpose leaves them alone, and playback skips transposition for percussion.
  - **Gap:** ABC and MIDI drum parts are written as pitched notes on a percussion clef, so a transpose would move the noteheads.
  - **Gap:** the transposed key signature is also drawn on percussion staves.

## Goals
1. **Header control:** global transpose up and down by semitone, in the header, using the existing tier registry. The drawer controls stay, and the transpose is saved per score (score DB).
2. **Key flip:** swap the current key for its enharmonic equivalent (Gb ↔ F#, Db ↔ C#, B ↔ Cb, …), applied to all pitched parts. It is saved per score.
3. **Spelling policy:** applied to the key signature, notes and chord symbols, after transposition and after the key flip.
4. **Instrument preferences:** per-instrument sharp/flat key preferences, mainly for strings and guitars.
5. **Percussion:** never transposed or given a key signature, in any format.

## Spelling policy
### Key choice by pitch class (major key, or the relative major of a minor key)
| Pitch class | Default | Alternative | Rule |
| --- | --- | --- | --- |
| 0 | C | — | |
| 1 | **Db** | C# | Prefer Db |
| 2 | D | — | |
| 3 | **Eb** | (D#) | D# is never used |
| 4 | E | (Fb) | |
| 5 | F | (E#) | E# is always F |
| 6 | **F#** | Gb | Prefer F#; Gb on flip |
| 7 | G | — | |
| 8 | **Ab** | (G#) | Always Ab, for every instrument (G# is never offered) |
| 9 | A | — | |
| 10 | **Bb** | (A#) | A# is never used |
| 11 | B | Cb | B by default; Cb only by explicit flip |
- **Minor keys** follow their relative major's signature. For example, Eb minor (6 flats) and D# minor (6 sharps) tie; the tie is broken by the major-key preference for the relative major (F#, so D# minor).
- **Flip** offers only spellings with at most 7 accidentals. A key in parentheses is never offered.

### Notes inside a key
- **Flat keys** spell accidentals with flats and naturals only, and **sharp keys** with sharps and naturals only. *Exception: see open question 1.*
- **E# becomes F and B# becomes C** everywhere.
- **Fb and Cb are avoided:** they become E and B, except where they are a passing note in a flat key whose neighbours make the flat spelling read better. The suggested rule: a note one diatonic step from both neighbours, in a key with 6 or more flats. *See open question 2.*
- **Double sharps and double flats are always respelled** to the nearest single accidental or natural, unless the source wrote them and the transposition is 0.
- **Chord symbols** follow the same key-relative spelling. Slash bass notes do too.

### Implementation options
- **A (recommended first):** choose the target key from the table and pass Verovio an interval with the right quality, e.g. C→F# is `+A4` and C→Gb is `+d5`. Verovio then spells relative to the key, keeping the source's diatonic relationships. A small pass inside the worker's view MEI then applies the overrides Verovio won't do:
  - E#→F and B#→C;
  - Fb/Cb away from passing notes;
  - double accidentals;
  - flats-only or sharps-only per key (adjusting `@accid` and `@accid.ges`).
  - It also re-checks that accidentals display correctly within each measure.
- **B:** our own MEI transposer, without Verovio's transpose. This gives full control but duplicates Verovio's pitch, key and chord-symbol logic. Choose it only if A can't meet the policy.
- **Playback and highlights:** spelling never changes sounding pitch, so they are unaffected. Note names from `scoreForView` must use the same speller, so labels match the noteheads (one shared `spellPitch(midi, key, context)` module).

## Instrument preferences (decided)
- **Strings and guitar/bass are sharp-leaning,** and only pitch class 1 differs from the default: those parts use **C#** where others use Db.
  - **F#** is already the default for everyone.
  - **Ab** stays Ab for everyone; G# is never used.
  - Everything else follows the default table.
- **Applies per part in the written (transposing) view.** In the concert view one global key applies (the default table).
- **Transposing instruments:** written key = concert key + the instrument's interval, then the same table and profile (e.g. concert Db gives B♭ trumpet Eb).
- **Registry:** a typed `INSTRUMENT_SPELLING` next to the GM manifest, keyed by instrument family, so families can be adjusted later.

## Percussion fixes
- **Unpitched in every format:** ABC and MIDI drum parts become unpitched notes in the generated MEI (placed by staff position, with a GM drum map), so they're never transposed.
- **Key signatures:** percussion staves never show one. The MEI view removes key signatures and key changes from percussion staffDefs. The tests check this for all formats under transpose and flip.

## UI
- **Header:** a transpose group with − / readout (e.g. "+2 · D") / +, as a secondary tier, and a flip button (⇄ "F# ↔ Gb") that is disabled when the key has no enharmonic equivalent.
- **Drawer:** the Pitch panel keeps the full controls plus the written/concert toggle.
- **Accessibility:** labels such as "Transpose up a semitone" and "Spell in G flat major".

## Validation
- **Speller tests:** a table-driven test covering each pitch class, major and minor, flip, the flat-key and sharp-key rules, E#/B#/Fb/Cb, double accidentals and chord-symbol roots and basses.
- **Engraving tests:** for fixtures transposed by −12 to +12, every rendered key signature follows the table, no note outside the allowed spellings appears, and percussion stays unchanged. Labels must match the noteheads.
- **Playback:** sounding pitches are identical before and after a flip.

## Decisions
1. **Minor keys:** the raised 6th and 7th of minor keys are exempt from the flats-only rule (C# in D minor). Chromatic notes that resolve upward keep the source's spelling.
2. **Fb and Cb:** allowed only in keys with 6 or more flats, as a stepwise passing note between neighbours. Elsewhere they become E and B.
3. **Instruments:** see Instrument preferences above. Pitch class 8 is always Ab.
4. **Header:** transpose ± and the key flip are secondary-tier controls (inline on desktop, inside More on mobile).

## Sequencing
- **Can start now:** the speller module (`src/lib/spelling.ts`, pure and table-tested) and the percussion fixes.
- **After the large-score Phase 3 PR merges:** wiring into the worker's view MEI and the header, because both change the worker's transpose and load options.
