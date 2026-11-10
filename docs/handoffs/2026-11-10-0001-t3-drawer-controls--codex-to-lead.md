# Handoff: 0001-t3 — Drawer controls and skin bar follow-ups (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0001 · **Spec:** [composable player skins](../specs/0001-composable-player-skins.md) · **Plan:** [T3](../plans/0001-composable-player-skins.md)
- **Dispatch:** [lead-to-codex](2026-11-10-0001-t3-drawer-controls--lead-to-codex.md)
- **Branch:** orch/0001-t3-drawer-controls
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-1eaa3a60
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/72 (draft)
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
- [x] Per lead decision after r1, unshowable bars restore the preset defaults: full gets its normal header, minimal keeps compact play. Unit and browser tests cover `['pdf']`, including an explicitly enabled instrument switcher.
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
- Renderable items are passed as an optional fourth argument to `resolveChrome`. Availability still derives from the requested bar; rendered header presence derives from actual elements. R1 supersedes the original empty-bar choice: empty/unrenderable bars now restore all default preset rendering, including compact play and explicitly enabled instrument selection.
- Skin phone placement uses the existing root ResizeObserver with the <580px threshold, rather than the viewport/device-class query used by legacy snippets. Initial state is SSR safe. A narrow embed in a wide host receives the same placement. Playback items are play, stop, tempo, transpose and key flip; each element mounts once. Desktop order stays unchanged; phone order is preserved within each location.
- The phone toolbar wraps rather than introducing another More popover/ref. The existing header More remains responsible for occasional controls.
- The instrument popover-in-More regression now runs at 640px, where the five-item bar retains overflow after the phone playback split.

## Open questions
None about implementation or scope. Lead owns other-family review and merge.

## Receiver ack
Lead to acknowledge through the ledger on main.

## Return
- **Outcome:** done; r2's no-skin phone regression is fixed, with all r1 fixes preserved. All six r2 verification commands passed, with reader passing on its requested isolated retry. Earlier submission/r1 results remain below as history.
- **Commits:** receiver ack `7501683`; implementation `6079501`.
- **What changed:** drawer panel/resolver, single file input outside header, renderable header suppression, phone playback toolbar and ephemeral Vite port; unit and browser regression checks.
- **Verification output:** setup, check (0 errors/warnings/hints), build, skin (5 skin + 7 bar/drawer unit tests and browser checks), embed, layout, standalone reader and manifest passed. Full validation and remainder results are recorded below.

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


### Initial submission verification results
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


