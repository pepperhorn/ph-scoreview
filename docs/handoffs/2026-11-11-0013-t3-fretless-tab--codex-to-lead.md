# Handoff: 0013-t3 — Violin and cello finger + position TAB (codex → lead)

- **Date:** 2026-11-11
- **Type:** return
- **Ledger:** 0013 · **Spec:** [0013](../specs/0013-stringed-instrument-tab.md) · **Plan:** [0013 T3](../plans/0013-stringed-instrument-tab.md)
- **Dispatch / receiver ack:** [lead to codex](2026-11-11-0013-t3-fretless-tab--lead-to-codex.md)
- **Branch:** `orch/0013-t3-fretless-tab`
- **Worktree:** `/home/shaun/.t3/worktrees/ph-vexflow-view/t3-e5798ced-64614dac132b6dc3`
- **Base:** `c2b32c6` (pinned `299d463` is an ancestor); receiver acknowledgement `6e51924`.
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/84 (draft)
- **Status:** closed
- **Outcome:** done (implementation; lead review/merge remains)
- **Initial implementation commit:** `b732c9dd6c52db0e305c80fac93b4b728e9ae478`; return-handoff commit is the final branch head.

## Review r1 resolution — supersedes initial implementation notes below

Review: https://github.com/pepperhorn/ph-scoreview/pull/84#pullrequestreview-5855044338, reviewed `d71c6ab61e2843d250d6f8e4d98a3283c7fc49da`.

1. **Active keys:** resolve fretless pitches after collecting a per-staff/global key timeline. Later global keys replace opening staff keys; an explicit staff key wins over a simultaneous global default. Mid-bar changes are selected at each note onset, including earlier notes in another layer. Measure accidentals reset at key boundaries. The real-Verovio F-major → D-major/B3 repro yields `L2` then `2`, and dedicated tests cover mid-bar voices and scoped precedence.
2. **Position directions:** genuine changes remain native directions. Unchanged bar-start reassertions carry staff-specific metadata; the shared SVG hook retains them only at the first position direction of each system/staff. Whole, actual forced-chunk and PDF tests use multi-bar systems, with an additional sparse passage asserting at least two bars and exactly one unchanged position label per system.
3. **Evidence:** altered pitches now include explicit MusicXML accidental elements. The violin begins with A3/B3/C4/D4 → 1/2/3/0; cello begins with C2/D2/E2/F2 → 0/1/3/4. Both therefore show real open strings. The cello selectable-PDF assertion now requires `H4`. The cello ABC report fixture has a positive four-line-TAB regression. `TAB_EVIDENCE_DIR` can override the artifact directory.
4. **Grace notes:** position directions require a drawn principal TAB note; skipped grace notes cannot consume or steal the label anchor. A regression asserts the direction targets the principal note, never the omitted grace.
5. **Position continuity — follow-up:** no local greedy shift cost was added. Carrying previous-position cost only inside a chunk can change the fingering when that same passage is rendered from a different chunk boundary. A phrase DP/Viterbi cost should share its state/solution across chunk boundaries (and keep opens neutral), with whole/chunk/PDF parity coverage. This exceeds a small isolated cost tweak; per the user's conditional instruction, it remains an explicit follow-up. This revision preserves the reviewed note-wise chart ranking and exact-pitch labels.

**Implementation commit:** `cf1672ef30fa039be01f9b4528793ef954192ba5`. Only `mei-tab.ts`, `tab/strings/svg.ts`, `tab/strings/integration.test.ts`, `validation/tab.mjs` and this task return handoff change. No protected files or ledger edits.

### R1 verification

```text
npm run test -w pepperscore: 18 files / 507 tests passed
npm run check: passed; Astro 23 files, 0 errors/warnings/hints
npm run build: passed; demo/worker/Verovio parity and notices passed
npm run test:tab: dense/natural/open passages, whole/actual-chunk/PDF labels and multi-bar position reassertions passed; all existing reader checks passed
npm run test:tab-bake: all 784 checks passed
npm run test:fret-assign: 2822 checks plus re-entrant checks passed
npm run test:chunks: whole 8 systems, chunked 8 systems; cross-boundary identity passed
npm run test:pdf: Poppler raster, vector composition and page model passed
Sequential foreground chain exit code: 0
```

Final PDF output:
```text
Poppler raster: staff width/6.5 mm height, known notehead and aligned note-name ink passed.
Vector composition passed: four exact paper sizes, embedded/selectable text, RGB paths, multipage annotated export, unsupported glyph error, cancellation.
PDF page model spike passed (chromium): A4 4 lines; A3 4; 2 pages for 80 bars.
```

