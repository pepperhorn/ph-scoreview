# Handoff: 0004-t1 — ABC engraving fidelity (codex → lead)

- **Date:** 2026-11-09
- **Type:** return
- **Ledger:** 0004 · **Spec:** [0004](../specs/0004-abc-import-parity.md) · **Plan:** [0004 T1](../plans/0004-abc-import-parity.md)
- **Dispatch:** [lead → codex](2026-11-09-0004-t1-abc-engraving-fidelity--lead-to-codex.md)
- **Branch:** orch/0004-t1-abc-engraving
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-bb111b69
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/60
- **Base commit:** 49c3e9b (dispatch docs at 415e1f4)
- **Port:** 5241 (no manual preview server used)
- **Status:** open

## Goal
Complete T1's ABC accidental, key-change, annotation/harmony, final/double-barline and clef fidelity requirements while retaining note identity and working ABC notation features.

## Context you need
The linked spec, plan and dispatch define acceptance. The original [issue report](2026-11-09-adhoc-abc-import-fidelity--scale-to-song-to-lead.md) and its committed spike assets remain unchanged. GBrain consulted: `projects/scoreflow-music-reader`; beam and bar-fit logic was preserved.

## Scope
- **In:** findings 1, 2, 4, 5, 7; cases a, a2, b, b2, c, e, f, g.
- **Out:** T2's grand-staff grouping, instrument transposition and MIDI metadata, README; MusicXML/MEI import; abcjs dependency.
- **Files owned/changed:** `packages/pepperscore/src/lib/import.ts` (ABC only), `packages/pepperscore/src/lib/notation/document.ts`, `packages/pepperscore/src/lib/score.ts` (additive `Measure.rightBarline` field), new `packages/pepperscore/src/lib/abc-import.test.ts`, new `packages/pepperscore/src/lib/__fixtures__/abc/*.abc`, this return and dispatch acknowledgement.
- **Do not touch:** ledger, original spike assets, other docs/code.

