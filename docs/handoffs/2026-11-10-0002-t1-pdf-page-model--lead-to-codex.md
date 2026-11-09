# Handoff: 0002-t1 — PDF page model and per-line break spike (lead → codex)

- **Date:** 2026-11-10
- **Type:** dispatch
- **Ledger:** 0002 · **Spec:** docs/specs/0002-pdf-export.md · **Plan:** docs/plans/0002-pdf-export.md (task T1)
- **Branch:** orch/0002-t1-pdf-page-model · **Worktree:** created by T3
- **PR:** <url once opened>
- **Base commit:** 13d48eb (0001 T2 merged as PR #66)
- **Port (if running a server):** 5221
- **Status:** open

## Goal
Prove per-line fitting for PDF export before any UI: paper sizes as data, a greedy `breakLines`, `ViewSpec.breakBefore` in `mei-view.ts`, and a dedicated Verovio worker `engravePages` that lays out at real page size. Plan task T1 (AC4 dimensions-as-data, AC5 layout half, AC6). **This is a spike:** if Verovio doesn't honour the breaks at page size, or bar measurement is unreliable, stop and report in the return handoff — that decides whether the rest of the plan stands.

## Context you need
- Spec: `docs/specs/0002-pdf-export.md`; plan approach, global rules, and task T1 (interfaces and all Notes / gotchas): `docs/plans/0002-pdf-export.md`.
- 0001 T2 merged the composable bar (`lib/bar-items.ts`), where a later 0002 task adds the `pdf` item. Not needed for T1.
- GBrain: `projects/scoreflow-music-reader`.

## Scope
- **In:** plan T1 exactly. Everything under `lib/pdf/` reached only by dynamic `import()`.
- **Out:** PDF composition (T2), overlay/button (T3), docs (T4). No new dependencies in T1.
- **Files you own:** `packages/pepperscore/src/lib/pdf/paper.ts`, `lib/pdf/fit.ts`, `lib/pdf/fit.test.ts`, `lib/pdf/engrave.ts`, `lib/pdf/engrave.worker.ts` (all new), `packages/pepperscore/src/lib/notation/mei-view.ts`, `validation/pdf.mjs` (new), root `package.json` (`test:pdf`, added to `test:validation`), plus your own 0002-t1 handoff files.
- **Do not touch:** `components/**`, `src/styles.css`, `lib/chrome.ts`, `lib/bar-items.ts`, `validation/skin.mjs` (0001 T3 runs in parallel), `lib/import.ts`, `lib/notation/document.ts`, the ledger.

## Acceptance criteria
- [ ] `PAPER_SIZES`, `breakLines` (unit test: one dense bar among sparse at maxBars 4 shortens only its own line), `ViewSpec.breakBefore` (absent → byte-identical output; test), `engravePages` as specified.
- [ ] `validation/pdf.mjs` shows the dense-bar fixture on A4 and that A3 never needs more lines than A4.
- [ ] Return handoff records the stave-size constant and its justification, and the shrink decision.
- [ ] `validation/pdf.mjs` picks an ephemeral port if it starts a server.

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run check && npm run build && npm run test:pdf && npm run test:document && npm run test:layout && npm run test:chunks
npm run test:manifest && npm run test:validation
```
Foreground; never overlap `build` with browser tests. Timing gates (editor redraw, large-score) also fail on main under load; rerun alone and record both results.

## Open questions
None. Escalate per AGENTS.md §7.

---
## Receiver ack

I will implement T1 only: paper dimensions, greedy per-line fitting, optional MEI system breaks preserving existing reader output, and an isolated abortable PDF engraving worker. I will prove A4/A3 fitting with a real Verovio fixture, record fixed stave size and any shrink fallback, and stop/report if measurement or encoded breaks are unreliable. Only the declared files and my task handoffs will change. No open questions. GBrain consulted: projects/scoreflow-music-reader and projects/scoreflow-music-reader/gotchas-abc-import; repository spec/plan govern this task.
