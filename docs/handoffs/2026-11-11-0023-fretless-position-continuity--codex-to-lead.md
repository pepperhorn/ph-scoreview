# Handoff: 0023 — Fretless position continuity (codex → lead)

- **Date:** 2026-11-11
- **Type:** return
- **Ledger:** 0023 · **Spec:** [0013](../specs/0013-stringed-instrument-tab.md)
- **Dispatch:** [lead → codex](2026-11-11-0023-fretless-position-continuity--lead-to-codex.md)
- **Branch:** `orch/0023-fretless-position-continuity`
- **Worktree:** `/home/shaun/.t3/worktrees/ph-vexflow-view/t3-001d66c6-b63a40684cb553da`
- **Base:** `2c50a1e` (includes required ancestor `4311266`)
- **Implementation:** `8de2433`; receiver ack committed first as `d7bb233`
- **Status:** complete; ready for lead review

## Goal and outcome
Reduce real violin/cello position changes by selecting fingerings across a phrase, preserving sounding pitches and existing rendering. Implementation and required verification are complete; ready for draft-PR review.

## Scope and files owned
Changed `packages/pepperscore/src/lib/tab/strings/phrase.ts`, new `phrase.test.ts` beside it, and the two 0023 handoffs. No rendering, styles, components, exports, dependencies, CI, ledger or other documentation changes. `solver.ts` ranking and charts remain intact. ABC import behaviour is unchanged.

## Acceptance criteria and counts
All counts use the exact 128-note natural/chromatic pitch sequences in `validation/tab.mjs`, with open strings carrying the prior hand position. Logical position labels count the initial stopped position plus actual changes, excluding per-system reassertions.

| Fixture | Position changes before → after | Logical position labels before → after |
|---|---|---|
| Violin | 0 → 0 | 1 → 1 |
| Cello | 84 → 55 | 85 → 56 |

Rendered counts (unchanged 900px reader fixture and A4 PDF settings):

| Fixture | First reader SVG (32 notes) position labels before → after | Full PDF (128 notes) position labels before → after |
|---|---|---|
| Violin | 1 → 1 | 4 → 4 |
| Cello | 13 → 8 | 85 → 56 |

Reader and PDF counts include system reassertions; violin's four PDF labels are one per system. Whole and forced-chunk outputs agree. Evidence: `/tmp/0023-before/` and `/tmp/0023-after/` (SVG, PDF, rasterized PDF and JSON labels); baseline log `/tmp/0023-before.log`, full verification `/tmp/0023-validation.log`.

Baseline measured with the original solver before editing; both before and after assign all 128 notes. New tests fix these after counts and reverse-check every assigned pitch. Additional tests cover a scale staying in I, a necessary shift occurring once, opens carrying the hand, fixed notes, ties at the exact duration boundary, overlapping voices, a future fixed chord requiring an earlier alternative, unsupported pitches, oversized chords and 4,096-note passages for each instrument. Existing solver and integration tests pass.

## Decisions made
- Candidate ordinal rank remains the local preference, including the cello half-position ranking. A change from an established hand position costs `4 + 2 * abs(newPosition - oldPosition)` ranks. Initial hand placement is free; opens preserve the hand at no shift cost. No additional string-crossing penalty was needed for the acceptance fixtures.
- Dynamic programming merges futures with equivalent position and relevant held notes. Released strings are omitted from the equivalence key except exact-boundary ties. Backpointers reconstruct choices without repeatedly copying the phrase.
- Retain at most 64 paths per event to bound polyphonic state growth. This is a beam approximation for complex overlapping voices, not a proof of global optimality for arbitrary polyphony. Non-overlapping monophonic passages merge to the chart's hand positions.
- Paths are compared first by missed note count, then fingering/movement cost. A cheap path cannot beat a viable retained path merely by dropping a later event. Chord compatibility and the existing four-distinct-pitch bound are retained.
- The two 4,096-note regression cases finished below one second each locally. Phrase optimization adds work compared with greedy selection; retained-state count stays bounded and long-score/render budgets are checked by the full suite.

## Verification
```bash
npm ci && npx playwright-core install chromium
npm run test -w pepperscore -- --run src/lib/tab/strings
npm run check && npm run build && npm run test:manifest && npm run test:validation
```

```text
npm ci && npx playwright-core install chromium: exit 0
npm run test -w pepperscore -- --run src/lib/tab/strings
 Test Files  3 passed (3)
      Tests  73 passed (73)
npm run check
 Result (23 files): 0 errors, 0 warnings, 0 hints
npm run build
 Demo build uses the library dist (worker chunks and Verovio files match) and ships its notices
npm run test:manifest
 GM manifest: 128 local packs, 16 icons and playable voices verified.
 Sound packs: complete pack.json, generated core (19 FluidR3 sounds) and versions passed
npm run test:validation
 Test Files  19 passed (19); Tests 710 passed (710) [pepperscore]
 Test Files  27 passed (27); Tests 294 passed (294) [editor]
Finger TAB: dense violin/cello, Notation/Both/TAB, whole/chunk/probe, transposition, playback and rasterized PDF passed
TAB: reader switch (piano and guitar, saved view, transposition, phone More panel, drawer at mid width, embeds) on chromium passed
Poppler raster: staff width/6.5 mm height, known notehead and aligned note-name ink passed.
Vector composition passed: four exact paper sizes, embedded/selectable text, RGB paths, multipage annotated export, unsupported glyph error, cancellation.
PDF page model spike passed (chromium): A4 4 lines; A3 4; 2 pages for 80 bars.
Full command chain exit 0.
```

## Known gotchas / follow-ups / GBrain
GBrain consulted: `projects/scoreflow-music-reader` (historical project context); current dispatch/spec govern. Lead may promote the bounded-state solver and fixture counts after review/merge. Implementer has not written to GBrain.

A separate concurrent TAB-only run hit Chromium `page.reload: Protocol error (Page.reload): Not attached to an active page` while other worktrees were running browser suites. Baseline TAB validation passed. The full sequential validation command subsequently passed including TAB and PDF, as recorded above. No renderer workaround or relaxed expectation was added.

## Open questions
None. Lead owns review, ledger updates and merge. PR must remain draft for review.
