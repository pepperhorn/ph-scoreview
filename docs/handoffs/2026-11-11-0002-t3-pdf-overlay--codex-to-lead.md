# Handoff: 0002-t3 — PDF overlay, button and controls.pdf (codex → lead)

- **Date:** 2026-11-11
- **Type:** return
- **Ledger:** 0002 · **Spec:** [PDF export](../specs/0002-pdf-export.md) · **Plan:** [PDF export T3](../plans/0002-pdf-export.md)
- **Dispatch + lead answers:** [lead-to-codex](2026-11-11-0002-t3-pdf-overlay--lead-to-codex.md), answers supplied at `6a8f604`
- **Branch:** orch/0002-t3-pdf-overlay
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-d1cdc39d-46ddba0ee7ed626a
- **Base:** fbf1f27d17572cbba0c3882a1f7164ee51c88d4f (required 299d463 is an ancestor)
- **R0 verified implementation commit:** 9112ba9 (the subsequent merge incorporates only the supplied docs-only lead-answer commit 6a8f604; no later main source changes). The dispatch conflict was resolved by retaining the receiver ack, supplied lead answers and user-authorized reader scope. Ledger changes are inherited from the lead commit, not feature edits.
- **Acknowledgement:** f6c1f48eb796ce5d5ef68ce74c443ae998018e1b
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/83 (draft; no watching or polling)
- **Port:** 5223 reserved; validation owns ephemeral servers; no persistent server
- **Status:** done

## Goal
Expose PDF export through default full chrome, explicit controls and skin bars, with a lazy themed overlay, remembered paper, local bars, cancellable fit checking and Save-time view snapshots. This return supersedes the blocked return at ca7fec8; the lead expanded ownership and clarified AC2 before implementation resumed.

## Scope
- **Owned/changed:** `packages/pepperscore/src/components/PdfOverlay.tsx`, `components/PepperScore.tsx`, `lib/chrome.ts`, `lib/bar-items.ts`, `lib/prefs.ts`, `src/styles.css`, `validation/pdf.mjs`, `apps/reader/src/embed/SkinTest.tsx`, both 0002-t3 handoffs; expanded scope `packages/pepperscore/vite.config.ts`, `validation/api.mjs`, `packages/pepperscore/src/lib/bar-items.test.ts`, `validation/skin.mjs`; additionally `validation/reader.mjs` for PDF-only expectations, authorized by the user after the reader tab-order failure.
- `DrawerControls.tsx`, runtime-files/verovio-runtime and finalize-dist were available within scope but required no final changes. The finalizer's original strict guard is preserved.
- **Protected:** no changes to `lib/pdf/**`, render, notation, TAB, dependencies, ledger, unrelated docs or CI.

## Implementation and acceptance evidence
- **AC1:** `controls.pdf`/`chrome.pdf` default on for full and off otherwise, explicit minimal true works, explicit false removes button and drawer action. Skin `pdf` is renderable and respects explicit false. The secondary header registry entry is composed in PepperScore; default full also exposes PDF in its drawer.
- **AC2:** overlay code imports only after clicking PDF; engraving only after opening and composition only on Save. Source-map traversal asserts the entire initial library graph contains no `lib/pdf` or `PdfOverlay` module. Built-consumer request tracking asserts no overlay/PDF/worker/library/font chunk loads before click, including with controls.pdf false. See size measurements below.
- **AC3:** paper defaults A4, bars default 4 on every mount; paper persists through reopen/reload, bars do not read or change on-screen barsPerLine. Actual downloaded bytes are parsed to confirm remembered A3 page dimensions and slugged title; untitled export downloads `score.pdf`. No download occurs until Save.
- **AC5 overlay:** real dense fixture reports exactly one shortened line. Captured worker output is `[4, 1, 4, 4]`, verifying sparse lines retain four bars. Fit uses the same metadata/annotation geometry as export, changes paper/bars reactively and aborts prior work. Save does not wait for fit.
- **AC9:** built UI exports at a real nonzero scroll offset and compares unchanged SVG/scroll before/after. Separate active-playback export verifies the playback time advances, stop callback count stays fixed and render callback count stays fixed.
- **Snapshots:** immutable current score, prefs, hidden IDs, channel and resolved active palette are captured synchronously before async work. The lazy overlay uses the reader's cached baseline and shared planStaves, passing hidden staves, spelling, TAB plan, visible IDs, TAB aliases/staves and annotation scales to exportScore. A host pitch change from +2 to +5 during Save leaves the export worker snapshot at +2. Palette resolution only runs when the root has pitch colours enabled; existing screen/PDF raster parity remains in test:pdf.
- **Cancellation:** worker instrumentation proves previous measure workers terminate, Cancel aborts an active Save and terminates the worker, and no cancelled download occurs. Unmount cancels both controllers; completed workers terminate too.
- **Failure recovery:** an injected font-fetch failure displays an alert and re-enables Save; restoring fetch and clicking Save succeeds. An aborted overlay module request displays an actionable error; Reload page recovers and opens the overlay successfully. Browser module-import failures are cached, so a same-page Retry was explicitly tested and rejected as ineffective. Export errors also provide Reload page alongside Cancel/Save.
- **Sandbox:** a real same-origin sandboxed iframe without allow-downloads displays an error before composition. frameElement comes from the parent realm, so the guard uses its attributes rather than this window's instanceof HTMLIFrameElement. Cross-origin ancestor sandbox restrictions remain outside reliable frameElement introspection; no claim is made of universal download-block detection.
- **UI:** contextual classes, Poppins, existing theme tokens, absolute positioning inside the reader, focus wrapping/restoration, Escape and a 390px containment check. PDF is not a phone playback-toolbar item. Its backdrop uses the same z-index 110 as the mixer, above the Options handle; a 390px hit-test verifies that the backdrop intercepts that handle. Adding the button exposed a real 901px overflow; the existing medium-width transport gap is now 4px instead of 8px. The original overflow assertions are unchanged, and touch/non-touch checks cover 761/900/901/1140/1141/1280px. The extra-controls drawer uses a 240px card minimum, preserving the original 272px minimum without that panel; at 1440px all five cards share one row with no card overflow or drawer scrolling. CSS scope validation passes in the full chain.
- **Packaging:** dedicated emitted PDF worker is reached through the host-copied URL. Its code does not contain upstream Verovio; the worker loads the separately published runtime. The original runtime URL guard remains intact.

