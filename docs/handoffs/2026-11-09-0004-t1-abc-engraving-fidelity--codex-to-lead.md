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
- **In:** findings 1, 2, 4, 5, 7; cases a, a2, b, b2, c, e, f, g; review 5825096206 fixes for octave-clef instrument switches, tied alterations and mid-bar keys.
- **Out:** T2's grand-staff grouping, instrument transposition and MIDI metadata, README; MusicXML/MEI import; abcjs dependency.
- **Files owned/changed:** `packages/pepperscore/src/lib/import.ts` (ABC only), `packages/pepperscore/src/lib/notation/document.ts`, `packages/pepperscore/src/lib/score.ts` (additive `Measure.rightBarline` and `Measure.keyChanges` fields), new `packages/pepperscore/src/lib/abc-import.test.ts`, new `packages/pepperscore/src/lib/__fixtures__/abc/*.abc`, `packages/pepperscore/src/lib/notation/mei-spelling.ts` (lead-authorized mid-bar key preservation/respelling only), this return and dispatch acknowledgement; `validation/document.mjs` (line-94 final-barline expectation only, explicitly authorized by the lead on 2026-11-09).
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
- Lead authorized the final-measure assertion update in `validation/document.mjs`: `right="end"` is required by AC4.
- abcjs calls `|]` `bar_thin_thick`, and `||` `bar_thin_thin`. Store an additive right-barline field; repeats take precedence in MEI.
- **Review 5825096206 / preferred octave fix:** abcjs retains octave-clef types but does not shift `p.pitch`. ABC now models octave clefs as written pitches, with `pitchBasis: written` and octave `part.transposition` / `measure.transposition`, matching the MusicXML convention. The guitar fixture's `G,` is stored as G4/MIDI 67 with `{semitones:-12, diatonic:-7}`, so `soundingMidi` stays G3/MIDI 55. `treble+8` uses +12/+7, `bass-8` uses -12/-7; plain clefs use zero. Removed the notehead octave offset from MEI generation, retaining `clef.dis`. Existing instrument-switch and concert-view code needs no changes.
- **T2 integration decision:** a later instrument `transpose=` must ADD its interval to the octave-clef interval (both semitones and diatonic steps); it must not replace the octave component. Compose the resulting part and per-measure intervals, since per-measure transposition overrides the part default. The written-pitch conversion here compensates only for the clef octave. T2 still owns parsing instrument transposition and its V:/MIDI precedence.
- **Tied alterations:** a per-part open-tie map carries the starting pitch's alteration into continuations across barlines and source line wraps. Continuations draw no new accidental and do not alter the new bar's accidental state; later untied notes reset to that bar's key. Chains of ties retain the alteration.
- **Mid-bar keys / added ownership:** the lead explicitly authorized `packages/pepperscore/src/lib/notation/mei-spelling.ts` only for preserving and respelling mid-bar key signatures. Verovio was probed and renders in-layer `<keySig>` at the encoded offset, so no accidental fallback was needed. Additive `Measure.keyChanges` records offsets; `document.ts` emits the signatures between layer events, outside beam/tuplet wrappers. The shared spelling pass preserves and respells those signatures in place, uses their active keys to read/respell subsequent pitches, and resets accidental state at each key change. A `[K:]` after a bar's final note remains a next-bar change instead of becoming an unrendered mid-bar event. Existing bar-boundary signature handling remains unchanged; mid-bar lookups are indexed by staff/measure to avoid rescanning all signatures per note.

- Tenor is normalized by abcjs to `type: alto, clefPos: 8`; map that to tenor/C4. Alto uses C3. Explicit source clefs take precedence over guessing from the voice name.

## Open questions
None for T1. T2 remains a separate sequential task after this PR is reviewed/merged.

