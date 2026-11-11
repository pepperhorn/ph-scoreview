# Handoff: 0017 — Prepare pepperscore 0.5.0 (codex → lead)

- **Date:** 2026-11-11
- **Type:** return
- **Ledger:** 0017 (quick; no separate spec/plan)
- **Dispatch:** [lead-to-codex](2026-11-11-0017-release-0-5-0--lead-to-codex.md)
- **Branch:** `orch/0017-release-0-5-0`
- **Worktree:** `/home/shaun/.t3/worktrees/ph-vexflow-view/t3-5de38d86-837e74894e3847b8`
- **Base commit:** `e3772e6` (contains pinned `9d3c36e`)
- **Receiver acknowledgement:** `b3b8db0`
- **Release/verification commit:** `035ddae` (only this handoff changes afterward)
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/85 (draft; no watching/polling)
- **Status:** closed

## Goal
Prepare the human-approved 0.5.0 package version and accurate release notes covering the merged pepperscore changes since 0.4.1. Publishing belongs to the human/lead, not this task.

## Scope
- **In / files owned:** version only in `packages/pepperscore/package.json`; pepperscore workspace version only in root `package-lock.json`; `packages/pepperscore/CHANGELOG.md`; receiver ack in the dispatch and this return handoff.
- **Out / do not touch:** runtime code, APIs, dependency specifications, other docs, ledger, npm publication, tags, merge and GBrain writes.

## Acceptance criteria
- [x] Package and workspace lock versions are 0.5.0; pack smoke passes and an actual tarball manifest reports 0.5.0.
- [x] CHANGELOG section `0.5.0 - 2026-11-11` uses Added / Changed / Fixed plus Behaviour changes; every feature bullet is traced below.

## Release-note traceability
The prior release's version commit is `4cd4352` (merged by PR #58 / `9fd59e6`). Inspected `git log --merges --first-parent 4cd4352..HEAD`, package diff and the corresponding return handoffs in this directory. No tags were present.

| CHANGELOG topic | Merged evidence / return handoff |
|---|---|
| Skin prop, tokens, palette data and exports | #59 / `9afa2f2`; [0001 T1](2026-11-01-0001-t1-skin-module-and-tokens--codex-to-lead.md) |
| Composable bars and annotation toggles | #66 / `13d48eb`; [0001 T2](2026-11-10-0001-t2-skin-bar--codex-to-lead.md) |
| Drawer actions and phone toolbar | #72 / `9205fc6`; [0001 T3](2026-11-10-0001-t3-drawer-controls--codex-to-lead.md) |
| Pitch-colour setting, handle and tile; internal PDF colour painting | #81 / `299d463`; [0001 T4](2026-11-11-0001-t4-pitch-colours--codex-to-lead.md) |
| Fretted string TAB, tunings, host override and fallback removal | #77 / `d248d7b`; [0013 T1](2026-11-10-0013-t1-string-instruments--codex-to-lead.md) |
| ABC spelling, keys, text, barlines and clefs | #60 / `8037061`, #63 / `c48dc0e`, #65 / `4629f1a` (tests only); [0004 T1](2026-11-09-0004-t1-abc-engraving-fidelity--codex-to-lead.md), [0005](2026-11-10-0005-mid-bar-keysig-once--codex-to-lead.md) |
| ABC grand staff, MIDI, transposition, first tune and directive scoping | #61 / `18ee573`, #62 / `f766e13`, #67 / `8c19b8f`; [0004 T2](2026-11-09-0004-t2-abc-parts-and-instruments--codex-to-lead.md), [0006](2026-11-10-0006-abc-directive-scoping--codex-to-lead.md), [0008](2026-11-10-0008-abc-voice-before-x--codex-to-lead.md) |
| Published ABC rules/templates | #64 / `c19e361`, #70 / `a15bf84`; [0007](2026-11-10-0007-readme-abc-authoring--codex-to-lead.md), [0010](2026-11-10-0010-readme-abc-sync--codex-to-lead.md); [ABC guide](../guides/abc-authoring.md) |
| Sounding octave clefs, MusicXML normalization and guitar switch | #75 / `3927afd`; [0012](2026-11-10-0012-octave-clef--codex-to-lead.md) |
| Bass/voice naming, ukulele sound and instrument nouns | #80 / `c1415a0`; [0016](2026-11-11-0016-instrument-names--codex-to-lead.md) |
| Choir variants, Treble policy, horns and diacritics | #82 / `9d3c36e`; [0018](2026-11-11-0018-choir-and-horn-names--codex-to-lead.md) |
| Internal PDF page model and vector composition | #71 / `6d0d41a`, #78 / `03d0ac7`; [0002 T1](2026-11-10-0002-t1-pdf-page-model--codex-to-lead.md), [0002 T2](2026-11-10-0002-t2-pdf-composition--codex-to-lead.md) |

