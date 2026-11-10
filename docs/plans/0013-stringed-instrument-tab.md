# Plan 0013 — TAB for stringed instruments

- **Spec:** ../specs/0013-stringed-instrument-tab.md
- **Base:** main @ 0fe23ce
- **Verification (whole item):** `npm run check && npm run build && npm run test:manifest && npm run test:validation`

## Tasks

### T1 — String instrument table, TAB part selection, fretted tunings
- **Depends on:** 0012 T1 (shares `tab-parts.ts`), 0001 T3 merged (settings types in `PepperScore.tsx`)
- **Route:** implement (default)
- **Owns:** `lib/tab/**`, `lib/instrument-model.ts` (ukulele + bass-5 entries), `lib/notation/mei-tab.ts` (line count from tuning), settings types/plumbing for a per-part TAB instrument override, `docs/specs/guitar-tab.md` is lead-owned (implementer proposes text)
- **Acceptance:** AC1, AC2, AC5

### T2 — Spike: finger + position TAB for fretless strings
- **Depends on:** — (runs in parallel; new files only)
- **Owns:** new `packages/pepperscore/src/lib/tab/strings/**` prototype (chart port + unit tests), its handoffs
- **Acceptance:** a written recommendation with rendered evidence: how finger + position shows in Verovio (e.g. TAB staff with finger number as `tab.fret` text plus position indications as `dir`/roman numerals, vs a separate annotation lane), the chart port with the cello mislabel fix, and the cost of each option. No reader integration.

### T3 — Fretless TAB in the reader
- **Depends on:** T1, T2 (and the human's call if T2 offers options)
- **Acceptance:** AC3

### T4 — Docs
- **Depends on:** T1, T3
- **Acceptance:** AC4

## Merge order
0012 T1 → T1 → T3 → T4; T2 anytime.

## Risks
- Re-entrant tuning breaks the solver's monotonic string assumption.
- Fretboard data duplication across apps (memory `fretboard-alignment`): flag mirrored changes.
