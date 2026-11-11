# Handoff: 0020 — Firefox PDF notation scale (codex → lead)

- **Date:** 2026-11-11
- **Type:** return
- **Ledger:** 0020, quick (no spec/plan)
- **Dispatch:** [lead-to-codex](2026-11-11-0020-pdf-firefox-scale--lead-to-codex.md)
- **Branch:** `orch/0020-pdf-firefox-scale`
- **Worktree:** `/home/shaun/.t3/worktrees/ph-vexflow-view/t3-2bc286a2-162eb91812263793`
- **Base:** `93eaed8c3c949dae82f4fb44e91b8f71a5c66acc` (includes pinned `10a018e`)
- **PR:** draft against main, opened after this handoff commit
- **Status:** closed — implementation done; ready for review

## Goal and scope
Fix Firefox's enlarged/off-page vector PDF notation and preserve Chromium output. Owned scope: `packages/pepperscore/src/lib/pdf/**`, `validation/pdf.mjs`, root `package.json` scripts only, own 0020 handoffs. No components, CI, dependencies, public API, or ABC import changes.

## What changed / decisions made
Firefox's `getScreenCTM()` on a nested SVG omits that SVG's viewBox transform. A child group's CTM includes it. `flattenViewports` now measures a temporary empty child group for SVG elements (both viewport and parent), then removes the probe in `finally`. All matrices are captured before replacing any nested SVG. Existing text-outline scaling therefore receives the correctly flattened transform too.

An initial experiment setting explicit paper dimensions on export SVGs did not fix Firefox; those changes were removed. No export dimensions or layout policy changed.

Validation adds an unsized offscreen fixture with two nested viewport levels: it asserts descendant screen coordinates survive flattening, both SVGs become groups, and the 0.1 / 10 scales occur exactly once. Existing PDF content-stream, Poppler staff/note geometry, and pitch-outline colour/width checks remain enabled on every engine. New `test:pdf:firefox` and `test:pdf:webkit` scripts select the same suite and unit tests.

## Acceptance criteria
- Chromium and Firefox: full PDF suite, including physical 6.5 mm staff height, printable staff width, note/name positions, four paper sizes, multipage layout, cancellation, and pitch outlines.
- Chromium before/after: complete rasterized pages for default A4 and host-colour A3 pitch fixtures are byte-identical at 144 DPI.
- WebKit: report local runtime failure honestly (see verification).

## Verify with
```bash
npm ci
npx playwright-core install chromium firefox webkit
npm run check
npm run build
npm run test:manifest
npm run test:validation
PDF_ARTIFACTS=/tmp/0020-after-chromium npm run test:pdf
BROWSER=firefox PDF_ARTIFACTS=/tmp/0020-after-firefox node validation/pdf.mjs
PITCH_PARITY_ONLY=1 npm run test:pdf:firefox
BROWSER=webkit node validation/pdf.mjs
```

## Verification output
Code commit: `94907459ea6b566259f1fdf752c33f67351d20db`; receiver ack: `d035232`.

```text
npm ci: added 378 packages, audited 384 packages
playwright-core install chromium firefox webkit: browser download present; WebKit host dependencies missing
npm run check: 0 errors, 0 warnings, 0 hints
npm run build: complete; demo worker chunks and Verovio files match
npm run test:manifest: 128 local packs, 16 icons and playable voices verified;
  complete pack.json and generated core (19 FluidR3 sounds) passed
npm run test:pdf (Chromium): 6 fit unit tests passed
PDF nested viewport transforms passed (chromium).
Poppler raster: staff width/6.5 mm height, known notehead and aligned note-name ink passed.
Vector composition passed: four exact paper sizes, embedded/selectable text, RGB paths,
  multipage annotated export, unsupported glyph error, cancellation.
PDF page model spike passed (chromium): A4 4 lines; A3 4; 2 pages for 80 bars.
BROWSER=firefox node validation/pdf.mjs: exit 0; same Poppler/vector checks passed
PDF page model spike passed (firefox): A4 4 lines; A3 4; 2 pages for 80 bars.
PITCH_PARITY_ONLY=1 npm run test:pdf:firefox: exit 0; 6 fit unit tests passed
PDF nested viewport transforms passed (firefox).
Pitch raster host G: screen 137,167,197 / 0.0365, PDF 137,167,197 / 0.0442
BROWSER=webkit node validation/pdf.mjs: failed at browser launch, missing host dependencies
```

Baseline Firefox failed `default C: enough edge rows outside staff/stem ink` before the fix. Both default and host pitch raster variants now pass on Firefox and Chromium. Full-page Chromium Poppler PPMs at 144 DPI match byte-for-byte before/after:

- A4 default SHA-256: `1d617f8b0e81a814e683150dec37ccf75a35a8b1ce28e0979a2dac8f8c5dd788`
- A3 host SHA-256: `700b905ceeeef494af479c0e2feeaf862385c27e01f981ff230b6a3b02c2ad64`

Local evidence: `/tmp/0020-before-chromium/`, `/tmp/0020-after-chromium/`, `/tmp/0020-after-firefox/` and `/tmp/0020-*.log` in this environment (temporary, not committed assets). Scope audit `git diff --stat main...HEAD` contains only owned files; `git diff --check` passed.

Full `npm run test:validation`: exit 0. All chained validations passed, including 700 library tests, 294 editor tests, desktop/phone reader and editor, chunking, large scores, guardrails, embeds, layout, TAB (including violin/cello PDF), TAB bake, instrument switching, and the final PDF suite:

```text
PDF nested viewport transforms passed (chromium).
Poppler raster: staff width/6.5 mm height, known notehead and aligned note-name ink passed.
Vector composition passed: four exact paper sizes, embedded/selectable text, RGB paths, multipage annotated export, unsupported glyph error, cancellation.
PDF page model spike passed (chromium): A4 4 lines; A3 4; 2 pages for 80 bars.
```

**Outcome:** done, with WebKit runtime limitation explicitly recorded above. Lead next action: cross-family review; WebKit proof requires a provisioned host.

## Known gotchas / GBrain
Read `projects/scoreflow-music-reader` through GBrain. Its historic architecture notes are not used as current implementation evidence; repo code and browser measurements establish this fix. Implementer made no GBrain writes.

## Open questions / follow-ups
WebKit cannot launch locally: Playwright reports missing libevent-2.1-7t64, libgstreamer-plugins-bad1.0-0, libflite1, libavif16, libwayland-server0, libmanette-0.2-0, libenchant-2-2, and gstreamer1.0-libav. Run the same suite on a host with WebKit dependencies before claiming WebKit proof. No system package changes were made.

## For GBrain (lead to promote)
For nested SVGs, Firefox's SVG-element CTM describes the viewport while a child group describes the viewBox content. Measuring a temporary child group yields consistent content matrices across Chromium and Firefox; explicit outer dimensions alone did not resolve this bug.

## For the ABC guide
No ABC import behaviour changed; no guide update needed.
