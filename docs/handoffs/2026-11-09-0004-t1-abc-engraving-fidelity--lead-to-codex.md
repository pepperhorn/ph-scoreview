# Handoff: 0004-t1 — ABC engraving fidelity (lead → codex)

- **Date:** 2026-11-09
- **Type:** dispatch
- **Ledger:** 0004 · **Spec:** docs/specs/0004-abc-import-parity.md · **Plan:** docs/plans/0004-abc-import-parity.md (task T1)
- **Branch:** orch/0004-t1-abc-engraving · **Worktree:** created by T3
- **PR:** <url once opened>
- **Base commit:** 49c3e9b
- **Port (if running a server):** 5241
- **Status:** open

## Goal
ABC sources draw every accidental the notation implies, follow mid-tune key changes, keep annotations separate from chord symbols, draw final/double barlines, and keep octave and C clefs, matching the MusicXML path. Findings 1, 2, 4, 5, 7 of the issue report.

## Context you need
- Spec (decisions, ACs): `docs/specs/0004-abc-import-parity.md`
- Plan task T1 (notes and gotchas): `docs/plans/0004-abc-import-parity.md`
- Issue report with evidence and line refs: `docs/handoffs/2026-11-09-adhoc-abc-import-fidelity--scale-to-song-to-lead.md`
- Repro cases, MusicXML references, screenshots: `docs/handoffs/assets/2026-11-09-abc-import-spike/`
- Code: `packages/pepperscore/src/lib/import.ts` `parseAbc`; `packages/pepperscore/src/lib/notation/document.ts` `scoreToMei`; types in `packages/pepperscore/src/lib/score.ts`.

## Scope
- **In:** findings 1, 2, 4, 5, 7; unit tests for cases b, b2, c, e, f, g and the bar-1 text/chord and final barline of a.
- **Out:** grand-staff grouping, transposition, MIDI program/channel, README (that's T2). MusicXML/MEI import paths. abcjs.
- **Files you own:** `packages/pepperscore/src/lib/import.ts` (ABC code only), `packages/pepperscore/src/lib/notation/document.ts`, `packages/pepperscore/src/lib/score.ts` (additive type fields only), `packages/pepperscore/src/lib/abc-import.test.ts` (new), `packages/pepperscore/src/lib/__fixtures__/abc/**` (new), plus your own handoff files for key 0004-t1.
- **Do not touch:** `docs/handoffs/assets/2026-11-09-abc-import-spike/` (copy fixtures out of it), the ledger, anything else.

## Acceptance criteria
- [ ] AC1, AC2, AC3, AC4, AC5 from the spec.
- [ ] AC8: the issue report's "already works" list still holds (add assertions for chord kinds, dyads, ties, beams in the new test file).
- [ ] `scoreToMei` output for the cases contains `accid=`, the key change, `<dir`, `right="end"`, and `clef.dis` where expected.
- [ ] `generatedPitchId` ids unchanged.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run test -w pepperscore -- --run src/lib/abc-import.test.ts
npm run check && npm run build && npm run test:manifest && npm run test:validation
```
Optional visual check: `npm run dev -- --host 0.0.0.0 --port 5241`, paste each case into the ABC drawer, compare with `shots/`.

## Known gotchas / decisions already made
- Probe abcjs `parseOnly` output for each case before coding; abcjs may represent mid-tune `K:` and octave clefs differently from what the report assumes. Record what you found under "Decisions made".
- GBrain `projects/scoreflow-music-reader` ("ABC beam and bar fit correction — 2026-09-26"): beams come from abcjs `startBeam`/`endBeam`. Don't rework beam or bar-fit code.
- `tests/` and `examples/` are gitignored; put tests in `src/lib/` as above.

## Open questions
None. Escalate per AGENTS.md §7 if abcjs can't supply something.

---
## Receiver ack
I will implement findings 1, 2, 4, 5 and 7 within the declared owned files, probing abcjs first. I will preserve beam/bar-fit behavior and generatedPitchId identity, add fixture-backed model/MEI regression coverage, run the required checks, and return a draft PR. Grand-staff grouping, transposition metadata, MIDI settings and README remain T2. No open questions. GBrain consulted: projects/scoreflow-music-reader.

---
## Return (in a separate …--<impl>-to-lead.md)
