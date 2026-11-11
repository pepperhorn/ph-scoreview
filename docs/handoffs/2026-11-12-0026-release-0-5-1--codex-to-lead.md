# Handoff: 0026 — Release pepperscore 0.5.1 (codex → lead)

- **Date:** 2026-11-12
- **Type:** return
- **Ledger:** 0026 (quick; no separate spec/plan)
- **Branch:** `orch/0026-release-0-5-1`
- **Worktree:** `/home/shaun/.t3/worktrees/ph-vexflow-view/t3-9d3eabcd-610a4e283e554427`
- **Base commit:** `76b76e0` (includes required ancestor `86bb9bf`)
- **Commits:** `acea222` (receiver acknowledgement first), `8d18381` (release preparation); this return is a subsequent docs commit.
- **PR:** draft PR against main; URL in the delivery message.
- **Status:** complete; ready for independent review.
- **Outcome:** done; all required local verification passed.

## Goal
Prepare pepperscore 0.5.1 with accurate release notes and a verified npm tarball. [Dispatch and committed acknowledgement](2026-11-12-0026-release-0-5-1--lead-to-codex.md). Publishing remains a separate human action; no npm publish or login was performed.

## Scope and files owned
- Original ownership: version only in `packages/pepperscore/package.json`, pepperscore version entries in root `package-lock.json`, `packages/pepperscore/CHANGELOG.md`, and my two 0026 handoffs.
- **Human-approved scope extension, 2026-11-12:** `apps/reader/package.json` pepperscore pin and the corresponding lockfile dependency entry, both 0.5.0 → 0.5.1. The first `npm ci` failed with `Missing: pepperscore@0.5.0 from lock file`: the reader's exact pin no longer matched the bumped local workspace. The human explicitly approved updating the pin and matching lock entry before those edits. No other dependencies changed.
- Out: publishing, runtime/source/styles changes, editor release, CI/infra, public APIs, other docs, ledger and GBrain writes.
- Scope audit: only the four release files listed above and my two 0026 handoffs differ from main.

## Acceptance criteria
- [x] Package version and workspace lock entry are 0.5.1; reader dependency resolves to that local version.
- [x] `npm run test:pack` passes, and a separate real tarball's internal `package/package.json` reports `pepperscore@0.5.1`.
- [x] Every 0.5.1 changelog bullet traces to a merged PR, as mapped below.
- [x] Historical changelog text from 0.5.0 onward is byte-for-byte unchanged.