## Acceptance criteria
- [x] AC1–AC5: explicit accidentals and bar state, changed keys and enharmonic spelling, separate text/harmony, final/double bars, octave/C clefs.
- [x] AC8 T1: chord kinds, dyads, ties, dotted durations, rests, tempo, beams, instrument-switch sounding pitch retained.
- [x] MEI carries `accid`, changed staff key signatures, `<dir>`, `right="end"`/`dbl`, `clef.dis` and C-clef line.
- [x] `generatedPitchId` implementation unchanged; regression assertions pin existing dyad ids and first guitar note id.
- [x] Native Verovio loads and engraves every copied fixture; SVG assertions check annotation and accidental output.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run test -w pepperscore -- --run src/lib/abc-import.test.ts
npm run check && npm run build && npm run test:manifest && npm run test:validation
```

## Decisions made / probe results
- Probed every T1 spike case with abcjs `parseOnly` before coding. `K:` changes appear both as voice `key` elements and as the next line's `staff.key`. Key arrays include cancellation `natural` entries (F-sharp → G-flat contains six flats plus a natural), so fifths count only sharps/flats. Each measure records its active key/mode; MEI emits staff-specific scoreDef changes before the affected bar.
- Explicit `pitch.accidental` is copied; implied repeats retain their alteration without an extra written sign. Accidental state persists across source line wraps and resets at barlines/key changes.
- Only `position: default` entries are harmony. Other entries become text directions, preserving above/below; side/absolute annotations use the existing direction model's above placement. Navigation text retains its separate navigation handling.
- abcjs calls `|]` `bar_thin_thick`, and `||` `bar_thin_thin`. Store an additive right-barline field; repeats take precedence in MEI.
- abcjs retains octave-clef types but does not shift `p.pitch`. The guitar fixture's `G,` stays G3 (MIDI 55). T1 preserves these sounding model pitches; scoreToMei offsets notehead octave for `-8`/`+8` clefs and writes `clef.dis`. **T2 integration note:** preserve that model/engraving convention when adding transposition metadata, avoiding a second octave shift.
- Tenor is normalized by abcjs to `type: alto, clefPos: 8`; map that to tenor/C4. Alto uses C3. Explicit source clefs take precedence over guessing from the voice name.

## Open questions
None for T1. T2 remains a separate sequential task after this PR is reviewed/merged.

## Return
- **Outcome:** partial: implementation complete; required full validation is blocked by an out-of-scope stale assertion
- **Commits:** receiver ack 85c8ed9; implementation b98d8e0; return documentation committed separately.
- **What changed:** ABC supplies accidental/key/clef/direction/barline metadata; reduced-model MEI preserves it. Eight copied fixtures and 15 regression tests include native Verovio engraving.
- **Verification output:**
  - Setup (`npm ci`, Chromium install): exit 0.
  - Targeted ABC suite: 15 tests passed, including native Verovio rendering of all eight fixtures.
  - `npm run check`: exit 0; reader diagnostics: 0 errors, 0 warnings, 0 hints.
  - `npm run build`: exit 0; demo worker/Verovio assets and notices match.
  - `npm run test:manifest`: exit 0; 128 packs / 16 icons and sound-pack checks passed.
  - `npm run test:validation`: exit 1 at `validation/document.mjs:113`. Its line 94 expects `<ending n="2" label="2."><measure n="3">` for ABC ending `|]`. AC4 now correctly produces `<measure n="3" right="end">`; the assertion must be updated by the lead or a follow-up owner. All preceding checks, including the complete transpose check, passed.
  - Diagnostic: ran the complete document validation with **only that expectation changed in memory**, leaving the repository file untouched. Exit 0. Then ran every remaining command from `test:validation` sequentially; all passed (continuation runner exit 0). This is diagnostic evidence, not a green unmodified full-suite result.
  - Unit totals in that continuation: pepperscore 8 files / 91 tests; editor 25 files / 273 tests. Editor desktop/phone, reader, chunks, large scores, guardrails, embed, clock embed, layout, TAB, TAB baking and instrument-switch checks passed.
  - Logs: `/tmp/0004-t1-validation.log` (unmodified suite failure), `/tmp/0004-t1-validation-tail.log` (adjusted-assertion diagnostic and remaining suites).

```text
DOCUMENT DIAGNOSTIC PASS: only final-barline assertion adjusted in memory; repo file unchanged
tab-bake: all 824 checks passed
Instrument switch: MEI clef mapping (treble, bass, alto, tenor, treble 8vb) passed
Instrument switch: chunked reader render moves tied notes across chunk boundaries; caches keyed by the spec passed
```

The initial full run caught a T1 regression where a measure clef overrode a percussion part. Fixed within owned `document.ts`, added the 15th unit test and reran check/build/manifest and validation; transpose now passes. No code changes followed that successful rerun.
- **Out-of-scope issues found:** no scope expansion required. Local main advanced to 19c51ae during this task (ledger-only changes); the implementer did not edit the ledger. Audit uses `git diff main...HEAD` and dispatch base 415e1f4. npm ci reported 8 existing dependency audit findings; no dependency changes attempted.
- **Follow-ups:** abcjs can compress later staff arrays when voices have different source-line lengths; the existing index-based part mapping can attach that line to the wrong model part. This was exposed by the existing transpose validation fixture; T1 keeps percussion unpitched regardless of a later measure clef, preserving the prior behavior. A general voice-identity remap is outside T1. Lead updates the stale document assertion (outside T1 ownership) and arranges other-family PR review; then T2. Optional human comparison with spike screenshots was not performed.
- **For GBrain (lead to promote):** cancellation naturals in abcjs key arrays must not count toward fifths; tenor is alto/clefPos 8; octave-clef pitch coordinates need a display offset on this reduced-model path.
