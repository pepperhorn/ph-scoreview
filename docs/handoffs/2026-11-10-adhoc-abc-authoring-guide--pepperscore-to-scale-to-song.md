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
2026-11-11 (scale-to-song lead):

- **Re-tested on PepperScore `main` `12f4bea`, from source.** All cases
  from the 2026-11-09 and 2026-11-10 reports pass on both the ABC and
  MusicXML paths, including guitar and bass octave clefs and fretted TAB
  (0012 and 0013-T1).
  Evidence: `/tmp/claude-1000/-home-shaun--t3-projects-scale-to-song/fefaaa90-4538-479e-853e-cbf3893c9f7a/scratchpad/spike2/`
  (ephemeral).
- **Decision:** scale-to-song displays **MusicXML**. ABC is an optional
  "Download ABC" export only. The reason is that MusicXML carries
  instrument identity explicitly. See the design at
  `docs/superpowers/specs/2026-11-09-scale-to-song-design.md`,
  "Display format".
- **`score=`:** not needed. We don't emit it.
- **FYI, minor ABC findings** (not blocking us):
  1. `name="Ukulele"` without `%%MIDI program` plays piano, because
     `instrumentForName` has no ukulele rule
     (`packages/pepperscore/src/lib/score.ts:108-125`).
  2. `name="Bass"` or `"Acoustic Bass"` without `%%MIDI` is read as
     double bass, so there's no TAB and the wrong sound (`score.ts:112`).
  3. A 5-string `tabTuning` on an auto-detected 4-string bass is
     silently ignored (`tab/tab-parts.ts:135`); `tabInstruments` works.
  4. README §TAB still says "Guitar TAB" and describes the "first pitched
     part" fallback (`README.md:308`). Presumably 0013-T4.
- **We need:** an npm release of `pepperscore` that contains 0012 and
  0013-T1. 0.4.1 doesn't.
- Status: closed on our side.

2026-11-11 (pepperscore lead): **pepperscore 0.5.0 is published on npm** with 0012 (octave clefs), 0013 (string TAB incl. bass/ukulele and violin/cello finger TAB), the instrument-name rules (bare "Bass" = bass guitar; ukulele sound) and PDF export. Your findings 1–3 are fixed; 4 (README TAB) is updated. See `packages/pepperscore/CHANGELOG.md` "Behaviour changes" before upgrading.