## Decisions made
- The library bundler collects the reader's **static** dependency graph, subtracts the static audio/instruments graphs, and groups only the remaining reader modules in the entry. Dynamic imports are excluded from collection. Shared framework-free modules retain normal automatic splitting. `preserveEntrySignatures: 'allow-extension'` permits private cross-chunk helper exports. This avoids a large shared render chunk, preserves plain runtime URLs in index.js, and reduces initial gzip overhead. No runtime-file or finalizer relaxation was needed.
- Snapshot planning belongs in the lazy overlay; the initial reader only captures current immutable references and the active palette.
- pdfPaper is a global preference, not part of per-score FileSettings. PDF bars are local overlay state.
- Failed module downloads require explicit page reload because the browser caches the failed module URL. Transient export/font failures can use Save again. Reload is never automatic.

## Initial size versus main (r0 reviewed head)
Measured against pinned main `fbf1f27`, built from a temporary archive using the same installed dependencies. The supplied lead-answer commit `6a8f604` has identical source and changes only the dispatch document and ledger. This is not a claim about the size of subsequent origin/main source changes. Raw bytes and Python gzip level 9, summing each reachable static JS file separately; dynamic edges are excluded. Library graph begins at dist/index.js. Consumer graph begins at the normal reader page's component/renderer URLs. This is payload size, not a latency benchmark.

| Initial payload | main raw | T3 raw | main gzip | T3 gzip | gzip change |
|---|---:|---:|---:|---:|---:|
| Library JS graph | 509,740 | 513,232 | 146,345 | 147,511 | +1,166 bytes |
| Package CSS | 75,072 | 76,627 | 12,571 | 12,781 | +210 bytes |
| Built reader consumer JS graph | 658,889 | 666,633 | 207,798 | 211,326 | +3,528 bytes |

The package's initial JS+CSS increase is **1,376 gzip bytes**, within the approximately 2 KB target. The multi-page demo's consumer graph grows more (+3,528 bytes), including downstream bundler/preload metadata and shared code retention; this is reported separately, not hidden by the package figure. Both graphs exclude the overlay and PDF engine until use. Initial package graphs retain the same three chunks (`index`, `range-fit-core`, `sound-players`). Earlier blocked measurements with split render/static overlay are superseded. Reproducible measurements: `/tmp/pdf-t3-size-metrics.json`; baseline archive path is recorded in `/tmp/pdf-t3-baseline-path`.

## Expanded-scope expectation changes (complete list)
1. `validation/api.mjs`: the three exact full/minimal/none resolved-chrome objects now include pdf true/false/false respectively.
2. `lib/bar-items.test.ts`: default drawer has PDF; omitted drawer lists include it; the all-disabled case explicitly disables PDF; a minimal PDF-only bar is enabled. Explicit empty renderable-bar fallback assertions remain.
3. `validation/skin.mjs`: omitted drawer list gains PDF; the formerly reserved PDF fallback now sets pdf:false, retaining instrumentSwitch:true with pdf:false during that fallback; returning to no skin expects the default PDF-only extra row; legacy phone fallback cases explicitly disable PDF before asserting their old transport layout. No unrelated assertions or budgets changed.