## Review r1 response — 5834310199
- **Request:** [review](https://github.com/pepperhorn/ph-scoreview/pull/72#pullrequestreview-5834310199), plus lead decisions in the follow-up brief.
- **Scope:** the same owned files; no PDF/import/notation/editor/ledger/dependency changes.
- **Drawer tab overlap:** skin playback toolbars with a drawer reserve a separate 47px strip below the toolbar. Every row remains above the tab rather than sharing its bottom strip. Full and minimal browser checks at 320, 390 and 580px hit-test each item's centre using `document.elementFromPoint`, click Play, assert Pause state and active playing-note marks, then pause again. Fixtures use `audio={false}`: this proves transport/scheduler activity without requiring sound output.
- **Wrapped floating UI:** a ResizeObserver measures the toolbar's real bottom footprint (including the drawer strip) into private `--ps-bottom-toolbar-h`. The octave dock, error toast and reader notices sit 12px above it. Both presets get a five-action, genuinely wrapped 320px toolbar test; the real octave dock and a real failed-file toast are checked for geometric clearance, and toolbar item hit-testing is repeated with each visible. Measurement is refreshed when drawer availability changes and removed when the toolbar unmounts.
- **Empty-bar fallback:** `resolveChrome` falls back to preset flags when no items can be shown. Reserved PDF/pitch-colour items are unavailable by default; actual element availability is passed by the component. An empty header-only phone partition does not trigger fallback if playback items still exist in the bottom toolbar. Full renders its original header and no new drawer rows; minimal renders compact play and any host-enabled default instrument switcher. Tests cover `resolveChrome('minimal', {}, ['pdf'])` and browser fallback with explicit `instrumentSwitch: true`.
- **Formatting:** removed the stray space before the hidden input's closing brace and the blank header line.
- **Test development:** updated empty-bar unit tests failed against the reviewed implementation before the fix. An initial browser-test attempt incorrectly tried to close a drawer that enabling the octave tool had already closed; corrected the test to await its closing animation. No timing thresholds were changed.
- **For GBrain (lead to promote):** visibility and containment do not prove pointer reachability. Hit-test control centres with drawer handles and floating UI present, and measure wrapped toolbar offsets rather than assuming one row.
- **Code commit:** `a7ffcf50d6e9c9a73eb5cdba94e293725093d6de` (handoff-only commit follows).
- **Verification:** all seven requested commands passed from the repo root, foreground and sequential. Check: 0 errors/warnings/hints. Skin: 5 skin + 7 bar/drawer unit tests plus browser checks. The final build and skin rerun include the CSS refinement that keeps no-drawer defaults from overriding measured offsets, and a test disabling/re-enabling the drawer while the wrapped toolbar stays mounted. Embed/layout/reader fixtures use unchanged default chrome; the refined selectors apply only to skin toolbars. No timing gate failed in this review round; no threshold changes or timing retries were needed. The earlier full-validation evidence above remains historical; full validation was not requested again.

```text
npm run check: exit 0
npm run build: exit 0
npm run test:skin: exit 0
npm run test:embed: exit 0
npm run test:layout: exit 0
npm run test:reader: exit 0
npm run test:manifest: exit 0
Skin phone r1: full/minimal 320/390/580px item-centre hit tests and playback; wrapped dock/toast offsets passed
Skin drawer: omitted actions, single refs, mode/bars/zoom/stop/mixer/file chooser, empty-bar preset fallback and no-skin restoration passed
```

- **Scope audit:** compared with reviewed head `2a185b515166f1aec2acb818691055170b4255ec`, only `PepperScore.tsx`, `lib/chrome.ts`, `lib/bar-items.test.ts`, `styles.css`, `validation/skin.mjs`, and this owned return handoff changed. `git diff --check` passed.
- **For T5:** document the new lead decision that an unshowable skin bar restores the preset's default controls. On minimal, omitted actions still require their control groups to be available (the becreative bar enables Stop via transport; the other five can be enabled through `controls`).
- **Follow-up:** other-family re-review on the pushed head. No merge, release, watching or polling.

## Review r2 response — 5835878229
- **Request:** [review](https://github.com/pepperhorn/ph-scoreview/pull/72#pullrequestreview-5835878229). R1 is confirmed; this round addresses only the no-skin full-preset phone regression.
- **Cause and fix:** r1 left the reusable `embedSwitch` node available for bar composition, but the no-bar toolbar treated node existence as visibility. `noBarSwitch` now applies `embedSwitchShown` once and is used consistently for toolbar eligibility, toolbar contents and corner rendering. Full without a showable bar therefore mounts neither the toolbar nor its dead switcher. Minimal's existing allowed switcher/menu remains intact. No r1 geometry, fallback-resolution, CSS or playback code changed.
- **Regression proof:** before the fix, the new browser test failed against reviewed head `429caadb983c9ef34403143b4e757cb198a1f265`: `390px touch=false no skin: full has no bottom toolbar`, actual 1, expected 0.
- **Coverage:** full without a skin and full with `bar: ['pdf']` have zero `.ps-embed-toolbar` and `.instrument-switch` elements at 390px, 850px and wide touch mode. Each context also checks that an explicitly enabled minimal no-skin switcher still opens/closes its menu. The real `/` reader page at 390px retains the main baseline's absence of embed toolbar/switcher, normal header playback and Options tab. This baseline is supported by the review's main comparison and inspection of `main`'s original `embedSwitchShown` gate; no new pixel-comparison claim is made.
- **Scope:** only `components/PepperScore.tsx`, `validation/skin.mjs` and this owned return handoff. No unrelated suggestions or scope expansion.
- **Code commit:** `a818a0f199ce396f40051057d21f403409057f56` (handoff-only commit follows).
- **Verification:** repo-root foreground commands ran sequentially, with no browser/build overlap. Check: 0 errors/warnings/hints. Build, skin (5 skin + 7 bar/drawer unit tests and browser checks), embed and layout passed on their first fixed-code runs. Reader first failed `validation/reader.mjs:1025`, `Twelve-staff playback: sampled playback frames (66)`. The requested isolated `npm run test:reader` rerun passed fully, including paging/playback follow, drawer layout and Endless scrollbars. No thresholds changed. A load average of 25.66 was observed after the failure; r2 also reports this gate failing on the previous head, but no baseline reproduction or causal proof is claimed this round.

```text
npm run check: exit 0
npm run build: exit 0
npm run test:skin: exit 0
npm run test:embed: exit 0
npm run test:layout: exit 0
npm run test:reader: exit 1 (twelve-staff sampled frames: 66)
isolated npm run test:reader retry: exit 0
Skin r2: no-skin/PDF full chrome at 390/850px and wide touch has no embed toolbar or switcher; minimal menu and 390px main reader defaults preserved
Skin phone r1: full/minimal 320/390/580px item-centre hit tests and playback; wrapped dock/toast offsets passed
```

- **Scope audit:** `git diff --stat 429caad...HEAD` contains only the two owned source/validation files plus this return handoff. `git diff --check` passed.
- **Follow-up:** pushed head needs other-family re-review. No merge, watch, polling, or unrelated fixes.
- **GBrain:** `projects/scoreflow-music-reader` consulted for historical context; this review and repo docs govern the fix. Lead may promote the lesson that a reusable JSX node's existence does not establish that a control is allowed in a specific chrome location.
