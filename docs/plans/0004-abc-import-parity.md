# Plan 0004 — ABC import parity with MusicXML

- **Spec:** ../specs/0004-abc-import-parity.md
- **Base:** main @ 49c3e9b
- **Verification (whole item):** `npm run test -w pepperscore -- --run src/lib/abc-import.test.ts && npm run check && npm run build && npm run test:manifest && npm run test:validation`

## Approach
Both tasks touch `parseAbc` in `import.ts` and `scoreToMei` in `notation/document.ts`, so they run one after the other. T1 fixes engraving of a single part's content; T2 fixes part structure and instrument/sound. Each adds cases to one shared vitest file; spike cases are copied into a fixtures folder (the spike folder itself is read-only).

## Tasks

### T1 — Engraving fidelity (accidentals, key changes, annotations, barlines, clefs)
- **Depends on:** —
- **Route:** implement (default)
- **Owns:** `packages/pepperscore/src/lib/import.ts` (ABC code only), `packages/pepperscore/src/lib/notation/document.ts`, `packages/pepperscore/src/lib/score.ts` (additive type fields only), `packages/pepperscore/src/lib/abc-import.test.ts` (new), `packages/pepperscore/src/lib/__fixtures__/abc/**` (new)
- **May read:** anything
- **Acceptance:** AC1, AC2, AC3, AC4, AC5, AC8 (T1 part), AC10 (for the cases T1 covers)
- **Verify:** plan verification command
- **Notes / gotchas:**
  - Finding 1: abcjs gives `accidental` on each pitch; set `Pitch.accidental` from it. `meiPitch` already writes `accid` when `pitch.accidental` is set. Check that implied accidentals (a bar's carried ♯ on a repeated note) are *not* redrawn, and that `=` gives ♮.
  - Finding 2: abcjs exposes inline/mid-tune `K:` as key changes in `tune.lines[].staff[].key` or as `key` elements in voices; fill `Measure.key` and emit a `<scoreDef key.sig>`/`<keySig>` change in MEI. Pitch alter must follow the active key.
  - Finding 4: only `position === 'default'` chord entries are chord symbols. Others become `Measure.directions` text and MEI `<dir>` with `place` from `^`/`_`.
  - Finding 7: map abcjs clef `type` (treble, bass, alto, tenor, treble-8, treble+8, bass-8 …) to MEI `clef.shape`/`clef.line`/`clef.dis`/`clef.dis.place`. Watch for whether abcjs already shifts pitches for octave clefs; playback must sound G3 for `e-guitar`, written G4.

### T2 — Grand staff, transposition and MIDI sound, README
- **Depends on:** T1 (merged)
- **Route:** implement (default)
- **Owns:** same as T1, plus `packages/pepperscore/README.md` (ABC section only)
- **Acceptance:** AC6, AC7, AC8, AC9, AC10 (remaining cases)
- **Verify:** plan verification command
- **Notes / gotchas:** model braced voices like MusicXML multi-staff parts (shared `sourcePartId`, ids `<pid>-1/-2`; see `instrument-view.ts` `sourcePartOf` and `render.ts:173`). Check how the MusicXML path sets `Part.transposition`/`pitchBasis` and match it so `settings.instrument` and the concert-pitch toggle keep working (`validation/transpose.mjs`, `validation/instrument-switch.mjs`).

## Merge order
T1 → T2

## Risks
- abcjs's model for mid-tune keys and clef octave may differ from what the handoff assumes; the implementer should probe abcjs output first and record what it found.
- Changing MEI ids would break highlighting; keep `generatedPitchId`.
