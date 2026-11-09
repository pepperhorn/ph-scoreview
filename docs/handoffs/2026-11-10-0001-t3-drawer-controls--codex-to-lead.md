# Handoff: 0001-t3 — Drawer controls and skin bar follow-ups (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0001 · **Spec:** [composable player skins](../specs/0001-composable-player-skins.md) · **Plan:** [T3](../plans/0001-composable-player-skins.md)
- **Dispatch:** [lead-to-codex](2026-11-10-0001-t3-drawer-controls--lead-to-codex.md)
- **Branch:** orch/0001-t3-drawer-controls
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-1eaa3a60
- **PR:** pending creation after this document is committed
- **Base commit:** aa407d5da86669d0193a5519a113a06c6a78c30b (includes required ancestor 13d48eb)
- **Status:** closed

## Goal
Deliver AC2a's omitted drawer actions and the approved T2 follow-ups: phone playback placement, no empty skin headers, and an ephemeral development-consumer test port.

## Context you need
The linked spec, plan and dispatch are authoritative. GBrain consulted: `projects/scoreflow-music-reader` (historical context only). T1/T2 return documents linked by the dispatch were read; development diagnostics keep their inline try/catch gate.

## Scope
- **In:** six missing drawer controls and the three approved T2 follow-ups.
- **Out:** pitch colours, PDF, ABC import, editor, release/docs and ledger changes.
- **Files owned/changed:** `packages/pepperscore/src/components/DrawerControls.tsx`, `components/PepperScore.tsx`, `src/styles.css`, `lib/chrome.ts`, `lib/bar-items.ts`, `lib/bar-items.test.ts`, `validation/skin.mjs`, and these two 0001-t3 handoffs. `SkinBar.tsx` was owned but needed no edit.
- **Do not touch:** `lib/pdf/**`, `lib/notation/**`, `lib/import.ts`, root `package.json`, `packages/pepperscore-editor/**`, ledger and unrelated docs. All preserved.

## Acceptance criteria
- [x] `drawerExtras(null, chrome)` returns `[]`; other cases respect availability, explicit false and bar exclusion.
- [x] Playback and view panel reuses the six existing action elements. The file input is outside the header; file and scale refs mount once.
- [x] Phone (<580px container) play/pause and other playback controls occupy a wrapping bottom toolbar; instrument switch and options stay in the header. Browser assertions cover the becreative bar at 390px.
- [x] Empty renderable skin bars mount no header. Unit tests cover reserved/unavailable items; browser regression checks `['pdf']`.
- [x] Development consumer binds port 0 and navigates to the actual assigned port.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run check && npm run build && npm run test:skin && npm run test:embed && npm run test:layout && npm run test:reader
npm run test:manifest && npm run test:validation
```
Build completed before browser suites; suites run sequentially.

## Known gotchas / decisions made
- Drawer actions reuse `headerElements`; bar/drawer exclusion prevents duplicate state-bound refs. Unavailable elements (e.g. clock-owned Stop) are filtered before the new panel renders.
- Renderable items are passed as an optional fourth argument to `resolveChrome`. Availability still derives from the requested bar; rendered header presence derives from actual elements. Explicit empty/unrenderable bars keep minimal's compact play suppressed, consistent with the skin's explicit bar request.
- Skin phone placement uses the existing root ResizeObserver with the <580px threshold, rather than the viewport/device-class query used by legacy snippets. Initial state is SSR safe. A narrow embed in a wide host receives the same placement. Playback items are play, stop, tempo, transpose and key flip; each element mounts once. Desktop order stays unchanged; phone order is preserved within each location.
- The phone toolbar wraps rather than introducing another More popover/ref. The existing header More remains responsible for occasional controls.
- The instrument popover-in-More regression now runs at 640px, where the five-item bar retains overflow after the phone playback split.

## Open questions
None about implementation or scope. Lead owns other-family review and merge.

## Receiver ack
Lead to acknowledge through the ledger on main.

## Return
- **Outcome:** done; all required suites passed individually, with aggregate-run failures and successful retries recorded below
- **Commits:** receiver ack `7501683`; implementation `6079501`.
- **What changed:** drawer panel/resolver, single file input outside header, renderable header suppression, phone playback toolbar and ephemeral Vite port; unit and browser regression checks.
- **Verification output:** setup, check (0 errors/warnings/hints), build, skin (5 skin + 7 bar/drawer unit tests and browser checks), embed, layout, standalone reader and manifest passed. Full validation/remainder results are being recorded below.

```text
Skin drawer: omitted actions, single refs, mode/bars/zoom/stop/mixer/file chooser, empty header and no-skin restoration passed
Skin bar: ordered full/minimal bars, instrument selection, drawer sync, derived chords, persisted toggles, 390px More and unknown/duplicate ids passed
```

The first `npm run test:validation` stopped at `test:transpose` with `Failed to fetch dynamically imported module: /node_modules/.vite/deps/abcjs.js?v=3bc008bc`. The isolated transpose rerun passed, including ABC/MIDI/MEI and 2520 chunk comparisons (109.4 s). All subsequent suites were invoked sequentially by their unchanged package scripts.

The repeated reader run failed `validation/reader.mjs:539`: `320px: a user stave scale is restored instead of the default`, actual `0.556`, expected `0.3`. The standalone reader run had passed fully on the same code. The ledger's S10 records the same assertion in webkit at another width; that is related evidence, not proof of an identical cause or a baseline reproduction. The final isolated `npm run test:reader` rerun passed fully (exit 0), including zoom restoration, paging/playback, drawer layout and Endless scrollbars. No reader test, persistence code or thresholds were changed.

Editor browser passed (reported render times 121–384 ms); large-score passed with import long tasks `[161,65,50]` ms, so the dispatch's two timing gates needed no rerun.
- **Out-of-scope issues found:** the Vite dynamic-module fetch failure and intermittent reader zoom-restore assertion above. Neither is claimed to have a proven baseline cause; no protected files or thresholds were changed.
- **Follow-ups:** lead to arrange other-family review; T4/T5 remain separate. No merge, release, PR watching or polling.
- **For the ABC guide:** no ABC import behaviour changed.
- **For GBrain (lead to promote):** compose drawer additions from the existing action elements and keep hidden inputs independent of header presence; filter actual available elements before reserving header height.


### Final verification results
- Setup, `npm run check`, `npm run build`, `npm run test:skin`, `npm run test:embed`, `npm run test:layout`, `npm run test:reader`, and `npm run test:manifest`: exit 0.
- `npm run test:validation`: exit 1 at the Vite/abcjs fetch above. Transpose rerun and every subsequent constituent script passed individually; the repeated reader failure also passed on its final isolated rerun. This was not a single uninterrupted green aggregate run.
- Library unit tests: 156/156; editor unit tests: 277/277.
- Source scope: `git diff --stat main...HEAD` contains only the seven owned code/validation files and the task handoffs. `git diff --check` passed. No test/browser suite overlapped a build.

```text
test:transpose: exit 0
test:document: exit 0
test:parser-diff: exit 0
test:score-db: exit 0
test:performance: exit 0
test:clock-contract: exit 0
test:pepperscore: exit 0
test:editor: exit 0
test:editor-browser: exit 0
test:editor-phone: exit 0
test:reader: exit 1
test:chunks: exit 0
test:large: exit 0
test:guardrails: exit 0
test:embed: exit 0
test:clock-embed: exit 0
test:layout: exit 0
test:tab: exit 0
test:tab-bake: exit 0
test:instrument-switch: exit 0
final isolated test:reader retry: exit 0
```
