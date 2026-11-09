# Handoff: adhoc — ABC import fidelity gaps found by the scale-to-song spike (scale-to-song lead → pepperscore lead)

- **Date:** 2026-11-09
- **Type:** dispatch (an issue report for the lead to triage into the ledger)
- **Ledger:** none yet (`adhoc`). The lead should assign an ID if it takes this on.
- **Spec / plan:** none yet. This document is the problem statement.
- **Branch / worktree / PR:** none
- **Base commit:** `54df48c` (main)
- **Status:** open

## Goal

Make `<PepperScore abc={…}>` engrave and play these simple, single-key
practice pieces as faithfully as the same music written in MusicXML:

- piano grand staff
- one-staff melody instruments
- transposing instruments
- chord symbols and dyads

That means:

- correct visible accidentals
- correct pitches after a key change
- a grand-staff brace
- the final barline
- text kept separate from chord symbols
- a way to state a transposing instrument and its sound from inside the
  ABC

"Done" means every case under
`docs/handoffs/assets/2026-11-09-abc-import-spike/cases/` renders and
plays the same as its MusicXML equivalent, apart from the known limits
listed under Scope.

## Context you need

- **Who found this.** A separate project, scale-to-song
  (`~/.t3/projects/scale-to-song`), generates practice melodies for
  PepperScore. Its design is at
  `docs/superpowers/specs/2026-11-09-scale-to-song-design.md` in that
  repo. We tested ABC as a compact share format and display source.
  Because of the problems below, scale-to-song **uses MusicXML for
  display and is not blocked**. This is a quality fix for PepperScore's
  ABC path, not an urgent one.
- **The ABC path:**
  `packages/pepperscore/src/lib/import.ts` `parseAbc` runs abcjs
  `parseOnly`, then builds PepperScore's reduced `Score`, then
  `notation/document.ts` `scoreToMei` produces MEI for Verovio.
  MusicXML goes to Verovio directly, which is why it passes all the same
  cases.
- **Fidelity review:** `docs/musicxml-fidelity-review.md`. Item 1 already
  notes that the ABC path is the reduced model.
- **Repro files** (committed with this handoff) are in
  `docs/handoffs/assets/2026-11-09-abc-import-spike/`:
  - `cases/*.abc`: one file per case, cases a–g.
  - `xml/*.musicxml`: MusicXML equivalents of a, d and e, used as the
    reference.
  - `shots/*.png`: Verovio screenshots from the spike. A file named
    `…_instrument_X.png` was taken with `settings.instrument = X`.
- **Spike harness:** vitest parse and playback scripts plus a Vite page.
  It is in the scale-to-song session scratchpad
  (`/tmp/claude-1000/-home-shaun--t3-projects-scale-to-song/…/scratchpad/abc-spike/`).
  It's ephemeral; don't depend on it. The findings below are
  self-contained.

## Findings (most severe first)

