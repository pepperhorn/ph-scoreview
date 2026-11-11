# Handoff: 0022 — Safari pitch-colour outlines (codex → lead)

- **Date:** 2026-11-11
- **Type:** return
- **Ledger:** 0022 (quick; no separate spec/plan)
- **Branch:** orch/0022-safari-pitch-outline
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-abd2e15d-6e20c9b0d1427ef3
- **PR:** none; not pushed because the human explicitly requires all local checks green before the single push
- **Base commit:** 15135bd
- **Commits:** 0720492 (receiver ack), 936e02b (implementation); this return is a subsequent docs commit
- **Status:** blocked
- **Outcome:** implementation complete; required verification gate blocked

## Goal
Make default and host-set pitch outlines rasterise consistently in Chromium, Firefox and WebKit while preserving outline thickness, PDF paint and reader highlights. Dispatch: [lead → codex](2026-11-11-0022-safari-pitch-outline--lead-to-codex.md).

## Scope
- **In / files owned:** pitch-colour rules in `packages/pepperscore/src/styles.css`; pitch parity checks in `validation/pdf.mjs`; these two 0022 handoffs. `render.ts` was permitted only if attributes were needed and is unchanged.
- **Out:** overlay implementation/recovery, performance budgets, skin validation, other docs, ledger, public APIs and dependencies.
- Scope audit: `git diff --stat main...HEAD` before this return lists only the dispatch acknowledgement and the two owned code/validation files. This return is the only additional file.

## What changed / decisions made
Verovio emits a path rule `stroke:currentColor`. WebKit applies it inside referenced `<use>` glyphs, where it overrides the stroke inherited from the notehead. The computed notehead stroke is already correct; changing stroke on the `<use>` did not repair the raster. Giving pitch noteheads the same `color` as `--ps-pitch-outline` repairs the glyph paint without changing the existing fill, stroke width or PDF snapshot.

The five existing reader-mark rules also set `color` to their existing respective paint tokens/defaults, so the new outline colour does not leak into playback, cursor, selection, transposed or out-of-range glyphs. PDF parity now exercises these five marks on a real score-system wrapper and requires their currentColor, fill and stroke to agree. Existing raster thresholds are unchanged. No render attributes, public contracts or ABC import behaviour changed.

## Acceptance criteria
- [x] Actual raster parity passes for default and nested host-set outline tokens in all three Playwright engines (full Chromium/Firefox; isolated parity diagnostic in WebKit).
- [x] Outline/head widths remain within the existing strict PDF parity tolerance; default colour is RGB 89,89,89 and host colour RGB 137,167,197.
- [ ] Required full `BROWSER=webkit node validation/pdf.mjs` passes — blocked before parity in unrelated overlay recovery.
- [ ] All local verification green before push — blocked by overlay recovery and large-score timing gates.

## Verification
Installed with `npm ci && npx playwright-core install chromium firefox webkit`. `npm run check` passes (reader: 23 files, 0 errors/warnings/hints). `npm run build` passes, including demo-dist consistency. `npm run test:manifest` passes (128 packs, 16 icons, 19 core sounds).

chromium (`npm run test:pdf`, exit 0):
```text
PDF overlay: availability, lazy chunks, defaults, focus trap, fit, remembered paper, local bars, actual download, separate worker, unchanged reader and phone containment passed
PDF nested viewport transforms passed (chromium).
Pitch raster default C: screen 89,89,89 / 0.0456, PDF 89,89,89 / 0.0442
Pitch raster host C: screen 137,167,197 / 0.0516, PDF 137,167,197 / 0.0442
PDF page model spike passed (chromium): A4 4 lines; A3 4; 2 pages for 80 bars.
```

firefox (`BROWSER=firefox node validation/pdf.mjs`, exit 0):
```text
PDF overlay: availability, lazy chunks, defaults, focus trap, fit, remembered paper, local bars, actual download, separate worker, unchanged reader and phone containment passed
PDF nested viewport transforms passed (firefox).
Pitch raster default C: screen 89,89,89 / 0.0430, PDF 89,89,89 / 0.0442
Pitch raster host C: screen 137,167,197 / 0.0365, PDF 137,167,197 / 0.0442
PDF page model spike passed (firefox): A4 4 lines; A3 4; 2 pages for 80 bars.
```

