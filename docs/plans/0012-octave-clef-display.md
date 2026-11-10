# Plan 0012 — Octave-clef parts draw at the right octave

- **Spec:** ../specs/0012-octave-clef-display.md
- **Base:** main @ 0fe23ce
- **Verification (whole item):** `npm run check && npm run build && npm run test:manifest && npm run test:validation`

## Approach
Single task. First prove where the octave is applied twice (MEI `@oct` vs `clef.dis` in Verovio; MusicXML octave-change on import) with small probes, then fix ABC in the MEI adapter/import, add a MusicXML pre-pass in the source normalisation step, and keep the instrument-switch clef's octave displacement. TAB reads sounding pitch.

## Tasks

### T1 — Octave-clef display on ABC and MusicXML, instrument switch keeps "8"
- **Depends on:** —
- **Route:** implement (default)
- **Owns:** `packages/pepperscore/src/lib/import.ts` (ABC + MusicXML transposition reading only), `lib/notation/document.ts`, `lib/notation/musicxml-source.ts` (or a new `lib/notation/musicxml-octave-clef.ts` pre-pass), `lib/instrument-view.ts`, `lib/instrument-switch-state.ts`, `lib/transpose.ts`, `lib/tab/tab-parts.ts` (sounding-pitch source only), `lib/abc-import.test.ts`, new tests + fixtures under `lib/__fixtures__/`, `packages/pepperscore/README.md` ("ABC headers" Clefs and "Guitar TAB" only)
- **Acceptance:** AC1–AC6
- **Verify:** `npm run test -w pepperscore` + item verification
- **Notes / gotchas:** compare a real MuseScore guitar export if available (search `validation/fixtures`, `tests/`); the earlier double-shift with `settings.instrument` (PR #60 r1) must not come back; record the Verovio upstream entry text in the return handoff for the lead to add.

## Merge order
T1

## Risks
- Changing ABC octave-clef pitches could move note ids or saved per-part settings; keep `generatedPitchId` stable.
