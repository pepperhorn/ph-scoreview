Addressed [review r2](https://github.com/pepperhorn/ph-scoreview/pull/74#pullrequestreview-5837609229) in **044aa8c7e1fd401bebe7cf9cbb994b076dbef320**, the requested last fix round.

- F4: chromatic cello/bass position rank now puts I before half (half ranks 1.25), while preserving opens and plain-before-modified priority. D2/E2, A2/B2, E3/F3, B3/C4 use I. A two-octave C-major scale test asserts only open/I results; every string of cello and provisional bass tests first-position overlap plus half for open+1. C#2 remains C half/1.
- Unhinted violin C#/D#/G# now prefer high 3 over low 4 (C#4, G#4, D#5 tested); explicit Db/Ab/Eb spellings still choose low 4. Existing low-2/Bb5 defaults and all r1 regressions remain green. T3 should still pass complete spelling including key-signature/gestural accidentals.
- No chart or integration edits: only `solver.ts`, `solver.test.ts`, and the requested return handoff changed.

Foreground repo-root `npm run test -w pepperscore && npm run check`: **exit 0**; **212 tests / 11 files passed**, including **50 solver tests**. All three workspace type checks passed; Astro 22 files, 0 errors/warnings/hints.

Copied all native `<fing>` evidence from cache into **`/tmp/0013-t2-r2-fing-probe/`** for archival: 55 files byte-compared to source and SHA-256 verified, plus `sha256.json`. All absolute paths are listed in the [updated return handoff](https://github.com/pepperhorn/ph-scoreview/blob/044aa8c7e1fd401bebe7cf9cbb994b076dbef320/docs/handoffs/2026-11-10-0013-t2-fretless-spike--codex-to-lead.md#review-r2-response--final-fix-round).

Key files on the implementation host:

- `/tmp/0013-t2-r2-fing-probe/within-aligned-offsets.mei`
- `/tmp/0013-t2-r2-fing-probe/within-aligned-offsets.svg`
- `/tmp/0013-t2-r2-fing-probe/within-aligned-offsets.png`
- `/tmp/0013-t2-r2-fing-probe/probe.mjs`
- `/tmp/0013-t2-r2-fing-probe/report.json`
- `/tmp/0013-t2-r2-fing-probe/sha256.json`

Probe result is unchanged: native `<fing>` preserves L/H text through MEI round-trip but does not reliably produce D's inline rendering. Archive scratch before cleanup. No PR watch started.
