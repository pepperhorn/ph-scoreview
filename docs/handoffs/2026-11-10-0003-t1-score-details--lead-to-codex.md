# Handoff: 0003-t1 — Score details fields (editor) (lead → codex)

- **Date:** 2026-11-10
- **Type:** dispatch
- **Ledger:** 0003 · **Spec:** docs/specs/0003-teaching-layer.md · **Plan:** docs/plans/0003-teaching-layer.md (task T1)
- **Branch:** orch/0003-t1-score-details · **Worktree:** created by T3
- **PR:** <url once opened>
- **Base commit:** 7eb7fd0
- **Port (if running a server):** 5231
- **Status:** open

## Goal
The editor's score meta gains `description`, `project`, `tags` (and model-only `goal`), editable in a new Details popover, saved in `.pepperscore` files and undoable. Plan task T1 (spec gap 2).

## Context you need
- Spec: `docs/specs/0003-teaching-layer.md`; plan task T1 (step-by-step TDD checklist and the `meta` shape): `docs/plans/0003-teaching-layer.md`.
- GBrain: `projects/scoreflow-music-reader`.

## Scope
- **In:** plan T1 exactly. `goal` has no UI. MusicXML output and golden fixtures unchanged.
- **Out:** T2+ (parts, plugin slot, tour); anything in `packages/pepperscore`.
- **Files you own:** `packages/pepperscore-editor/src/model/schema.ts`, `src/model/create.ts`, `src/format/pepperscore-file.ts` and its tests, `src/engine/commands/score.ts`, `score.test.ts`, new `src/ui/DetailsPanel.tsx`, `src/ui/keymap.ts` (`PopoverName` only), `src/ui/Popover.tsx`, `src/ui/TopBar.tsx`, `src/ui/phone/PhoneMenu.tsx`, `src/style.css`, `packages/pepperscore-editor/README.md`, plus your own 0003-t1 handoff files.
- **Do not touch:** `packages/pepperscore/**`, the ledger.

## Acceptance criteria
- [ ] The tests in plan T1 (setMeta add/remove/trim/dedupe/undo; file round trip; old files still parse) written first, then passing.
- [ ] Details popover reachable from `TopBar` (`data-ps-popover-for="details"`) and `PhoneMenu`; contextual class names; Poppins.

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run test:editor && npm run test:editor-browser && npm run test:editor-phone
npm run check && npm run build && npm run test:manifest && npm run test:validation
```
Run long commands in the foreground; never overlap `build` with reader tests.

## Open questions
None. Escalate per AGENTS.md §7.

---
## Receiver ack
