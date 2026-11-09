# 0004 — ABC import parity with MusicXML

- **Status:** approved
- **Ledger:** 0004 · **Plan:** ../plans/0004-abc-import-parity.md
- **Author:** lead · **Date:** 2026-11-09

## Problem
`<PepperScore abc={…}>` engraves simple practice pieces less faithfully than the same music as MusicXML: missing accidentals, ignored key changes, no grand-staff brace, annotations replacing chord symbols, plain final barlines, lost octave/C clefs, and no way to state a transposing instrument or MIDI sound in the ABC. Full problem statement, repro files and evidence: [`../handoffs/2026-11-09-adhoc-abc-import-fidelity--scale-to-song-to-lead.md`](../handoffs/2026-11-09-adhoc-abc-import-fidelity--scale-to-song-to-lead.md) (findings 1–8). Repro cases: `../handoffs/assets/2026-11-09-abc-import-spike/`.

## Goals
Fix findings 1–8 on the ABC path so every case in the spike's `cases/` renders and plays like its MusicXML equivalent.

## Decisions (lead + human, 2026-11-09)
- **Route:** extend the existing path (abcjs `parseOnly` → reduced `Score` in `import.ts` → `scoreToMei` in `notation/document.ts`). No ABC→MusicXML converter. The reduced model already has `Pitch.accidental`, `Measure.key`/`clef`/`transposition`, `Part.gmProgram`/`transposition`/`sourcePartId`; mostly they need filling in and emitting.
- **Transposition:** honour both `transpose=` on `V:` and `%%MIDI transpose N`, as written→sounding semitones. If both are present for a voice, `V: transpose=` wins. The display stays as written; only playback (and the concert-pitch view) moves. `%%MIDI program N` (0-based GM) sets the sound; `%%MIDI channel 10` means drums. Otherwise fall back to the voice name.
- **Grand staff:** voices braced in `%%score {A | B}` become one source part with two staves, modelled the way MusicXML multi-staff parts already are (two `Part`s sharing `sourcePartId`, ids `<pid>-1`/`<pid>-2`), with one name and `<staffGrp symbol="brace">` in MEI.

## Non-goals
The MusicXML/MEI paths; abcjs itself; lyrics, decorations, tuplet engraving, multi-tune files.

## Constraints
- Keep the `settings.instrument` workaround working (finding 6).
- Don't regress the handoff's "already works" list (chord kinds, dyads, ties, dots, rests, `Q:`, beams from abcjs `startBeam`/`endBeam`, E♯ in F♯, C♭ in G♭).
- MEI ids from `generatedPitchId` must stay stable (playback highlighting and editor identity depend on them).

## Acceptance criteria
- [ ] AC1 — `g-accidentals`, `c-cello`, `f-chords` draw every ♯ ♭ ♮ the ABC implies, with per-bar accidental rules (finding 1).
- [ ] AC2 — `b-spelling`: the `K:Gb` section plays and draws G♭-major pitches with a new key signature; E♯ in F♯ and C♭ in G♭ keep their spelling (finding 2).
- [ ] AC3 — `a-piano-grand`: "Swing" is text (MEI `<dir>`), C7 is the chord symbol in bar 1 (finding 4).
- [ ] AC4 — `|]` gives a light-heavy final barline (`right="end"`), `||` gives `right="dbl"` (finding 5).
- [ ] AC5 — `e-guitar` shows treble clef with 8 below and sounds G3; `treble+8`, `bass-8`, alto and tenor clefs survive to MEI (finding 7).
- [ ] AC6 — `a-piano-grand` is one braced grand-staff part, one name, no "Melody" label (finding 3).
- [ ] AC7 — `d2-sax-transpose` shows written A major and sounds concert C4 like `xml/d-alto-sax.musicxml`; `%%MIDI transpose` works too; `%%MIDI program` picks the sound; `%%MIDI channel 10` gives drums (findings 6, 8).
- [ ] AC8 — The "already works" list still passes; `settings.instrument` still transposes.
- [ ] AC9 — `packages/pepperscore/README.md` documents the honoured ABC headers (`transpose=`, `%%MIDI transpose|program|channel`, `%%score` grouping, precedence).
- [ ] AC10 — vitest unit tests parse every spike case with `parseAbc` and assert the model and the `scoreToMei` output.

## Open questions
None.
