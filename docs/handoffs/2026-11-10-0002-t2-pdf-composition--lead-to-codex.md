# Handoff: 0002-t2 — PDF composition (lead → codex)

- **Date:** 2026-11-10
- **Type:** dispatch
- **Ledger:** 0002 · **Spec:** docs/specs/0002-pdf-export.md · **Plan:** docs/plans/0002-pdf-export.md (task T2)
- **Branch:** orch/0002-t2-pdf-composition · **Worktree:** created by T3
- **Base commit:** 6d0d41a (T1 merged as PR #71)
- **Port (if running a server):** 5222
- **Status:** closed

## Goal
Turn T1's engraved pages into a real vector PDF: `composePdf` (jsPDF + svg2pdf.js, `compress: true`) and `exportScore` (the only entry point the UI will import), with the reader's annotation overlay (note names, counts, inferred chords, pitch colours) drawn by the same code as the screen, fonts embedded, exact page sizes. Plan task T2 (AC4 real files, AC7, AC8, AC8a).

## Context you need
- Spec `docs/specs/0002-pdf-export.md`; plan approach, global rules and T2 notes `docs/plans/0002-pdf-export.md`.
- T1 return handoff (stave size 6.5 mm, margins 12 mm, `engravePages` contract, line-mode pagination, whole-document shrink): `docs/handoffs/2026-11-10-0002-t1-pdf-page-model--codex-to-lead.md`; T1 review suggestions for T2 (`gh pr view 71 --comments`, r3): a piano A3/12 case leaves a bar off a 0.999 line, `breakLines` could get a non-positive first-line width, four engraving passes per request, check the worker is its own chunk.
- Global instructions: note-text style over coloured dots (white Poppins 600, black 35% stroke, `paint-order: stroke`); svg2pdf ignores `paint-order`, so use the three-pass render (stroke-only outline, shadow, solid white fill).
- 0011 (PR #73) harness helpers: `validation/lib/ports.mjs`, `VALIDATION_BUDGET_SCALE`.
- GBrain: `projects/scoreflow-music-reader`; memory note: commercial licence audit — list new deps in third-party notices.

## Scope
- **In:** plan T2. New dependencies `jspdf` and `svg2pdf.js` (MIT, approved in the spec) as lazy-loaded runtime deps; a PDF parser (e.g. `pdf-lib`) as a dev dependency for tests.
- **Out:** overlay/button/`controls.pdf` (T3), large scores and docs (T4).
- **Files you own:** `packages/pepperscore/src/lib/pdf/compose.ts`, `lib/pdf/fonts.ts` (new), `lib/pdf/**` additions needed by T2, `lib/render.ts` (annotation extraction only), `packages/pepperscore/package.json` + root `package-lock.json`, third-party notices, `validation/pdf.mjs`, your own 0002-t2 handoff files.
- **Do not touch:** `components/**`, `src/styles.css`, `lib/chrome.ts`, `lib/bar-items.ts` (0001 T3 in flight), `lib/tab/**`, `lib/instrument-model.ts` (0013), `packages/pepperscore-editor/**`, other `validation/*.mjs`, the ledger.

## Acceptance criteria
- [ ] Plan T2 acceptance (AC4 real files, AC7, AC8, AC8a), with tests that parse the PDF for page size, page count and text.
- [ ] No PDF code in the initial bundle (dynamic import only); notices updated; non-Latin title behaviour recorded.
- [ ] Reader screen output unchanged by the annotation extraction (existing reader/layout suites pass).

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run check && npm run build && npm run test:pdf && npm run test:reader
npm run test:manifest && npm run test:validation
```
Build before browser suites; under load rerun timing gates with `VALIDATION_BUDGET_SCALE=2` and record both results.

## Open questions
None. Escalate per AGENTS.md §7.

---
## Receiver ack

Acknowledged 2026-11-10: implement T2 only: vector composition at exact paper dimensions, embedded Poppins, shared reader annotation drawing and exportScore snapshot entry. Own only the listed PDF additions, render annotation extraction, package dependency/lock files, notices, validation/pdf.mjs and task handoffs. Preserve UI, editor, ledger and all protected files. Verify parsed PDFs and reader regression suites; return a committed handoff and draft PR. GBrain consulted: projects/scoreflow-music-reader and projects/scoreflow-music-reader/gotchas-abc-import. No open questions.
