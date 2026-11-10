# 0013 — TAB for stringed instruments

- **Status:** approved (T2 is a spike; T3 scope may change from its result)
- **Ledger:** 0013 · **Plan:** ../plans/0013-stringed-instrument-tab.md
- **Author:** lead · **Date:** 2026-11-10

## Problem
Generated TAB assumes a 6-string guitar and falls back to "the first pitched part's top staff", so a piano gets guitar TAB inside its brace and a cello gets 6-string guitar TAB (scale-to-song report, findings #6–#8: `../handoffs/2026-11-10-adhoc-octave-clef-and-tab--scale-to-song-to-lead.md`). Current rules: `guitar-tab.md` "Which staves get TAB".

## Decisions (human, 2026-11-10)
- **Which parts get TAB:** any stringed instrument — guitars; bass guitar 4- and 5-string; ukulele soprano, tenor, baritone, bass; violin, viola, cello (and double bass). Nothing else: no fallback to the first pitched part, and never a TAB staff inside a non-string grand-staff brace.
- **Fretted strings** (guitar, bass, ukulele): fret-number TAB with that instrument's string count and default tuning. Bass parts default to 4-string `[28,33,38,43]`; 5-string `[23,28,33,38,43]` by host setting. `settings.tabTuning` still overrides.
- **Ukulele detection:** from the part name ("Ukulele" = soprano GCEA re-entrant, "Tenor/Baritone/Bass Ukulele") plus a per-part host override. Sound: nylon guitar (GM 25, zero-based 24) until a uke sample exists.
- **Fretless strings** (violin, viola, cello, double bass): **finger + position** notation, ported from the violintab app's charts (`~/violintab/src/lib/tab/instruments.ts`), with Davidoff cello positions and the known mislabel fix above 2nd position (memory `fretboard-alignment`).

## Decisions after the T2 spike (human, 2026-11-10)
- **Rendering: option D** — a four-line Verovio TAB staff with finger numbers, the `L`/`H` modifiers placed inline on the string line by SVG text substitution keyed by stable note ids (Verovio 6.3 throws on letters in `tab.fret`), position changes as `<dir>` ("I pos.", "III pos.", "pos. ½"). Applies to every render path (probe, chunk, whole, PDF). Evidence: `../handoffs/assets/2026-11-10-0013-t2-fretless-spike/`.
- **Charts:** violin and cello ship (cello with the Davidoff relabel). Viola and double bass get **no** finger TAB until a teacher-approved chart is supplied; their parts show notation only.
- Finger numbers are display only; playback stays on the score timeline.

## Default tunings (MIDI, low → high)
| Instrument | Tuning |
|---|---|
| Guitar | 40 45 50 55 59 64 (EADGBE) |
| Bass 4 / 5 | 28 33 38 43 / 23 28 33 38 43 |
| Ukulele soprano, tenor (re-entrant) | 67 60 64 69 (G4 C4 E4 A4) |
| Ukulele baritone | 50 55 59 64 (D3 G3 B3 E4) |
| Ukulele bass | 28 33 38 43 |
| Violin / Viola / Cello / Double bass | 55 62 69 76 / 48 55 62 69 / 36 43 50 57 / 28 33 38 43 |

## Acceptance criteria
- [ ] AC1 — TAB is offered and generated only for stringed parts; piano/cello/flute scores without strings show no TAB option; no TAB staff inside a piano brace.
- [ ] AC2 — Each fretted instrument gets its string count and default tuning; re-entrant ukulele fingering is playable (solver handles a high 4th string); bass defaults to 4-string; host override per part and `tabTuning` work.
- [ ] AC3 — Violin and cello parts get finger + position TAB (option D) matching the charts (violin 1st–4th, cello half–4½ Davidoff), readable in dense passages, on every render path incl. PDF; double stops share a feasible hand position. Viola and double bass show no TAB yet.
- [ ] AC4 — README "Guitar TAB" becomes "String TAB" and documents instruments, detection, defaults and overrides.
- [ ] AC5 — Existing guitar TAB validation (`test:tab`, `test:tab-bake`, `test:fret-assign`) still passes.

## Open questions
None (resolved after T2).
