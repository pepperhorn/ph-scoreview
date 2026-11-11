# Handoff: 0024 — CI runs-on repo variable (codex → lead)

- **Date:** 2026-11-11
- **Type:** return
- **Ledger:** 0024 (quick; no separate spec or plan)
- **Branch:** orch/0024-ci-runs-on-variable
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-831d6fdb-b7a11004d235e95c
- **Base commit:** 9602bd5
- **Status:** open (implementation complete; hosted CI and independent review pending)

## Goal
Allow both CI jobs to select a runner via the JSON repository variable
`CI_RUNS_ON`, with the existing `ubuntu-latest` behavior when unset.

## Context you need
- [Dispatch and receiver acknowledgement](2026-11-11-0024-ci-runs-on-variable--lead-to-codex.md)
- [Runner installation and switch guide](../guides/self-hosted-runner.md)
- GBrain searched: `default:projects/scoreflow-music-reader` and
  `default:projects/scoreflow-music-reader/gotchas-abc-import`; no runner-specific
  constraints returned. Current repo docs govern this change.

## Scope
- **In / files owned:** `.github/workflows/ci.yml` and the two 0024 handoffs.
- **Out / do not touch:** all application code, other workflows, ledger, guide,
  runner installation, repository variables and infrastructure.

## Acceptance criteria
- [x] Every runs-on uses `${{ fromJSON(vars.CI_RUNS_ON || '"ubuntu-latest"') }}`.
- [ ] PR CI green on GitHub-hosted runners with the variable unset (lead gate).
- [x] Workflow validator accepts fromJSON(vars…).
- [x] Triggers, paths-ignore, concurrency, reader condition, timeouts, images,
  steps and caches unchanged.

## Verify with
```bash
npx --yes @action-validator/cli .github/workflows/ci.yml
git diff --check
git diff --stat main...HEAD
gh variable list -R pepperhorn/ph-scoreview --json name
```

## Return
- **Outcome:** implementation done; CI acceptance remains pending.
- **PR:** draft PR against main, linked in the delivery message and PR body.
- **Commits:** receiver ack `1209a31`; workflow `10c66d4`;
  this return handoff is the following docs-only commit.
- **What changed:** exactly two workflow lines, one per job.
- **Verification output:**
  ```text
  @action-validator/cli: exit 0
  WARNING: Glob validation is not yet supported. Glob at /on/push/paths-ignore will not be validated.
  WARNING: Glob validation is not yet supported. Glob at /on/pull_request/paths-ignore will not be validated.
  git diff --check: exit 0
  gh variable list --json name: []
  ```
- **Scope audit:** only the workflow and the owned 0024 handoffs changed.
  The full local suite was deliberately skipped per the dispatch brief.
- **Decisions made:** use the supplied expression verbatim. No extra hygiene
  changes needed: both jobs already run inside the Playwright container; apt
  changes container directories and pack-smoke creates temporary apps through
  os.tmpdir() with finally cleanup. Existing npm cache behavior stays intact.
  No host-directory mounts or new caches were added. This is a static inspection,
  not a live self-hosted runner verification.
- **Open questions:** none for implementation.
- **Out-of-scope issues found:** none.
- **Follow-ups:** lead arranges independent review and confirms all three hosted
  CI jobs green on the PR head. The human installs t3box and sets CI_RUNS_ON
  afterward using the guide; this task did neither.
- **For GBrain (lead to promote):** after merge, record that CI_RUNS_ON accepts
  a JSON string or label array and defaults to ubuntu-latest. No implementer
  GBrain writes were made.
