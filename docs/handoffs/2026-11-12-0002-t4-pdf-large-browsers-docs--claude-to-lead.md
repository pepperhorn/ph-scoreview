# Handoff: 0002-t4 — PDF export: large scores, browsers and docs (claude → lead)

- **Date:** 2026-11-12
- **Type:** return
- **Ledger:** 0002 · **Spec:** [PDF export](../specs/0002-pdf-export.md) · **Plan:** [T4](../plans/0002-pdf-export.md)
- **Dispatch:** [lead-to-claude](2026-11-12-0002-t4-pdf-large-browsers-docs--lead-to-claude.md)
- **Branch:** orch/0002-t4-pdf-large-browsers-docs · **Base:** e1693e8 (main with 0001-t5, 0022 merged)
- **PR:** see the Return section
- **Status:** done (r1: review changes addressed, see the r1 sections)

## Goal
AC10 (large score exports without freezing; Cancel works) and AC11 (Chromium, Firefox, WebKit), plus CI and docs.

## What changed
- **Cooperative composition** (`lib/pdf/cooperative.ts`, `slices.ts`, `compose.ts`, `export.ts`, `annotations.ts`, `normalize.ts`). svg2pdf draws a 30-part page in one synchronous 3–4 s burst, so checking between pages was not enough. Each page is now:
  - annotated, text-normalised and paint-materialised as generators that pause between elements (the old sync functions remain as thin wrappers, so existing callers and tests are unchanged);
  - split into slices of ≤60 elements (`planSlices`), each drawn by its own svg2pdf call on a shell that keeps the original ancestors, defs and styles (`sliceShell`). Slices run in document order, so paint order and output are unchanged. The existing Poppler pixel-parity and operator checks pass unchanged.
  - Every slice boundary yields (`setTimeout`, not `scheduler.yield`: its continuation runs ahead of other timers and starved the timer heartbeat, which would also starve playback) and checks the `AbortSignal`.
- **Progress:** `ExportRequest.onProgress({phase: 'engraving'|'annotating'|'composing', page, pages})`; the overlay shows "Building PDF… preparing/drawing page N of M" (`PdfOverlay.tsx`, 12 lines).
- **Validation** (`validation/pdf.mjs`): `assertLargeScoreExport` (30 parts from `synthetic.mjs`, 12 bars by default; `PDF_LARGE_MEASURES` overrides; `PDF_LARGE_ONLY=1` runs just it). It asserts a valid multi-page PDF, ordered progress, responsiveness, AbortError with prompt cancel (< 750 ms × scale), and no leaked offscreen host, `FontFace` or live worker after both a cancelled and a completed export. It was written first and failed (no progress, multi-second blocks) before the implementation.
- **CI:** Firefox and WebKit run `npm run test:pdf` as steps in the existing PR-only `reader` matrix job, preceded by the same Poppler install the `validate` job uses (`test:pdf` hard-requires `pdftoppm`). `runs-on` untouched. The job timeout stays at **30 min** (r1: the review measured both reader jobs under 13 min). The PDF step costs about 3–5 min per engine on CI (review: 2m54s Firefox, 4m33s WebKit at r0); r1 adds three short cancel exports and the large-overlay cancel, so expect roughly +1–2 min.
- **Docs:** README (PDF section: no imperative API, cancel/progress, large scores, browser support, WebKit limit), CHANGELOG `Unreleased`, spec phase 2 marked done.
- **Initial bundle (r1):** r0 changed only lazy modules. r1 adds `lib/lazy-import.ts` and its call in `PepperScore.tsx`: `dist/index.js` goes from 480,340 to 480,999 bytes raw and **140,354 to 140,594 gzip-9 (+240 bytes)**, measured by rebuilding with and without the change.

## Timings (30 parts × 12 bars = 3 pages, A4, 4 bars/line; local, `VALIDATION_BUDGET_SCALE=2`, load average 8–10, Verovio from the shipped runtime file)
"Longest block" is the largest gap between 10 ms timer ticks over the **whole** export, by phase. It is now gated in all three engines (500 ms × scale). Cancel latency is measured from a cancel requested by an independent timer to the AbortError.

| Engine | Export | Longest block (whole export) | Engraving | Annotating | Composing | Cancel: startup / mid-page / between pages |
|---|---:|---:|---:|---:|---:|---:|
| Chromium | 36.2 s | 431 ms (long task 206 ms) | 26 ms | 197 ms | 431 ms | 3 / 46 / 30 ms |
| Firefox | 18.8 s | 244 ms | 26 ms | 87 ms | 244 ms | 0 / 22 / 25 ms |
| WebKit | 62.5 s | 361 ms | 328 ms | 161 ms | 361 ms | 0 / 46 / 43 ms |

