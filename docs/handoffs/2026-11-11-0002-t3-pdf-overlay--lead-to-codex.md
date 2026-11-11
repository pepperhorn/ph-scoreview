# Handoff: 0002-t3 — PDF overlay, button and controls.pdf (lead → codex)

- **Date:** 2026-11-11
- **Type:** dispatch
- **Ledger:** 0002 · **Spec:** docs/specs/0002-pdf-export.md · **Plan:** docs/plans/0002-pdf-export.md (task T3)
- **Branch:** orch/0002-t3-pdf-overlay · **Worktree:** created by T3
- **Base commit:** 299d463 (0002 T1 #71, T2 #78 and 0001 T4 #81 merged)
- **Port (if running a server):** 5223
- **Status:** closed

## Goal
A PDF button (header registry on `full`, drawer via `drawerExtras`, bar item `pdf`, `controls.pdf`/`chrome.pdf`) opens an overlay with paper size (remembered `pdfPaper`, default A4), bars per line (local, default 4), a "Checking fit…" note, Save and Cancel; Save calls `exportScore` and downloads a blob (`<slugged title>.pdf` or `score.pdf`). Plan T3 (AC1, AC2, AC3, AC5 overlay half, AC9).

## Context you need
- Spec `docs/specs/0002-pdf-export.md` (overlay section, AC1–AC3, AC5, AC9) and plan T3 notes (header registry secondary, drawer extras, theme tokens, dialog role + focus trap like the mixer, no `position:fixed`, abort previous measure runs, Cancel terminates the worker, no `lib/pdf` chunk before click, compare initial chunk sizes vs main).
- T2 return handoff `docs/handoffs/2026-11-10-0002-t2-pdf-composition--codex-to-lead.md` (`exportScore` contract; T3 must verify worker chunk separation once the UI reaches it).
- **Pitch colours (0001 T4, #81):** when pitch colours are on, the export must pass the active palette — `resolvePitchColours` throws unless the root has colours on, so call it only then (see `docs/handoffs/2026-11-11-0001-t4-pitch-colours--codex-to-lead.md`).
- 0001 skin/bar work (T2/T3 return handoffs) for bar items, `resolveChrome`, `drawerExtras`, phone bottom toolbar rules.
- Known follow-up for T4, not this task: Firefox export renders notation ~10× too large (ledger S22).

## Scope
- **In:** plan T3.
- **Out:** large scores/Firefox/WebKit/docs (T4); stamping templates (0015).
- **Files you own:** `packages/pepperscore/src/components/PdfOverlay.tsx` (new), `lib/chrome.ts`, `lib/bar-items.ts`, `lib/prefs.ts`, `components/PepperScore.tsx`, `components/DrawerControls.tsx`, `src/styles.css`, `validation/pdf.mjs`, `apps/reader/src/embed/SkinTest.tsx`, your own 0002-t3 handoff files.
- **Do not touch:** `lib/pdf/**`, `lib/render.ts`, `lib/tab/**`, `lib/notation/**` (0013-T3 in flight), the ledger.

## Acceptance criteria
- [ ] Spec AC1, AC2 (no `lib/pdf` chunk loaded before the button is clicked; initial chunk sizes vs main recorded), AC3, AC5 overlay half, AC9 (scroll, engraving and playback unaffected).
- [ ] Contextual class names; Poppins; theme tokens; works on phone within the bottom-toolbar rules.

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run check && npm run build && npm run test:pdf && npm run test:embed && npm run test:reader && npm run test:pack
npm run test:manifest && npm run test:validation
```
Build before browser suites; under load rerun timing gates with `VALIDATION_BUDGET_SCALE=2`.

---
## Receiver ack

Acknowledged 2026-11-11 (Codex). I will add the PDF control and themed, cancellable overlay within the declared files; use lazy PDF imports, remembered paper and local bars; snapshot the current planned view and active pitch palette on Save; verify unused-feature chunk separation and reader state preservation. No changes to PDF internals, notation, TAB, rendering, ledger or unrelated docs. Base 299d463 is an ancestor and the worktree is clean. GBrain consulted: projects/scoreflow-music-reader (historical context); repo spec/plan and linked returns govern this task. No open scope questions.

---
## Lead answers (2026-11-11, after blocked return at ca7fec8)
1. **Build/packaging:** you now also own `packages/pepperscore/vite.config.ts`, `packages/pepperscore/scripts/finalize-dist.mjs`, and `packages/pepperscore/src/lib/verovio-runtime.ts` / any `runtime-files` module, for this one purpose: keep runtime asset URLs (`new URL(…, import.meta.url)` for Verovio files etc.) resolvable by hosts after the lazy PDF chunk is connected. Prefer fixing chunking (e.g. keep the runtime-files module in the entry chunk via `manualChunks`/output options) over loosening the finalizer. If the guard must change, it must still prove the same thing for every chunk that carries runtime URLs, and `npm run test:pack` (consumer install) plus host-copied URL checks must pass. Don't touch `lib/pdf/**` or `lib/render.ts` (0013-T3 owns them); if a fix needs them, stop and ask.
2. **Outdated tests:** you now own `validation/api.mjs`, `packages/pepperscore/src/lib/bar-items.test.ts` and `validation/skin.mjs` for updating expectations that assume PDF is reserved/unrenderable or that the drawer has no PDF action. Only those expectations; list each change in the return handoff.
3. **AC2 meaning:** no PDF engine, worker or PDF libraries (jsPDF, svg2pdf, fonts) in the initial graph, and the overlay itself lazy-loaded too, so the initial payload grows only by the button/registry wiring. Measure and record initial raw + gzip size vs main (target: under ~2 KB gzip increase) and show no `lib/pdf` chunk is fetched before the button is clicked.
Continue the original handoff and finish the remaining AC9 evidence (active playback + nonzero scroll), cancellation, failure, untitled filename and worker-packaging checks.

Acknowledged: resuming within the expanded packaging and expectation-only test scope; AC2 includes lazy overlay and initial gzip measurement.

### Additional lead answer (2026-11-11, reader verification)
The user expanded ownership to `validation/reader.mjs` for the header tab-order expectation at approximately line 115 (add PDF in registry position) and any other assertion that only changes because PDF now exists. No other changes in that file; enumerate each in the return. Acknowledged.
