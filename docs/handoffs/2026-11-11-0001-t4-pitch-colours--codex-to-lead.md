# Handoff: 0001-t4 — Pitch colours and toggle tile (+ PDF parity) (codex → lead)

- **Date:** 2026-11-11
- **Type:** return
- **Ledger:** 0001 (also 0002 AC8a)
- **Spec:** [0001](../specs/0001-composable-player-skins.md), [0002](../specs/0002-pdf-export.md)
- **Plan:** [0001 T4](../plans/0001-composable-player-skins.md)
- **Dispatch:** [lead-to-codex](2026-11-11-0001-t4-pitch-colours--lead-to-codex.md)
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/81 (draft; CI/reviews not polled)
- **Branch:** orch/0001-t4-pitch-colours
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-6e1573c8-388b2ff6de2075c9
- **Base commit:** 843767e (includes required 03d0ac7, verified ancestor); receiver acknowledgement ad1400e
- **Port:** browser harnesses use ephemeral ports, host 0.0.0.0 for the skin consumer; no persistent server.
- **Status:** closed

## Goal
Colour displayed-pitch noteheads through the skin palette with an accessible, persistent tile and no toggle engraving; export the same fills and outlines as vector PDF.

## Context you need
The linked dispatch/spec/plan and T1–T3 return handoffs govern this work. GBrain consulted: `default:projects/scoreflow-music-reader`, historical project context only. Implementer has made no GBrain writes.

## Scope
- **In / owned:** `packages/pepperscore/src/lib/pitch-colours.ts`, `lib/pitch-colours.test.ts`, `components/PitchColourTile.tsx`, `lib/prefs.ts`, `lib/file-state.ts`, `lib/file-state.schema.json`, `lib/render.ts`, `components/PepperScore.tsx`, `src/styles.css`, `validation/skin.mjs`, plus dispatch-authorized `components/DrawerControls.tsx`, `lib/bar-items.ts`, `lib/pdf/**`, `validation/pdf.mjs`, and this task's handoffs.
- **Out:** T5 documentation/changelog, PDF UI/overlay (0002 T3), fretless TAB.
- **Protected:** no changes to `lib/tab/**`, `lib/notation/**`, editor, other validations, other docs or ledger. DrawerControls/bar-items required no edits: their existing registry already carries the pitchColours slot.

