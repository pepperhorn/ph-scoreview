# Handoff: 0013-t1 — String instruments, TAB selection and tunings (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0013 · **Spec:** ../specs/0013-stringed-instrument-tab.md · **Plan:** ../plans/0013-stringed-instrument-tab.md (T1)
- **Dispatch:** [Receiver acknowledgement](2026-11-10-0013-t1-string-instruments--lead-to-codex.md)
- **Branch:** orch/0013-t1-string-instruments
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-5fdad52b-93573c8f57e66b60
- **Base commit:** ea2fb11 (includes pinned ancestor 9205fc6)
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/77
- **Implementation commits:** 55956df (receiver ack), fc4e8e3 (implementation and return handoff); this follow-up records the PR URL.
- **Status:** closed
- **Outcome:** done — implementation, targeted acceptance checks and the full required verification chain passed.

## Goal
Generate TAB for fretted string parts with instrument defaults, physical string counts and re-entrant fingering. Remove the first-pitched-part fallback. Keep violin/cello classified for T3 without rendering finger TAB; viola/double bass remain notation only.

## Context you need
Read the linked spec, T1 plan and dispatch. GBrain consulted: [default:projects/scoreflow-music-reader] and [default:projects/scoreflow-music-reader/gotchas-abc-import], especially 1-based model GM programs, sounding-pitch TAB, and build-before-browser validation.

