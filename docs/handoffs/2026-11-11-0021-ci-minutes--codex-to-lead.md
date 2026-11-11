# Handoff: 0021 — [quick] Cut CI minutes (codex → lead)

- **Date:** 2026-11-11
- **Type:** return
- **Ledger:** 0021 · **Spec/Plan:** quick item, dispatch below
- **Branch:** `orch/0021-ci-minutes`
- **Worktree:** `/home/shaun/.t3/worktrees/ph-vexflow-view/t3-c2da46b4-05b42576365ef801`
- **Base commit:** `caeffd2` (contains pinned ancestor `d95911e`)
- **PR:** draft to be opened after this handoff is committed; see this branch's PR against main
- **Status:** closed

## Goal
Reduce billed CI minutes while retaining the validation and pack checks for code changes on PRs. Source: [human dispatch and lead notes](2026-11-11-0021-ci-minutes--human-to-lead.md).

## Scope
- **In / files owned:** `.github/workflows/ci.yml`, receiver acknowledgement in the dispatch, and this return handoff.
- **Out / do not touch:** ledger, application code, dependencies, branch protection, lead process, self-hosted runners, deployment and release workflows.

## Acceptance criteria
- [x] Workflow configuration ignores docs-only changes for main pushes and PRs; also ignores root Markdown, `.ph-orch.json`, `.claude/**`.
- [x] Push trigger is limited to main; PR branch pushes only trigger pull_request CI once a PR exists.
- [x] Reader skips push events; PRs and workflow_dispatch retain Firefox/WebKit coverage.
- [ ] PR's own CI green: intentionally not watched or polled; lead/reviewer must confirm.
- [ ] Post-merge docs-only main commit starts no run: lead must verify after merge.
- [ ] Lead's docs-only ledger flow avoids waiting on CI: lead-owned process, recorded in dispatch lead notes and ledger log, outside implementer scope.

## What changed and expected minute savings
- Ignore orchestration/docs-only changes on both automatic events: saves approximately 45 billed minutes for each formerly complete run (less when an old run would have been cancelled).
- Main-only push trigger removes duplicate PR branch push runs: approximately 45 minutes saved per formerly duplicated PR update, a 50% reduction for that pair.
- Reader condition removes two browser jobs on main pushes: approximately 30 of 45 billed minutes saved per code merge, about 67%; manual runs retain all three jobs.
- Concurrency uses PR number or ref and cancels superseded runs for the same PR/ref.
- Validate reuses reader's pinned `mcr.microsoft.com/playwright:v1.63.0-noble` image and IPC option. Chromium install remains as a version-mismatch fallback without `--with-deps`. Poppler installs with `apt-get` directly because the container runs as root. Avoids repeated browser/system-library installation; net savings are unmeasured because pulling the image also takes time.
- A formerly duplicated PR update plus main merge costs roughly 135 minutes versus 60 afterward, before container savings (~56%). The target 70–80% overall reduction depends on the proportion of docs-only runs and updates; it is an estimate, not an observed result.

## Verify with
```bash
npm ci
npx --yes @action-validator/cli .github/workflows/ci.yml
npm run check && npm run build && npm run test:manifest && npm run test:validation
git diff --check
git diff --stat main...HEAD
```

## Verification output
All commands below exited 0:
```text
npm ci: completed (local Node v26.12.0 / npm 11.20.0; CI retains Node 22)
@action-validator/cli: exit 0; warns glob validation is unsupported
Workflow structure assertions: passed triggers, ignores, concurrency, reader gating,
  container parity and retention of all validation/pack commands
npm run check: Result (23 files): 0 errors, 0 warnings, 0 hints
npm run build: Demo build uses the library dist (worker chunks and Verovio files match) and ships its notices
npm run test:manifest: GM manifest: 128 local packs, 16 icons and playable voices verified.
Sound packs: complete pack.json, generated core (19 FluidR3 sounds) and versions passed
npm run test:validation: PDF page model spike passed (chromium): A4 4 lines; A3 4; 2 pages for 80 bars.
git diff --check: clean
```
Local logs: `/tmp/0021-{npm-ci,action-validator,workflow-assertions,check,build,manifest,validation}.log`.
The full suite passed, including the PDF raster checks with local Poppler. Desktop editor validation reported one 407 ms redraw but passed. `test:pack` was preserved and not separately run locally. No local container runtime was available to exercise the GitHub job image; the PR CI must verify the actual Node 22/container/Poppler combination. Static workflow assertions do not prove GitHub's event delivery or actual billed-minute savings.

## Known gotchas / decisions made
- GBrain searched: `default:projects/scoreflow-music-reader` and `default:projects/scoreflow-music-reader/gotchas-abc-import`. No CI-specific guidance found; repo dispatch/lead notes govern this task.
- Followed lead's existing branch-protection investigation: private free-plan repo, no required-check workaround or CI-skipped job needed.
- Retained root `*.md` ignores as requested; package README/CHANGELOG paths remain eligible for CI.
- All validation and pack commands, reader steps/matrix, permissions and timeouts are retained.
- No ABC import changes; no ABC guide update needed.

## Open questions
None for implementation. GitHub execution and post-merge event behavior require lead verification.

## Return / follow-ups
- **Outcome:** implementation complete; remote CI and post-merge verification remain with lead.
- **Commits:** acknowledgement `cb46363`; workflow and return handoff in the following commit.
- **Follow-ups:** lead reviews PR CI/container execution, verifies post-merge docs-only suppression, and continues docs-only ledger handling from lead notes. No watch or polling performed by implementer.
- **For GBrain (lead to promote):** docs-only/orchestration changes no longer start this CI; CI begins when a PR opens, and main pushes retain Chromium checks only. Savings are estimates until observed.