4. `validation/reader.mjs:115`: append `pdf` to the desktop header tab-order list in its secondary registry position. No other reader assertion or logic changed.

## Verify with
```bash
npm ci && npx playwright-core install chromium
VALIDATION_BUDGET_SCALE=2 npm run check
VALIDATION_BUDGET_SCALE=2 npm run build
VALIDATION_BUDGET_SCALE=2 npm run test:pdf
VALIDATION_BUDGET_SCALE=2 npm run test:embed
VALIDATION_BUDGET_SCALE=2 npm run test:reader
VALIDATION_BUDGET_SCALE=2 npm run test:pack
npm run test:manifest
VALIDATION_BUDGET_SCALE=2 npm run test:validation
```
Foreground, sequential verification; build precedes browser suites. No PR monitoring.

## Verification output
```text
npm ci && npx playwright-core install chromium: exit 0
npm run check: exit 0 (Astro: 0 errors, 0 warnings, 0 hints)
npm run build: exit 0; original runtime URL guard and demo dist checks passed
npm run test:pdf: exit 0 (final aggregate; fit units 6/6, expanded overlay,
  Poppler raster parity, vector composition and page-model regressions)
npm run test:embed: exit 0 (standalone and final aggregate)
npm run test:reader: exit 0 in final aggregate (all scenarios, including
  header layout, playback follow, Options layout and annotation sizes)
npm run test:pack: exit 0 (119-file tarball; fresh Vite, Astro client,
  Node import, Astro SSR; host-copied runtime URL checks)
npm run test:manifest: exit 0 (128 packs, 16 icons; complete/core packs)
npm run test:validation: exit 0 (one uninterrupted final aggregate run)
  Library unit tests: 494/494; editor unit tests: 294/294
  API/audio/clock/CSS/skin/assets/sounds/spelling/transpose/document/parser,
  score memory/performance/editor desktop+phone/reader/chunks/large reader,
  guardrails/embed/clock embed/layout/TAB/baked TAB/instrument switch/PDF passed
git diff --check: exit 0
```

All load-sensitive final browser suites used `VALIDATION_BUDGET_SCALE=2`; no thresholds or sampling logic changed. Final logs: `/tmp/pdf-t3-z-check.log`, `/tmp/pdf-t3-done-{build,pack,manifest,validation}.log`. The final aggregate executes the exact `test:pdf`, `test:embed` and `test:reader` commands against the final built source, covering the later CSS fixes as well as their standalone earlier checks. Chromium only; T4 retains other engines and large-score PDF certification.

Verification development caught the obsolete reader tab-order expectation (authorized and updated), real medium-width header overflow (CSS fixed; assertion retained), and the API page-location guard (explicit reload uses history.go(0), with no test relaxation). The first full reader attempt after the layout fix reached the ensemble playback gate and failed at 99 sampled frames (`samples.length > seconds * 20`, reader.mjs:1025). The isolated rerun at the same VALIDATION_BUDGET_SCALE=2 passed the playback-follow gates, then exposed the five-card drawer wrapping into two rows; the drawer CSS was corrected and its original assertion retained. Thresholds and sampling logic are unchanged. No baseline performance claim is made.

## Known gotchas / context
GBrain consulted read-only: `projects/scoreflow-music-reader` (historical project context); the repo spec, plan, linked prior returns and lead answers govern this implementation. No implementer GBrain writes. No ABC import behaviour changed (For the ABC guide).

## Open questions / follow-ups
Lead owns cross-family review and merge. T4 retains large-score and Firefox/WebKit certification (including the known Firefox scaling issue S22). No T4 fixes or template stamping were included. Remote checks/reviews are not watched or polled; all green results above are local verification. Reviewers should retain the distinction between the package size target met above and the larger multi-page demo consumer delta, and between tested same-origin sandbox rejection and cross-origin restrictions that cannot be reliably introspected.

## Receiver ack
Lead acknowledges through the ledger on main.

## Return
- **Outcome:** done; T3 acceptance and required local verification complete. Draft awaits lead review/merge.
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/83
- **For GBrain (lead to promote):** shared initial/lazy modules can split the reader and displace runtime asset URLs. Group the reader's static graph while preserving framework-free entry sharing; verify the actual package consumer and worker URL, not just the isolated PDF spike. Browser failed-import caching makes an explicit page reload the reliable recovery for a failed module fetch. Cross-realm frameElement instanceof checks do not detect same-origin sandboxed iframes.

## Review r1 response — 5855741268

Review: https://github.com/pepperhorn/ph-scoreview/pull/83#pullrequestreview-5855741268, on `3d90d5d998f8809f964d8055503b849deeb04d24`.

