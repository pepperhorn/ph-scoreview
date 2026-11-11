# Handoff: adhoc — [quick] Cut CI minutes / GitHub Actions spend (human → lead)

- **Date:** 2026-11-11
- **Type:** quick
- **Ledger:** 0021
- **Branch:** `orch/0021-ci-minutes` · **Worktree:** created by T3
- **Base commit:** d95911e
- **Status:** closed

## Goal
ph-scoreview CI is the main reason for our GitHub Actions bill. This month so far (1–11 Nov), the account has used 11,568 Linux minutes and been billed $54.41 after the free quota ran out on 8 Nov. ph-scoreview is $33.80 of that, and it was $31.10 in October. Since 9 Nov the account has used 2,400–3,600 minutes a day, which is about $15/day.

Cut ph-scoreview's billed minutes by about 70–80% **without dropping coverage of code changes**.

## Why it costs so much
One CI run is 3 parallel jobs (`validate` chromium plus `reader` firefox and webkit) of about 15–18 min each, so roughly 45 billed minutes, or about $0.27, per run. Three things multiply that:

1. **Docs-only commits run the full suite.** Most recent runs on `main` are `docs(ledger)` / `docs(handoffs)` commits that only touch `docs/wip/LEDGER.md` and `docs/handoffs/**` (checked: 51e9ac0, 91c265b, d95911e, 29c6a69, adb17d1). `cancel-in-progress` cancels many of them partway, but GitHub still bills the minutes each one used.
2. **PR commits run twice.** `on: push:` has no branch filter and `pull_request:` is also set, so every push to an `orch/*` branch with an open PR starts two runs: a push run and a `synchronize` run. The concurrency group is `ci-${{ github.ref }}`, and the ref differs between them (`refs/heads/orch/...` vs `refs/pull/N/merge`), so neither cancels the other.
3. **Each run reinstalls everything.** Every `validate` run does `playwright-core install --with-deps chromium` plus `apt-get install poppler-utils` from scratch.

## Change to make (`.github/workflows/ci.yml`)

```yaml
on:
  push:
    branches: [main]
    paths-ignore: ['docs/**', '*.md']
  pull_request:
    paths-ignore: ['docs/**', '*.md']
  workflow_dispatch:

concurrency:
  group: ci-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

On the `reader` job, run Firefox/WebKit on PRs only. They already ran on the PR, so running them again on main after the merge adds nothing:

```yaml
  reader:
    if: github.event_name != 'push'
```

Optional, only if it's trivial: run `validate` in the same `mcr.microsoft.com/playwright:v1.63.0-noble` container that `reader` uses. That removes the `--with-deps` apt install; poppler-utils would still need installing.

## Check before merging
- **Required status checks.** If branch protection on `main` requires `CI`, a docs-only PR will now never get that check and will be stuck waiting. Either make the check not required, or add a tiny "CI skipped" job for docs-only changes. Look at the branch protection settings before merging.
- **Orchestration flow.** Any ledger rule that waits on `ci` after a docs-only merge to main will now wait forever, because no run starts. Change the lead's ledger handling so docs-only merges don't set `Waiting on: ci`.
- **Branches without a PR.** Pushes to `orch/*` branches that don't have a PR yet no longer run CI. CI starts when the PR is opened. That matches how handoffs already work ("CI on the PR is the real check").
- `*.md` only matches files at the repo root (README, CHANGELOG). If the pack smoke test should still run when README changes for a release, remove `'*.md'` from both lists.

## Files you own
`.github/workflows/ci.yml`, your own handoff files, and the ledger row for this item.

## Acceptance criteria
- [ ] A commit that only touches `docs/**` starts **no** CI run on `main` or on a PR.
- [ ] A push to a PR branch starts **one** CI run, not two.
- [ ] `reader` (firefox/webkit) runs on PRs and does not run on a push to `main`.
- [ ] The PR's own CI run is green.
- [ ] The lead's ledger flow no longer waits on `ci` for docs-only commits.

## Verify with
```bash
npx --yes @action-validator/cli .github/workflows/ci.yml || true   # syntax sanity
```
After merging, push a docs-only commit to main and check that the Actions tab shows no new CI run.

## Out of scope (separate item if wanted)
Moving CI to a self-hosted runner on our Coolify infrastructure (`runs-on: self-hosted`). Self-hosted minutes are currently free and would remove almost all of what's left of this cost. That needs an infrastructure decision first.

---
## Receiver ack

Codex (2026-11-11): I will restrict CI pushes to main, ignore docs/root Markdown/orchestration-only paths for push and PR events, key concurrency by PR number or ref, and skip reader jobs on main pushes while keeping PR and manual browser coverage. I will assess the optional validate container change and preserve Poppler. I own only `.github/workflows/ci.yml` and my 0021 handoffs; the ledger and docs-only CI waiting policy stay with the lead. I will validate locally, push `orch/0021-ci-minutes`, open a draft PR, and return without watching or polling it. No open questions. GBrain checked: `default:projects/scoreflow-music-reader` and `default:projects/scoreflow-music-reader/gotchas-abc-import`; no CI-specific guidance found.

---
## Lead notes (2026-11-11)
- **Branch protection:** this private repo is on the free plan, so `main` has no branch protection or required checks (API returns 403 "Upgrade to GitHub Pro"). No required-check workaround is needed; don't add a "CI skipped" job.
- **Keep `'*.md'` in paths-ignore** except: README/CHANGELOG changes in `packages/pepperscore/` are under `packages/**`, so they still run CI (pack smoke included). Root `*.md` (AGENTS.md, CLAUDE.md) don't need CI.
- **Also ignore** `.ph-orch.json` and `.claude/**` (orchestration config, no code).
- **Do the optional container change** for `validate` only if it's trivial and keeps poppler-utils working; otherwise record as a follow-up.
- The lead will stop setting `Waiting on: ci` for docs-only commits (lead process, not this PR).
- Implementer: you own `.github/workflows/ci.yml` and your own 0021 handoff files only (not the ledger — the lead owns it).
