# Handoff: 0019 — [quick] Raise CI validation timeout (codex → lead)

- **Date:** 2026-11-11
- **Type:** return
- **Ledger:** 0019 (S28); quick item, no spec or plan
- **Branch:** orch/0019-ci-validation-timeout
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-9a7e54ef-5b8a9c6615d1f821
- **Base commit:** 51e9ac0 (contains pinned base 7abcd5c)
- **Implementation commit:** 81342583a67b80ea7ec7fdf60b3c41c86291277a
- **PR:** draft creation follows this commit; locate by branch `orch/0019-ci-validation-timeout`.
- **Status:** open; implementation complete, CI acceptance pending

## Goal
Allow the chromium validation suite enough time to complete on busy CI runners,
while leaving room for setup and the existing 12-minute pack smoke step.
See [dispatch handoff](2026-11-11-0019-ci-validation-timeout--lead-to-codex.md).

## Scope
- **In:** chromium validate job timeout 30 → 45 minutes; Validation suite step timeout 15 → 25 minutes.
- **Out:** tests, optional timing instrumentation, all other workflow settings.
- **Files owned and changed:** `.github/workflows/ci.yml` and the two 0019 handoff files.
- **Do not touch:** application code, tests, dependencies, ledger, other documentation.

## Acceptance criteria
- [x] Requested workflow timeouts raised.
- [ ] CI on the draft PR runs green with the validation step completing.

## Verify with
```bash
npx --yes @action-validator/cli .github/workflows/ci.yml
git diff --check
git diff --stat main...HEAD
```

## Known gotchas / decisions already made
GBrain searched: `projects/scoreflow-music-reader` and
`projects/scoreflow-music-reader/gotchas-abc-import`. Current task requirements
come from the dispatch handoff. Only the lead writes back to GBrain.

## Open questions
None. Lead must confirm PR CI completes; watching and polling were expressly
excluded from this implementation task.

## Return
- **Outcome:** implementation done; CI acceptance pending.
- **Commits:** acknowledgement 40d0102; workflow change 8134258; this return handoff is committed separately.
- **What changed:** exactly two workflow timeout values; no test changes.
- **Verification output:**
  ```text
  npx --yes @action-validator/cli .github/workflows/ci.yml
  exit 0 (no diagnostics)
  git diff --check
  exit 0 (no diagnostics)
  ```
- **Local suite limitation:** dependencies are not installed in this fresh worktree. The task-specific handoff prescribes workflow syntax validation and identifies PR CI as the real check; local check/build/manifest/full validation were not run.
- **Decisions made:** omitted optional timing instrumentation to keep the CI change to two lines.
- **Out-of-scope issues found:** none.
- **Follow-ups:** lead reviews and confirms green CI, including validation completion. No PR watching or polling by implementer.
- **For GBrain (lead to promote):** no new cross-project decisions; record the outcome after merge if useful.
