# Handoff: 0003-t2 — Parts: licence-cap plumbing blocked (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0003 · **Spec:** [0003](../specs/0003-teaching-layer.md) · **Plan:** [0003 task T2](../plans/0003-teaching-layer.md)
- **Dispatch:** [lead to codex](2026-11-10-0003-t2-parts--lead-to-codex.md)
- **Branch:** orch/0003-t2-parts
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-561b6b7c
- **Base commit:** b8fb939 (required T1 base, verified ancestor of HEAD)
- **Port:** 5232
- **Status:** blocked

## Goal
Implement plan T2: undoable addPart, setPartInstrument and removePart commands, emptiness/cap predicates, and a Parts control in both shells that respects the actual licence staff cap.

## Scope
- **In / files owned:** new engine/commands/parts.ts and parts.test.ts, commands/index.ts, new ui/PartsPanel.tsx, ui/Popover.tsx, ui/keymap.ts (PopoverName only), ui/TopBar.tsx, ui/phone/PhoneMenu.tsx, src/style.css, editor README, own 0003-t2 handoffs (all code under packages/pepperscore-editor).
- **Out:** T3, packages/pepperscore, validation, ledger, other docs and files.
- **Actual changes:** dispatch acknowledgement and this return handoff only. No implementation code or tests changed.

## Acceptance criteria
All T2 criteria remain pending: red-first checklist tests; clean invariants and undo; refusal to remove nonempty/last parts; flute/piano structure and time refill; layouts; licence cap including piano's two staves; pitched-only controls with reasons; contextual Poppins UI and unchanged MusicXML goldens.

## Blocker / open question for lead
Please expand T2 ownership to `packages/pepperscore-editor/src/ui/controls.tsx` and `packages/pepperscore-editor/src/ui/PepperScoreEditor.tsx`, narrowly to pass the current licence `maxStaves` into `EditorUi` and its provider value. Then redispatch T2.

Evidence:
- Spec gap 1 and plan Global constraints require the Parts control to respect the licence cap in both shells.
- `PepperScoreEditor.tsx` receives the verified `maxStaves` and builds the `EditorUi` value, but does not include that cap in it. This file is owned by T3, not T2.
- `controls.tsx` defines `EditorUi`; it exposes store, key context, editable, refocus, togglePopover and optional scrollToMeasure, with no licence cap.
- `PopoverBody` is shared by desktop and phone and receives only name, store and onClose. Its callers (`CanvasOverlay.tsx`, `phone/InlineStrip.tsx`) are also outside T2 ownership.
- `TopBar` and `PhoneMenu` have the cap, but are not ancestors of the shared popover body; PhoneMenu unmounts when a choice opens a strip.
- `ui/session.ts` constructs the editor store with `maxStaves: Infinity`, so the store's invariant report cannot recover the verified licence cap.

The minimal recommended solution is the two-file context extension above. A DOM attribute lookup, module-global licence registry or hard-coded cap would avoid the ownership boundary only by adding an unnecessary side channel or giving incorrect behaviour for signed licences. Per AGENTS.md section 7, stopped before implementation instead of expanding scope.

## Verify with
After ownership is resolved, follow the dispatch exactly:
```bash
npm ci && npx playwright-core install chromium
npm run test:editor && npm run test:editor-browser && npm run test:editor-phone
npm run check && npm run build && npm run test:manifest && npm run test:validation
```
Run foreground commands sequentially, never overlapping build/browser tests.

## Known gotchas / decisions already made
GBrain consulted: `projects/scoreflow-music-reader`, `projects/scoreflow-music-reader/gotchas-abc-import`. Repo spec and plan remain authoritative. PR #68 review read; its Details pattern provides shared popover content but does not address licence-cap propagation. Implementer made no GBrain writes.

## Receiver ack
Lead to acknowledge the blocked return through the ledger; implementer did not edit it.

## Return
- **Outcome:** blocked, no feature implementation.
- **PR:** draft opened for this branch; see linked thread PR and final agent reply.
- **Commits:** d3abf1b (receiver acknowledgement), followed by this return document commit.
- **What changed:** only own handoff files.
- **Verification output:** `npm ci && npx playwright-core install chromium` exited 0; raw log `/tmp/0003-t2-install.log`. Required feature tests/check/build/manifest/validation not run: implementation stopped at the ownership blocker. No passing acceptance claim.
- **Decisions made:** request explicit context-plumbing ownership; do not introduce a side channel to bypass task scope.
- **Out-of-scope issues found:** the cap plumbing above.
- **Follow-ups:** lead expands ownership and redispatches; then implement red-first tests and complete T2.
- **For the ABC guide:** no change; no ABC code touched.
- **For GBrain (lead to promote):** T2's listed UI ownership needs the licence-cap context plumbing before both shells can enforce the signed cap through shared PartsPanel.