Chromium's export time and block were higher than on the quiet-host run in r0 (16.6 s, 199 ms) because the host was shared; the gate is the same.

**Full fixture (30 parts × 150 bars), Chromium, run alone, `VALIDATION_BUDGET_SCALE=2`:** completed, **38 pages, export 245 s (4.1 min)**, longest timer gap 313 ms (annotating 305, composing 313, engraving 19), longest long task 518 ms, cancel 0 / 20 / 506 ms. This is the same fixture and generator as `validation/large-score.mjs`. `PDF_LARGE_MEASURES=150 PDF_LARGE_ONLY=1 node validation/pdf.mjs` reproduces it; the routine gate stays at 12 bars.

- Before this work Chromium blocked 2.5–5 s per page (40 bars: 39 s total, 3.9 s longest task); svg2pdf alone was 3–4 s per page.
- Remaining ~200–400 ms blocks are single steps that cannot be sliced: `DOMParser` of a ~450 KB page and the forced layout when a page is first attached.
- Export time is dominated by engraving in the worker; this task made it non-blocking, not faster.

## S34 root cause and fix (r1: reversed from r0)
- **Cause (unchanged):** the reader app is built with Vite, whose `__vitePreload` adds `<link rel="modulepreload">` for the lazy `PdfOverlay` chunk before `import()`. When that fetch fails, WebKit keeps the failed resource in its per-process memory cache and answers every later attempt (reload, `goto`, retry) from it with no request to the server. Reproduced with `route.abort`, a 503 and a dropped socket.
- **r0 was wrong that no code-side fix exists.** The review's finding was right: a different query string is a different resource.
- **Fix (code side, portable to any host bundler):** new `lib/lazy-import.ts`, `importWithRecovery(load, stem)`. If the plain import fails, it finds the chunk's address from the page's `modulepreload` links or resource timing (by file-name stem) and imports `<url>?recovery=<unique>` once. The overlay loader in `PepperScore.tsx` (lazy-load effect only) uses it. Each attempt gets its own query because browsers cache a failed module per address (Chromium cached a fixed `?recovery=1` failure and failed the in-page retry in my first attempt). If no address is found, or the retry fails, the original error is shown as before. Reload page stays as the last resort. Initial-graph cost: the helper is ~1 KB raw in the entry; I did not re-measure gzip separately and expect it within noise of the 2 KB target.
- **No host-config change:** I did not touch `apps/reader/astro.config.mjs`, `vite.config.ts` or `build.modulePreload`; the code-side fix is enough and works for hosts we do not control. README mentions that Vite hosts can also exclude the chunk from `modulePreload`.
- **Test:** the original recovery assertion is restored in all three engines. The fault is `route(/PdfOverlay/)` (so the retry address fails too), then unroute, **Reload page**, open the overlay and expect "Paper size". A second scenario recovers in the same page (Cancel, reopen). The duplicate scoped `.pdf-trigger` is a transition: `setSkin({bar:['pdf']})` briefly renders both the header and bar buttons, so every open waits for exactly one trigger first.
- Files changed for this: `lib/lazy-import.ts` (new), `components/PepperScore.tsx` (one import and one call in the PDF lazy-load effect), `validation/pdf.mjs`.

## WebKit engraving stall: cause and fix (r1)
- **Root cause: the test harness, not the product.** A worker that only does `import('verovio-module.mjs')` then instantiates it stalled the page's timers for 6.1 s (import took 11.4 s) in WebKit when the 7.3 MB module was served by the Vite dev server (which transforms it); the same module served byte for byte as static JS took 0.6 s to import with a 387 ms main-thread gap, and instantiating took 0.6 s either way. The structured clone of the input is 28 ms and not a factor. The CI stall of 2.8 s came from the same dev transform, as `validation/pdf.mjs` loaded Verovio through Vite.
- **Fix:** the large-score test now loads Verovio from the shipped runtime file (`dist/verovio/*.mjs`, served untransformed by a small middleware), as production does. Whole-export responsiveness is now gated in **all three engines**, engraving phase included; WebKit measures 328 ms there (an irreducible-for-now cost of base64 decode and WASM compile, which I did not try to mitigate further).
- **Cancel during startup** is tested in every engine (timer fires 30 ms after the engraving phase starts): AbortError within a few ms, worker terminated.
- Not fixed, and not claimed: the **reader's** own Verovio worker under the same dev transform. It was not in scope and production is unaffected.
- README no longer carries an unconditional claim; it quotes measured figures from the validation fixture and says they are not a guarantee on slow devices.

