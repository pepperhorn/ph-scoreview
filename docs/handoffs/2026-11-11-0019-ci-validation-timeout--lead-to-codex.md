# Handoff: 0019 — [quick] CI validation step timeout (S28) (lead → codex)

- **Date:** 2026-11-11
- **Type:** quick
- **Ledger:** 0019 (suggestion S28)
- **Branch:** orch/0019-ci-validation-timeout · **Worktree:** created by T3
- **Base commit:** 7abcd5c
- **Status:** open

## Goal
The chromium job's "Validation suite" step (`.github/workflows/ci.yml` ~line 40, `timeout-minutes: 15`) now takes ~12–16 min and times out on busy runners (PR #82 push run, PR #85 both runs, two main runs). Raise the step timeout to 25 and the job's `timeout-minutes` from 30 to 45 so the job still fits pack (12) + setup. Optionally (only if trivial) print per-suite durations so we can see what grew. No test changes.

## Files you own
`.github/workflows/ci.yml` (those timeouts, optional timing output), your own 0019 handoff files.

## Acceptance criteria
- [ ] Timeouts raised as above; CI on this PR runs green with the validation step completing.

## Verify with
```bash
npx --yes @action-validator/cli .github/workflows/ci.yml || true   # syntax sanity if available
```
CI on the PR is the real check.

---
## Receiver ack
