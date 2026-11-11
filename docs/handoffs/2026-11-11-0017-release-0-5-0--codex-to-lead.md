# Handoff: 0017 — Prepare pepperscore 0.5.0 (codex → lead)

- **Date:** 2026-11-11
- **Type:** return
- **Ledger:** 0017 (quick; no separate spec/plan)
- **Dispatch:** [lead-to-codex](2026-11-11-0017-release-0-5-0--lead-to-codex.md)
- **Branch:** `orch/0017-release-0-5-0`
- **Worktree:** `/home/shaun/.t3/worktrees/ph-vexflow-view/t3-5de38d86-837e74894e3847b8`
- **Base commit:** `e3772e6` (contains pinned `9d3c36e`)
- **Receiver acknowledgement:** `b3b8db0`
- **Initial release commit:** `035ddae`; review r1 changes and verification are recorded below.
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
- Initial scope excluded fretless integration; superseded by the PR #84 merge update below. Violin/cello finger TAB now ships in 0.5.0; viola/double bass remain gated.
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
Initial verification record (superseded for clean installation by review r1 below): check/build/pack/manifest/full validation exited 0 on the initial release-file content, but `npm ci` was run before the version bump. The earlier claim that installation was verified against the final release files was incorrect. Local results do not assert GitHub CI or review approval.

```text
npm ci: exit 0 BEFORE the version bump (not final-tree installation proof)
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

## Review r1 — reader pin and shipped README

Review: https://github.com/pepperhorn/ph-scoreview/pull/85#pullrequestreview-5855176574
Reviewed head: `9c0eae57046a2e529576e513d8ba60cd83a50304`.

### Scope and acknowledgement
The lead explicitly expanded ownership to the pepperscore version pin in `apps/reader/package.json`, its root lock entry, and `packages/pepperscore/README.md` for release accuracy. I accept all three findings: align both reader pins to 0.5.0, replace stale Guitar TAB fallback/default documentation, and document the shipped skin/pitch/TAB APIs. Runtime code, other dependency specs, ledger, publication and GBrain writes remain out of scope.

The two exact pin edits were already present when this turn started and became commit `3d3e1c2` during the turn; preserved and included in this branch. No unrelated changes were present. README changes are based on the current source and the 0001 T1–T4 / 0013 T1 return handoffs linked above. GBrain historical project lookup repeated (`default:projects/scoreflow-music-reader`); source and handoffs determine the API documentation.

### What changed / decisions made
- Both reader pins now match the workspace's 0.5.0 version. This resolves the missing pepperscore@0.4.1 lock entry without changing dependency ranges elsewhere.
- String TAB documents fretted identities, exact onReady-id overrides, no first-pitched-part fallback, bass/ukulele defaults, re-entrant physical order and matching-string-count tuning overrides. Finger TAB remains explicitly unavailable in this release. Imported TAB behavior stays documented.
- Added the skin prop row, theme roles, supported bar ids and control precedence, palette requirements, `mergeSkins` and `CRF_PITCH_COLOURS`, with an example. Added settings/handle rows for `pitchColours`, `setPitchColours(on)` in the ref row, and a TAB settings row for `tabInstruments`. Uses the exported `PepperScoreSettings` indexed type rather than suggesting the internal `TabInstrument` type is a package export.
- Corrected the original installation claim above: the first `npm ci` ran before bumping the package, so it did not validate the final version combination. Review r1 reruns the whole requested chain with both reader pins fixed.
- For the ABC guide: no import behavior changes; README changes describe existing merged behavior only.

### Review r1 verification
All commands in the foreground repo-root chain exited 0 against the final reader pins and README:
```bash
npm ci && npm run check && npm run build && npm run test:pack
```
Logs: `/tmp/0017-r1-{ci,check,build,pack}.log`. No npm publication; no PR watch/poll.

```text
npm ci: exit 0 (after both reader pins were set to 0.5.0)
npm run check: 23 Astro files, 0 errors, 0 warnings, 0 hints
npm run build: 10 pages; Complete; demo uses matching library dist and notices
npm run test:pack: pepperscore-0.5.0.tgz (111 files), no sources
  fresh Vite + React host build passed
  fresh Astro + React client:only host build passed
  Node import touches no window, document, storage or location
  fresh Astro SSR client:visible host built, served and answered 200
git diff --check: exit 0
```

Review r1 outcome: all three findings addressed; ready for re-review. Compared with reviewed head `9c0eae5`, only the reader version pin, its lock entry, package README and this return handoff changed. No runtime source edits or dependency-range changes. These are local results; GitHub CI and review approval are not claimed. No publication, PR watching or PR polling.

## Merged PR #84 — include violin/cello finger TAB in 0.5.0

The user requested merging `origin/main` (no rebase) after 0013 T3 merged as `0c61c4e`, keeping the previous file ownership. Fetch/merge completed without conflicts as `45d8130`; it includes `0c61c4e` and the lead's later documentation commits. Source changes arriving through that merge belong to PR #84; no runtime source was edited for this release-doc update.

Source: [0013 T3 return handoff](2026-11-11-0013-t3-fretless-tab--codex-to-lead.md), `tab/strings/charts.ts`, `tab/strings/svg.ts`, `tab/tab-parts.ts` and `notation/mei-tab.ts`. GBrain historical project lookup repeated (`default:projects/scoreflow-music-reader`); the merged source/handoff governs the new release content.

Updated CHANGELOG 0.5.0 and README String TAB: four-line violin/cello finger + position TAB in TAB/Both views, inline L/H low/high labels, `I pos.` / `pos. ½`, Davidoff cello positions, and display-only finger numbers with source-pitch playback. Chart-based finger TAB ignores fretted tuning/capo. Viola and double bass still get no generated TAB. Also corrected the TAB identity, tuning and behaviour-change text so no active release section still excludes violin/cello. This supersedes the initial/r1 handoff notes that finger TAB was unavailable. No new API or import behavior change in this documentation update.

Traceability: PR #84 / `0c61c4e`; 0013 T3 return linked above. Changes authored after the merge are limited to the two package docs and this 0017 return handoff. Lead-owned ledger changes are inherited from main, not edited here.

Verification: the requested foreground repo-root chain exited 0 with the merged runtime and final package docs:
```bash
npm ci && npm run check && npm run build && npm run test:pack
```
Logs: `/tmp/0017-finger-{ci,check,build,pack}.log`. No npm publication or PR watch/poll.

```text
npm ci: exit 0
npm run check: 23 Astro files, 0 errors, 0 warnings, 0 hints
npm run build: 10 pages; Complete; demo matches library dist and notices
npm run test:pack: pepperscore-0.5.0.tgz (113 files), build output and no sources
  fresh Vite + React host build passed
  fresh Astro + React client:only host build passed
  Node import touches no browser globals
  Astro SSR client:visible host built, served and answered 200
git diff --check: exit 0
```

Outcome: documentation updated for merged PR #84, ready for re-review. Only handoff verification text changed after the successful chain. Local checks pass; GitHub CI/review state is not asserted. No npm publication.
