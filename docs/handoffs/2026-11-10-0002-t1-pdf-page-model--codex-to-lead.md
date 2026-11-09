# Handoff: 0002-t1 — PDF page model and per-line break spike (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0002 · **Spec:** [0002-pdf-export](../specs/0002-pdf-export.md) · **Plan:** [0002-pdf-export](../plans/0002-pdf-export.md), T1
- **Dispatch:** [lead-to-codex](2026-11-10-0002-t1-pdf-page-model--lead-to-codex.md)
- **Branch:** orch/0002-t1-pdf-page-model
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-e3689cb4
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/71 (draft)
- **Base commit:** 13d48eb (required ancestor); acknowledgement bb46a41
- **Port:** validation uses ephemeral port 0 on 127.0.0.1; no persistent server
- **Status:** closed (implementation complete; aggregate harness caveat recorded)

## Goal
Prove T1's per-line fitting at real paper dimensions before PDF composition or UI proceeds. See the spec and plan above for the full feature; this handoff covers T1 only.

## Scope
- **In:** paper dimensions, greedy line fitting, optional MEI system breaks, an isolated abortable Verovio worker, and regression validation.
- **Out:** PDF composition/download, annotations, overlay/button, dependencies, and all other tasks.
- **Files owned/changed:** `packages/pepperscore/src/lib/pdf/{paper.ts,fit.ts,fit.test.ts,engrave.ts,engrave.worker.ts}`, `packages/pepperscore/src/lib/notation/mei-view.ts`, `validation/pdf.mjs`, root `package.json`, and this task's dispatch/return handoffs.
- **Do not touch:** components, styles, chrome/bar registry, import/document model, skin validation, ledger; all preserved.

