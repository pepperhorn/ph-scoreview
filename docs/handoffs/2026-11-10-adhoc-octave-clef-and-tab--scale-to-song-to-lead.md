# Handoff: adhoc — octave-clef display and generated TAB (scale-to-song lead → pepperscore lead)

- **Date:** 2026-11-10
- **Type:** dispatch (an issue report for the lead to triage into the ledger)
- **Ledger:** 0012 (octave-clef display: #1, #2, #4) and 0013 (stringed-instrument TAB: #6–#8)
- **Spec / plan:** none yet. This document is the problem statement.
- **Branch / worktree / PR:** none
- **Base commit:** `4b57e63` (main)
- **Status:** acked
- **Follows:** `docs/handoffs/2026-11-09-adhoc-abc-import-fidelity--scale-to-song-to-lead.md`. Everything in that report re-tested OK on 2026-11-10 (main `1a903eb`), **except** the octave-clef item, which is still wrong and is detailed here.

## Goal

Make octave-clef instruments (guitar and bass guitar) look and play right
on both import paths:

- the notes sit where a player reads them (guitar G3 on the 2nd line of
  the treble-8 staff);
- playback is at sounding pitch;
- generated TAB uses sounding pitch.

Also decide which parts should get generated TAB.

"Done" means every file in
`docs/handoffs/assets/2026-11-10-octave-clef-tab/cases/` matches the
"expected" column below, in notation, TAB and playback.

## Context you need

- **Who found this.** scale-to-song (`~/.t3/projects/scale-to-song`) will
  send generated MusicXML with guitar and bass parts and wants to offer
  the Notation / TAB / Both switch for them. These findings come from a
  spike using a Vite page that renders PepperScore **from source**: the
  `runtimeFilesDev` plugin plus aliases to `packages/pepperscore/src`, on
  main `1a903eb`.
- **Code:**
  - TAB: `packages/pepperscore/src/lib/tab/` (`tab-parts.ts`,
    `fret-assign.ts`).
  - ABC import: `src/lib/import.ts` `parseAbc`.
  - ABC → MEI: `src/lib/notation/document.ts` `scoreToMei` /
    `meiPitch`.
  - MusicXML: goes to Verovio directly.
  - README sections "Guitar TAB" and "ABC headers".
  - `docs/guides/abc-authoring.md` "Clefs".
- **Repro files** (committed with this handoff) are in
  `docs/handoffs/assets/2026-11-10-octave-clef-tab/`:

  | File | Contents |
  |---|---|
  | `cases/e-guitar.abc` | `V:1 clef=treble-8 name="Guitar"`, `K:G`, `G,A, B,C DE FG \| "G"[G,B,D]4 "D"[F,A,D]4 \|]` (sounding G3 to G4, then G and D chords) |
  | `cases/e-guitar.musicxml` | The same music in the **standard** guitar encoding: written pitch (G4…) plus `<clef-octave-change>-1` plus `<transpose><octave-change>-1</octave-change>` |
  | `cases/e2-guitar-sounding.musicxml` | The same music at **sounding** pitch (G3…) with `<clef-octave-change>-1` and **no** `<transpose>` |
  | `cases/h-bass-sounding.musicxml` | Bass guitar (GM 34) at sounding pitch (C2–A2, G1–F2), F clef with `<clef-octave-change>-1`, no `<transpose>`, chord symbols C and G7 |

  `shots/*.png` are screenshots from the spike. A `tab-…-both` file was
  taken with `settings.tabView: 'both'`; `-tuned` adds
  `tabTuning: [28,33,38,43]`.

## Findings

| # | Case | Notation | Playback | Generated TAB | Expected |
|---|---|---|---|---|---|
| 1 | `e-guitar.abc` | ❌ **An octave high.** The 8va-bassa treble clef is drawn, but G3 appears on the G5 position, above the staff, with the run up to G6 on 3 ledger lines (`shots/e-guitar.abc.png`). | ✅ G3 | ❌ **An octave high:** frets 12-14 / 12-13-15 / 12-14-15 instead of 0-2 / 0-5 / 3-0-2-3. The chord is 12/12/10 (`shots/tab-e-guitar.abc-both.png`). | G3 on the 2nd line, TAB 0-2… |
| 2 | `e-guitar.musicxml` (standard encoding) | ❌ **An octave high**, same as #1 (`shots/e-guitar.musicxml.png`) | ✅ G3 | ✅ 0-2, 0-5, 3, 0-2-3. Chords 5/4/3 and 4/2/3 (`shots/tab-e-guitar.musicxml-both.png`). | Notation on the 2nd line |
| 3 | `e2-guitar-sounding.musicxml` | ✅ G3 on the 2nd line with the "8" clef | ✅ G3 | ✅ same frets as #2 | (reference: this is right) |
| 4 | `e-guitar.abc` with `settings.instrument: 'guitar'` | ⚠️ Notes in the right place, but the clef **loses its "8"** (plain treble) | ✅ | ✅ 0-2… (`shots/tab-e-guitar.abc+instrument=guitar-both.png`) | Treble-8 clef kept |
| 5 | `h-bass-sounding.musicxml`, `tabTuning: [28,33,38,43]` | ✅ bass-8 clef, correct position | ✅ | ✅ 4-line TAB, all frets right (C2 = A3, G1 = E3, …) (`shots/tab-h-bass-sounding.musicxml-both-tuned.png`) | — |
| 6 | `h-bass-sounding.musicxml` with the default `tabTuning` | ✅ | ✅ | ⚠️ 6-line guitar TAB with the low notes moved up an octave (`shots/tab-h-bass-sounding.musicxml-both.png`). The README describes this behaviour, but a part whose GM program is 33–40 (bass) could default to bass tuning. | 4-string bass tuning for bass parts |
| 7 | Piano grand staff (`2026-11-09…/cases/a-piano-grand.abc`), `tabView: 'both'` | — | — | ⚠️ Guitar TAB built from the right hand at frets 12–20 and inserted **inside** the grand-staff brace, between the RH and LH staves (`shots/tab-a-piano-grand.abc-both.png`) | (product call, see Open questions) |
| 8 | Cello (`2026-11-09…/cases/c-cello.abc`), `tabView: 'both'` | — | — | ⚠️ 6-string guitar TAB for a cello part (`shots/tab-c-cello.abc-both.png`) | (product call) |

### Likely causes (to verify, not settled)

**#1 (ABC):**

- `parseAbc` turns an octave clef into a transposition, so the part ends
  up as written G4 with `transposition {semitones:-12, diatonic:-7}`.
- `meiPitch` then writes `oct="4"`, and the `staffDef` also carries
  `clef.dis="8" clef.dis.place="below"`.
- Verovio places a note under a `clef.dis` clef by treating `@oct` as
  sounding pitch. The octave is therefore applied twice.
- TAB is generated from the written (+12) pitch instead of the sounding
  pitch.
- **Fix options:** emit `oct` at sounding pitch when the clef has
  `dis`, or drop the transposition and keep the letters at sounding
  pitch, as #3 does.

**#2 (MusicXML):**

- This is Verovio's MusicXML import of
  `<clef-octave-change>` together with `<transpose><octave-change>`.
  It most likely applies the octave again.
- Check `docs/verovio-upstream-notes.md`. A pre-pass that normalises
  this encoding before Verovio may be needed: drop the octave-change
  transpose and lower the written octaves. MuseScore and Guitar Pro
  export this encoding, so it matters beyond scale-to-song.
- **Verify by comparing a MuseScore guitar export.**

**#4:** the instrument switch re-derives the clef from the instrument table
(`clef: 'treble'`) and loses the octave displacement.

**The ABC guide is wrong:** `docs/guides/abc-authoring.md` (Clefs) and
README §"ABC headers" say "`G,` sounds G3 and is drawn as G4 (second
line)". That is the intended behaviour, not what renders today. Once #1 is
fixed it becomes true. Until then, note the limitation.

