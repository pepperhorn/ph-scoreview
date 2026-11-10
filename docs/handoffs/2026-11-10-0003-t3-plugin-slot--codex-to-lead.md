# Handoff: 0003-t3 — Plugin slot and control targets (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0003 · **Spec:** [0003](../specs/0003-teaching-layer.md) · **Plan:** [0003 T3](../plans/0003-teaching-layer.md)
- **Dispatch / ack:** [lead-to-codex](2026-11-10-0003-t3-plugin-slot--lead-to-codex.md)
- **Branch:** orch/0003-t3-plugin-slot
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-0a103941-dc4ee81564903b48
- **Base commit:** 8127cec (dispatch base, ancestor verified)
- **Implementation commit:** 13a8306
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/76
- **Port:** 5233 reserved; no persistent server started
- **Status:** closed

## Goal
Deliver plan T3: a public session-scoped plugin host and usable control targets in both shells, with browser proof of keyboard isolation and file-open cleanup.

## Context you need
Read the linked spec, plan T3 and dispatch. GBrain checked: `projects/scoreflow-music-reader`; the repo docs govern this change. Also read T1 and T2 return handoffs and `docs/specs/pepperscore-plugins-and-embeds.md`. No private tour logic or wording is included.

## Scope
- **In:** host factory and unit tests, exported types, editor props/overlays, session origin, target markers/reveal, phone metadata editing, README, demo-only stub and editor browser validation.
- **Out:** T4–T6, private packages, publishing, dependencies, core `packages/pepperscore/**`, other validation files, ledger, ABC import.
- **Files owned / changed:** `packages/pepperscore-editor/src/plugin/host.ts`, `host.test.ts`; editor `src/index.ts`, `src/ui/PepperScoreEditor.tsx`, `session.ts`, `TopBar.tsx`, `ScoreTab.tsx`, `TempoFields.tsx`, `controls.tsx` (target attribute plumbing only), `phone/PhoneHeader.tsx`, `PhoneMenu.tsx`, `PhoneShell.tsx`, `PhoneTabs.tsx`; editor README; `apps/reader/src/embed/EditorDemo.tsx`, `EditorStubPlugin.tsx`; `validation/editor.mjs`; this task's dispatch ack and return handoff.
- **Do not touch:** all other paths. Scope audit uses `git diff --stat main...HEAD`; main has advanced independently since dispatch.

## Acceptance criteria
- [x] Public `EditorHost`, `EditorPlugin`, `EditorTarget` match plan T3 and are exported from package root.
- [x] Host dispatch is undoable; document subscriptions ignore cursor-only changes and stop after unsubscribe; read-only dispatch is refused.
- [x] Optional overlays render only after measurement; unsupported API versions are skipped; no plugins means no wrapper.
- [x] Eight targets in both shells; reveal wakes collapsed phone header, opens menu, selects Score tab and opens the desktop inspector drawer when needed.
- [x] Plugin typing and shortcut keys leave editor mode and document unchanged; Escape in the overlay leaves editor popovers open.
- [x] File Open remounts the overlay, disposes its old document subscription and window listener, and leaves exactly one active listener/subscription.
- [x] Ordinary load and Open have origin `opened`; host `startedNew` and phone New have origin `new`.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run test:editor && npm run build && npm run test:editor-browser && npm run test:editor-phone
npm run check && npm run test:manifest && npm run test:validation
```

## Verification output
```text
Setup: npm ci && npx playwright-core install chromium: PASS
TDD red: host.test.ts failed because ./host did not exist
Host green: 3 tests passed (undo/redo, document-only subscribe/unsubscribe, read-only dispatch)
npm run test:editor: 27 files, 293 tests passed
npm run build: 10 pages; demo/library dist match
npm run test:editor-browser: PASS (also rerun within full validation)
  plugin cases: 1280px, 900px, 390px targets/key isolation/Details/file-open cleanup/origin PASS
  full-run editor redraw times: 245,175,279,141,248,211,243,228 ms
npm run test:editor-phone: PASS (also rerun within full validation)
npm run check: 0 errors, 0 warnings, 0 hints
npm run test:manifest: PASS (128 packs, 16 icons; core 19 sounds)
npm run test:validation: FAILED at reader.mjs:1025, Twelve-staff playback sampled playback frames (67)
VALIDATION_BUDGET_SCALE=2 npm run test:reader: PASS
Remaining validation commands: PASS (chunks, large, guardrails, embed, clock-embed, layout, tab, tab-bake, instrument-switch)
git diff --check: clean; only owned paths in main...HEAD
```
The initial full run passed every stage through editor-phone before stopping at the reader frame-sampling assertion. The successful reader retry retained the same code; its sampled-frame threshold does not consume the budget multiplier. No claim is made that a baseline run reproduced the failure. Early development browser attempts also caught two harness mistakes (waiting for a zero-size wrapper to be visible and clicking the hidden phone demo New button); both were fixed before the passing final cases.

Logs are `/tmp/0003-t3-{setup,red,unit,build,browser,phone,check,manifest,validation}.log`.

## Known gotchas / decisions made
- Plugin host depends on a root getter rather than global DOM lookup; targets exclude plugin content and inert ancestors. Visible selection uses non-null `offsetParent` as planned.
- `revealTarget` initiates React updates; callers wait for the render before finding/measuring the target. Phone reveal is a root-scoped internal event handled by PhoneShell; desktop reveal uses existing inspector controls, preserving file ownership.
- Read-only hosts refuse dispatch. First-party plugins own their cleanup; the host is not a sandbox or a remote loader. The browser stub deliberately registers both a document subscription and a window listener so cleanup is observable.
- Phone title/composer previously had display text only (and composer was absent when empty). Reused TopBar's existing MetaText editor so both targets can actually be edited, with the same double-click, Enter, blur and Escape behavior; an empty composer now shows its placeholder. No styles were changed.
- `startedNew` is consumed only when creating the initial session; subsequent real Open/New actions determine their own origin.
- Browser coverage at 1280, 900 and 390 pixels also promotes a real Details edit scenario from the T1 follow-up. The stub remains outside the editor package, under `?stubPlugin=1`.

## Open questions
None.

## Return (implementer → lead)
- **Outcome:** done — implementation and editor verification complete; initial full-run reader failure and successful retry recorded above.
- **What changed:** see scope and acceptance above.
- **Out-of-scope issues found:** reader.mjs:1025 frame-sampling gate failed once (67 samples), then passed on retry with VALIDATION_BUDGET_SCALE=2; no baseline reproduction, no reader edits.
- **Follow-ups:** lead to arrange the cross-family review and merge. T4–T6 remain gated by the plan's owner prerequisites. The broader T2 Parts browser probe remains a separate follow-up; this change opens the shared Parts panel but does not reproduce its full instrument/cap matrix.
- **For the ABC guide:** no ABC import behavior changed.
- **For GBrain (lead to promote):** plugin API v1 is session-scoped; callers wait after reveal, remeasure on resize/scroll, and release subscriptions/listeners on unmount. An initial page load is `opened` unless its host explicitly passes `startedNew`. Implementer made no GBrain writes.
