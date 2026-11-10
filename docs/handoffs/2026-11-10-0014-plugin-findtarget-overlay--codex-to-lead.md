# Handoff: 0014 — findTarget ignores plugin overlays (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0014 (quick; no separate spec or plan)
- **Branch:** orch/0014-plugin-findtarget-overlay
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-8dc218da-ada745620e3260de
- **Base commit:** 113540a (includes required 08e0102)
- **Status:** closed

## Goal
Keep visible editor targets discoverable beneath plugin-owned overlays, while respecting ordinary editor occlusion.

## Context you need
- [Dispatch and committed receiver acknowledgement](2026-11-10-0014-plugin-findtarget-overlay--lead-to-codex.md)
- [Ledger](../wip/LEDGER.md), item 0014 / S20
- Original finding: [PR #76 round 2](https://github.com/pepperhorn/ph-scoreview/pull/76)

## Scope
- **In:** centre hit-stack filtering and regression coverage.
- **Out:** tour implementation, header hold-open product behavior, outside-pointer handlers, ABC import and public API changes.
- **Files owned/changed:** `packages/pepperscore-editor/src/plugin/host.ts`, `packages/pepperscore-editor/src/plugin/host.test.ts`, `validation/editor.mjs`, `apps/reader/src/embed/EditorStubPlugin.tsx`, own 0014 handoffs only.
- No ledger or other docs edited.

## Acceptance criteria
- [x] All eight EditorTargets preserve the baseline element after reveal with a click-blocking full-screen plugin backdrop at 1280, 900 and 390px.
- [x] For every target/width, an editor-owned cover beneath that backdrop returns null; removing the cover restores the original element.
- [x] Existing hidden/inert/off-screen/clipping checks stay intact.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run test:editor && npm run build && npm run test:editor-browser && npm run test:editor-phone && npm run check
npm run test:manifest
npm run test:validation
```

## Known gotchas / decisions made
- GBrain checked: `default:projects/scoreflow-music-reader` and `default:projects/scoreflow-music-reader/gotchas-abc-import`. Build precedes browser validation; harnesses allocate free ports.
- Take the first non-plugin element in `elementsFromPoint`, rather than accepting any target anywhere in the stack. This preserves ordinary occlusion.
- The validation stub backdrop is hidden by default, enabled only during the new checks. It uses pointer-events auto and a lower z-index than the existing plugin input/bubble.
- Initial browser run passed backdrop/cover checks at all three widths, then timed out at the existing phone file-open More click because auto-collapse made the control inert. The stub-plugin case now re-reveals the title before this click. No product behavior changed.
- For the ABC guide: no ABC import behavior changes.

## Open questions
None.

## Return
- **Outcome:** done
- **What changed:** host ignores hits inside `[data-ps-plugin]`; one unit regression covers plugin stacking, non-plugin blockers, child hits and empty stacks. Browser regression covers all eight targets at all three requested widths.
- **Commits:** receiver ack `514b6b4`; implementation `b58e581`; this return handoff is the final docs commit.
- **Verification output:** all commands below exited 0 with the default timing budgets (no scaled retry).
```text
npm ci && npx playwright-core install chromium: PASS
npm run test:editor: 27 files passed; 294 tests passed
npm run build: PASS; demo/library dist and notices match
npm run test:editor-browser: PASS
Plugin host: 1280px targets, key isolation, details, file-open cleanup and origin pass
Plugin host: 900px targets, key isolation, details, file-open cleanup and origin pass
Plugin host: 390px targets, key isolation, details, file-open cleanup and origin pass
npm run test:editor-phone: PASS
npm run check: 0 errors, 0 warnings, 0 hints
npm run test:manifest: PASS
GM manifest: 128 local packs, 16 icons and playable voices verified.
Sound packs: complete pack.json, generated core (19 FluidR3 sounds) and versions passed
npm run test:validation: PASS (entire chain, exit 0)
PDF page model spike passed (chromium): A4 4 lines; A3 4; 2 pages for 80 bars.
git diff --check: PASS
```
- Browser redraw warnings were below the 800ms failure threshold: focused run 572/501/465ms; full-suite run 454/508/424/591/561/501ms. No timing gate failed.
- Full-suite log during this run: `/tmp/0014-validation.log` (local, temporary); focused logs `/tmp/0014-{build,editor-browser,editor-phone,check,manifest}.log`.
- Scope audit against `main`: only the four declared source/test files and the two own handoffs changed.
- **Follow-ups:** lead arranges cross-family review and decides merge; no PR watch requested or started.
- **For GBrain (lead to promote):** plugin-owned click-blocking overlays must be skipped when resolving tour targets, but only until the first non-plugin hit. Existing phone auto-collapse still requires reveal before using idle header controls.
