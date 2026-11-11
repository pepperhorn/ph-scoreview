# Handoff: 0002-t4 — PDF export: large scores, browsers and docs (claude → lead)

- **Date:** 2026-11-12
- **Type:** return
- **Ledger:** 0002 · **Spec:** [PDF export](../specs/0002-pdf-export.md) · **Plan:** [T4](../plans/0002-pdf-export.md)
- **Dispatch:** [lead-to-claude](2026-11-12-0002-t4-pdf-large-browsers-docs--lead-to-claude.md)
- **Branch:** orch/0002-t4-pdf-large-browsers-docs · **Base:** e1693e8 (main with 0001-t5, 0022 merged)
- **PR:** see the Return section
- **Status:** done, with one decision for the lead (S34 WebKit assertion, below)

## Goal
AC10 (large score exports without freezing; Cancel works) and AC11 (Chromium, Firefox, WebKit), plus CI and docs.

## What changed
- **Cooperative composition** (`lib/pdf/cooperative.ts`, `slices.ts`, `compose.ts`, `export.ts`, `annotations.ts`, `normalize.ts`). svg2pdf draws a 30-part page in one synchronous 3–4 s burst, so checking between pages was not enough. Each page is now:
  - annotated, text-normalised and paint-materialised as generators that pause between elements (the old sync functions remain as thin wrappers, so existing callers and tests are unchanged);
  - split into slices of ≤60 elements (`planSlices`), each drawn by its own svg2pdf call on a shell that keeps the original ancestors, defs and styles (`sliceShell`). Slices run in document order, so paint order and output are unchanged. The existing Poppler pixel-parity and operator checks pass unchanged.
  - Every slice boundary yields (`setTimeout`, not `scheduler.yield`: its continuation runs ahead of other timers and starved the timer heartbeat, which would also starve playback) and checks the `AbortSignal`.
- **Progress:** `ExportRequest.onProgress({phase: 'engraving'|'annotating'|'composing', page, pages})`; the overlay shows "Building PDF… page N of M" (`PdfOverlay.tsx`, 12 lines).
- **Validation** (`validation/pdf.mjs`): `assertLargeScoreExport` (30 parts from `synthetic.mjs`, 12 bars by default; `PDF_LARGE_MEASURES` overrides; `PDF_LARGE_ONLY=1` runs just it). It asserts a valid multi-page PDF, ordered progress, responsiveness, AbortError with prompt cancel (< 750 ms × scale), and no leaked offscreen host, `FontFace` or live worker after both a cancelled and a completed export. It was written first and failed (no progress, multi-second blocks) before the implementation.
- **CI:** Firefox and WebKit run `npm run test:pdf` as steps in the existing PR-only `reader` matrix job, preceded by the same Poppler install the `validate` job uses (`test:pdf` hard-requires `pdftoppm`). `runs-on` untouched. Job timeout 30 → 40 min: the new step has a 12 min cap and the existing step caps already sum to 20 min.
- **Docs:** README (PDF section: no imperative API, cancel/progress, large scores, browser support, WebKit limit), CHANGELOG `Unreleased`, spec phase 2 marked done.
- **Initial bundle:** unchanged. Only lazy modules (`lib/pdf/**`, `PdfOverlay.tsx`) and docs/validation/CI changed; `PepperScore.tsx` and everything in the static graph are untouched.

## Timings (30 parts × 12 bars = 3 pages, A4, 4 bars/line; local, `VALIDATION_BUDGET_SCALE=2`, load average ~5)
"Longest block" is the largest gap between 10 ms timer ticks, split by phase. Long tasks are only reported by Chromium.

| Engine | Export total | Annotating | Composing | Engraving (worker) | Longest long task | Cancel latency |
|---|---:|---:|---:|---:|---:|---:|
| Chromium | 16.6 s | 199 ms | 171 ms | 10 ms | 93 ms | 20 ms |
| Firefox | 21.3 s | 195 ms | 160 ms | 233 ms | n/a | 11 ms |
| WebKit | 38.4 s | 229 ms | 239 ms | **2525 ms** | n/a | 15 ms |

- Before: Chromium blocked 2.5–5 s per page (40 bars: 39 s total, 3.9 s longest task); svg2pdf alone was 3–4 s per page.
- The remaining ~200 ms blocks are single steps that cannot be sliced: `DOMParser` of a ~450 KB page, and the forced layout when a page is first attached. Target (< 200 ms per slice) is met on Chromium; Firefox and WebKit are within ~40 ms of it.
- Total export time is dominated by Verovio engraving in the worker (≈ 8 s per 12 bars before this change too); this task made it responsive, not faster. A full 150-bar score is minutes, so the gate uses 12 bars. Gates are 500 ms × scale (composition, all engines) and engraving on Chromium only; I did not change any other budget.
- Host load varied from 5 to 33 during the work, and numbers moved ~2× with it. Runs on the loaded host failed the 500 ms gate once on Chromium (515 ms), hence the scale-2 runs above.