## Scope

- **In:**
  - #1 and #2 (notation octave on both paths).
  - #1's TAB octave.
  - #4 (keeping the "8" through the instrument switch).
  - #6 (a bass default tuning), if the lead agrees.
  - Correcting the guide and README.
  - Tests.
- **Out:**
  - #7 and #8 (TAB on non-guitar parts) until the lead decides. See Open
    questions.
  - The fingering solver's choices (they look playable).
  - Imported TAB staves.
- **Files you own:** the lead decides. Probably `src/lib/import.ts`,
  `src/lib/notation/document.ts`, the MusicXML pre-processing in
  `src/lib/notation/musicxml-source.ts`, `src/lib/tab/tab-parts.ts`, the
  instrument-switch clef logic, the README, the guide and tests.
- **Do not touch:** `docs/handoffs/assets/2026-11-10-octave-clef-tab/`.
  Those are reference fixtures; copy them into test fixtures if needed.

## Acceptance criteria

- [ ] `e-guitar.abc` and `e-guitar.musicxml` both draw G3 on the 2nd
      line of a treble-8 staff, and the 1st bar ends on G4 on the 2nd
      space. They look the same as `e2-guitar-sounding.musicxml`.
- [ ] Generated TAB for all three guitar cases is
      `0-2 | 0-5 | 3 | 0-2-3`, with chords `5/4/3` and `4/2/3`.
      Playback is G3…G4.
- [ ] With `settings.instrument: 'guitar'` on `e-guitar.abc`, the clef
      keeps its "8" and the notes stay in place.
- [ ] (If #6 is accepted) a bass part (GM 33–40, or "bass" in the name)
      gets 4-string `[28,33,38,43]` TAB by default, and
      `settings.tabTuning` still overrides it.
- [ ] The guide's Clefs rule and the README's ABC headers match what
      renders, with a change-log line in the guide.
- [ ] The regression cases from the 2026-11-09 handoff still pass.

## Verify with

```bash
cd ~/ph-vexflow-view
npm test --workspace pepperscore   # add tests: parseAbc + scoreToMei for e-guitar.abc (assert oct at sounding when clef.dis), musicxml-source for e-guitar.musicxml, tab-parts frets for all three
npm run dev --workspace pepperscore-reader -- --host 0.0.0.0   # open each case with TAB view Both and compare to shots/
```

## Known gotchas / decisions already made

- **Scale-to-song's decision:** it will emit guitar and bass as
  MusicXML at **sounding pitch** with `<clef-octave-change>-1` and no
  `<transpose>` (case #3 and #5). It will offer TAB only for guitar and
  bass parts, and it will pass `tabTuning` per instrument. It is therefore
  **not blocked**. #2 matters for third-party MuseScore and Guitar Pro
  files.
- **The earlier ABC handoff's other findings are resolved:**
  accidentals, key changes, brace, text, final barline, transpose and
  MIDI program, re-tested on `1a903eb`.
- **GBrain:** `projects/scoreflow-music-reader` holds earlier
  ABC/Verovio notes.

## Open questions

1. **#7 and #8:** should generated TAB go only to guitar-family and
   bass parts (by GM program or name) instead of "else the first pitched
   part's top staff"? And should a TAB staff ever be inserted inside a
   grand-staff brace?
2. **#2:** fix it with a MusicXML pre-pass in PepperScore, or report it
   upstream to Verovio (or both)?

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