## Acceptance criteria
- Paper dimensions are data in millimetres: A4, A3, Letter, Legal.
- Greedy `breakLines` and absent/explicit `ViewSpec.breakBefore` have unit coverage, including byte-exact legacy output and ending wrapper placement.
- Browser validation checks dense A4 `[4,1,4,4]`, A3 line count, actual system membership, page bounds, pagination, 30-staff shrink, hidden staves, empty/single/oversize pickup, and cancellation.
- Focused T1 verification passed; all remaining validation checks passed independently or on replay. The aggregate command itself failed due to the cross-worktree harness collision documented below.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run check && npm run build && npm run test:pdf && npm run test:document && npm run test:layout && npm run test:chunks
npm run test:manifest && npm run test:validation
```
Do not overlap build with browser tests. Timing failures should be rerun alone. PDF validation starts and closes its own ephemeral Vite server; it dynamically imports the new entry directly because no UI entry is in scope yet.

## Known gotchas / decisions already made
GBrain consulted read-only: `projects/scoreflow-music-reader`, `projects/scoreflow-music-reader/gotchas-abc-import`. Repository spec and plan are authoritative; implementer writes no GBrain pages.

- **Fixed stave size:** 6.5 mm across the five-line staff (about 1.625 mm per space). This is a readable sheet-music default, independent of screen zoom and paper. Existing `STAFF_UNITS = 72` establishes conversion to Verovio layout units. Margins are fixed at 12 mm. T2 should map each returned SVG to the exact physical dimensions in `PAPER_SIZES`; integer Verovio layout units are rounded.
- **Measurement (r1):** one continuous, unjustified `breaks: none` pass measures complete barline-to-barline extents and staff bounding boxes across every visible staff. Key, meter and clef changes remain in their contextual bars; no first-note prefix is subtracted. Reserve a repeated-system prefix, then preflight planned lines in `breaks: encoded` mode with justification disabled. `line` mode still width-fits systems even with that flag; it is used only for final pagination. If repeated/cautionary signatures require more room, increase the shared reserve and re-plan from the original contextual bar widths. Reject unresolved multi-bar overflow before final justification. A truly oversize single bar retains the standalone contract. Nested text boxes can have local transforms, so their raw x coordinates are not mixed into staff extents.
- **Break mode:** `encoded` honours both sb and pb but does not paginate sb-only scores automatically; the 80-bar fixture caught all 20 systems overflowing a single page. Final rendering uses Verovio `breaks: 'line'`, preserving encoded sb while allowing automatic page breaks at real page height. The worker checks actual measure counts per system against its plan and rejects mismatches.
- **Shrink fallback:** Verovio exposes a document-wide scale, not a per-system scale. When the natural tallest system exceeds content height, enlarge layout dimensions to shrink the whole document and report `shrunk: true`, as permitted by T1. Physical margins remain fixed. Normal scores retain 6.5 mm staves.
- **Empty score:** explicitly return one blank SVG page and no lines, avoiding Verovio's zero-size empty layout.
- **Entry contract:** `engravePages({ data, view? }, { paper, maxBars, font?, files? }, signal)` returns `{ pages, lines, shrunk }`. Pass `SourceDocument.engravingText` as data and the reader's `ViewSpec` snapshot as view. `LineInfo` has zero-based `start`, bar `count`, and verified unstretched system `width` in layout units. Host-supplied Verovio files can be passed explicitly; default uses the shipped files.
- **Lazy boundary:** no existing entry imports PDF code. T2/T3 must dynamically import `pdf/engrave`; no public entry or dependencies changed. A fresh worker owns each request and is terminated on completion, failure or cancellation, leaving reader state independent.

## Open questions
No T1 design questions. The lead should retain the aggregate-harness caveat when reviewing; shared test-port cleanup is outside this task.

## Receiver ack
Lead acknowledges through the ledger; do not edit the ledger from this branch.

## Return
- **Outcome:** done for T1; the aggregate validation command was not green in this shared environment (see exact failure and successful replays below).
- **Implementation commit:** `6da5584` (acknowledgement `bb46a41`).
- **What changed:** T1 only, described above.
- **Initial verification output (before r1):** `npm run check`, `npm run build`, `test:document`, `test:layout`, `test:chunks`, and `test:manifest` passed separately. The aggregate `test:validation` failed during transpose with `page.evaluate: Execution context was destroyed, most likely because of a navigation` (`validation/transpose.mjs:162`). The harness hard-codes port 43991 (`:137`) and accepts any responding server there. `ss` showed listener PID 1621606; `/proc/1621606/cwd` resolved to another worktree, `/home/shaun/.t3/worktrees/ph-vexflow-view/t3-1eaa3a60`. No other worktree/process was modified or stopped. A diagnostic replay substitutes an ephemeral free port in memory and preserves the original script URL for relative fixture paths, without changing the unowned harness. The ephemeral-port transpose replay passed (105.7 s), and the remaining aggregate checks ran separately and sequentially. `test:parser-diff` initially hit a dynamic module fetch failure on port 43984; an unchanged standalone `npm run test:parser-diff` replay then passed. Every other remaining check passed, including reader and large-score timing gates on their first run.

```text
npm run check: 0 errors, 0 warnings, 0 hints (plus all package TypeScript checks)
npm run build: Demo build uses the library dist (worker chunks and Verovio files match) and ships its notices
test:pdf: 5 unit tests passed; PDF page model spike passed (chromium): A4 4 lines; A3 4; 2 pages for 80 bars.
A4 actual bars/system: [4, 1, 4, 4]; A3: [4, 4, 4, 1]. Page bounds, tall shrink, empty/single/pickup, hidden staves and cancellation passed.
test:document: MEI view matches DOM reference in 48 cases; all import regressions/channels passed.
test:layout: Layout validation passed (chromium)
test:chunks: chunked engraving matches whole engraving across chunk boundaries passed (39.5 s)
test:manifest: 128 local packs, 16 icons and playable voices verified; sound packs passed.
test:validation: FAILED during transpose: Execution context was destroyed (shared port 43991).
transpose on temporary free port: engraving validation passed (105.7 s).
remaining checks: score-db, performance, clock-contract, pepperscore (159 tests), editor (277 tests), editor-browser, editor-phone, reader, large, guardrails, embed, clock-embed, tab, tab-bake, instrument-switch and pdf passed.
parser-diff: first continuation failed dynamic import fetch; unchanged standalone replay passed (see tail below).
```

- **Out-of-scope issues found:** legacy browser harnesses bind fixed ports and can attach to another worktree's server; parser-diff also had a transient module-fetch failure. No timing-gate rerun was needed: editor, reader and large passed.
- **Decisions made:** fixed stave/margins, contextual measurement and encoded-mode natural preflight (r1), line-mode pagination, whole-document tall-system fallback, blank empty page.
- **For the ABC guide:** no ABC import behaviour changed.
- **Follow-ups:** T2 owns composition, annotations, embedded fonts and physical PDF sizes; T3 owns UI/snapshot integration and lazy-loading assertions; T4 owns large-score performance and other browsers. T1's browser validation targets source modules through Vite; the eventual production PDF chunk becomes reachable in T2/T3.
- **For GBrain (lead to promote):** encoded sb-only MEI needs `breaks: 'line'` for automatic pagination; checking line membership alone misses clipping, so validate physical page bounds too.

### Parser replay output tail
```text
ok   worker import case multi-measure rests
ok   worker import case timewise with internal DTD entities
ok   worker import case playback marks: articulations, fermata, cue, ornaments, pedals
Streaming MusicXML reader matches the DOM importer
```

### Scope audit
`git diff --stat main...HEAD` contains only the declared T1 files and the two 0002-t1 handoffs. Working tree is clean after committing this handoff.

## Review r1 revision
- **Request:** [review 5834270546](https://github.com/pepperhorn/ph-scoreview/pull/71#pullrequestreview-5834270546), lead-directed major/minor/nit fixes.
- **Major:** contextual extents across all staves replace the isolated-bar/top-layer prefix heuristic. Planned lines are independently checked without justification, so final compression cannot conceal overfill. The committed validator reproduces the reviewer's original `mrestTop` and `keyChanges` fixtures (including pitch/octave/accidental patterns) for A4/A3 and ceilings 4/12, and checks every line against the rounded printable width.
- **Minor:** 3,000 deterministic generated sequences check greedy monotonicity for larger capacities and A3 versus A4. The same sweep verifies rounded physical capacities across neither/one/both-paper shrink regimes.
- **Nit:** `pageGeometry` supplies the exact rounded page/margin integers both to fitting and Verovio; no unrounded capacity remains.
- **Compatibility:** no changes to `mei-view.ts` in r1. Existing absent-`breakBefore` byte-equivalence and document reference tests remain required.
- **R1 verification:** the exact requested foreground sequence passed from the repo root: `npm run check && npm run build && npm run test:pdf && npm run test:document && npm run test:layout && npm run test:chunks && npm run test:manifest`. PDF: 6 tests passed (including 3,000 generated monotonicity/capacity cases); all 8 independent reviewer fixture checks passed; A4 dense counts remain `[4,1,4,4]`; A3 remains four lines; 80 bars remain two pages. Document reference transform passed 48 cases, layout/chunks passed, manifest verified 128 packs/16 icons. Aggregate explicitly skipped per lead because other worktrees hold fixed ports.
- **For GBrain (lead to promote):** do not infer natural fit from justified SVG bounds. Measure contextual bar/staff extents and preflight encoded systems without justification; signature repetition/cautionaries can add width at line boundaries.

### R1 independent natural-fit evidence
The validation toolkit separately re-engraves the worker's planned starts using `breaks: encoded`, `noJustification: true`, real rounded page dimensions, and the same Bravura/font options. It checks every system against the printable width across all staff paths and staff boxes. Bounding-box-only `g.system` elements are excluded from system counts.

| Fixture | Paper | Ceiling | Maximum natural fill | Lines |
|---|---|---:|---:|---:|
| mrestTop | a4 | 4 | 0.8000 | 12 |
| mrestTop | a4 | 12 | 0.8000 | 12 |
| mrestTop | a3 | 4 | 0.7977 | 8 |
| mrestTop | a3 | 12 | 0.7977 | 8 |
| alternatingKeys | a4 | 4 | 0.8306 | 8 |
| alternatingKeys | a4 | 12 | 0.8306 | 8 |
| alternatingKeys | a3 | 4 | 0.7098 | 6 |
| alternatingKeys | a3 | 12 | 0.8722 | 5 |

Negative control: temporarily substituting the reviewed `1d72271` worker (then restoring the revised worker before final verification) makes the new validation fail. The original `mrestTop` fills are 1.1709 (A4/4) and 1.5557 (A3/12); the original alternating-key A3/12 fill is 1.0162. This confirms the assertions detect the original failure, independently of the new worker's own checks.

Mode detail: a native toolkit probe with the same two-bar planned systems and `noJustification: true` changed the first `line`-mode width from 2049.5 to 2905.5 when pageWidth changed 2326→3290. The equivalent `encoded`-mode width stayed 1207.9. Use encoded mode to measure natural fit, and line mode to paginate the final justified pages.

R1 verification tail:
```text
> pepperscore-monorepo@0.0.0 test:layout
> node validation/layout.mjs

Layout validation passed (chromium)

> pepperscore-monorepo@0.0.0 test:chunks
> node validation/chunks.mjs

Slice keys: a leading key replaces the carried key; a mid-measure change keeps it passed
chromium: whole 8 systems, chunked 8 systems
chromium: chunked engraving matches the whole engraving across chunk boundaries passed (17.9 s)

> pepperscore-monorepo@0.0.0 test:manifest
> node scripts/verify-gm-manifest.mjs && node validation/sound-packs.mjs

GM manifest: 128 local packs, 16 icons and playable voices verified.
Sound packs: complete pack.json, generated core (19 FluidR3 sounds) and versions passed
```