## Scope
- **In:** string table/detection, exact-part-id host TAB identity overrides, per-staff tuning in MEI, re-entrant solver, toggle availability, tests.
- **Out:** finger TAB integration, new sounds, render.ts/PDF/editor changes, README/spec/ledger edits, other repositories.
- **Files owned and changed:** packages/pepperscore/src/lib/tab/string-instruments.ts and .test.ts; tab/tab-parts.ts; tab/fret-assign.ts; lib/notation/mei-tab.ts; lib/prefs.ts; components/PepperScore.tsx; validation/tab.mjs; validation/fret-assign.mjs; validation/reader.mjs (limited follow-up ownership granted by the lead); the two 0013-t1 handoffs.
- **Protected scope:** no changes to tab/strings/**, render.ts, lib/pdf/**, editor, validation files other than the three listed above, or lead-owned docs.

## Acceptance criteria
- AC1/AC2/AC5: non-string generated-TAB fallback removed; bass and ukulele defaults; mixed-instrument tuning; host identity overrides and global tuning; re-entrant chord/sustain; existing guitar/imported TAB behavior.
- Browser regressions use the report's exact piano/cello ABC and all four octave-clef guitar cases (including instrument-switched ABC), plus sounding bass MusicXML. Bass gets four MEI and SVG lines by default.
- Unit tests cover every GM guitar/bass program, instrument names, future finger-TAB candidates, exact-id overrides, a five-string bass, global standard tuning explicitly overriding mixed defaults, and preserving a piano brace.
- Return includes mirror notes and proposed String TAB README text below.

## Verify with
Run the dispatch commands from the repo root:
```bash
npm ci && npx playwright-core install chromium
npm run test -w pepperscore && npm run check && npm run build
npm run test:tab && npm run test:fret-assign && npm run test:tab-bake && npm run test:instrument-switch
npm run test:manifest && npm run test:validation
```

## Decisions made
- New public host setting: `settings.tabInstruments: Record<onReady part id, TabInstrument | 'none'>`. IDs: guitar, bass4, bass5, ukulele-soprano, ukulele-tenor, ukulele-baritone, ukulele-bass, violin, viola, cello, double-bass. Exact part IDs only; it changes TAB identity, not playback. Invalid keys/values are ignored. This is host configuration, not a saved per-file preference.
- Default tuning is resolved independently for every generated staff. Explicit `settings.tabTuning` overrides **every generated part**, including an explicit standard guitar tuning on bass/ukulele. Existing nonstandard saved/global tunings retain that global override behavior. Legacy implicit standard-guitar preference values mean instrument defaults. Imported authored TAB retains its original tuning until the existing stale-TAB regeneration path applies.
- Render metadata is attached to a shallow score view (`withTabSettings`), preserving protected render.ts and public render signatures. `TabSpec.tunings` carries worker staff-specific tunings; the existing global tuning remains a fallback.
- String order is physical bottom to top, not sorted MIDI pitch. Re-entrant tuning enables distinct-string permutations; ordinary monotonic guitar/bass enumeration is preserved. Existing fret/span/capo limits and costs are unchanged.
- Explicit names identify ukulele sizes and fretless strings before generic GM sounds. GM 33 Acoustic Bass qualifies as bass4 despite the old sound model's double-bass classification; an explicit Double/Upright/Contrabass name remains unsupported fretless bass.
- Authored imported TAB remains available for otherwise unidentified parts; generating new TAB still uses the fretted classification in ordinary scores. No new finger-TAB staff is produced in this task.

## For the ABC guide
No ABC import behavior changed. The existing sounding-pitch/octave-clef rules remain; the exact report ABC fixtures are regression-tested.

## Tuning/limit changes to mirror in becreative/chordl
Lead should compare becreative src/lib/guitar-tunings.ts and chordl instruments.ts with the new string table:
- guitar unchanged [40,45,50,55,59,64];
- bass4 [28,33,38,43], bass5 [23,28,33,38,43];
- soprano/tenor uke physical string order [67,60,64,69], baritone [50,55,59,64], bass uke [28,33,38,43];
- future fretless identities violin [55,62,69,76], viola [48,55,62,69], cello [36,43,50,57], double bass [28,33,38,43].
Do not sort re-entrant pitches. No existing fret/span/capo limit changed. No sibling repository was edited.

## Proposed README “String TAB” text (lead/T4)
Generated fret-number TAB is available for guitar, four-/five-string bass guitar and soprano/tenor/baritone/bass ukulele. Parts are detected from their names and GM guitar/bass programs. Bass defaults to four strings; unqualified Ukulele means soprano re-entrant GCEA. No generated guitar TAB is added to piano, flute or other non-string parts. Violin/cello await finger-TAB integration; viola/double bass await approved charts.

Use `settings.tabInstruments: { '<onReady-part-id>': 'bass5' }` (or a ukulele identity above) to override TAB identity for a part; `'none'` disables it. This setting does not change the playback sound; ukulele scores can use nylon guitar GM 25. Omit `tabTuning` for per-instrument defaults, or supply 4–8 open-string MIDI pitches in physical string order to override every generated staff. Re-entrant order is preserved. Frets remain relative to the capo. Notation/TAB/Both controls appear only when the score can show TAB.

## Open questions / follow-ups
No blocking questions. The lead explicitly extended ownership of validation/reader.mjs for piano-TAB-dependent assertions. The stale desktop tab-order assertion is fixed and full validation passes. Lead owns review/merge, T3 finger-TAB integration, T4 docs and GBrain promotion. Preserve physical-string ordering when integrating the fretless charts (those charts run high to low).

## Reader assertion changes (lead-authorized follow-up)
- validation/reader.mjs:115: removed only `'tab'` from the piano sample's expected desktop header tab order, matching AC1.
- Reviewed the other header-layout, keyboard, sample and TAB references throughout reader.mjs. No other assertion depended on the piano sample having a TAB control; no other reader.mjs assertion changed.
- This follow-up changes only validation/reader.mjs and this return handoff.


## For GBrain (lead to promote)
Generated TAB now resolves per-part fretted defaults and supports re-entrant physical courses. Host TAB identity overrides use exact onReady IDs, independently of audio instrument switches. Old implicit standard-guitar prefs mean auto defaults; explicit host tabTuning remains a global override.

## Verification output
Lead-authorized follow-up ran this exact unmodified chain in the foreground:
```bash
npm run check && npm run build && npm run test:manifest && npm run test:validation
```
Exit code **0**. All four commands and every validation sub-suite passed. The environment used default timing budgets; no timing gate failed and no VALIDATION_BUDGET_SCALE=2 rerun was needed.

Evidence from this run:
- check: 0 errors, 0 warnings, 0 hints.
- build: demo library/worker/Verovio files match; notices shipped.
- manifest: 128 local packs, 16 icons and playable voices verified; sound packs passed.
- unit tests: 14 library files / 230 tests and 26 editor files / 290 tests passed.
- reader: header first-paint/tab order, core functionality, zoom/rotation, paging/playback follow, dialogs, links, focus, drawer, and Endless scrollbars passed.
- chunks, large scores, guardrails, embed/clock, layout, TAB, 784 TAB-bake checks, instrument switch and PDF all passed.
- large score: first paint 937 ms; import shown after 647 ms; worst timer lag 8 ms; no import main-thread long tasks.

Actual final verification tail (Vite connection chatter and PDF diagnostic JSON omitted):
```text
> pepperscore-monorepo@0.0.0 test:pdf
> npm run test -w pepperscore -- --run src/lib/pdf/fit.test.ts && node validation/pdf.mjs


> pepperscore@0.4.1 test
> vitest run --run src/lib/pdf/fit.test.ts


 RUN  v3.2.7 /home/shaun/.t3/worktrees/ph-vexflow-view/t3-5fdad52b-93573c8f57e66b60/packages/pepperscore

 ✓ src/lib/pdf/fit.test.ts (6 tests) 215ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  18:17:47
   Duration  827ms (transform 88ms, setup 0ms, collect 88ms, tests 215ms, environment 0ms, prepare 153ms)

PDF page model spike passed (chromium): A4 4 lines; A3 4; 2 pages for 80 bars.
Process exit code: 0
```

Earlier standalone targeted verification (unchanged implementation): test:fret-assign passed 2822 existing checks plus re-entrant chord/ringing-string checks; 2000 events in 6.9 ms (best of 5). The earlier full-validation failure at reader.mjs:115 is superseded by the successful foreground chain above.