Logs: `/tmp/84-r1-final-{tests,check,build,tab,bake,frets,chunks,pdf}.log`. Commands ran as a sequential foreground chain after the final source edits. No PR watching/polling was used.

### R1 rendered evidence (regenerated and visually inspected)

- Violin PDF raster: `/tmp/0013-t3-evidence-r1/Violin-whole-pdf.png`
- Cello PDF raster: `/tmp/0013-t3-evidence-r1/Cello-whole-pdf.png`
- Reader SVGs: `/tmp/0013-t3-evidence-r1/Violin-whole.svg`, `/tmp/0013-t3-evidence-r1/Cello-whole.svg`
- Forced-chunk SVGs: `/tmp/0013-t3-evidence-r1/Violin-chunk.svg`, `/tmp/0013-t3-evidence-r1/Cello-chunk.svg`
- PDF-worker SVGs: `/tmp/0013-t3-evidence-r1/Violin-whole-pdf.svg`, `/tmp/0013-t3-evidence-r1/Cello-whole-pdf.svg`
- Actual PDFs: `/tmp/0013-t3-evidence-r1/Violin-whole.pdf`, `/tmp/0013-t3-evidence-r1/Cello-whole.pdf`

## Goal

Implement spec AC3: four-string violin and cello finger TAB in Both/TAB, with inline L/H and named positions, sounding-pitch re-fingering, shared-position double stops, and matching whole/chunk/PDF labels. Viola/double bass remain gated.

## Scope and files owned

Changes are limited to `packages/pepperscore/src/lib/tab/**`, `lib/notation/mei-tab.ts`, `lib/verovio.worker.ts` (SVG substitution only), `lib/pdf/engrave.worker.ts` (SVG substitution only), `validation/tab.mjs`, and the two 0013-t3 handoffs. No components, chrome, bar-items, preferences, styles, editor, ledger, dependencies, public exports, or `validation/pdf.mjs` changes. `lib/render.ts` did not require changes: the shared worker hook covers its probes, pages and lazy systems.

## Acceptance criteria and outcome

- Violin/cello are offered by the existing TAB planner, use their approved four-string charts and ignore fretted tuning/capo settings. Viola and double bass remain unsupported.
- Notes with simultaneous onsets across voices are solved together; active strings remain occupied and stopped notes share a hand position. Existing chart ranking supplies deterministic pitch/spelling choices; ties retain their string and invisible rhythm continuation. Unsupported/impossible events remain unlabelled rather than inventing a pitch. This is an event/occupancy solver, not a claim of globally optimal bowing or ergonomic fingering.
- Stable original note IDs and TAB aliases remain intact. Numeric `44` reserves two glyphs for L/H labels. `note@type` carries the exact finger and position through Verovio MEI round-trips and becomes a class on that specific SVG note. Substitution never depends on chord output order or a hard-coded glyph size.
- Initial and changed positions are native MEI directions. Marked bar-start reassertions are retained only at system/chunk starts by the shared SVG postprocessor; opens/rests do not change the hand position. Position directions use compact text centred over their note to avoid collisions in dense passages.
- One shared string-level postprocessor runs on every reader-worker SVG and every PDF-worker SVG, including measurement/probe pages. PDF composition uses the existing explicit outline/fill passes; no unsupported paint-order dependency was added.
- Playback still uses the source score timeline; the regression compares it before/after all TAB views. Finger placeholders never supply audio pitches.

## Rendered examples

Generated by the committed `validation/tab.mjs`, kept outside Git to preserve the explicit owned-file scope:

| Example | SVG / actual PDF | Rasterized first PDF page |
|---|---|---|
| Violin dense semiquavers, inline L2/H3, I position | `/tmp/0013-t3-evidence-r1/Violin-whole.svg`; `/tmp/0013-t3-evidence-r1/Violin-whole.pdf` | `/tmp/0013-t3-evidence-r1/Violin-whole-pdf.png` |
| Cello half/I/IV½ shifts, inline H4 | `/tmp/0013-t3-evidence-r1/Cello-whole.svg`; `/tmp/0013-t3-evidence-r1/Cello-whole.pdf` | `/tmp/0013-t3-evidence-r1/Cello-whole-pdf.png` |