## Decisions made / changelog traceability
- **Changed: finger-TAB position continuity** → [PR #92](https://github.com/pepperhorn/ph-scoreview/pull/92), [0023 return](2026-11-11-0023-fretless-position-continuity--codex-to-lead.md). Wording describes display-only fingering selection and unchanged pitches/playback. It does not claim an improvement in every score: the acceptance cello sequence went 84 → 55 shifts, while violin stayed 0 → 0.
- **Changed: cooperative PDF and Cancel/progress** → [PR #94](https://github.com/pepperhorn/ph-scoreview/pull/94), [0002-t4 return](2026-11-12-0002-t4-pdf-large-browsers-docs--claude-to-lead.md). Existing Unreleased wording retained.
- **Fixed: Safari pitch outlines** → [PR #91](https://github.com/pepperhorn/ph-scoreview/pull/91), [0022 return](2026-11-11-0022-safari-pitch-outline--codex-to-lead.md). Includes both default and host-set outlines and retained reader-mark colours.
- **Fixed: WebKit PDF verification and lazy-chunk recovery** → PR #94 and 0002-t4 return above. Existing wording correctly scopes recovery to Vite/native ESM and ordinary error/Reload behavior to other bundlers.
- Omitted a separate line for [PR #90](https://github.com/pepperhorn/ph-scoreview/pull/90): a worked README skin example changes no library behavior ([0001-t5 return](2026-11-11-0001-t5-skins-docs--claude-to-lead.md)).
- Skipped CI-only #89 and editor-only #93. `git diff 9a3ab8c..HEAD -- packages/pepperscore` confirms viewer changes are the skin/PDF docs, pitch CSS, fingering selection and PDF work covered above, with no editor publishing change in viewer files.
- No ADR needed.

## Known gotchas / GBrain
Consulted `default:projects/scoreflow-music-reader` and `default:projects/scoreflow-music-reader/gotchas-abc-import` for project context. Current dispatch and repo docs govern. Implementer made no GBrain writes; lead owns promotion.

## For the ABC guide
No ABC import behavior changed.

## Verify with
```bash
npm ci
npm run check && npm run build && npm run test:pack
npm run test:manifest && npm run test:validation
npm pack --json --ignore-scripts --pack-destination /tmp/0026-pack-artifact -w pepperscore
# Inspect package/package.json inside pepperscore-0.5.1.tgz; require version === 0.5.1.
git diff --check
git diff --stat main...HEAD
```

## Verification output
All commands below exited 0 after the approved reader-pin correction. Default budgets were used; no assertions, tests or budgets changed.

```text
npm ci
added 378 packages, and audited 384 packages in 14s
npm run check
Result (23 files): 0 errors, 0 warnings, 0 hints
npm run build
Demo build uses the library dist (worker chunks and Verovio files match) and ships its notices
npm run test:pack
Pack smoke: pepperscore-0.5.1.tgz (124 files) has the build output and no sources
Pack smoke: a fresh Vite + React host build passed
Pack smoke: Vite: a failed lazy PDF chunk recovers through the cache-busted retry
Pack smoke: a fresh Webpack + React host build passed
Pack smoke: Webpack: a failed lazy PDF chunk degrades to the ordinary error and Reload button
Pack smoke: a fresh Astro + React host build (client:only island) passed
Pack smoke: importing pepperscore in Node touches no window, document, storage or location
Pack smoke: a fresh Astro SSR host (output: server, @astrojs/node, client:visible island) built, served and answered 200
npm run test:manifest
GM manifest: 128 local packs, 16 icons and playable voices verified.
Sound packs: complete pack.json, generated core (19 FluidR3 sounds) and versions passed
npm run test:validation
Test Files 20 passed (20); Tests 716 passed (716) [pepperscore]
Test Files 28 passed (28); Tests 295 passed (295) [editor]
Finger TAB: dense violin/cello, Notation/Both/TAB, whole/chunk/probe, transposition, playback and rasterized PDF passed
PDF overlay Cancel click mid-page (chromium): input delay 73 ms, dialog closed 3 ms after delivery; Playwright click including its own waits 773 ms (not gated)
Poppler raster: staff width/6.5 mm height, known notehead and aligned note-name ink passed.
Vector composition passed: four exact paper sizes, embedded/selectable text, RGB paths, multipage annotated export, unsupported glyph error, cancellation.
PDF page model spike passed (chromium): A4 4 lines; A3 4; 2 pages for 80 bars.
PDF large score (chromium, 30 parts x 12 bars): export 29774 ms, 3 pages, longest timer gap 362 ms {"engraving":17,"annotating":174,"composing":362}, longest long task 215 ms; cancel latency startup 0 / mid-page 30 / between pages 29 ms
Full validation command chain: exit 0
Packed manifest: pepperscore@0.5.1 (pepperscore-0.5.1.tgz)
git diff --check: exit 0
```

Logs: `/tmp/0026-{ci,check,build,pack,manifest,validation}.log`; independently inspected tarball: `/tmp/0026-pack-artifact/pepperscore-0.5.1.tgz`. These are local transient evidence; the output above is committed. npm ci printed audit/install-script advisories; no dependency or audit fixes were made.

## Open questions / follow-ups
None for implementation. Lead owns cross-model review, CI confirmation, ledger update and merge. Human owns npm login and publication after release approval. Browser validation in this run used Chromium; the WebKit/Firefox release-note claims trace to merged PR #94, whose cross-browser checks were not repeated for this metadata-only task. No npm publishing occurred.

## For GBrain (lead to promote)
Workspace releases must update the private reader exact pin with the viewer version, or npm ci rejects the lockfile/workspace resolution. Scope extension was approved by the human here.
