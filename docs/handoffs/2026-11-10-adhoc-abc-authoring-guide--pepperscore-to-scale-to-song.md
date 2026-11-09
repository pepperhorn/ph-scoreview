# Handoff: adhoc — ABC authoring guide for PepperScore (pepperscore lead → scale-to-song lead)

- **Date:** 2026-11-10
- **Type:** human (cross-project notice; reply to the issue report `2026-11-09-adhoc-abc-import-fidelity--scale-to-song-to-lead.md`)
- **Ledger (pepperscore repo):** 0004 closed; 0005, 0006 closed; follow-ups 0007, 0008 in flight
- **Status:** open

## Goal
Scale-to-song can send ABC to `<PepperScore abc={…}>` and get the same engraving and playback as MusicXML for its practice pieces, provided the ABC follows the authoring guide. Decide whether to switch display back from MusicXML to ABC, and update your ABC generator to follow the guide.

## What changed in PepperScore (all on `main` of pepperhorn/ph-scoreview)
All 8 findings from your report are fixed (PRs #60, #61, #62, #63):
accidentals per bar (incl. ties), mid-tune and mid-bar `K:` changes, `"^text"` separate from `"C7"` chord symbols, `|]`/`||` barlines, octave/alto/tenor clefs, `%%score {RH | LH}` grand staff, `V: transpose=` and `%%MIDI transpose|program|channel` per voice. Every case in your spike (`cases/a…g`) now renders and plays like its MusicXML equivalent, except `d3-sax-score` (`score=` is not supported; use `transpose=`).

## What you need to do
1. Generate ABC per the guide: **`/home/shaun/ph-vexflow-view/docs/guides/abc-authoring.md`** (GitHub: `pepperhorn/ph-scoreview` → `docs/guides/abc-authoring.md`). It's a living ledger: rules, templates for single melody / transposing instrument / piano grand staff / guitar, known limits, and a dated change log. Check its change log before each scale-to-song release.
2. Key rules (snapshot; the guide wins if they differ):
   - One tune per string, `X:1` first; `K:` last in the header.
   - Declare each voice with `V:<id> name="…" clef=…`; put its `%%MIDI program N` (zero-based GM) right after the `V:` line.
   - Transposing instruments: write notes as the player reads them, add `transpose=<written→sounding semitones>` (alto sax -9, B♭ trumpet/clarinet -2). Don't also set `settings.instrument` for the same transposition.
   - Guitar: `clef=treble-8` and note letters at **sounding** pitch (`G,` = sounding G3, drawn G4); no extra `transpose=-12`.
   - Piano: `%%score {RH | LH}` **before** the two `V:` lines.
   - Correction 2026-11-10: an earlier copy of this snapshot and the guide had the piano and guitar templates wrong; use the guide's current templates.
   - Chord symbols `"C7"`; text `"^Swing"` / `"_rit."`. End with `|]`.
3. Requires a PepperScore build that includes PR #63 (main at or after `c48dc0e`); no npm release with these fixes yet.

## Open questions (for scale-to-song)
- Do you want PepperScore to support `score=` (abcm2ps-style) or anything else your generator emits? Reply with a handoff to the pepperscore lead.

---
## Receiver ack
