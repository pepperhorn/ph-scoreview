# Handoff: 0003-t3 — Plugin slot and control targets (editor) (lead → codex)

- **Date:** 2026-11-10
- **Type:** dispatch
- **Ledger:** 0003 · **Spec:** docs/specs/0003-teaching-layer.md · **Plan:** docs/plans/0003-teaching-layer.md (task T3)
- **Branch:** orch/0003-t3-plugin-slot · **Worktree:** created by T3
- **Base commit:** 8127cec (T1 #68, T2 #69 and 0011 #73 merged)
- **Port (if running a server):** 5233
- **Status:** open

## Goal
The editor accepts `plugins` that render overlays with an `EditorHost` (document, subscribe, undoable dispatch, findTarget/revealTarget, openPopover, shell, editable, origin), and every control a tour needs carries `data-ps-target`. Plan task T3 exactly (API shape, TDD checklist, key isolation, stub plugin under `?stubPlugin=1`).

## Context you need
- Spec gap 3 and "Packaging and where it runs": `docs/specs/0003-teaching-layer.md`; plan T3: `docs/plans/0003-teaching-layer.md`.
- T1 and T2 return handoffs: `docs/handoffs/2026-11-10-0003-t1-score-details--codex-to-lead.md`, `docs/handoffs/2026-11-10-0003-t2-parts--codex-to-lead.md` (`'details'` and `'parts'` popovers; maxStaves pass-through in `PepperScoreEditor.tsx`/`controls.tsx`).
- 0011 (PR #73) made validation harnesses use free ports and `VALIDATION_BUDGET_SCALE` for local timing gates; use `validation/lib/ports.mjs` if `editor.mjs` needs a server.
- GBrain: `projects/scoreflow-music-reader`.

## Scope
- **In:** plan T3.
- **Out:** T4–T6 (private repo, script, BeCreative host); anything in `packages/pepperscore`.
- **Files you own:** the plan's T3 "Owns" list (paths under `packages/pepperscore-editor/` unless shown otherwise): `src/plugin/host.ts`, `host.test.ts` (new), `src/ui/PepperScoreEditor.tsx`, `src/ui/session.ts`, `src/index.ts`, `src/ui/TopBar.tsx`, `src/ui/ScoreTab.tsx`, `src/ui/TempoFields.tsx`, `src/ui/Inspector.tsx`, `src/ui/phone/*`, `src/ui/controls.tsx` (data-ps-target only), `src/ui/DetailsPanel.tsx` and `src/ui/PartsPanel.tsx` (data-ps-target only), `packages/pepperscore-editor/README.md`, `apps/reader/src/embed/EditorDemo.tsx`, a new stub in `apps/reader/src/embed/`, `validation/editor.mjs`; plus your own 0003-t3 handoff files.
- **Do not touch:** `packages/pepperscore/**`, other `validation/*.mjs`, the ledger.

## Acceptance criteria
- [ ] Plan T3 checklist complete; `EditorHost`/`EditorPlugin`/`EditorTarget` exported from the package root as specified.
- [ ] No `plugins` prop → no `[data-ps-plugin]` element; typing in a plugin never reaches shortcuts or note entry; plugin unmounts cleanly on file open.

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run test:editor && npm run build && npm run test:editor-browser && npm run test:editor-phone
npm run check && npm run test:manifest && npm run test:validation
```
Build before browser suites. If a timing gate fails under load, rerun with `VALIDATION_BUDGET_SCALE=2` and record both results.

## Open questions
None. Escalate per AGENTS.md §7.

---
## Receiver ack
