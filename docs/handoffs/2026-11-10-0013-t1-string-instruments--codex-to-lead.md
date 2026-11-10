# Handoff: 0013-t1 — String instruments, TAB selection and tunings (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0013 · **Spec:** ../specs/0013-stringed-instrument-tab.md · **Plan:** ../plans/0013-stringed-instrument-tab.md (T1)
- **Dispatch:** [Receiver acknowledgement](2026-11-10-0013-t1-string-instruments--lead-to-codex.md)
- **Branch:** orch/0013-t1-string-instruments
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-5fdad52b-93573c8f57e66b60
- **Base commit:** ea2fb11 (includes pinned ancestor 9205fc6)
- **PR:** pending creation after this commit
- **Status:** blocked
- **Outcome:** partial — implementation and targeted acceptance checks complete; required full validation is blocked by an out-of-scope stale assertion.

## Goal
Generate TAB for fretted string parts with instrument defaults, physical string counts and re-entrant fingering. Remove the first-pitched-part fallback. Keep violin/cello classified for T3 without rendering finger TAB; viola/double bass remain notation only.

## Context you need
Read the linked spec, T1 plan and dispatch. GBrain consulted: [default:projects/scoreflow-music-reader] and [default:projects/scoreflow-music-reader/gotchas-abc-import], especially 1-based model GM programs, sounding-pitch TAB, and build-before-browser validation.

## Scope
- **In:** string table/detection, exact-part-id host TAB identity overrides, per-staff tuning in MEI, re-entrant solver, toggle availability, tests.
- **Out:** finger TAB integration, new sounds, render.ts/PDF/editor changes, README/spec/ledger edits, other repositories.
- **Files owned and changed:** packages/pepperscore/src/lib/tab/string-instruments.ts and .test.ts; tab/tab-parts.ts; tab/fret-assign.ts; lib/notation/mei-tab.ts; lib/prefs.ts; components/PepperScore.tsx; validation/tab.mjs; validation/fret-assign.mjs; the two 0013-t1 handoffs.
- **Protected scope:** no changes to tab/strings/**, render.ts, lib/pdf/**, editor, other validation files or lead-owned docs.

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
Blocking verification follow-up: validation/reader.mjs:115 still expects a TAB header control on the piano sample. The required new behavior removes that control, so its expected desktop tab order must omit tab. This file is explicitly excluded by the dispatch (“other validation files”); per AGENTS.md §7 I left it untouched and stopped scope changes. Lead must update/authorize that assertion and rerun test:validation. Suites after test:reader were not reached by the aggregate run. Lead also owns review/merge, T3 finger-TAB integration, T4 docs and GBrain promotion. Preserve the physical-string ordering contract when integrating the fretless charts (those charts run high to low).

## For GBrain (lead to promote)
Generated TAB now resolves per-part fretted defaults and supports re-entrant physical courses. Host TAB identity overrides use exact onReady IDs, independently of audio instrument switches. Old implicit standard-guitar prefs mean auto defaults; explicit host tabTuning remains a global override.

## Verification output
```text
npm ci && npx playwright-core install chromium: exit 0
npm run test -w pepperscore: 14 files, 230 tests passed (final aggregate run)
npm run check: exit 0; 0 errors, 0 warnings, 0 hints
npm run build: exit 0; Demo build uses the library dist (worker chunks and Verovio files match) and ships its notices
npm run test:tab: exit 0
TAB: non-string exclusion, bass and ukulele defaults, octave-clef regressions passed
TAB: reader switch (piano and guitar, saved view, transposition, phone More panel, drawer at mid width, embeds) on chromium passed
npm run test:fret-assign: exit 0
perf: 2000 events in 6.9 ms (best of 5)
fret-assign: 2822 checks passed
fret-assign: re-entrant open chord and ringing high fourth string passed
npm run test:tab-bake: exit 0; all 784 checks passed
npm run test:instrument-switch: exit 0; reader settings, playback, saved switches, octave tool and chunked rendering passed
npm run test:manifest: exit 0; 128 local packs, 16 icons and playable voices verified; sound packs passed
npm run test:validation: exit 1 at validation/reader.mjs:115
AssertionError: Desktop tab order follows the header registry
actual:   stop,play,openFile,mode,bpm,transpose,keyFlip,bars,staveScale,mixer
expected: stop,play,openFile,mode,tab,bpm,transpose,keyFlip,bars,staveScale,mixer
```
The aggregate passed API/audio/clock/CSS/skin/assets/sounds/spelling/transpose/document/parser-diff/score-db/performance/clock-contract, all 230 reader-library unit tests, all 290 editor unit tests, editor browser and phone suites before this stale reader assertion. An earlier aggregate attempt was interrupted by Vite navigation while final source edits were still happening; the stable-source rerun above supersedes it.