- **Firefox header:** PDF remains a secondary header item. At root widths 761–900px the legacy inline action uses a 24px-wide, 16px FileMusic icon; the accessible name remains Export PDF. The label/normal width return outside that interval, including in More. In this interval, PDF-enabled legacy headers use a 3px transport gap; headers without PDF and skin bars retain their spacing. A font-loaded Firefox probe after setting zoom to 100% measured a 721px transport plus 24px padding inside 761px (16px slack). Skin bars retain their existing composition. No reader assertion changed. Built-demo probes with Poppins blocked, JS on/off, measured 761/761 client/scroll widths in Chromium and Firefox.
- **Keyboard scope:** removed the document capture listener. The dialog's own onKeyDown handles Escape and wraps Tab only from its first/last focusable element. Cleanup does not restore focus into A when focus is in another reader; Save focuses its own Cancel before disabling fields. The new /embed-skin two-reader regression focuses reader B, Tabs within it, and closes B's drawer with Escape while A's PDF dialog stays open. A's own Tab wrap/Escape checks remain.
- **Bars draft:** keep an editable string, permit empty text, and clamp only on blur/Save. An empty commit restores the last valid bars value. Tests clear/type 6 without a prefixed 1, clamp 99 to 8 on blur, and verify the Save worker's maxBars is 8.
- **Contextual classes:** pdf-save/pdf-cancel/pdf-reload, pdf-paper/pdf-bars; fallback Cancel/Reload also have classes. Save uses existing accent/onAccent theme roles for primary emphasis.
- **Bundler cleanup:** readerModules clears at buildStart, entries resolve to absolute paths relative to this config rather than matching path suffixes, and comments identify the extra minified exports as private cross-chunk implementation links (including visibility to namespace/export-star consumers).
- **Overlay pitch colours:** actual overlay downloads carry the supplied RGB palette with colours on and omit it with colours off. These assertions inspect PDF drawing operators. Pitch paint deliberately is not in the engraving worker message: the existing T2 pipeline applies it during composition after worker engraving. No protected PDF internals were changed.
- **Scope:** PdfOverlay.tsx, PepperScore.tsx, styles.css, vite.config.ts, validation/pdf.mjs and this own return handoff only. No changes to validation/reader.mjs or its 761px assertion, PDF/render/notation/TAB internals, dependencies, CI, ledger or other docs.
- **GBrain:** projects/scoreflow-music-reader consulted read-only; current review and repo docs govern these fixes. No implementer write-back.

### r1 verification
All requested checks passed locally before the single r1 push. Commands ran in the foreground, sequentially; browser timing gates used `VALIDATION_BUDGET_SCALE=2`. No reader assertion, timing threshold or scope guard was relaxed.

```text
npm run check: exit 0 (Astro: 0 errors, 0 warnings, 0 hints)
npm run build: exit 0 (runtime URL and demo distribution guards unchanged)
npm run test:pdf: exit 0 (full final build; fit 6/6, r1 reader-local
  Tab/Escape, draft/blur/Save, actual palette on/off, existing overlay,
  vector composition, Poppler raster parity and page-model checks)
npm run test:embed: exit 0
npm run test:reader (chromium): exit 0
BROWSER=firefox npm run test:reader: exit 0
npm run test:pack: exit 0 (fresh Vite, Astro client, Node and Astro SSR)
npm run test:skin: exit 0 (including real phone control hit-tests)
npm run test:css: exit 0
git diff --check: exit 0
```

Final logs: `/tmp/pdf-r1-final-check.log`, `/tmp/pdf-r1-complete-pdf.log`, `/tmp/pdf-r1-r2-{build,embed,reader-chromium,reader-firefox,pack,skin,css}.log`. The earlier Chromium attempt reached the twelve-staff playback sampling gate and failed at 113 frames; the subsequent full Chromium run passed without changing its threshold. The first compact-icon Firefox attempt passed first-paint but found a 2px font-loaded inline overflow; the PDF-only spacing rule above fixed it, and the entire Firefox suite then passed. Final PDF checks were repeated after the last header CSS change.

R1 initial package JS+CSS (same static graph and gzip-9 method as r0): baseline **584,812 raw / 158,916 gzip bytes**; r1 **590,623 raw / 160,407 gzip bytes**, **+1,491 gzip bytes** versus merge-base, still under the approximately 2 KB target. `/tmp/pdf-r1-sizes.json` records the measurement. Lazy source-map/network and packaging assertions still pass.

Only the user-required Chromium/Firefox reader matrix is claimed here. WebKit installation reported missing host libraries; no WebKit result is claimed. PDF certification for other engines remains T4. No remote checks/reviews were polled or watched.

**Outcome:** review r1 addressed, all requested local checks green; ready for lead re-review. This handoff is included in the sole r1 source push to avoid an extra paid CI run.
