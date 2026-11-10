# ABC authoring guide for apps that send ABC to PepperScore

> **Audience:** apps that generate ABC for `<PepperScore abc={…}>` (first: scale-to-song). **Owner:** the lead, on `main`. This is a living ledger: every change to the ABC import path updates the "Rules" and adds a line to the "Change log" at the bottom. **Published reference for npm users:** the package README's ABC section (`packages/pepperscore/README.md`), which carries the same checklist, rules and templates. Keep both in step: rule changes land in the README via a PR; this guide records them in the Change log. Background: [spec 0004](../specs/0004-abc-import-parity.md).

## Quick checklist

1. One tune per string. Start with `X:1`. Only the first tune is imported.
2. Header order: `X:` → `T:` → `C:` → `M:` → `L:` → `Q:` → `%%score`/`%%staves` (if grouping) → `V:` lines (with their `%%MIDI` lines right after each) → `K:` last. `%%score` must come **before** the `V:` lines it groups.
3. Keep `K:` after `X:` (a file-level `K:` before `X:` is tolerated but has no effect on voices).
4. Declare every voice with `V:<id> name="…" clef=…` (preferably in the tune header; body-only declarations also work), even a single voice, if you need a specific instrument, clef or transposition. `V:` lines before `X:` also work as file-wide defaults, but prefer the tune header.
5. Put `%%MIDI program|channel|transpose` **directly after the `V:` line it belongs to**. A `%%MIDI` line before any `V:` is a default for every voice.
6. Transposing instruments: write the notes **as the player reads them** and add `transpose=<semitones written→sounding>` on the `V:` line.
7. End the piece with `|]`.
8. Chord symbols in plain quotes (`"C7"`); text in quotes with a position prefix (`"^Swing"`, `"_rit."`).

## Rules

### Tune and header
- Only the first tune (`X:` to the next `X:`) is read. Before the first `X:`, only `%%MIDI` and `V:` lines apply (as defaults); `M:`, `L:`, `Q:`, `C:` there are ignored, so put them after `X:`. A `K:` there doesn't end the tune header; the tune's own first `K:` does. A `V:` line before `X:` supplies defaults (clef, name, transposition) for that voice; a tune-header `V:` for the same id overrides each property it sets. If the body has music before any `[V:…]` selector, it goes to the first declared voice — which may be a file-header voice — so select voices explicitly in the body.
- Honoured: `T:` title, `C:` composer, `M:` meter, `L:` default length, `Q:` tempo, `K:` key (with `m`/`min` for minor).

### Keys and accidentals
- Change key mid-tune with a `K:` line or inline `[K:Gb]`, including mid-bar. The new signature is drawn where it occurs.
- Write accidentals normally (`^F`, `_B`, `=F`). Per-bar rules apply: an accidental carries to later notes of the same pitch in that bar, and a tie (`^F- | F`) carries it into the next bar.
- Spelling is kept as written: `^E` in F♯ major and `_C` in G♭ major stay E♯ and C♭.

### Clefs
- `clef=treble|bass|alto|tenor|treble-8|treble+8|bass-8|perc` on `V:` (or `K:`).
- Octave clefs: ABC note letters are the **sounding** pitch (ABC 2.1); the clef draws them an octave higher (`treble-8`, `bass-8`) or lower (`treble+8`). Guitar: `clef=treble-8`, and `G,` sounds G3 and is drawn as G4 on the second line; generated TAB uses the sounding pitch (`G,` = open G string). Don't add `transpose=-12`; the clef already does it. An explicit `transpose=` (instrument interval) still applies on top.

