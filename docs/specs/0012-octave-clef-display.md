# 0012 — Octave-clef parts draw at the right octave

- **Status:** approved
- **Ledger:** 0012 · **Plan:** ../plans/0012-octave-clef-display.md
- **Author:** lead · **Date:** 2026-11-10

## Problem
Guitar-style octave-clef parts are drawn an octave high on both import paths, and generated TAB for ABC is an octave high. Problem statement, repro files, screenshots and likely causes: [`../handoffs/2026-11-10-adhoc-octave-clef-and-tab--scale-to-song-to-lead.md`](../handoffs/2026-11-10-adhoc-octave-clef-and-tab--scale-to-song-to-lead.md) (findings #1, #2, #4). Repro: `../handoffs/assets/2026-11-10-octave-clef-tab/`.

## Goals
- ABC `clef=treble-8` and standard MusicXML guitar encoding (written pitch + `<clef-octave-change>-1` + `<transpose><octave-change>-1`) both draw like `e2-guitar-sounding.musicxml`: G3 on the 2nd line of a treble-8 staff (finding #1, #2).
- Playback at sounding pitch; generated TAB from sounding pitch (`0-2 | 0-5 | 3 | 0-2-3`, chords `5/4/3`, `4/2/3`).
- The instrument switch keeps the octave clef's "8" (finding #4).
- Guide and README describe what renders.

## Decisions (human + lead, 2026-11-10)
- **MusicXML (#2):** fix with a PepperScore pre-pass that normalises the written-pitch + transpose-octave encoding before Verovio, **and** record it in `docs/verovio-upstream-notes.md` with a drafted upstream issue (don't file without asking — memory `verovio-upstream-ledger`).
- **ABC (#1):** MEI convention under `clef.dis` is that `@oct` is the sounding octave (Verovio draws it so). The implementer picks between emitting sounding `oct` when the clef has `dis`, or keeping letters at sounding pitch with no octave transposition, whichever keeps the instrument switch and concert view correct (PR #60 review found a double shift once before; see `../handoffs/2026-11-09-0004-t1-abc-engraving-fidelity--codex-to-lead.md`).

## Non-goals
TAB part selection and new instrument tunings (that's 0013); imported TAB staves; the fingering solver.

## Acceptance criteria
- [ ] AC1 — `e-guitar.abc` and `e-guitar.musicxml` draw G3 on the 2nd line of a treble-8 staff; bar 1 ends on sounding G4 (drawn as written G5, above the staff); same as `e2-guitar-sounding.musicxml` (compare rendered SVG note positions).
- [ ] AC2 — Generated TAB for all three guitar cases is `0-2 | 0-5 | 3 | 0-2-3`, chords `5/4/3` and `4/2/3`; playback G3…G4.
- [ ] AC3 — `settings.instrument: 'guitar'` on `e-guitar.abc` keeps the treble-8 clef and note positions; switching to alto sax / flute and back stays correct; concert view correct.
- [ ] AC4 — `h-bass-sounding.musicxml` unchanged (bass-8 clef, correct position); a MuseScore-style bass export (written + octave transpose) draws correctly too.
- [ ] AC5 — README "ABC headers"/"Guitar TAB" match behaviour; lead updates the guide.
- [ ] AC6 — All 0004–0010 ABC tests and instrument-switch/transpose validation still pass.

## Open questions
None.