## S34 root cause (WebKit overlay does not recover after a failed lazy chunk + reload)
- **Not an overlay or test-ordering bug; it is WebKit.** The reader app is built with Vite, whose `__vitePreload` adds `<link rel="modulepreload">` for the lazy `PdfOverlay` chunk just before `import()`. When that fetch fails, WebKit keeps the failed resource in its per-web-process memory cache, and every later attempt in that process (reload, `history.go(0)`, `goto` of the same URL, Cancel + click again, up to 5 s later) is answered from the failure with **no request to the server**. `import()` or `fetch()` of the same URL without the preload link works, and a new page (new web process) loads the chunk fine.
- Reproduced three ways, so it is not a Playwright `route.abort` artefact: abort, a server answering 503, and a server destroying the socket. Server logs show zero requests after the failure. (Chromium and Firefox re-request on reload.)
- The intermittent "two `.pdf-trigger`" I could not reproduce in 6+ runs; with `/embed-skin` there are two readers on the page, and every assertion in the block is scoped to `.skin-reader`. No change made for it.
- **No product fix is possible in our code:** the preload link comes from the host bundler, the chunk URL is content-hashed, and a page can't evict a WebKit memory-cache entry. The overlay already shows an actionable alert with Reload page (never a stuck "Loading…").
- **Test change (decision for you):** in WebKit only, `validation/pdf.mjs` now asserts the real recovery path: after the fault is cleared, the dialog still shows the alert and a Reload button, and the same score opens the overlay normally in a **new page**. Chromium/Firefox keep the original assertion unchanged (reload, then "Paper size" visible). I judged this the honest test of an engine-level limit rather than a weakened assertion, but it is a per-engine difference, so please confirm. The README documents the limit for Safari users. If you would rather have the original reload assertion everywhere, the only options are host-side (disable `modulePreload` for that chunk in `apps/reader`, out of my scope) or accepting a red WebKit run.

## Decisions made
- `setTimeout` yields, 25 ms slice budget, ≤60 elements per svg2pdf call (100 gave 90–190 ms slices).
- Progress is a callback on the request (not an event or promise) so the overlay needs no new state machine.
- WebKit engraving-phase stall is reported but not gated (see Follow-ups).
- Debug probes used during diagnosis were committed in a WIP commit and removed in the next one; the PR's net diff contains none.

## Follow-ups (for the lead to promote)
- **New suggestion, WebKit:** the page's timers stall for ~2.5 s (4.6 s on a loaded host) while the engraving worker starts/runs, with the main thread idle. Measured via the heartbeat during `engravePages` in WebKit only; not in our composition code. Worth a look at worker start-up (module worker + WASM instantiate) and whether `large-score.mjs`'s reader path shows it too. Effort M, value medium (Safari large scores).
- Non-sliceable ~200 ms steps (DOMParser, first layout) could go if the export kept one DOM per page instead of serialising in `export.ts` and re-parsing in `compose.ts` (also saves ~100 ms/page). Effort S–M.
- S32 (chord/tempo overlap) not touched.
- GBrain page candidates: "WebKit caches a failed modulepreload for the life of the web process; reload does not recover" and "svg2pdf is synchronous per call: slice by pruned shells; scheduler.yield starves timers".
- GBrain: consulted `projects/scoreflow-music-reader` via the brief only (read-only; no write).

## For the ABC guide
No ABC import behaviour changed.

## Files touched
`validation/pdf.mjs`, `packages/pepperscore/src/lib/pdf/{cooperative,slices,compose,export,annotations,normalize}.ts`, `components/PdfOverlay.tsx` (progress text only; the S34 cause is not here), `README.md`, `CHANGELOG.md`, `.github/workflows/ci.yml` (reader job only), `docs/specs/pepperscore-plugins-and-embeds.md`, own handoffs. Nothing in the do-not-touch list.

## Verification output
Host load was 5–67 (other agents), so timing suites used `VALIDATION_BUDGET_SCALE=2` where noted; no budget or threshold was changed.

```text
npm ci && npx playwright-core install chromium firefox webkit: exit 0
npm run check: exit 0
npm run build: exit 0 (runtime URL and demo dist guards pass)
npm run test:manifest: exit 0
VALIDATION_BUDGET_SCALE=2 npm run test:validation: exit 0 (includes test:pdf on chromium;
  PDF large score (chromium, 30 parts x 12 bars): export 33220 ms, 3 pages, longest annotating/composing
  gap 365 ms, longest long task 175 ms, cancel latency 20 ms: loaded host)
npm run test:pdf (chromium, unscaled, earlier run): every parity/overlay/page-model check passed; the large gate
  failed once at 515 ms on a load-31 host before the scale-2 reruns above
VALIDATION_BUDGET_SCALE=2 BROWSER=firefox npm run test:pdf: exit 0
  PDF large score (firefox): export 70818 ms (load ~60), longest annotating 423 / composing 512 ms, cancel 20 ms
VALIDATION_BUDGET_SCALE=2 BROWSER=webkit npm run test:pdf: exit 0 (includes the S34 WebKit branch)
  PDF large score (webkit): export 194047 ms (load ~67), engraving stall 6508 ms (reported, not gated),
  annotating 762 / composing 541 ms, cancel 62 ms
```
Quieter-host numbers for the three engines are in the Timings table above.

## Receiver ack
Lead acknowledges through the ledger on main.

## Return
- **Outcome:** done; AC10, AC11 met locally; CI steps added for the reader job. One decision for the lead: the WebKit-only S34 assertion.
