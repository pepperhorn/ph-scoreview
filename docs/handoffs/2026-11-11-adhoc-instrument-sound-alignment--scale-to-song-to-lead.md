# Handoff: adhoc — instrument sound from names and GM banks (scale-to-song lead → pepperscore lead)

- **Date:** 2026-11-11
- **Type:** dispatch (an issue report for the lead to triage into the ledger)
- **Ledger:** none yet (lead assigns)
- **Spec / plan:** none. This document is the problem statement.
- **Branch / worktree / PR:** none
- **Base commit:** `6d3422c` (main)
- **Status:** open

## Goal

When a part names its instrument but gives no GM program, PepperScore
should still play the right sound. When a part gives a GM2 bank variation
PepperScore can't play, it should fall back cleanly to the bank-0 program.

Today a part with no program falls back to the name, but the name only picks
one of 16 **icons** (`score.ts:108` `instrumentForName`). The sound then comes
from that icon's voice. So "Tuba" plays piano, "Ukulele" plays piano, and
"Bass" plays double bass.

"Done" means the table under Acceptance criteria plays the stated GM program
on both import paths (ABC with no `%%MIDI program`, MusicXML with no
`<midi-instrument>`).

## Context you need

- **Who found this.** scale-to-song (`~/.t3/projects/scale-to-song`) sends
  MusicXML that always has `<midi-program>`, so **it is not blocked**. It
  resolves every instrument itself (design doc
  `docs/superpowers/specs/2026-11-09-scale-to-song-design.md`, "Instrument
  resolution"). This handoff is for ABC and third-party files that name an
  instrument without a program, and for files that use GM2 banks.
- **Code:**
  - `packages/pepperscore/src/lib/score.ts:108` `instrumentForName`: name →
    icon id only.
  - `score.ts:72` `instrumentForProgram`, `:79` `gmProgramForNumber`.
  - ABC: `src/lib/import.ts:307-318`. With no valid `%%MIDI program`, the
    part gets `instrument: instrumentForName(name)` and **no `gmProgram`**.
  - MusicXML: `src/lib/notation/musicxml-source.ts:335-347`
    `instrumentFields`, same fallback. `<midi-bank>` is never read.
  - Sounds: `gm-soundfont-manifest.json` (FluidR3 GM, 128 programs, bank 0
    only). `sf2-player.ts:45-47` picks bank 0 (or 128 for drums) only.
- **Reference data:** crf-admin `instrument` was checked against GM on
  2026-11-11. Its `gm_program` (1–128), `gm_bank` (GM2 bank LSB, MSB 121)
  and `gm_fallback_program` columns are the reference values in the table
  below.

## Findings

| # | Problem | Where | Expected |
|---|---|---|---|
| 1 | **Name gives an icon, not a sound.** A part named "Tuba", "Oboe", "Harp", "Banjo", "Harmonica", "Vibraphone", "Xylophone", "Horn" or "Organ" with no program plays piano, or the nearest icon's voice. | `instrumentForName`, `import.ts:318`, `musicxml-source.ts:347` | A `gmProgramForName(name)` table (GM 1-based) used before the icon fallback. The part gets `gmProgram`/`gmSoundfont` from it, and its icon from `manifest.programs[p-1].icon`. |
| 2 | **"Ukulele" plays piano.** There is no ukulele rule. | `instrumentForName` | Program 25 (nylon guitar) and icon `guitar`. TAB detection (0013-T1) already treats ukulele as fretted, so the sound should agree. |
| 3 | **A bare "Bass" means double bass.** `\bbass\b` maps to `double-bass` (GM 33). In pop and rock parts "Bass" is a bass guitar. | `score.ts:112` | Bare "Bass", "Bass Guitar", "Electric Bass", "E. Bass" → 34 (electric bass, finger), icon `bassguitar`. Double bass only for "Double Bass", "Contrabass", "Upright Bass", "Acoustic Bass", "String Bass" → 33. (Lead's call. MuseScore names its bass guitar part "Bass Guitar" and its double bass "Contrabass".) |
| 4 | **`<midi-bank>` is ignored.** A GM2 file with `<midi-bank>15490</midi-bank><midi-program>25</midi-program>` (Ukulele: MSB 121, LSB 1) plays program 25. That's an acceptable fallback today, but it isn't documented or tested, and an SF2 with the variation would never be used. | `musicxml-source.ts:345`, `sf2-player.ts:47`, ABC `%%MIDI bank` | Read `<midi-bank>` (MusicXML 1–16384, so `value-1` = MSB×128+LSB) and ABC `%%MIDI bank`. Use the variation when the loaded SF2 has that bank/preset, else bank 0 with the same program. Document it in the README. |
| 5 | **Program numbering is easy to get wrong.** MusicXML `<midi-program>` is 1–128 and ABC `%%MIDI program` is 0–127. The code handles both correctly. | README "ABC headers" | One sentence in the README and the ABC guide saying so, with an example (Ukulele/nylon = `%%MIDI program 24`). |

## Acceptance criteria

Each name, used as an ABC `V: name="…"` with no `%%MIDI` and as a MusicXML
`<part-name>` with no `<midi-instrument>`, gets this `gmProgram` and icon:

| Name | GM (1-based) | Icon |
|---|---|---|
| Ukulele | 25 | guitar |
| Acoustic Guitar / Guitar | 26 | guitar |
| Classical Guitar / Nylon Guitar | 25 | guitar |
| Electric Guitar | 28 | guitar |
| Bass, Bass Guitar, Electric Bass | 34 | bassguitar |
| Double Bass, Contrabass, Upright Bass, Acoustic Bass | 33 | double-bass |
| Banjo | 106 | guitar |
| Harp | 47 | violin (manifest icon) |
| Tuba | 59 | trombone |
| Horn, French Horn | 61 | trombone |
| Oboe | 69 | clarinet |
| Harmonica | 23 | piano |
| Vibraphone | 12 | piano |
| Xylophone | 14 | piano |
| Organ, Hammond | 17 | piano |
| Fiddle | 111 | violin |
| Voice / Vocals | 54 | microphone |
| (existing rules: sax, flute, clarinet, trumpet, trombone, violin, viola, cello) | unchanged programs | unchanged |

- [ ] The table passes for both import paths (unit tests in
      `abc-import.test.ts` and a musicxml-source test).
- [ ] An explicit program (`%%MIDI program`, `<midi-program>`, a GM
      `<virtual-instrument>`) still wins over the name.
- [ ] `<midi-bank>` + `<midi-program>` and `%%MIDI bank` are read. With
      the default FluidR3 sounds, a bank > 0 plays the bank-0 program (test).
- [ ] The README states the numbering (1–128 vs 0–127), the name table
      and the bank fallback.
- [ ] The regression cases from the 2026-11-09 and 2026-11-10 handoffs
      still pass.

## Verify with

```bash
cd ~/ph-vexflow-view
npm test --workspace pepperscore
npm run dev --workspace pepperscore-reader -- --host 0.0.0.0   # open a "Tuba" ABC with no %%MIDI; the mixer shows Tuba and plays tuba
```

## Scope

- **In:** findings 1–5, tests, README and guide text.
- **Out:** new sound samples (for example a real ukulele), the TAB
  tunings (0013), the instrument switch.
- **Files you own:** the lead decides. Probably `score.ts`, `import.ts`,
  `notation/musicxml-source.ts`, `sf2-player.ts`, README, the ABC guide and
  tests.

## Known gotchas / decisions already made

- scale-to-song always emits `<midi-program>` and names parts exactly as
  crf-admin does. For PepperScore it emits the **fallback program** with no
  bank (Ukulele → 25), so it does not depend on finding 4.
- Earlier FYI, still open: a 5-string `tabTuning` is ignored on a
  4-string-detected bass part. See the receiver ack in
  `docs/handoffs/2026-11-10-adhoc-abc-authoring-guide--pepperscore-to-scale-to-song.md`
  (scale-to-song repo).
- **GBrain:** `projects/scoreflow-music-reader`.

## Open questions

1. Finding 3: is a bare "Bass" a bass guitar (my suggestion) or a double
   bass? Choral "Bass" voices also exist, so "Bass" next to
   Soprano/Alto/Tenor parts could mean voice. Maybe check sibling parts.
2. Finding 4: worth supporting SF2 banks now, or only document the bank-0
   fallback?

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

---
## Update 2026-11-11 (scale-to-song, after reviewing 0.5.0)

0.5.0 (0016, 0018) already covers Ukulele → 25, bare "Bass" → 34, Banjo
106, French Horn 61, English Horn 70, Recorder 75, soprano sax 65, and the
README numbering note (finding 5). **Still open:**

- Finding 1 for name-only Tuba (59), Oboe (69), Harp (47), Harmonica (23),
  Vibraphone (12), Xylophone (14), Organ/Hammond (17) and Fiddle (111):
  they still play piano. A small extension of the program overrides in
  `tab/string-instruments.ts` (~line 113) would do it.
- Minor: name-only "Electric Guitar" plays the `guitar` voice (25, nylon)
  rather than 28, and "Acoustic Guitar" rather than 26.
- Finding 4 (`<midi-bank>` / `%%MIDI bank`): unchanged.

Priority low: scale-to-song always emits `<midi-program>`.
