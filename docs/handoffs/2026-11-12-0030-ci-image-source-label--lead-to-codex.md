# Handoff: 0030 — [quick] CI image: link package to repo so GITHUB_TOKEN can publish (lead → codex)

- **Date:** 2026-11-12
- **Type:** quick (CI follow-up to 0027; human-approved item)
- **Ledger:** 0030
- **Branch:** orch/0030-ci-image-source-label · **Worktree:** created by T3
- **Base commit:** a3cbd5d
- **Status:** open

## Goal
The first run of `.github/workflows/ci-image.yml` after merging #96 (0027) pushed every layer, then failed on the manifest with `error from registry: denied`. The account `pepperhorn` is a **user** account, and the package doesn't exist yet. The usual cause is a new GHCR package created by `GITHUB_TOKEN` without a link to the repository.

Fix: add the following to `.github/ci-image/Dockerfile`, as the 0027 review suggested:
```
LABEL org.opencontainers.image.source=https://github.com/pepperhorn/ph-scoreview
```
Also add a description label. Check GitHub's docs ("Connecting a repository to a package", and publishing with `GITHUB_TOKEN`) for anything else needed on a user-owned repo. Examples: a package-name rule, or the `docker/build-push-action` with `labels`. If the docs say `GITHUB_TOKEN` cannot create a new package for a user account, stop and say so in the return handoff. The fallback would be a one-time push by the human with a PAT; don't do that yourself.

Merging this PR changes `.github/ci-image/**` on main, which re-runs the publish. That run is the real test.

## Files you own
- `.github/ci-image/Dockerfile`
- `.github/workflows/ci-image.yml` (only if the docs require it)
- your own 0030 handoff files

## Acceptance criteria
- [ ] `docker build .github/ci-image` succeeds, and `docker inspect` shows the source label.
- [ ] actionlint is clean if you touched the workflow.
- [ ] The return handoff cites the GitHub doc that supports the fix.

## Verify with
```bash
docker build -t ph-ci-test .github/ci-image && docker inspect ph-ci-test --format '{{json .Config.Labels}}'
```
There are no runtime changes, so the project's full verify isn't needed.

---
## Receiver ack
Codex acknowledges task 0030: check GitHub's Container registry documentation for
repository linkage and GITHUB_TOKEN publishing on a user account, add source and
description OCI labels to the CI Dockerfile, then build locally and inspect the
labels. Only the owned Dockerfile, workflow if required by the docs, and task 0030
handoffs may change. No PAT push or live package publication; the lead owns merge
and the publish run after merge. No open scope questions. Full runtime validation
is waived by this handoff.