## Acceptance criteria
- [x] Default-off palette noteheads, enharmonics, individually coloured chord heads, transposed displayed pitches and lazy systems.
- [x] Accessible square C tile in bar and annotations drawer, aria-pressed, default off, selected ring/dimmed state, settings/handle/reload sync; absent with no palette.
- [x] Playback, cursor, selection, transposed and range marks retain precedence. Toggle and palette changes use CSS, leaving engraving intact.
- [x] Old saved files omit the off setting; true persists; missing per-score values restore false.
- [x] PDF export accepts the active palette snapshot and paints inline RGB fills and dark outlines; real-page raster parity at non-unit scale.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run check && npm run build
npm run test:skin && npm run test:score-db && npm run test:transpose && npm run test:chunks && npm run test:reader && npm run test:pdf
npm run test:manifest && npm run test:validation
```

## Known gotchas / decisions made
- `skin.ts` is outside this task's ownership. Palette variables are emitted by the owned `pitchColourStyle` helper and combined with `skinStyle` on the root. This produces all 12 planned root variables without modifying the exported theme helper. `pitchClassOf` lives in the planned module; no new root export was added outside ownership.
- Tag each notehead at every system's geometry pass. Prefer each pitch's source id; otherwise retain Verovio/source chord order. Skip percussion, unpitched notes, TAB events/staves. PDF uses the same tagging helper.
- The shared outline is 18 native engraving units, scales with the notehead, and sits behind its fill. The tile uses the specified Poppins 600, white, 3-unit rgba black outline style independently.
- Default-off is omitted from `buildFileState` so existing saved output is unchanged. Restoration explicitly normalizes an omitted per-score setting to false, preventing another score's true state from leaking.
- `exportScore` takes optional `pitchColours: PitchPalette`. Presence means the snapshot pref is on; omission means plain notation. The PDF UI is a later task and must pass the palette only when both skin palette and pref are active. Resolve host CSS-variable palette values to concrete colours before exporting if an integration uses them.
- PDF head outlines use the existing explicit paint passes with no text-style shadow. Path strokes retain native SVG scaling; only text needs the PDF-mm stroke correction.
- Browser tests use built-distribution imports for UI; PDF source-module fixture explicitly configures Verovio and removes font `@import`s when injecting built CSS. These are harness setup details, not product changes.
- For the ABC guide: no ABC import behaviour changed.

## Open questions
None. Lead review/merge remains required.

## Receiver ack
Lead acknowledges through the ledger on main.

## Return
- **Outcome:** done; required local validation passed.
- **What changed:** displayed-pitch tagging, CSS palette paint and mark precedence, shared tile, settings/handle/persistence, inline export painting, and browser/raster acceptance coverage.
- **Code/validation head:** `343f440` (implementation `d64280d`, fixture corrections `d5155f3` and `343f440`); only return documentation changes after final validation.
- **Verification output:** the final uninterrupted `npm run test:validation` passed (exit 0) on `343f440b132c05d7a9edf94dbfb8e80396c93076`. Setup, check, build, score-db, transpose, chunks (rerun), reader, manifest and initial PDF suite passed. First aggregate stopped at the new chromatic fixture; corrected invalid overfull ABC bars and accidental carry to explicit valid bars. An early chunks run overlapped a build and hit ERR_HTTP_HEADERS_SENT; final build completed before the successful rerun. Early PDF harness attempts needed CSS imports stripped and explicit source-module Verovio paths; both corrected without changing product code. The next aggregate passed every suite through instrument-switch but stopped at an additional PDF test that reversed ABC pitches without per-pitch identities. ABC intentionally has no such identities; the test now supplies explicit ids before testing identity precedence, retaining the real ABC source-order/raster test. The corrected complete PDF suite passed, including the no-outline raster control. No product changes were required for either fixture correction. No timing thresholds changed.
- **Out-of-scope issues found:** none requiring scope growth.
- **Follow-ups:** other-family review; 0002 T3 wires the active palette into its export snapshot; 0001 T5 documents the new setting/handle/tile.
- **For GBrain (lead to promote):** SVG noteheads need their own pitch tags inside chord groups. Screen CSS variables do not reach svg2pdf; paint concrete fills/strokes before composition and raster-check real engraving at non-unit scale. Path strokes and text strokes require different scale treatment.


## Final verification output
```text
npm ci && npx playwright-core install chromium: exit 0
npm run check: exit 0 (Astro: 0 errors, 0 warnings, 0 hints)
npm run build: exit 0 (demo dist/runtime/notices verification passed)
npm run test:skin: exit 0
npm run test:score-db: exit 0
npm run test:transpose: exit 0
npm run test:chunks: exit 0 (after the initial build-overlap harness failure)
npm run test:reader: exit 0
npm run test:pdf: exit 0 (after correcting the explicit-identity test)
npm run test:manifest: exit 0 (128 local packs, 16 icons)
npm run test:validation: exit 0 (final uninterrupted run)
  Library: 244 tests passed; editor: 294 tests passed
  Skin: 5 skin + 7 bar/drawer + 4 pitch-colour unit tests passed
  Pitch colours: chord/enharmonics, outlines, mark precedence, no re-engrave,
    drawer/bar/settings/handle/reload, no palette, transposition and lazy paging passed
  Editor redraw samples: 189, 160, 273, 136, 256, 282, 228, 214 ms
  Pitch PDF: real-page reader colours and outlined raster heads match at non-unit scale
  Poppler raster: staff width/6.5 mm height, known notehead and aligned note-name ink passed
  Vector composition: exact paper sizes, embedded/selectable text, RGB paths,
    multipage annotated export, unsupported glyph error and cancellation passed
  PDF page model spike passed (chromium): A4 4 lines; A3 4; 2 pages for 80 bars
git diff --check: exit 0
```
No normal-budget timing gate failed; no `VALIDATION_BUDGET_SCALE=2` rerun was needed. All required suites passed on the final source; the last full run is uninterrupted. Browser/physical audio certification beyond the prescribed Chromium suites is not claimed.

Final logs: `/tmp/t4-build.log`, `/tmp/t4-skin-final.log`, `/tmp/t4-pdf-final.log`, `/tmp/t4-validation-green.log`. The earlier failed aggregate logs are `/tmp/t4-validation.log` (overfull fixture) and `/tmp/t4-validation-final.log` (unsupported identity-test assumption). Only tests changed between those runs and the final green run.

Scope audit: `git diff --stat main...HEAD` contains only owned source/validation paths and this task's handoffs. No ledger, TAB/notation implementation, editor, dependencies or unrelated docs changed. No PR watching/polling, merge or release.