### Instruments and sound
- `name="…"` selects the instrument from its name (e.g. "Flute", "Cello", "Alto Saxophone") when no `%%MIDI program` is given. A name never implies transposition.
- `%%MIDI program N`: **zero-based** GM number (0–127), e.g. 0 piano, 40 violin, 42 cello, 65 alto sax, 73 flute.
- `%%MIDI channel 10` or a voice named like "Drums": unpitched percussion. Use `clef=perc`.
- Body-only voices: a `%%MIDI` line after `[V:id]` / `V:id` in the body applies to that voice. One before any voice selector applies to the first voice, unless notes or a barline come before every selector: then it belongs to that implicit default voice and later voices don't inherit it. Safest: put each `%%MIDI` line right after its voice's `V:` line.

### Transposing instruments
- `V:sax name="Alto Saxophone" transpose=-9` → written A4 sounds C4. Values are written→sounding semitones: B♭ clarinet/trumpet -2, tenor sax -14, alto sax -9, horn in F -7, baritone sax -21.
- `transpose=` wins over `%%MIDI transpose`. Prefer `transpose=`.
- `score=` is **not** supported; don't use it.
- The written key goes in `K:`: for alto sax in concert C, write `K:A`.
- Don't send concert-pitch ABC *and* `transpose=`; pick written pitch + `transpose=`. (Alternative: concert-pitch ABC with no `transpose=`, and the host sets `settings.instrument`.)

### Grand staff (piano, harp, organ)
- Group the voices with braces, `%%score {RH | LH}`, **before** declaring them, then declare both voices. They become one part with one name and a brace. Name the first voice (`name="Piano"`); the second inherits the instrument.
- Without braces, voices stay separate parts.

### Chord symbols, text and dyads
- `"C7"`, `"Am7b5"`, `"C/E"`: chord symbols (default position).
- `"^Swing"` above, `"_rit."` below: text, never a chord symbol. You can put text and a chord on the same note: `"^Swing""C7"c`.
- Dyads/chords: `[CE]` gives one stem with two pitches.

### Barlines
- `|]` final barline, `||` double barline, `|:` `:|` `::` repeats, `[1` `[2` endings.

## Templates

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

## Known limits (don't rely on these)
- Lyrics, decorations, tuplet engraving, multi-tune files: outside the parity guarantee.
- `score=` on `V:` is ignored.
- `M:`, `L:`, `Q:`, `C:` before `X:` are ignored (ABC 2.1 file-header defaults aren't applied).
- Saved per-part reader settings reset for piano ABC scores first shown before 2026-11-10 (grand-staff regrouping).

## Change log
<!-- Newest first: YYYY-MM-DD — ledger item / PR — what changed for ABC authors -->
- 2026-11-10 — 0012 / PR #75 — octave clefs now draw at the right octave (guitar `G,` on the second line) and generated TAB uses sounding pitch; the instrument switch keeps the "8". Known limit removed.
- 2026-11-10 — known limit added (scale-to-song report) — octave clefs draw an octave high; fix tracked as 0012.
- 2026-11-10 — 0008 / PR #67 — `V:` lines before `X:` now keep clef, name and transposition as defaults (tune-header `V:` overrides per property); `%%score`/`%%staves` grouping is kept.
- 2026-11-10 — 0007 / PR #64 — the npm package README now carries the full ABC authoring rules and templates (no behaviour change).
- 2026-11-10 — guide correction (found by 0007) — `%%score` must precede the `V:` lines it groups (the earlier piano template didn't group); octave-clef notes are written at sounding pitch (guitar template now `G, A, B, C`); tenor sax is -14. No code change.
- 2026-11-10 — 0006 / PR #62 — `%%MIDI` works with voices declared only in the body; a file-level `K:` before `X:` no longer breaks tune-header `V:` lines.
- 2026-11-10 — 0004-t2 / PR #61 — `%%score {…}` grand staff; `V: transpose=`, `%%MIDI transpose|program|channel` per voice; drums by channel 10 or name; only the first tune is read.
- 2026-11-10 — 0004-t1 / PR #60 — accidentals drawn per bar (incl. ties); mid-tune and mid-bar key changes; `^`/`_` text separate from chord symbols; `|]` and `||` drawn; octave, alto and tenor clefs.
