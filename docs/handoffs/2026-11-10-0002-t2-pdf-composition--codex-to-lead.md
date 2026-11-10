# Handoff: 0002-t2 — PDF composition (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0002 · **Spec:** [PDF export](../specs/0002-pdf-export.md) · **Plan:** [PDF export, T2](../plans/0002-pdf-export.md)
- **Dispatch:** [lead-to-codex](2026-11-10-0002-t2-pdf-composition--lead-to-codex.md)
- **Branch:** orch/0002-t2-pdf-composition
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-4829b32d-6df260c4995f3118
- **Base commit:** 456cd398b3157ba0c9bc59ccba8e3d092009c323 (6d0d41a is an ancestor)
- **Acknowledgement:** a45801342c58e5fa39e00923bdaf3dcbf375df9e
- **PR:** draft opened after this handoff commit; linked PR body references both handoffs
- **Port:** harness owns an ephemeral localhost port; no persistent server
- **Status:** closed (T2 implementation returned; AC8a integration dependency remains)

## Goal
Compose the separately engraved SVG pages into compressed vector PDFs, with embedded fonts, selectable metadata and shared reader annotations. The linked spec and plan govern the full feature; this return covers T2 only.

## Scope
- **In:** `composePdf`, `exportScore`, shared annotation layout/drawing extraction, font assets/embedding, PDF runtime dependencies and parser dev dependency, generated third-party notices, and PDF validation.
- **Out:** overlay/button/controls, downloads, large-score performance certification, browser matrix, changes to ABC importing, and pitch-colour screen implementation (0001 T4).
- **Files owned/changed:** `packages/pepperscore/src/lib/pdf/**` T2 additions and engraving options; `packages/pepperscore/src/lib/render.ts` helper extraction/export only; `packages/pepperscore/package.json`; root `package-lock.json`; `packages/pepperscore/scripts/third-party-notices.mjs`; `validation/pdf.mjs`; both own 0002-t2 handoffs.
- **Protected:** no components, CSS, chrome, bar registry, TAB modules, instrument model, editor, other validation files or ledger changed.

## Acceptance criteria
- AC4: parsed real PDFs have exact A4, A3, Letter and Legal dimensions (0.001 mm tolerance).
- AC7: multipage export, selectable title/composer text, embedded TrueType fonts; T1 bounds/pagination fixtures retained.
- AC8: shared note names/counts/inferred-chord drawing, annotation scales, transposed snapshot and hidden staff exclusion covered. Worker pages contain no screen playhead, selection or part controls.
- AC8a: composition preserves RGB fills and outlines, including explicit outline/shadow/fill passes. **Screen-to-export pitch-colour parity cannot be certified:** this checkout has no pitch-colouring implementation (the plan assigns it to 0001 T4). Export currently engraves an uncoloured view, so a later integration must apply the shared pitch-colour painter to its pages. Do not mark full AC8a complete on this evidence.
- Lazy boundary: no static PDF import from the reader; built reader/library JS contain no jsPDF, svg2pdf or PDF-font references. Worker chunk emission must be checked after T3 connects the caller.

## Verify with
```bash
npm ci --include=dev && npx playwright-core install chromium
npm run check && npm run build && npm run test:pdf && npm run test:reader
npm run test:manifest && npm run test:validation
```

All required checks passed; see the verification output below.

## Known gotchas / decisions already made
GBrain consulted read-only: `projects/scoreflow-music-reader`, `projects/scoreflow-music-reader/gotchas-abc-import`. No implementer GBrain writes.

### T3 integration contract
Dynamically import `packages/pepperscore/src/lib/pdf/export.ts` and call:
```ts
exportScore({
  input: { data: sourceDocument.engravingText, view },
  options: { paper, maxBars, font, files },
  score: viewScore,
  visiblePartIds: planned.visibleParts.map(part => part.id),
  tabAliases: planned.tabAlias,
  annotations: { showNames, showCounts, subdivisions, showChordSymbols,
    inferChordSymbols, scale: annotationScale },
}, signal): Promise<Blob>
```
`viewScore` is the immutable Save-time instrument/transposition view; `view` is the corresponding `planStaves` view (hiddenStaves, spelling, TAB, chordSymbols). Pass `visiblePartIds` and `tabAliases` from the same `planStaves` result so hidden parts do not affect annotation spacing and imported TAB events resolve like the reader. The caller owns the snapshot; do not pass live mutable state. The function never uses the reader's toolkit/channel or live score DOM. `composePdf(pages, {paper,title?}, signal)` is the lower-level page composer. T3 owns filenames, download errors and the UI. `engravePages` remains available for checking fit.

