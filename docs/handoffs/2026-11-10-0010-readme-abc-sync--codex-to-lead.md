# Handoff: 0010 — README ABC sync (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0010 (quick; no separate spec or plan)
- **Branch:** orch/0010-readme-abc-sync
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-98350ce6
- **Base commit:** 7362cf70583b2ebbf4aff4da83fde80a2acff60f (includes required 8c19b8f)
- **PR:** pending creation after this handoff is committed
- **Status:** closed

## Goal
Synchronize the four obsolete ABC README statements with the importer shipped in 0008 / PR #67.

## Context you need
- [Dispatch and committed receiver acknowledgement](2026-11-10-0010-readme-abc-sync--lead-to-codex.md)
- [Authoring guide](../guides/abc-authoring.md): checklist 2/4, Tune and header, Known limits.
- Importer evidence: `packages/pepperscore/src/lib/import.ts:193–226` replays file voices after layout directives and selects the first voice for unselected music; lines 306–312 apply tune-header names.
- Regression evidence: `abc-import.test.ts` default-voice boundaries, file-header voice declarations, and tune-header layout suites (lines 491–539, 656–725).

## Scope
- **In / files owned:** `packages/pepperscore/README.md` ABC section and this task's two handoffs.
- **Out / do not touch:** runtime code, tests, the lead's guide, ledger, and all unrelated files.
- No server or port required for this documentation task.

## Acceptance criteria
- [x] Exactly four README spots corrected: grouping order, valid pre-X voice defaults, per-property overrides and first-voice body music, obsolete clef limit removed.
- [x] Nothing outside owned scope changed.
- [x] For the ABC guide: none. Import behaviour is unchanged; README now reflects the existing guide.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run check && npm run build
npm run test:manifest
npm run test:validation
npm run test -w pepperscore -- --run src/lib/abc-import.test.ts
git diff --check
git diff --stat main...HEAD
```

## Known gotchas / decisions already made
GBrain consulted (read only): `default:projects/scoreflow-music-reader` and `default:projects/scoreflow-music-reader/gotchas-abc-import`. Local guide, importer and tests were the authority for wording. Only the lead writes GBrain.

## Open questions
None.

## Return
- **Outcome:** done; documentation only.
- **What changed:** README checklist now orders `%%score`/`%%staves` before voices and permits file-header voice defaults; Tune and header documents clef/name/transposition defaults, per-property tune overrides, and explicit body voice selection; removed obsolete ignored-clef limit.
- **Verification output:**
```text
npm run check: passed; Astro: 22 files, 0 errors, 0 warnings, 0 hints.
npm run build: passed; 10 pages built; demo dist workers, Verovio files and notices match.
npm run test:manifest: passed; 128 local packs, 16 icons; generated core 19 FluidR3 sounds.
ABC importer: 1 test file passed, 74 tests passed.
npm run test:validation: FAILED (exit 1) at the final instrument-switch stage.
All preceding stages passed, including package/editor unit tests, reader, embed, layout and tab-bake (824 checks).
page.evaluate: Error: The score could not be read.
  at live (validation/instrument-switch.mjs:308:42)
  at validation/instrument-switch.mjs:544:11
git diff --check: passed.
```
- **Verification notes:** An early check ran before npm ci completed (`tsc: not found`); its rerun passed. The first full validation started before the reader build completed and stopped at a missing `apps/reader/dist/index.html`; rerun after build completion is recorded above. Build emitted its existing large-chunk advisory.
- **Decisions made:** Mirror the guide at the four requested spots only; explicitly mention both layout directive names in checklist 2. No ADR needed.
- **Out-of-scope issues found:** The full validation suite fails loading a score in instrument-switch.mjs:544 after its full-reader-picker checks pass. Runtime and test sources are unchanged and outside this task; no fix attempted. The requested check/build and focused ABC tests pass.
- **Follow-ups:** Lead to arrange cross-family review and merge.
- **For GBrain (lead to promote):** None; docs sync only.
