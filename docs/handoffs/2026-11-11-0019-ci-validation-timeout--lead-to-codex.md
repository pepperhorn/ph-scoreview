# Handoff: 0019 — [quick] CI validation step timeout (S28) (lead → codex)

- **Date:** 2026-11-11
- **Type:** quick
- **Ledger:** 0019 (suggestion S28)
- **Branch:** orch/0019-ci-validation-timeout · **Worktree:** created by T3
- **Base commit:** 7abcd5c
- **Status:** closed

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

Acknowledged: raise only the chromium validate job timeout from 30 to 45 minutes
and its Validation suite step timeout from 15 to 25 minutes. I own
`.github/workflows/ci.yml` and the two 0019 handoffs. No test changes or optional
timing instrumentation are needed. I will validate the workflow, commit a return
handoff, push my branch, and open a draft PR; CI completion remains for the lead
because the task explicitly prohibits watching or polling the PR. No open questions.

GBrain searched: `projects/scoreflow-music-reader` and
`projects/scoreflow-music-reader/gotchas-abc-import`; the dispatch handoff supplies
the current timeout requirements.
