# Handoff: 0002-t3 — PDF overlay, button and controls.pdf (codex → lead)

- **Date:** 2026-11-11
- **Type:** return
- **Ledger:** 0002 · **Spec:** [PDF export](../specs/0002-pdf-export.md) · **Plan:** [PDF export T3](../plans/0002-pdf-export.md)
- **Dispatch:** [lead-to-codex](2026-11-11-0002-t3-pdf-overlay--lead-to-codex.md)
- **Branch:** orch/0002-t3-pdf-overlay
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-d1cdc39d-46ddba0ee7ed626a
- **Base:** fbf1f27d17572cbba0c3882a1f7164ee51c88d4f (required 299d463 is an ancestor)
- **Acknowledgement commit:** f6c1f48eb796ce5d5ef68ce74c443ae998018e1b
- **PR:** draft created after this return commit; PR body links both handoffs
- **Port:** 5223 reserved; no persistent server started
- **Status:** blocked

## Goal
Expose PDF export through default full chrome, explicit controls and skin bars, with a themed overlay, remembered paper, local bars, cancellable fit checking and Save-time view snapshots.

## Scope
- **In / owned:** `packages/pepperscore/src/components/PdfOverlay.tsx`, `components/PepperScore.tsx`, `lib/chrome.ts`, `lib/bar-items.ts`, `lib/prefs.ts`, `src/styles.css`, `validation/pdf.mjs`, `apps/reader/src/embed/SkinTest.tsx`, and the two 0002-t3 handoffs. `DrawerControls.tsx` was owned but needed no edit.
- **Out / protected:** PDF internals, render, notation, TAB, ledger, unrelated docs, dependencies and build configuration/scripts. None changed.

## Current state and acceptance criteria
Implementation is present but is **not ready for approval**. AC1/AC2/AC3/AC5-overlay/AC9 remain unverified through the built UI because the build integration gate fails. The added UI test has not passed; it must be exercised and corrected once the build blocker is resolved. No claim is made that playback preservation, download behaviour, phone containment or worker packaging is certified.

- Added controls.pdf/chrome.pdf, the PDF bar action, a secondary entry composed with the header registry in PepperScore, and PDF drawer extras including the default drawer.
- Added an absolute-positioned themed Poppins dialog with local default 4 bars, A4 default, persisted/validated pdfPaper, fit status, Save/Cancel, busy/error states, focus wrapping, Escape and cancellation cleanup.
- Imports `lib/pdf/engrave` only from the fit effect after opening, and `lib/pdf/export` only from Save. No runtime static PDF import was introduced; type imports erase.
- Captures displayScore/prefs/hidden parts/palette synchronously, then uses the cached baseline and shared planStaves for the Save view, TAB aliases and TAB staves. The active palette is resolved only when the root has pitch colours enabled.
- Fit uses the annotation geometry and metadata reservation matching export. Each measurement cancels its predecessor. Cancel/unmount abort fit and Save; engraving's existing AbortSignal path terminates its worker.
- Downloads use a temporary Blob URL and a slugged title/fallback score.pdf. Detects a same-origin sandbox without allow-downloads and reports an error. Cross-origin ancestor sandbox restrictions cannot be reliably diagnosed by this implementation and remain a risk.

## Blockers requiring lead scope decision
1. `npm run build` fails in **unowned** `packages/pepperscore/scripts/finalize-dist.mjs:26`:
   ```text
   AssertionError [ERR_ASSERTION]: dist/index.js refers to ./verovio/verovio-module.mjs as a plain new URL(…, import.meta.url)
   ```
   Connecting the lazy export makes the bundler extract `runtime-files-*.js` (350 bytes) and `render-*.js` shared chunks. The existing finalizer requires runtime asset URL expressions in index.js itself. Main builds successfully in an isolated temporary archive with the same node_modules; T3 reaches bundling and then fails this guard. Resolving packaging/asset paths needs ownership of build scripts/config and potentially runtime-files or PDF internals. Do not merely remove the assertion: validate host-copied URLs, worker packaging and pack consumers.
