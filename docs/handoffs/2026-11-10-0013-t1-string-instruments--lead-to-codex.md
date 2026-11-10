# Handoff: 0013-t1 — String instrument table, TAB part selection, fretted tunings (lead → codex)

- **Date:** 2026-11-10
- **Type:** dispatch
- **Ledger:** 0013 · **Spec:** docs/specs/0013-stringed-instrument-tab.md · **Plan:** docs/plans/0013-stringed-instrument-tab.md (task T1)
- **Branch:** orch/0013-t1-string-instruments · **Worktree:** created by T3
- **Base commit:** 9205fc6 (0012 #75, 0013-t2 #74, 0001-t3 #72 merged)
- **Port (if running a server):** 5331
- **Status:** open

## Goal
Generated TAB goes only to stringed parts, with the right string count and default tuning per instrument, and never inside a non-string grand-staff brace. Spec AC1, AC2, AC5. Fretless parts (violin, cello) are detected and marked as "finger TAB" candidates but get **no** TAB staff yet (T3 adds it); viola and double bass get none.

## Context you need
- Spec decisions, default-tuning table, ACs: `docs/specs/0013-stringed-instrument-tab.md`; plan T1: `docs/plans/0013-stringed-instrument-tab.md`.
- Current rules: `docs/specs/guitar-tab.md` ("Which staves get TAB"), `packages/pepperscore/src/lib/tab/tab-parts.ts`, `lib/tab/fret-assign.ts` (`STANDARD_TUNING`, span limits), `lib/notation/mei-tab.ts` (6 lines hard-coded), `lib/instrument-model.ts`.
- 0012 (PR #75): TAB now reads sounding pitch; octave-clef guitar/bass are correct — keep its tests green. Report: `docs/handoffs/2026-11-10-adhoc-octave-clef-and-tab--scale-to-song-to-lead.md` (findings #6–#8, shots in `docs/handoffs/assets/2026-11-10-octave-clef-tab/`).
- T2 spike (merged #74): `lib/tab/strings/` (violin/cello charts) — read only here.
- Memory note (fretboard data duplicated in becreative `src/lib/guitar-tunings.ts` and chordl `instruments.ts`): list any tuning/limit change for the lead to mirror; don't edit other repos.

## Scope
- **In:** instrument detection (GM program 25–32 guitar, 33–40 bass, name match for guitar/bass/ukulele sizes/violin/viola/cello/double bass, plus a per-part host override); a string-instrument table with string count + default tuning (spec table; bass 4-string default, 5-string by override); TAB only for fretted parts; no fallback to the first pitched part; no TAB inside a non-string brace; TAB staff line count from the tuning; solver support for re-entrant ukulele tuning; `settings.tabTuning` still overrides (decide and record how it applies when parts have different instruments); TAB toggle hidden when no part qualifies; tests incl. the report's piano and cello cases (no TAB) and `h-bass-sounding.musicxml` (4-line bass TAB by default).
- **Out:** fretless finger TAB rendering (T3); README/spec docs (T4 — propose text in the return handoff); new sounds (ukulele uses nylon guitar GM 25).
- **Files you own:** `packages/pepperscore/src/lib/tab/**` (except `strings/**`, read-only), `lib/instrument-model.ts`, `lib/instruments.ts` if instrument ids need adding, `lib/notation/mei-tab.ts`, `components/PepperScore.tsx` and `lib/prefs.ts`/`lib/file-state.ts`/`lib/file-state.schema.json` (only for the per-part TAB instrument override setting and toggle visibility), `validation/tab.mjs`, `validation/fret-assign.mjs`, plus your own 0013-t1 handoff files.
- **Do not touch:** `lib/render.ts`, `lib/pdf/**` (0002-t2 in flight), `packages/pepperscore-editor/**` (0003-t3), other validation files, docs, the ledger.

## Acceptance criteria
- [ ] Spec AC1, AC2, AC5 with unit + browser tests; the four 0012 guitar/bass cases still give the same frets.
- [ ] Return handoff lists tuning/limit changes to mirror in becreative/chordl, and proposed README "String TAB" text.

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run test -w pepperscore && npm run check && npm run build
npm run test:tab && npm run test:fret-assign && npm run test:tab-bake && npm run test:instrument-switch
npm run test:manifest && npm run test:validation
```
Build before browser suites; under load rerun timing gates with `VALIDATION_BUDGET_SCALE=2`.

## Open questions
None. Escalate per AGENTS.md §7.

---
## Receiver ack
