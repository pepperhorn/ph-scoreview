# Handoff: 0029 — Editor pack check in CI + prepublish guard (codex → lead)

- **Date:** 2026-11-12
- **Type:** return
- **Ledger:** 0029 (quick; no spec or plan)
- **Branch:** orch/0029-editor-pack-ci
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-40df5bfc-ea5fbe6a2099e674
- **Base commit:** f1f24b0a82dcad00d7bb0c1e07b44473a501916c (contains pinned 7c2da17)
- **Implementation commit:** fff7c67
- **PR:** draft against main, URL reported by implementer after creation
- **Status:** closed

## Goal and context
Complete the two 0025 follow-ups before publishing the editor: run editor packaging verification in existing CI and prevent publishing absent or stale output. Authoritative dispatch: [lead handoff](2026-11-12-0029-editor-pack-ci--lead-to-codex.md).

## Scope and files owned
- **In:** root `package.json` scripts; editor `package.json` scripts; `packages/pepperscore-editor/scripts/prepublish-guard.mjs`; own 0029 handoffs.
- **Out:** dependencies, lockfile, CI workflows (0027 owns ci.yml), public APIs, application code, ABC import, actual publishing, main/ledger edits and GBrain writes.
- **Files changed:** exactly the five owned paths (two manifests, guard, dispatch acknowledgement, return handoff).

## Acceptance criteria
- [x] Root `npm run test:pack` runs both core and editor checks successfully; standalone `test:pack:editor` retained.
- [x] Editor publish dry-run rejects missing dist, rejects stale declarations, and passes with built output.
- [x] Measure added time: standalone editor check 78.67s; combined pack command 407.13s (6m47s), below the existing 720s timeout by 312.87s on this machine. Network and CI machine performance vary.

## Verify with
```bash
npm ci
npm run check
npm run build
npm run test:manifest
/usr/bin/time npm run test:pack
/usr/bin/time npm run test:pack:editor
npm run test:validation
# Baseline timing failure at editor-browser; rerun suffix in script order:
VALIDATION_BUDGET_SCALE=2 npm run test:editor-browser
# Same env for: test:editor-phone, test:reader, test:chunks, test:large,
# test:guardrails, test:embed, test:clock-embed, test:layout, test:tab,
# test:tab-bake, test:instrument-switch, test:pdf (all passed).
npm publish --dry-run -w @pepperhorn/pepperscore-editor
```
Negative dry-run checks use absent dist and temporarily age `dist/index.d.ts` below all source timestamps. Restore timestamps after the stale check. Rebuild before the final successful dry-run. Only `npm publish --dry-run` was used.

## Verification output
- npm ci: exit 0 (npm audit/install-script warnings only).
- npm run check: exit 0; Astro 23 files, 0 errors/warnings/hints.
- npm run build: exit 0; demo library dist, worker assets, Verovio files and notices match.
- npm run test:manifest: exit 0; 128 packs, 16 icons and playable voices; generated core 19 FluidR3 sounds and versions passed.
- npm run test:pack: exit 0, 407.13s. Vite, Webpack, Astro static and Astro SSR passed; lazy PDF recovery/degradation checks passed.
- npm run test:pack:editor: exit 0, 78.67s.
  `Editor pack: 85 allowed files; CSS 41023 bytes without embedded fonts; clean pack JSON; fresh consumer ESM import, declarations, CSS and Vite build passed; production dev licence rejected.`
- Temporary isolated guard fixtures: PASS for each of three missing outputs, each of three stale outputs, newer nested source, fresh output and invocation from outside package cwd. No fixture files added to repo.
- Missing-dist dry-run: exit 1; `Editor prepublish guard: dist/index.js is missing. Run npm run build -w @pepperhorn/pepperscore-editor before publishing.`
- Stale-declarations dry-run: exit 1; same build guidance, `dist/index.d.ts is older than src/`.
- Built-output dry-run: exit 0; `+ @pepperhorn/pepperscore-editor@0.1.0` (dry-run; restricted GitHub Packages registry).
- Full validation: initial `npm run test:validation` passed its prefix through library/editor unit tests (editor: 295 tests, 28 files), then stopped at `validation/editor.mjs:655`: one change-to-redraw time 818ms exceeded the 800ms baseline. This was the only failure; no runtime/application code changed.
- Reran `test:editor-browser` and every following command from root `test:validation`, in order, with `VALIDATION_BUDGET_SCALE=2`: exit 0. All editor browser/phone, reader, chunks, large-score, guardrails, embed/clock-embed, layout, TAB/bake, instrument-switch and PDF checks passed. Editor redraw samples reached 1293ms within the scaled 1600ms cap. Do not interpret this as a green unscaled full-suite run.
- Final PDF tail: `PDF large score (chromium, 30 parts x 12 bars): export 17226 ms, 3 pages, longest timer gap 300 ms; longest long task 132 ms; cancel latency startup 0 / mid-page 25 / between pages 30 ms`.
- Scope: manifest comparisons show only scripts changed; git diff --check passed.

Detailed local logs: `/tmp/0029-{ci,check,build,manifest,pack,editor-pack,validation,publish-missing,publish-stale,publish-built}.log`; timing logs `/tmp/0029-{pack-time,editor-time}.log`; successful remaining-suite log `/tmp/0029-validation-suffix.log`; final editor rebuild `/tmp/0029-editor-rebuild.log`.

## Decisions made
- Reject stale/missing files rather than silently build in `prepublishOnly`: explicit failure meets the missing-dist acceptance criterion and gives a clear recovery command. A build-on-publish would make the required negative check pass unexpectedly.
- Resolve paths from the guard's module URL; compare each required regular file's mtime against the newest file recursively beneath src. All nested source files count, not just entry points. This is an mtime guard as requested, not content-hash provenance; manually preserving timestamps can defeat it.
- Use `prepublishOnly`, not prepack: existing pack-editor JSON handling and builds stay intact. Normal pack checks verified this.
- Keep existing CI timeout and workflows unchanged: measured combined time is comfortably below 12 minutes locally.

## Known gotchas
GBrain consulted: `default:projects/scoreflow-music-reader` (historical context) and `default:projects/scoreflow-music-reader/gotchas-abc-import` (root npm ci guidance). Repo dispatch takes precedence; no current packaging decisions were supplied by GBrain. Implementer did not write to GBrain.

## Open questions / out-of-scope issues
No open scope questions. Unscaled editor browser timing exceeded its budget on this loaded host (818ms vs 800ms); adjusted-budget rerun passed. No application changes were made to address timing. No ABC import behaviour change; no ABC guide update needed.

## Return / follow-ups
- **Outcome:** done; task-specific verification passed, broader suite completed with the timing qualification above.
- **Lead next:** review draft PR with the other model family and handle CI/merge under repo policy. Implementer will neither watch nor merge the PR.
- **For GBrain (lead to promote):** editor packing now runs in the existing root pack CI step; publishing checks source/output mtimes; editor consumer verification added about 79s locally (combined about 407s). These timings are machine/network-specific.
