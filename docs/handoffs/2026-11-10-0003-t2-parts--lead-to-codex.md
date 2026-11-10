# Handoff: 0003-t2 — Add, change and remove parts (editor) (lead → codex)

- **Date:** 2026-11-10
- **Type:** dispatch
- **Ledger:** 0003 · **Spec:** docs/specs/0003-teaching-layer.md · **Plan:** docs/plans/0003-teaching-layer.md (task T2)
- **Branch:** orch/0003-t2-parts · **Worktree:** created by T3
- **PR:** <url once opened>
- **Base commit:** b8fb939 (T1 merged as PR #68)
- **Port (if running a server):** 5232
- **Status:** closed

## Goal
Editor users can add a part, change an empty part's instrument, and remove an empty part from a new Parts popover, per plan task T2 (spec gap 1), with the commands `addPart`, `setPartInstrument`, `removePart`, `canEditPart`, `canAddPart`.

## Context you need
- Spec: `docs/specs/0003-teaching-layer.md`; plan task T2 (facts about `SwitchInstrumentId`, piano as one 2-stave part, `emptyPartMeasure`, layouts, and the TDD checklist): `docs/plans/0003-teaching-layer.md`.
- T1 return handoff (merged as PR #68): `docs/handoffs/2026-11-10-0003-t1-score-details--codex-to-lead.md` — T1 added the Details popover to the same `TopBar`, `PhoneMenu`, `Popover`, `keymap` files; follow its pattern.
- PR #68 review (`gh pr view 68 --comments`).
- GBrain: `projects/scoreflow-music-reader`.

## Scope
- **In:** plan T2 exactly.
- **Out:** T3 (plugin slot), anything in `packages/pepperscore`.
- **Files you own:** `packages/pepperscore-editor/src/engine/commands/parts.ts` (new), `parts.test.ts` (new), `src/engine/commands/index.ts`, `src/ui/PartsPanel.tsx` (new), `src/ui/Popover.tsx`, `src/ui/keymap.ts` (`PopoverName` only), `src/ui/TopBar.tsx`, `src/ui/phone/PhoneMenu.tsx`, `src/style.css`, `packages/pepperscore-editor/README.md`, plus your own 0003-t2 handoff files.
- **Do not touch:** `packages/pepperscore/**`, `validation/**`, the ledger.

## Acceptance criteria
- [ ] Every test in plan T2's checklist written first (confirm failing), then passing; `checkInvariants` empty after each command; undo restores.
- [ ] `removePart` refuses a part with notes and the last part; disabled controls say why; `drum-kit` excluded from choices.
- [ ] Contextual class names; Poppins; MusicXML golden fixtures unchanged.

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run test:editor && npm run test:editor-browser && npm run test:editor-phone
npm run check && npm run build && npm run test:manifest && npm run test:validation
```
Run long commands in the foreground; never overlap `build` with browser tests. Other worktrees may be running browser suites; if a timing or port check fails, rerun that suite alone and record both results.

## Open questions
None. Escalate per AGENTS.md §7.

---
## Receiver ack

Acknowledged: implement T2 only in the assigned editor files: undoable add/change/remove commands, empty-part guards, staff-cap-aware Parts controls in both shells, and README. Write and run the checklist tests red before implementation, then run the required sequential verification. No packages/pepperscore, validation, ledger, or T3 edits. No open questions. GBrain consulted: projects/scoreflow-music-reader and projects/scoreflow-music-reader/gotchas-abc-import; repo plan is authoritative.

---
## Lead answers (2026-11-10, after blocked return at 39d27a9)
- **Ownership widened:** you also own `packages/pepperscore-editor/src/ui/PepperScoreEditor.tsx` and `packages/pepperscore-editor/src/ui/controls.tsx`, **only** to pass the licence `maxStaves` (already computed in `PepperScoreEditor.tsx` ~line 79 and passed to `EditorSession`) through to `PartsPanel` in both shells, and to wire the Parts button/menu item. No other changes in those files. No side channels (globals, module state).
- If `EditorSession` lives in another file that also needs a one-line prop pass-through, you may touch it for that only; list it in the return handoff.
- 0003 T3 later owns `PepperScoreEditor.tsx`; nothing else is editing it now.
- Continue the original handoff from the TDD checklist.


Receiver ack (continued): accepted the narrow ownership extension to controls.tsx and PepperScoreEditor.tsx for maxStaves propagation. Resume original T2, with no other scope changes.