## Decisions made / known gotchas
- Explicitly label PDF as internal groundwork: no export UI or public export API exists in this base. `compose.ts` dynamically imports both `jspdf` and `svg2pdf.js`; both are already package dependencies. No dependency changes in this PR.
- Do not advertise the fretless spike (#74 / `9662519`) as integrated TAB. Charts/solver are internal groundwork; reader integration remains a separate task.
- Omit validation-only #73 and editor-only #68/#69/#76/#79 from this package's user-facing release notes. The package diff since 0.4.1 was audited for coverage.
- Behaviour changes explicitly cover Bass, Alto/Tenor, no non-string TAB fallback, matching string counts for tuning, and sounding-pitch ABC octave clefs.
- GBrain consulted: `default:projects/scoreflow-music-reader` (historical project context), `default:projects/scoreflow-music-reader/gotchas-abc-import` (sounding-pitch rule corroborated against current source and guide). Repo docs/source control release details. No implementer GBrain writes.
- For the ABC guide: no import behavior changes in this release-metadata-only PR; it summarizes already-merged changes.

## Verify with
```bash
npm ci
npm run check && npm run build && npm run test:pack
npm run test:manifest && npm run test:validation
git diff --check
git diff --stat main...HEAD
```
An additional local `npm pack --ignore-scripts` tarball manifest read confirms the actual packed version, without publishing.

## Verification output
All commands in Verify with exited 0 on the final release-file content. No implementation changes were needed during verification. Only handoff documentation changes after these results. Local results do not assert GitHub CI or review approval.

```text
npm ci: exit 0
npm run check: 0 errors, 0 warnings, 0 hints (23 Astro files)
npm run build: Complete; demo/library dist and notices check passed
npm run test:pack: pepperscore-0.5.0.tgz (111 files), no sources
  fresh Vite + React host build passed
  fresh Astro + React client:only host build passed
  Node import touches no window/document/storage/location
  Astro SSR client:visible host built, served and answered 200
Tarball manifest: pepperscore@0.5.0; release CHANGELOG included
npm run test:manifest:
  GM manifest: 128 local packs, 16 icons and playable voices verified
  Sound packs: complete pack.json, generated core and versions passed
npm run test:validation: exit 0
  pepperscore: 17 files, 687 tests passed
  editor: 27 files, 294 tests passed
  TAB bake: all 784 checks passed
PDF page model spike passed (chromium): A4 4 lines; A3 4; 2 pages for 80 bars.
git diff --check: exit 0
```

Logs: `/tmp/0017-{ci,check,build,pack,manifest,validation}.log`, `/tmp/0017-tarball.log`. Actual local tarball: `/tmp/0017-release-pack/pepperscore-0.5.0.tgz` (not published). Scope audit: only the three release files and the two 0017 handoffs differ from the task base; `git diff --stat main...HEAD` excludes the lead's later ledger-only commit on main. No ledger edit by this branch.

## Open questions / follow-ups
No scope questions. Lead to arrange other-family review, check CI, merge and provide the human with publication instructions separately. Do not publish, watch or poll this PR.

## Return
- **Outcome:** done — all required local checks passed; ready for review
- **What changed:** release metadata and notes only, plus task handoffs.
- **For GBrain (lead to promote):** record the release outcome only after merge/publication as appropriate; preparing a tarball is not publication proof.