WebKit isolated parity diagnostic (`BROWSER=webkit PITCH_PARITY_ONLY=1 node /tmp/0022-isolated.mjs`, exit 0):
```text
PDF nested viewport transforms passed (webkit).
Pitch raster default C: screen 89,89,89 / 0.0456, PDF 89,89,89 / 0.0442
Pitch raster host C: screen 137,167,197 / 0.0516, PDF 137,167,197 / 0.0442
```
This untracked diagnostic copies the current PDF validation, uses a separate temporary Vite cache and bypasses `assertPdfOverlay` only. It proves the unchanged raster assertions and new mark assertions pass; it does **not** count as the required full WebKit suite passing.

`npm run test:validation` passed API/audio/clock/CSS/skin/assets/sounds/spelling/transpose/document/parser/score-db/performance/clock-contract/package/editor/editor-browser/editor-phone/reader/chunks, then stopped at `test:large`. Package tests: 27 files / 294 tests passed. Skin validation includes 11 unit tests and the browser scenarios. Full log: `/tmp/0022-validation.log`.

### Blockers / failed attempts
1. **Full WebKit PDF command**, `/tmp/0022-webkit.log`: `locator.waitFor: Timeout 60000ms exceeded` at `validation/pdf.mjs:765`, waiting for `Paper size` after the lazy chunk is deliberately aborted, unrouted, and the page reloaded. This same recovery failure occurred in the initial baseline run before the CSS change (`/tmp/0022-baseline.log`, old line 757). An additional overlay-only scratch diagnostic also reproduced an intermittent two-`.pdf-trigger` strict-locator failure at the earlier post-reload click (`/tmp/0022-overlay-debug.log`). Neither failure is a pitch raster assertion. No assertions or overlay behaviour were weakened to conceal these failures.
2. **Full validation timing**, `/tmp/0022-validation.log`: large-score import task 218 ms against 200 ms. Rerunning `npm run test:large` with unchanged budgets (`/tmp/0022-large-retry.log`) passed import timing but failed on-demand playback highlight at 677 ms against 500 ms. The checks suggest `VALIDATION_BUDGET_SCALE` for a loaded host; I did not change limits or use that override.
3. An earlier Chromium PDF attempt overlapped the full suite and failed a source-module fetch while skin validation forced Vite dependency-cache refresh. The subsequent sequential full Chromium run passed.

The sequential follow-up chain stopped at WebKit, and the remaining validation suffix chain stopped at `test:large`. Guardrails/embed/clock-embed/layout/tab/tab-bake/instrument-switch were therefore not reached in that suffix run. Separate final skin/CSS reruns were not reached; both passed earlier inside full validation. Do not report the full validation command or full WebKit command as green.

## Open questions / next action for lead
Confirm whether to assign/authorise repair of the PDF overlay recovery test/behaviour (outside the dispatch's parity-only permission for `validation/pdf.mjs`), and resolve or accept the local performance-budget gate. Then finish verification and perform the single push and draft PR creation requested by the human. No remote mutation has occurred.

## Verify with / resume
```bash
npm run check && npm run build && npm run test:manifest
npm run test:pdf
BROWSER=firefox node validation/pdf.mjs
BROWSER=webkit node validation/pdf.mjs
npm run test:skin && npm run test:css
npm run test:validation
# Only after all required local gates pass:
git push -u origin orch/0022-safari-pitch-outline
# Create draft PR against main, title: 0022: [quick] Safari pitch-colour outlines
# Link both handoffs and include per-browser output from above.
```

## Known context / for GBrain (lead to promote)
GBrain searched: `projects/scoreflow-music-reader` (general background; no Safari-specific advice found). Implementer made no GBrain writes. Useful lesson: for WebKit SVG `<use>` raster bugs, inspect upstream glyph `stroke:currentColor` rules as well as computed style on the notehead; a correct computed inherited stroke does not prove the referenced glyph paints with it. No ADR needed.
