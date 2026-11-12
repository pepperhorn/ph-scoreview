# Handoff: 0027 — CI image with Poppler baked in (codex → lead)

- **Date:** 2026-11-12
- **Type:** return
- **Ledger:** 0027 (quick; no spec or plan)
- **Branch:** orch/0027-ci-image-poppler
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-5af773b8-12ba7c349610e2a5
- **Base commit:** f1f24b0a82dcad00d7bb0c1e07b44473a501916c (contains dispatch base 7c2da17)
- **Implementation commit:** 8d9c14ceea4f2d97af22bb5a62e816d518345f95
- **PR:** draft against main, created after this handoff commit; see branch PR and implementation response.
- **Status:** closed (implementation returned; review and CI remain with lead)

## Goal and context

Remove per-run Poppler downloads after an explicit CI image switch, while preserving the current MCR image when `CI_IMAGE` is unset. Dispatch and receiver acknowledgement: [lead-to-codex](2026-11-12-0027-ci-image-poppler--lead-to-codex.md). Runner instructions: [self-hosted-runner.md](../guides/self-hosted-runner.md#ci-image).

GBrain searched: `projects/scoreflow-music-reader`; search returned no CI-specific decisions. No GBrain writes (implementer role).

## Scope and files owned

- `.github/ci-image/Dockerfile`: Playwright v1.63.0-noble plus Poppler, apt lists cleaned; no repository content copied.
- `.github/workflows/ci-image.yml`: manual/main Dockerfile-path publishing to GHCR with `contents: read`, `packages: write` and `GITHUB_TOKEN`.
- `.github/workflows/ci.yml`: only the two container-image declarations, adjacent tag comments, and Poppler fallback commands.
- `docs/guides/self-hosted-runner.md`: appended CI image section only.
- Own dispatch ack and this return handoff.

Out of scope: runtime code, dependencies, ledger, publishing the image, package visibility, CI repository variables, and merging. No changes to these.

## Acceptance criteria and verification

- Both jobs use `${{ vars.CI_IMAGE || 'mcr.microsoft.com/playwright:v1.63.0-noble' }}`. A GET-only `gh variable list -R pepperhorn/ph-scoreview --json name` returned no variables; `CI_IMAGE` is unset. PR CI success remains unverified: no watching or polling per brief.
- Poppler fallback is exactly `command -v pdftoppm || (apt-get -o Acquire::Retries=5 update && apt-get -o Acquire::Retries=5 install -y poppler-utils)`.
- Workflow lint: actionlint v1.7.12 installed into `/tmp/0027-tools` (no repo dependency); both workflows passed with no diagnostics.
- `npm ci && npm run check && npm run build`: passed (exit 0). Output tail:

  ```text
  added 378 packages, and audited 384 packages in 32s
  Result (23 files):
  - 0 errors
  - 0 warnings
  - 0 hints
  [build] 10 page(s) built in 8.83s
  [build] Complete!
  Demo build uses the library dist (worker chunks and Verovio files match) and ships its notices
  ```
- Docker build and Poppler: passed (exit 0 for both commands). Output:

  ```text
  #6 unpacking to docker.io/library/ph-ci-test:latest 133.7s done
  #6 DONE 135.2s
  pdftoppm version 24.02.0
  ```
- `git diff --check`: passed; scope audit lists only owned paths.

Commands:

```bash
npm ci && npm run check && npm run build
docker build -t ph-ci-test .github/ci-image
docker run --rm ph-ci-test pdftoppm -v
/tmp/0027-tools/actionlint .github/workflows/ci.yml .github/workflows/ci-image.yml
git diff --check
git diff --stat main...HEAD
```

## Decisions made

Used the dispatch's permitted **public GHCR package fallback**; no container credentials are supplied. There is no working private-image route within the permitted `ci.yml` edit scope: existing `permissions` grants only `contents: read`, so all unspecified permissions (including packages) are none. Private GHCR pulls need `packages: read` plus package access and conditional credentials; changing CI permissions is outside the explicitly owned image/credentials/Poppler portions. Anonymous pulls preserve MCR behavior and avoid sending GitHub credentials to MCR. The derived image contains only public Playwright and Poppler; recommend making this package public before switching. No claim that MCR accepts GitHub credentials; that was not tested.

References: [GitHub token permission rules](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions), [GHCR authentication and package access](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry). These explain why private authentication would need a broader permission edit. If package-public policy disallows this, leave `CI_IMAGE` unset and authorize that separate edit before switching.

## Exact switch-on steps (lead/human, after merge)

1. Publish on main, then confirm the **Publish CI image** run succeeded:

   ```bash
   gh workflow run ci-image.yml -R pepperhorn/ph-scoreview --ref main
   ```

2. In GitHub package settings for `pepperhorn/ph-scoreview-ci`, change visibility to **public**. Verify an anonymous pull with a temporary empty Docker config:

   ```bash
   ci_image_docker_config=$(mktemp -d)
   docker --config "$ci_image_docker_config" pull ghcr.io/pepperhorn/ph-scoreview-ci:v1.63.0-noble
   rmdir "$ci_image_docker_config"
   ```

3. Switch both CI jobs:

   ```bash
   gh variable set CI_IMAGE -R pepperhorn/ph-scoreview --body 'ghcr.io/pepperhorn/ph-scoreview-ci:v1.63.0-noble'
   gh workflow run ci.yml -R pepperhorn/ph-scoreview --ref main
   ```

4. Rollback, if required:

   ```bash
   gh variable delete CI_IMAGE -R pepperhorn/ph-scoreview
   ```

Keep the Dockerfile base, publisher tag, CI fallback, and `playwright-core` versions aligned; publish a new image tag before changing `CI_IMAGE`.

## Return

- **Outcome:** implementation complete; live publication/switch and PR CI acceptance remain with lead.
- **Commits:** 8393204 receiver ack; 8d9c14c implementation; this return handoff committed separately.
- **Scope audit:** only the six owned paths changed (including both handoffs); guide changes append the new section only.
- **Open questions:** none blocking this implementation. Public package visibility is an explicit activation prerequisite.
- **Follow-ups:** cross-family review, check PR CI with `CI_IMAGE` unset, human merge approval (CI/infra change), then publication and opt-in steps above. No monitors started.
- **For GBrain (lead to promote):** CI image needs public package visibility before opting in; unset `CI_IMAGE` preserves MCR and apt fallback. No ABC guide changes.