2. Unowned `validation/api.mjs:11` (exact resolved-chrome object), `lib/bar-items.test.ts:42–54` and `validation/skin.mjs:536,645` still assert PDF is reserved/unrenderable and the legacy drawer has no added PDF action. Those expectations conflict with this task's explicit requirements and need authorized updates. No out-of-scope tests were edited.
3. AC2's strict unchanged-byte claim is not met by the current static overlay import. Static library graph comparison (relative ESM imports reachable from index.js; dependencies external) against local main fbf1f27:
   - main: **509,740 raw bytes**, **146,309 zlib-compressed bytes** (compression level 9).
   - first T3 bundle: **519,919 raw bytes**, **151,461 zlib-compressed bytes**; +10,179 raw / +5,152 compressed. This is a development measurement before the final small effect/revision edits, not a final artifact claim.
   - PDF export chunk: ~2.664 MB; worker code appears embedded in the lazy output. Worker separation and actual host network loading remain unverified because finalization fails.
   Lead should clarify whether the requirement means no PDF libraries in the initial graph (intended by plan) or byte-identical initial payload; consider lazily loading the overlay too in the resumed implementation.

Per AGENTS §7 and the dispatch's file ownership, implementation stopped when these required scope changes became concrete. No packaging guard, protected implementation, or old test was changed to force a pass.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run check && npm run build && npm run test:pdf && npm run test:embed && npm run test:reader && npm run test:pack
npm run test:manifest && npm run test:validation
```

## Verification output
```text
npm ci && npx playwright-core install chromium: exit 0
npm run check: exit 0 (Astro: 0 errors, 0 warnings, 0 hints)
npm run build: exit 1 (runtime URL assertion, finalize-dist.mjs:26)
npm run test:pdf: exit 1 (fit.test.ts 6/6 pass; UI cannot start: demo dist missing)
npm run test:embed: exit 1 (demo dist missing)
npm run test:reader: exit 1 (demo dist missing)
npm run test:pack: exit 1 (rebuild repeats finalize-dist.mjs:26 failure on final source)
npm run test:manifest: exit 0 (128 local packs, 16 icons; complete/core packs)
npm run test:validation: exit 1 (test:api, api.mjs:11 exact object misses new pdf:true key)
npm run test:css: exit 0 (scoped, no fixed positions/viewport units/generic names)
bar-items.test.ts: 5 pass, 2 fail (old drawer and reserved-PDF expectations)
git diff --check: exit 0
```
No timing gate failed; no budget scaling used. Aggregate validation stops at API, so later suites are not claimed to have run. Main library build succeeded from a temporary archive (no new git worktree), proving the finalizer failure is introduced by this integration; no baseline browser comparison is claimed.

Logs: `/tmp/pdf-t3-{setup,build,main-build,css,bar-tests}.log`, `/tmp/pdf-t3-final-{check,test-pdf,test-embed,test-reader,test-pack,test-manifest,test-validation}.log`, `/tmp/pdf-t3-results.txt`. Scope audit includes only the eight changed implementation/fixture/validation files and these two handoffs. All protected files are untouched.

## Known gotchas / decisions made
- GBrain consulted read-only: `projects/scoreflow-music-reader` (historical project context). Repo spec/plan and linked T2/T4/skin returns govern implementation. No implementer GBrain writes.
- Header registry additions are composed locally in PepperScore because `lib/header-controls.ts` is outside ownership; existing controls retain their registry order/tiers.
- pdfPaper belongs to global Prefs, not per-score FileSettings; PDF bars never read/write screen barsPerLine.
- Snapshot references use the reader's immutable view objects and retain old objects across awaits. Fit revisions track score/prefs/hidden/palette changes.
- No ABC import behaviour changed (For the ABC guide).

## Open questions / follow-ups
Lead: extend ownership for the build/packaging integration and outdated PDF-reservation tests, then resume T3 validation before requesting review. AC9 needs active-playback and meaningful nonzero-scroll evidence; new test currently covers SVG/scroll identity only. Test cancellation, retryable failures, sandbox rejection, untitled filename, dense fitting and Save-time view changes, and verify worker packaging after the build is repaired. T4's Firefox/large-score work remains separate.

## Receiver ack
Lead acknowledges through the ledger on main.

## Return
- **Outcome:** partial / blocked, draft for review of concrete implementation and required scope expansion.
- **What changed:** PDF availability, overlay, preferences, snapshot integration and initial UI validation.
- **For GBrain (lead to promote):** first lazy PDF connection changes shared-chunk placement; existing index-only runtime asset guards must be revisited with consumer packaging proof rather than assumed to pass from the standalone PDF spike.
