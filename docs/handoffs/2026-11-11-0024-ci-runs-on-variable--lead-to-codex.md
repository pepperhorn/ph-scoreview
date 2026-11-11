# Handoff: 0024 — [quick] CI runs-on from a repo variable (self-hosted runner switch) (lead → codex)

- **Date:** 2026-11-11
- **Type:** quick
- **Ledger:** 0024 · **Guide:** docs/guides/self-hosted-runner.md
- **Branch:** orch/0024-ci-runs-on-variable · **Worktree:** created by T3
- **Base commit:** see `git log -1` at dispatch
- **Status:** open

## Goal
Make every job in `.github/workflows/ci.yml` take its runner from the repo variable `CI_RUNS_ON` (a JSON string or array), defaulting to `ubuntu-latest` when it's unset: `runs-on: ${{ fromJSON(vars.CI_RUNS_ON || '"ubuntu-latest"') }}`. With the variable unset, behaviour is identical to today. The human then installs the t3box runner (guide) and sets the variable to move CI off billed minutes.

Self-hosted hygiene in the same PR, harmless on GitHub-hosted runners:
- The container jobs already run as root in the Playwright image. Make sure no step writes outside `$GITHUB_WORKSPACE` / the container, so the host stays clean between runs.
- Keep `timeout-minutes` as they are (0019 values).
- Don't add caches that only make sense on hosted runners.

## Files you own
`.github/workflows/ci.yml`, and your own handoff files for key 0024.

## Acceptance criteria
- [ ] Every `runs-on` uses the variable expression with the `ubuntu-latest` fallback.
- [ ] With the variable unset, the PR's own CI run is green on GitHub-hosted runners (so nothing changes until the human flips the variable).
- [ ] `npx --yes @action-validator/cli .github/workflows/ci.yml` passes, or note why it can't parse `fromJSON(vars…)`.
- [ ] No other workflow behaviour changes (triggers, paths-ignore, concurrency, `reader` PR-only all unchanged).

## Verify with
```bash
npx --yes @action-validator/cli .github/workflows/ci.yml || true
git diff --stat main...HEAD
```
CI on the PR is the real check. Don't run the full local suite for a workflow-only change.

---
## Receiver ack