## Cancellation tests (r1)
- Library level: cancels come from an independent timer, measured from the request, at three points: during engraving start-up, while the first page is being drawn (timer fires 150 ms after page 1 starts, and a page takes seconds, so removing the within-page checks would fail the latency gate and the "page 2 never started" assertion), and between pages. Each asserts AbortError, latency under 750 ms × scale, and no offscreen host, `FontFace` or live worker. The completed export is checked for the same leaks.
- Overlay level: with a 24-staff score, a real Cancel click once the status reads "drawing page 1 of N"; the dialog closes promptly, no download occurs, the worker terminates, the host and fonts are released, and after switching to a small score the overlay reopens and downloads `after-cancel.pdf`.
- Progress events now fire at the **start** of each page (`page` is the page being worked on); the overlay reads "Building PDF… preparing/drawing page N of M".

## Decisions made
- `setTimeout` yields, 25 ms slice budget, ≤60 elements per svg2pdf call (100 gave 90–190 ms slices).
- Progress is a callback on the request (not an event or promise) so the overlay needs no new state machine.
- The WebKit engraving-phase stall was a harness artefact (Vite dev transform of the 7 MB runtime); the large-score test now loads the shipped runtime and gates the whole export in all engines.
- The S34 mitigation is code-side (`lib/lazy-import.ts`); no host build config changed.
- Debug probes used during diagnosis were committed in a WIP commit and removed in the next one; the PR's net diff contains none.

## Follow-ups (for the lead to promote)
- **WebKit residual:** engraving start-up still costs ~330 ms of main-thread time (base64 decode and WASM compile in the worker). Sharing one compiled `WebAssembly.Module` across the fit-check and Save workers would remove it from every run after the first. Effort M, value low-medium.
- **Reader in dev builds:** the reader's own Verovio worker is stalled the same way when Verovio is served through Vite's dev transform; production is unaffected. Only matters for contributors testing in WebKit.
- Non-sliceable ~200 ms steps (DOMParser, first layout) could go if the export kept one DOM per page instead of serialising in `export.ts` and re-parsing in `compose.ts` (also saves ~100 ms/page). Effort S–M.
- S32 (chord/tempo overlap) not touched.
- GBrain page candidates: "WebKit caches a failed modulepreload for the life of the web process; reload does not recover; retry through a unique query string" and "Vite dev transform of the 7 MB Verovio module stalls WebKit timers: time against the shipped file" and "svg2pdf is synchronous per call: slice by pruned shells; scheduler.yield starves timers".
- GBrain: consulted `projects/scoreflow-music-reader` via the brief only (read-only; no write).

## For the ABC guide
No ABC import behaviour changed.

## Files touched
`validation/pdf.mjs`, `packages/pepperscore/src/lib/pdf/{cooperative,slices,compose,export,annotations,normalize}.ts`, `components/PdfOverlay.tsx` (progress text only), `components/PepperScore.tsx` (the PDF lazy-load effect: one import and one call), `lib/lazy-import.ts` (new), `README.md`, `CHANGELOG.md`, `.github/workflows/ci.yml` (reader job only), `docs/specs/pepperscore-plugins-and-embeds.md`, own handoffs. Nothing in the do-not-touch list.

## Verification output
Final r1 run on the head of this branch. Host load was 8–10 for the per-engine runs; timing suites used `VALIDATION_BUDGET_SCALE=2`; no budget or threshold was changed.

```text
npm run check: exit 0
npm run build: exit 0
npm run test:manifest: exit 0
VALIDATION_BUDGET_SCALE=2 npm run test:validation: exit 0 (full chain, includes test:pdf on chromium;
  PDF large score (chromium, 30 parts x 12 bars): export 15201 ms, longest timer gap 222 ms, long task 106 ms)
VALIDATION_BUDGET_SCALE=2 BROWSER=chromium npm run test:pdf: exit 0
VALIDATION_BUDGET_SCALE=2 BROWSER=firefox  npm run test:pdf: exit 0
VALIDATION_BUDGET_SCALE=2 BROWSER=webkit   npm run test:pdf: exit 0
VALIDATION_BUDGET_SCALE=2 PDF_LARGE_MEASURES=150 PDF_LARGE_ONLY=1 BROWSER=chromium node validation/pdf.mjs: exit 0
  (30 parts x 150 bars: 38 pages, export 245177 ms, longest gap 313 ms; run alone, 4m18s wall)
```
The per-engine numbers in the Timings table come from the second set of runs above.

## Receiver ack
Lead acknowledges through the ledger on main.

## Return
- **Outcome:** done; r1 addresses all three review findings. AC10 and AC11 hold locally in all three engines with the original S34 recovery assertion restored everywhere; a completed 150-bar Chromium export is recorded above. No open decision, apart from the ledger items in Follow-ups.