## Return
- **Outcome:** done
- **Commits:** receiver ack 85c8ed9; implementation b98d8e0; final-barline expectation b852bf0; review 5825096206 fixes f6e9d6e; return documentation committed separately.
- **What changed:** ABC supplies accidental/key/clef/direction/barline metadata; reduced-model MEI preserves it. Eight copied fixtures and 23 regression tests include native Verovio engraving. Updated the single final-measure expectation in `validation/document.mjs:94` to require `right="end"` for `|]`, as specified by AC4.
- **Verification output:**
  - Setup (`npm ci`, Chromium install): exit 0.
  - Targeted ABC suite: 23 tests passed, including native Verovio rendering of all eight fixtures.
  - `npm run test:spelling`: exit 0; all 7911 checks passed, including 490 planned intervals checked against Verovio. Log: `/tmp/0004-t1-review-spelling.log`.
  - `npm run check`: exit 0; reader diagnostics: 0 errors, 0 warnings, 0 hints.
  - `npm run build`: exit 0; demo worker/Verovio assets and notices match.
  - `npm run test:manifest`: exit 0; 128 packs / 16 icons and sound-pack checks passed.
  - Full unmodified `npm run check && npm run build && npm run test:manifest && npm run test:validation`: exit 0 after the review fixes (starting reviewed head b852bf0, code fixes f6e9d6e). No in-memory patch or continuation runner was used for this final verification.
  - All document, transpose, parser, performance, clock, editor/reader browser, chunking, large-score, guardrail, embed, layout, TAB and instrument-switch checks passed. Unit totals: pepperscore 8 files / 99 tests; editor 25 files / 273 tests.
  - Final validation log: `/tmp/0004-t1-review-validation-final.log`. Actual final output tail:

```text
Instrument switch: MEI clef mapping (treble, bass, alto, tenor, treble 8vb) passed
Instrument switch: chunked spelling moves both tied notes and drops the source clef changes passed
Instrument switch: reader settings switch both piano staves (clef, written pitch, ps-transposed / ps-out-of-range, host highlights), no double transposition, concert-basis rule passed
Instrument switch: playback plays alto sax program 66 at the fitted sounding pitch; unswitched transposing parts unchanged in both views passed
Instrument switch: full reader picker (Instrument and Sound sections, trumpet, harp sound, level and fit, as written, hidden by the host, drum kit) passed
Instrument switch: saved switch vs host settings (same host: the reader's flute; changed host: alto sax) passed
Instrument switch: octave tool (select, Shift/second-click passage, phrase, 8va/8vb, out of range, auto-fit kept as written, reset, Escape, focus, saved, hidden, embed menu and compact entry) passed
Instrument switch: chunked reader render moves tied notes across chunk boundaries; caches keyed by the spec passed
```

The initial full run caught a T1 regression where a measure clef overrode a percussion part. It was fixed within owned `document.ts`, covered by the 15th unit test, and passes the final full suite. The subsequent final-barline assertion mismatch was resolved through the lead's explicit one-line ownership expansion. Both earlier blockers and all three findings from [review 5825096206](https://github.com/pepperhorn/ph-scoreview/pull/60#pullrequestreview-5825096206) are resolved. The superseded verification run was stopped to add the final boundary regression; the final full unmodified run above completed with exit 0.
- **Out-of-scope issues found:** lead explicitly expanded ownership to the single final-barline assertion in `validation/document.mjs` on 2026-11-09; no other validation edits made. The lead also explicitly authorized the shared `notation/mei-spelling.ts` change only for preserving/respelling mid-bar key signatures; it is listed under files changed and Decisions made above. Optional ownership for `instrument-view.ts` and `transpose.ts` was not needed; both files remain unchanged. Local main advanced to 19c51ae during this task (ledger-only changes); the implementer did not edit the ledger. Audit uses `git diff main...HEAD` and dispatch base 415e1f4. npm ci reported 8 existing dependency audit findings; no dependency changes attempted.
- **Follow-ups:** abcjs can compress later staff arrays when voices have different source-line lengths; the existing index-based part mapping can attach that line to the wrong model part. This was exposed by the existing transpose validation fixture; T1 keeps percussion unpitched regardless of a later measure clef, preserving the prior behavior. A general voice-identity remap is outside T1. Lead arranges other-family re-review of the review fixes; then T2. Optional human comparison with spike screenshots was not performed.
- **For GBrain (lead to promote):** cancellation naturals in abcjs key arrays must not count toward fifths; tenor is alto/clefPos 8; octave-clef ABC pitches must be converted to written pitch with octave transposition metadata, rather than a display-only MEI offset; mid-bar key signatures must survive the shared spelling pass.
