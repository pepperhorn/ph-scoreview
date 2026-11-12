# Handoff: 0027 — CI image with Poppler baked in (S37) (lead → codex)

- **Date:** 2026-11-12
- **Type:** quick (CI change, human-approved; merge needs human OK)
- **Ledger:** 0027
- **Branch:** orch/0027-ci-image-poppler · **Worktree:** created by T3
- **Base commit:** 7c2da17
- **Status:** open

## Goal
Stop CI going red when Ubuntu's apt mirror fails DNS (S37 in `docs/wip/LEDGER.md`; runs 43059869776, 43060590510). Both the `validate` job and the `reader` job (`.github/workflows/ci.yml:36-39` and `:104-107`) `apt-get install poppler-utils` on every run.

The approach:
1. Add `.github/ci-image/Dockerfile`: `FROM mcr.microsoft.com/playwright:v1.63.0-noble`, plus `poppler-utils`, with the apt lists cleaned. Nothing else.
2. Add `.github/workflows/ci-image.yml`. It runs on `workflow_dispatch` and on pushes to `main` that touch `.github/ci-image/**`. It builds the image and pushes it to `ghcr.io/pepperhorn/ph-scoreview-ci:v1.63.0-noble` with `GITHUB_TOKEN` and `permissions: packages: write`. The tag must track the Playwright tag.
3. In `ci.yml`, both jobs take their image from `${{ vars.CI_IMAGE || 'mcr.microsoft.com/playwright:v1.63.0-noble' }}`. That way CI keeps working before the image exists, and the human or lead switches over by setting `CI_IMAGE`. Pulling from private ghcr needs `container.credentials`. Work out a form that also works when the image is the public mcr one (for example, credentials always set to `github.actor` / `secrets.GITHUB_TOKEN`; check whether mcr tolerates that). If no clean form exists, say so in the return handoff and recommend making the ghcr package public; the image holds no secrets.
4. Keep the Poppler step only as a fallback: `command -v pdftoppm || (apt-get -o Acquire::Retries=5 update && apt-get -o Acquire::Retries=5 install -y poppler-utils)`.
5. Add a comment in `ci.yml` next to the Playwright tag saying the ci-image Dockerfile tag must be bumped with it.
6. Add a short "CI image" section to `docs/guides/self-hosted-runner.md` covering the publish workflow and the `CI_IMAGE` variable. You own that section only.

## Files you own
- `.github/ci-image/Dockerfile` (new)
- `.github/workflows/ci-image.yml` (new)
- `.github/workflows/ci.yml` (container image, credentials and Poppler steps only)
- `docs/guides/self-hosted-runner.md` (the new "CI image" section only)
- your own 0027 handoff files

## Acceptance criteria
- [ ] With `CI_IMAGE` unset, the PR's CI is green and behaves exactly as today. The Poppler fallback runs.
- [ ] `docker build .github/ci-image` succeeds locally if docker is available; otherwise say so. `pdftoppm -v` works in the image.
- [ ] `ci-image.yml` is valid. Run `actionlint` if you can get it without adding a dependency, or `npx --yes action-validator`; otherwise do a careful read and say so.
- [ ] The return handoff lists the exact switch-on steps: run the workflow, then `gh variable set CI_IMAGE …`.

## Verify with
```bash
npm ci && npm run check && npm run build
docker build -t ph-ci-test .github/ci-image && docker run --rm ph-ci-test pdftoppm -v
```
The project's full verify isn't needed (no runtime code changes).