| # | Problem | Repro | Evidence | Expected |
|---|---|---|---|---|
| 1 | **No visible accidentals outside the key signature on non-transposed parts.** Pitches and playback are right, but the engraving shows ♯F as plain F, C♯ in D minor as C, G♯ in Caug as G. Teaching-critical. | `cases/g-accidentals.abc`, `cases/c-cello.abc`, `cases/f-chords.abc` (`Caug` bar) | `import.ts` never sets `pitch.accidental` for ABC notes. `document.ts:141-147` (`meiPitch`) then writes only `accid.ges` and no written `accid`. With `settings.instrument` set to a transposing instrument the accidentals reappear (`shots/g-accidentals.abc_instrument_alto-saxophone.png`), so the transposed path sets them. | Each written accidental is drawn, with courtesy rules per bar: abcjs exposes `accidental` on each pitch, so pass it through. Natural signs where `=` is used or needed. |
| 2 | **A key change partway through is ignored**, so pitches are wrong. After `K:Gb` the passage is still read in F♯ (6 sharps): G♭ A♭ B♭ C♭ are drawn and played as G♯ A♯ B♯/C… | `cases/b-spelling.abc` (F♯ then `K:Gb`). Control: `cases/b2-gb.abc` (G♭ only, renders correctly, C♭ kept) | `import.ts:182-183` reads a single global key from `tune.getKeySignature()`. There is no per-measure key in the reduced model or in `scoreToMei`. | Per-measure key signatures: pitches follow the active key, and the new key signature is drawn. |
| 3 | **No grand-staff grouping.** `%%score {RH \| LH}` gives two separate parts with no brace. The left hand is labelled "Melody" unless it is named. | `cases/a-piano-grand.abc` vs `xml/a-piano-grand.musicxml` (`shots/a-piano-grand.*.png`) | `document.ts:205`: `staffDefs` is a flat list with no `<staffGrp symbol="brace">`. `import.ts:186-191`: the part naming falls back to `'Melody'`. | Braced voices from `%%score {…}` become one grand-staff part (two staves, one name), as MusicXML `<staves>2` does. |
| 4 | **A text annotation hijacks the chord symbol.** `"^Swing""C7"c` shows "Swing" as the chord symbol and drops C7. With the text placed after the chord, the text is silently dropped. | `cases/a-piano-grand.abc`, bar 1 | `import.ts:267`: `chordSymbol` = the first `item.chord` entry with `position !== 'below'`. abcjs marks `^…` annotations `position: 'above'` and real chord symbols `position: 'default'`. | Only `position === 'default'` entries are chord symbols. `^ _ < > @` annotations become text directions (MEI `<dir>`). |
| 5 | **The final barline `\|]` is drawn as a single barline.** | any case (all end with `\|]`) | `document.ts:250-254`: the measure `right` attribute only handles repeats. | `\|]` gives `right="end"`, `\|\|` gives `right="dbl"`. |
| 6 | **No way to state a transposing instrument in ABC.** `V: transpose=-9`, `%%MIDI transpose -9`, `score=` and `%%MIDI program 65` are all ignored. Written A4 plays as A4 instead of concert C4. | `cases/d1-sax-name.abc`, `d2-sax-transpose.abc`, `d3-sax-score.abc` vs `xml/d-alto-sax.musicxml` (plays C4) | `import.ts:191`: the instrument comes only from `instrumentForName(name)`, and transposition is never read. Workaround: write the ABC at concert pitch and set `settings.instrument: 'alto-saxophone'`. That works (`shots/…_instrument_alto-saxophone.png`) but the ABC text alone can't express it. | Honour `transpose=` on `V:`, and/or `%%MIDI transpose`, as written-to-sounding semitones, and `%%MIDI program N` for the sound. The written display stays as written. |
| 7 | **Octave clefs are lost.** `clef=treble-8` becomes a plain treble clef, and the notes are drawn at sounding pitch below the staff. Playback octave is right (G3). With `settings.instrument: 'guitar'` the display is transposed up, but there is still no "8" under the clef. | `cases/e-guitar.abc` vs `xml/e-guitar.musicxml` (`shots/e-guitar.*.png`) | `import.ts:189`: the clef is reduced to treble, bass or percussion. abcjs's clef `verticalPos`/octave is dropped, and so are the alto and tenor clefs. | Keep `treble-8`, `treble+8`, `bass-8`, alto and tenor through to MEI `clef.dis`/`clef.dis.place` and `clef.shape`/`clef.line`. |
| 8 | **The sound comes only from the voice name.** `%%MIDI program` is ignored, and an unnamed voice is piano. | all cases | `import.ts:191` | Use `%%MIDI program` (and `%%MIDI channel 10` for drums) when present; fall back to the name. |