`*-chunk.svg` and `*-pdf.svg` capture the other paths. `whole.json` and `chunk.json` contain stable note IDs and labels for all three views and transposed examples. The test asserts whole/chunk identity, equality with PDF labels, playback stability, and real rendered text boxes without finger/position collisions. It rasterizes an actual PDF page with Poppler and checks selectable modifier text. These are local artifacts, not hosted GitHub attachments; rerun `npm run test:tab` to regenerate them. Both first-page PDF rasters were inspected during implementation.

## Verify with

```bash
npm ci && PLAYWRIGHT_SKIP_BROWSER_GC=1 npx playwright-core install chromium
npm run test -w pepperscore && npm run check && npm run build
npm run test:tab && npm run test:tab-bake && npm run test:fret-assign
npm run test:chunks && npm run test:pdf
npm run test:manifest
VALIDATION_BUDGET_SCALE=2 npm run test:validation
```

## Initial verification output (historical: d71c6ab)

```text
npm ci + Playwright Chromium install: exit 0
npm run test -w pepperscore: 18 test files / 502 tests passed
npm run check: all workspaces passed; Astro 23 files, 0 errors/warnings/hints
npm run build: passed; demo library/worker/Verovio parity and notices passed
npm run test:manifest: 128 local packs, 16 icons; 19 FluidR3 core sounds passed
npm run test:fret-assign: 2822 checks plus re-entrant checks passed
npm run test:tab-bake: all 784 checks passed
npm run test:chunks: whole 8 systems, chunked 8 systems; matches across boundaries
VALIDATION_BUDGET_SCALE=2 npm run test:validation: exit 0 (all sub-suites)
```

Actual final-run output (diagnostic JSON and Vite connection chatter omitted):

```text
Finger TAB: dense violin/cello, Notation/Both/TAB, whole/chunk/probe, transposition, playback and rasterized PDF passed
TAB: reader switch (piano and guitar, saved view, transposition, phone More panel, drawer at mid width, embeds) on chromium passed
tab-bake: all 784 checks passed
Poppler raster: staff width/6.5 mm height, known notehead and aligned note-name ink passed.
Vector composition passed: four exact paper sizes, embedded/selectable text, RGB paths, multipage annotated export, unsupported glyph error, cancellation.
PDF page model spike passed (chromium): A4 4 lines; A3 4; 2 pages for 80 bars.
Process exit code: 0
```

Final logs: `/tmp/0013-t3-e5798-{tests,check,build,manifest,tab,bake,frets,chunks,validation}.log`. The full validation log includes the final PDF suite. Poppler emitted font-collection diagnostics while extracting the fretless PDFs; rasterization, selectable modifier checks and the PDF suite all succeeded.

## Decisions made / known gotchas

- GBrain consulted: `[default:projects/scoreflow-music-reader]`. Repo spec, merged T1/T2 handoffs and PR #74 reviews supplied the current task requirements. No implementer GBrain writes.
- The `type` metadata channel is preserved by pinned Verovio and solves the spike's SVG-order and MEI round-trip risks without changing note IDs or adding a public API.
- Finger strings follow chart high→low order, while tuning XML is derived from the chart's reversed physical order. Only the ported violin/cello charts are wired; provisional viola/bass data is unchanged.
- Spelling includes gestural/written accidentals, inherited key signatures and earlier measure accidentals. The solver receives sounding MIDI, not tuning-plus-finger arithmetic.
- Compact position directions are centred in the shared SVG hook because Verovio left-aligns them; a rendered PDF collision assertion caught the stress passage's adjacent IV½/half-position overlap before this correction.
- Source/build changes while Vite browser suites are running cause full reloads. Interrupted exploratory runs were discarded; the final browser chain runs after the final build with no concurrent edits/builds.
- **For the ABC guide:** no ABC import behaviour changed. T4 should document the newly enabled violin/cello TAB, supported ranges, L/H, position names, and the chart-based tuning/capo policy.

## Open questions / follow-ups

No product questions. Lead owns cross-family review, merge, ledger acknowledgement, T4 documentation and GBrain promotion. Preserve the local examples before temporary-file cleanup if desired. No new host settings or dependencies are required.

## For GBrain (lead to promote)

Verovio preserves custom note types through MEI round-trip and exposes them as SVG classes: use a per-note marker for finger TAB labels. Numeric two-digit placeholders reserve layout width; all reader/PDF render paths must share the substitution. Compact centred position directions need rendered-box collision checks, including PDF.

R1 for GBrain (lead to promote): key inference must use staff/global timelines at note onset; resolving after all voices prevents a mid-bar key from leaking backwards into another layer. Distinguish native position changes from reassertions and suppress redundant reassertions per system/staff after engraving.
