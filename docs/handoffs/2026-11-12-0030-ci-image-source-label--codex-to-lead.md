# Handoff: 0030 — CI image source label (codex → lead)

- **Date:** 2026-11-12
- **Type:** return
- **Ledger:** 0030 · **Spec/plan:** quick item; [dispatch handoff](2026-11-12-0030-ci-image-source-label--lead-to-codex.md)
- **Branch:** orch/0030-ci-image-source-label
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-7b8d7de5-771b594313f67ce1
- **PR:** draft to be opened immediately after committing this return; find by branch above.
- **Base commit:** ec937b74b1410d39d071001cbc0fac15749706b7 (includes pinned a3cbd5d)
- **Commits:** receiver ack e01080f; implementation 7dd030fa72567698492400e2ad2b6c7dc751f731; this return follows.
- **Status:** closed (implementation complete; review and live publish remain with lead)

## Goal
Associate the CI image with pepperhorn/ph-scoreview using OCI metadata, so the
publish workflow can use its GITHUB_TOKEN for the GHCR package.

## Context you need
The dispatch reports that the initial publish failed at manifest upload with
`error from registry: denied`. Missing linkage is a proposed cause, not a confirmed
root cause. Local build success cannot establish that the live registry accepts it.

## Scope
- **In / files owned:** `.github/ci-image/Dockerfile`, `.github/workflows/ci-image.yml` only if docs require it, and own 0030 handoffs.
- **Out / do not touch:** runtime code, dependencies, other docs, ledger, credentials, package settings, live publication and merge.
- **Changed:** Dockerfile source and description labels; dispatch ack; this return.
- Workflow unchanged; actionlint is not applicable.

## Acceptance criteria
- [x] Local Docker build succeeds.
- [x] Docker inspect shows the exact requested repository source label and description.
- [x] Supporting GitHub documentation cited below.
- [x] Only owned files changed; `git diff --check` passes.

## Verify with
```bash
docker build -t ph-ci-test .github/ci-image && docker inspect ph-ci-test --format '{{json .Config.Labels}}'
git diff --check
git diff --stat main...HEAD
```

## Known gotchas / decisions already made
GBrain searched: [default:projects/scoreflow-music-reader] (project context only);
no relevant GHCR-specific guidance found. Repo handoff and current GitHub docs
are the authority for this change. No GBrain writes by implementer.

## Return
- **Outcome:** done; ready for review.
- **What changed:** added `org.opencontainers.image.source=https://github.com/pepperhorn/ph-scoreview` and a text description of the CI image's Playwright/Poppler tools.
- **Verification output** (exit 0; existing apt layer cached):

```text
#5 [2/2] RUN apt-get ... install ... poppler-utils ...
#5 CACHED
#6 naming to docker.io/library/ph-ci-test:latest 0.0s done
#6 unpacking to docker.io/library/ph-ci-test:latest 0.0s done
#6 DONE 0.2s
{"org.opencontainers.image.description":"PepperScore CI image with Playwright browsers and Poppler PDF tools","org.opencontainers.image.source":"https://github.com/pepperhorn/ph-scoreview","org.opencontainers.image.version":"24.04"}
```

Full runtime verification is explicitly waived by the dispatch (metadata-only).

## Decisions made / documentation evidence
- [Connecting a repository to a package](https://docs.github.com/en/packages/learn-github-packages/connecting-a-repository-to-a-package#connecting-a-repository-to-a-container-image-using-the-command-line) gives the Dockerfile source-label method, including a personal-account example, and repository access inheritance.
- [Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#pushing-container-images) recommends the source label for GITHUB_TOKEN permissions. It supports personal-account namespaces, and its labeling section documents the description key. This supports the requested fix; it does not prove the original denial's cause.
- [Publishing and installing a package with GitHub Actions](https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/publishing-and-installing-a-package-with-github-actions#default-permissions-and-access-settings-for-packages-modified-through-workflows) explicitly describes package creation by GITHUB_TOKEN. Its workflow examples include both build-push-action and plain docker build/push with packages: write and GITHUB_TOKEN, and a package name distinct from the repository name.
- No documented prohibition on creating user-owned GHCR packages with GITHUB_TOKEN was found. No PAT bootstrap or workflow conversion is required by these docs. Existing lowercase namespace/image and workflow permissions already match this guidance. No ADR needed.

## Open questions / follow-ups
No implementation questions. Lead: review, then obtain the required human merge
approval for this CI change. A main-branch merge changes `.github/ci-image/**`
and triggers the existing publisher; that run is the actual registry validation.
If denied again, investigate live package linkage/Actions access before choosing
a fallback. No PAT push, package mutation, publish dispatch, PR watching or polling
was performed here.

- **Out-of-scope issues found:** none.
- **For GBrain (lead to promote):** preserve the distinction between successful local label inspection and confirmed GHCR publication; record the actual publish outcome after merge.
- **For the ABC guide:** no ABC import behavior changed.