**What already works on the ABC path** (don't regress it):

- Chord-symbol kinds 7, maj7, m7, m7b5 (abcjs shows ♭5), dim7, aug,
  sus4, 6 and slash chords (C/E).
- Dyads come through as one note with 2 pitches and one stem.
- Ties, dotted notes, rests and `Q:` tempo.
- Beams, where the source notes are written adjacent.
- E♯ in F♯ major, and C♭ in G♭ major when set as the only key.

## Scope

- **In:** findings 1–8 on the ABC import path (`parseAbc` and the
  `scoreToMei` adapter), with tests.
- **Out:**
  - The MusicXML path, which passes these cases.
  - abcjs itself.
  - Lyrics, decorations, tuplet engraving (already covered by the
    fidelity review) and multi-tune files.
- **Files you own:** the lead decides. Probably `packages/pepperscore/src/lib/import.ts`, `packages/pepperscore/src/lib/notation/document.ts`, the reduced `Score` types if per-measure key or clef is added, and new tests.
- **Do not touch:** `docs/handoffs/assets/2026-11-09-abc-import-spike/`.
  Those are reference fixtures; copy them into test fixtures if needed.

## Acceptance criteria

- [ ] `g-accidentals`, `c-cello` and `f-chords` draw every ♯, ♭ and ♮
      that ABC notation implies, following the per-bar accidental rules.
- [ ] In `b-spelling`, the `K:Gb` section plays and draws G♭ major
      pitches and shows a new key signature. E♯ in F♯ and C♭ in G♭ keep
      their spelling.
- [ ] `a-piano-grand` renders as one braced grand-staff part with no
      "Melody" label. "Swing" appears as text and C7 as the chord symbol
      in bar 1. The final barline is light-heavy.
- [ ] `d2-sax-transpose` (or `transpose=`/`%%MIDI transpose`, whichever
      is chosen and documented) shows written A major and sounds concert
      C4, matching `xml/d-alto-sax.musicxml`. `%%MIDI program` selects
      the sound.
- [ ] `e-guitar` shows a treble clef with an "8" below and sounds G3,
      matching `xml/e-guitar.musicxml`.
- [ ] Everything in the "already works" list still passes.
- [ ] The README's ABC section documents which ABC headers are honoured
      (transpose, MIDI program, `%%score` grouping).

## Verify with

```bash
cd ~/ph-vexflow-view
npm test --workspace pepperscore     # or the package's vitest command; add tests that parse each case with parseAbc
npm run dev --workspace pepperscore-reader -- --host 0.0.0.0   # then open each case in the reader and compare to shots/
```

Suggested test shape: for each case, run `parseAbc`, then assert parts,
clefs, key per measure, per-pitch `accidental`/`alter`, `chordSymbol` and
instrument/transposition. Run `scoreToMei` and assert the presence of
`accid=`, `staffGrp symbol="brace"`, `right="end"`, `<dir>` and
`clef.dis`.

## Known gotchas / decisions already made

- **Scale-to-song will not depend on this.** It writes MusicXML for
  display and keeps its own link format. There's no deadline from that
  side.
- **The `settings.instrument` workaround** (finding 6) exists and works.
  Any fix must keep it working.
- **GBrain:** `projects/scoreflow-music-reader` has earlier ABC notes
  ("ABC beam and bar fit correction — 2026-09-26": beams come from abcjs
  `startBeam`/`endBeam`). Read it before touching beam or bar-fit code.

## Open questions

1. Should the ABC path aim for parity with MusicXML for these features,
   or should PepperScore convert ABC to MusicXML (for example
   abcjs → MusicXML) and drop the reduced-model-to-MEI adapter for ABC?
   That is the lead's call. It decides the size of this work.
2. For transposition, which ABC convention should be the primary one:
   `transpose=` on `V:` (abc 2.1 / abcm2ps) or `%%MIDI transpose`
   (abc2midi)? Supporting both is cheap; say which wins if both appear.

---
## Receiver ack
<!-- Implementer fills this in FIRST and commits it on its branch (reviewers acknowledge in their PR comment instead): a restatement of the goal in their own words, plus any questions. "Blocked: <q>" is a valid ack. -->

---
## Return (implementer → lead; fill in when done, or in a separate …-to-lead.md)
- **Outcome:** done | partial | blocked
- **PR:** <url>
- **Commits:** <sha range>
- **What changed:**
- **Verification output:** <paste tail>
- **Decisions made:**
- **Out-of-scope issues found:**
- **Follow-ups:**
- **For GBrain (lead to promote):**