### Decisions made
- jsPDF 4.2.1 and svg2pdf.js 2.9.0 are runtime dependencies imported dynamically within composition; pdf-lib 1.17.1 is test-only. Notices walk the runtime dependency trees automatically and include their licences.
- Verovio notation paths remain vectors. Private-use tempo glyphs require music fonts too: embed TrueType conversions of Bravura, Petaluma and Petaluma Script, renamed PepperScore Music / Hand / Hand Text to respect reserved font names. Assets README records upstream sources, conversion and hashes; original OFL notices accompany them. No conversion tool is a runtime dependency.
- Poppins Regular and SemiBold are embedded for ordinary text. Serif/Mono fall back to Poppins; Petaluma handwriting uses the converted script face. Unsupported code points (tested with CJK) fail with an explicit missing-glyph error instead of silently dropping text. Complex-script shaping beyond these tests is not certified.
- Annotation helper extraction preserves screen drawing/class names and coordinates. PDF pages reuse those helpers; PDF styles are inline. SVG insertion uses the reader's existing allowlist sanitizer. Stroked elements use explicit outline, shadow and fill passes because svg2pdf ignores paint-order.
- Reserve a metadata band above engraving (on each page for consistent pagination), draw supplied metadata only on page one, and draw page numbers inside the bottom margin. Long metadata lines shrink to page width. Annotation spacing is passed into engraving, with a bottom annotation reserve. No score source or screen layout state is modified.
- Composition yields between pages and checks cancellation between stages/pages. Per-page CPU/performance and three-engine certification remain T4.
- T1's first-line capacity now has a positive clamp; the borderline piano first-line underfill suggestion is intentionally left unchanged.

## Verification output
```text
npm ci --include=dev && npx playwright-core install chromium: exit 0
npm run check: exit 0 (Astro: 0 errors, 0 warnings, 0 hints)
npm run check -w pepperscore after final PDF/TAB-alias edits: exit 0
npm run build: exit 0; demo dist/runtime/notices verification passed
npm run test:pdf: exit 0
  fit.test.ts: 6 passed
  Vector composition passed: four exact paper sizes, embedded/selectable text,
  RGB paths, multipage annotated export, unsupported glyph error, cancellation.
  Imported TAB alias annotation assertion passed.
  PDF page model spike passed (chromium): A4 4 lines; A3 4; 2 pages for 80 bars.
npm run test:reader: exit 0 (all scenarios, including annotation scales and Endless scrollbars)
npm run test:manifest: exit 0 (128 local packs, 16 icons; complete/core packs)
npm run test:validation: exit 0
  Includes core 223 unit tests, editor 290 unit tests, desktop/phone editor,
  reader, chunks, large-score reader, embeds, layout, TAB, instrument switch,
  and final PDF composition + page-model regressions.
  No normal-limit timing failures; VALIDATION_BUDGET_SCALE=2 rerun not needed.
npm run test:pack: exit 0
  Tarball: 106 files, build output and no sources
  Fresh Vite + React, Astro + React, Node import and Astro SSR hosts passed
```

The first PDF development-harness run hit Vite's outdated optimized dependency reload; explicitly pre-optimizing the dynamic dependencies fixed it. Early real-file tests also caught missing tempo glyphs and mixed text/music runs; embedding the renamed music faces and selecting fonts per text run fixed those failures. Final PDF and aggregate runs passed with those fixes.

Built reader and library JS were searched for `jspdf`, `svg2pdf`, PDF font asset names: no matches. `git diff --check` passed. All changed paths are within the declared owned set (including this task's two handoffs).

## Open questions / follow-ups
- Lead: retain AC8a as an integration gate for 0001 T4/T3 or explicitly assign a follow-up; RGB/path preservation alone proves composition, not screen-to-export parity.
- T3: verify actual worker chunk separation once the dynamic UI caller is reachable, and unused-feature initial bundle/network behaviour through the UI.
- T4: measure large-score page composition/cancellation and tall ensembles with metadata/large annotations, then run Firefox/WebKit.
- For the ABC guide: no ABC import behaviour changed.
- For GBrain (lead to promote): private-use tempo glyphs still need a real embedded music font even when notation glyphs are SVG paths; Poppins-only embedding is insufficient.

## Receiver ack
Lead acknowledges the return through the ledger; implementer has not edited it.

## Return
- **Outcome:** composition implemented; AC8a screen parity remains dependent on the unimplemented screen pitch-colour feature.
- **What changed:** exact vector PDF composition, snapshot export, shared annotations, embedded fonts, parser-based validation and notices.
- **Verification:** see above.

## Review r1 corrections (review 5838232005)

Review: https://github.com/pepperhorn/ph-scoreview/pull/78#pullrequestreview-5838232005

The first implementation's file parser did not verify physical drawing placement and missed the blockers. This round adds independent PDF graphics/text state inspection and Poppler raster checks against actual exported bytes.

- Flatten nested SVG viewports into browser-resolved parent-space `g` matrices before svg2pdf sees them. The outer paper coordinate system is retained, eliminating Verovio definition-scale's double viewBox scaling.
- Split Unicode accidentals into embedded music-font runs. Bravura has sharp/flat/natural Unicode glyphs; double accidentals use their equivalent BMP SMuFL glyphs because jsPDF encodes text as UTF-16. Retain missing-glyph validation. The fixture now exports actual F-sharp minor and B-flat inferred chords.
- Normalize font family/weight/style in inline CSS as well as attributes. Freeze drawing/geometry properties on outline and shadow clones. Keep white fill, embedded Poppins SemiBold, 35% black stroke of width 3 and a 0.5-unit aligned shadow. Emulate a central baseline with measured glyph ascent/descent and centre simple text using the embedded face's advances. Temporary browser font faces are released after composition.
- Extract `annotationBands` from `render.ts` without changing its placement algorithm; screen and PDF now call the same builder, including all six TAB lines, ordered next-staff limits, below-staff controls and the shared lane gap. A six-line TAB plus below-staff direction fixture checks the lane position.
- Replace the weak metadata/page-number-satisfied assertion with the complete `G E C / 1 / C chord / D 2 / E 3 / F 4` sequence. Correct the metadata comment: long lines shrink rather than wrap.
- Decode each PDF text run using its actual selected font's ToUnicode map. Assert that used text resources are embedded; identify SemiBold from the embedded TrueType name table, not jsPDF's generic `/Poppins` alias. Check outline/fill matrices, shadow offset, baseline offset, horizontal centre, opacity, stroke width and white fill.
- Geometry validation checks a full first system against the 12 mm content margins and 6.5 mm stave height, known notehead curves, and the corresponding note-name origin. When `pdftoppm` is installed it also rasterizes the actual exported first page at 144 dpi and checks staff, notehead and label ink. The content-stream checks remain the portable fallback. `PDF_ARTIFACTS=<directory>` retains PDF fixtures and their source test data for review; `PDF_COMPOSITION_ONLY=1` runs the focused composition checks while developing.

Verification for this round is recorded below before the correction commit is pushed.

### r1 verification output
```text
npm run check: exit 0 (Astro 0 errors, 0 warnings, 0 hints)
npm run build: exit 0; demo dist/runtime/notices check passed
PDF_ARTIFACTS=/tmp/scoreview-r1 npm run test:pdf: exit 0
  fit.test.ts: 6 passed
  Poppler raster: staff width/6.5 mm height, known notehead and aligned note-name ink passed.
  Vector composition: exact dimensions, embedded/selectable text, F♯m/B♭ runs,
  house-style font/matrices/alpha, shared TAB lane, cancellation and missing-glyph error passed.
  PDF page model spike passed (chromium): A4 4 lines; A3 4; 2 pages for 80 bars.
npm run test:reader: exit 0 (all scenarios, including annotation sizes and Endless scrollbars)
npm run test:layout: exit 0 (chromium)
npm run test:manifest: exit 0 (128 local packs, 16 icons; complete/core packs)
npm run test:pack: exit 0 (fresh Vite, Astro client-only and Astro SSR hosts; Node import)
PDF_COMPOSITION_ONLY=1 PDF_ARTIFACTS=/tmp/scoreview-r1 npm run test:pdf: exit 0
  Final inline-CSS fixture renders white text over a coloured dot.
  Re-parsing/rasterizing those same final PDF bytes with the stricter known-notehead
  width/height assertions also passed (0.15 mm tolerance).
```
All commands ran in the foreground at normal timing limits. No timing gate failed, so no `VALIDATION_BUDGET_SCALE=2` rerun was needed. A negative-control probe deliberately scaled a real PDF page to 1/11 size; the new validator rejected it with `PDF contains full-size horizontal staff paths`.

The exported geometry, house-style and F♯m/B♭ PDFs were also rasterized to PNG and visually inspected in this worktree. Local review artifacts: `/tmp/scoreview-r1/{geometry,house,accidentals}.{pdf,png}`. They are reproducible test outputs, not committed source assets. The tests always check decoded graphics/text state and run Poppler ink checks when available.

No protected files or dependencies changed in r1. AC8a's screen pitch-colour integration gate remains as accepted by the reviewer; the three-pass support it needs is now covered here. For GBrain (lead to promote): page dimensions and selectable text alone cannot prove PDF layout; assert actual transformed geometry and rendered ink, including nested SVG viewports and inline-CSS text styles.
