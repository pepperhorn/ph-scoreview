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
- **Outcome:** done — review r2 addressed; all requested unit/check/build/TAB/instrument-switch/reader checks passed in one foreground chain at default budgets.

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
- Default tuning is resolved independently for every generated staff. Per the r1 lead decision, explicit `settings.tabTuning` and nonstandard saved/global tunings apply **only when their length matches the part identity's default string count**. All other parts keep their defaults. Six-note standard/Drop D affects guitars while bass/ukulele stay four strings; a four-note tuning affects four-string identities, not guitar or bass5. Legacy implicit standard-guitar preferences still mean instrument defaults. Authored imported TAB retains its tuning until the existing stale-TAB regeneration path applies.
- Render metadata is attached to a shallow score view (`withTabSettings`), preserving protected render.ts and public render signatures. `TabSpec.tunings` carries worker staff-specific tunings; the existing global tuning remains a fallback.
- String order is physical bottom to top, not sorted MIDI pitch. Re-entrant tuning enables distinct-string permutations; ordinary monotonic guitar/bass enumeration is preserved. Existing fret/span/capo limits and costs are unchanged.
- GM programs are authoritative: 25–40 permit names to refine fretted string identity; 41/42/43/44 classify violin/viola/cello/contrabass exactly. Other programs never acquire TAB from their approximate playback icon or a misleading name. GM 45–52 harp/ensembles and 106–108 banjo/shamisen/koto no longer inherit violin/guitar TAB identities. Without a program, explicit string names are used; bass guitar/electric/acoustic/fretless/e-bass matches have word boundaries, while plain Bass/Basso and bass winds do not qualify.
- Host `tabInstruments` is an initial TAB identity override: an actual reader instrument switch drops it and the source name, using the exact target instrument id before any GM fallback. An octave-only edit keeps the override. Explicit host overrides may identify an otherwise unrecognized source part before an instrument switch.
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
Generated fret-number TAB is available for guitar, four-/five-string bass guitar and soprano/tenor/baritone/bass ukulele. GM programs take precedence: programs 25–40 identify fretted strings, with explicit names refining ukulele sizes and bass identities. When no program is supplied, explicit string-instrument names are used. Names such as Bassoon, Bass Clarinet and choir Bass do not enable TAB. Bass defaults to four strings; unqualified Ukulele means soprano re-entrant GCEA. Piano, flute, harp and string-ensemble sounds get no generated TAB. Exact GM 41/42/43/44 or explicit names without a program identify the fretless families; violin/cello await T3, while viola/double bass await approved charts.

Use `settings.tabInstruments: { '<onReady-part-id>': 'bass5' }` (or a ukulele identity above) to override a part's initial TAB identity; `'none'` disables it. An actual reader instrument switch replaces that host override; an octave-only edit retains it. This setting does not change playback sound; ukulele scores can use nylon guitar GM 25. Omit `tabTuning` for instrument defaults, or supply 4–8 open-string MIDI pitches in physical string order. A supplied or saved tuning applies only to generated parts with the same string count: six-note Drop D affects guitar, leaving bass and ukulele at their defaults; a four-note tuning affects four-string bass/ukulele, leaving guitar and five-string bass unchanged. Re-entrant order is preserved. Frets remain relative to the capo. Notation/TAB/Both controls appear only when the score can show TAB.

## Open questions / follow-ups
No blocking questions. The lead explicitly extended ownership of validation/reader.mjs for piano-TAB-dependent assertions. The stale desktop tab-order assertion is fixed. Prior full validation passed; current r1 verification is recorded below. Lead owns review/merge, T3 finger-TAB integration, T4 docs and GBrain promotion. Preserve physical-string ordering when integrating the fretless charts (those charts run high to low).

## Reader assertion changes (lead-authorized follow-up)
- validation/reader.mjs:115: removed only `'tab'` from the piano sample's expected desktop header tab order, matching AC1.
- Reviewed the other header-layout, keyboard, sample and TAB references throughout reader.mjs. No other assertion depended on the piano sample having a TAB control; no other reader.mjs assertion changed.
- This follow-up changes only validation/reader.mjs and this return handoff.


## For GBrain (lead to promote)
Generated TAB now resolves per-part fretted defaults and supports re-entrant physical courses. Host TAB identity overrides use exact onReady IDs and are dropped after actual instrument switches. GM programs gate detection; approximate sound icons never create string TAB identities. Implicit standard-guitar prefs mean auto defaults; explicit and saved tunings affect matching string counts only.

## Review r2 resolution and current verification
Review: https://github.com/pepperhorn/ph-scoreview/pull/77#pullrequestreview-5839098642 (reviewed ea515d5). The reviewer confirmed all r1 items resolved.

- Fixed the switched Double Bass regression: when `switched`, `stringInstrument` first uses the exact target `part.instrument` id. Double Bass maps to the unsupported fretless `double-bass` identity even though its target playback program is GM 33; Bass Guitar maps to bass4; Guitar maps to guitar. Violin/viola/cello map to their corresponding fretless identities.
- Source/imported GM detection is unchanged: an unswitched Acoustic Bass GM 33 still gets bass4. Host overrides remain ignored after an actual instrument switch.
- Added six parameterized Piano switch tests: double-bass, bassguitar, guitar, violin, viola, cello. Each asserts the classifier identity, toggle availability, generated staff selection, and tuning (or absence of a TAB spec). The source deliberately carries a host bass5 override to verify target precedence.
- R2 files changed: lib/tab/string-instruments.ts, lib/tab/string-instruments.test.ts and this return handoff. No other files or acceptance criteria changed.

Foreground verification, exact chain:
```bash
npm run test -w pepperscore && npm run check && npm run build && npm run test:tab && npm run test:instrument-switch && npm run test:reader
```
**Exit code 0** at default budgets, with no failures, interruptions or scaled reruns in r2.
- Library: 14 files / 240 tests passed (15 string-instrument tests).
- check: 0 errors, 0 warnings, 0 hints.
- build: demo library/worker/Verovio parity and notices check passed.
- TAB: all existing pipeline and reader browser cases passed, including PepperScore onReady ids/none/bass5/tuning-count/trumpet-switch coverage.
- instrument-switch: playback, picker, saved host settings, octave tools and chunked rendering passed.
- reader: all checks passed.

Actual final verification tail:
```text
chromium: header first paint matches the server render (no hydration reflow) passed
chromium: reader import, engraving, layout, annotations, fonts, mixer, persistence and playback passed
chromium: four-bar Vertical default, compact readable floor, Endless default and user-zoom restore passed
chromium: stave scale reflow, quiet zoom commits, anchoring and per-score memory passed
chromium: rotation re-fits default zoom, keeps user zoom and keeps tall stacks reachable passed
chromium: system paging, overhang and page-jump playback follow passed
chromium: silent playback fallback passed
chromium: TimGM6mb fallback shares one soundfont download passed
chromium: ID-less MusicXML with a multi-measure rest intro passed
chromium: open dialog passed
chromium: score link passed
chromium: stave focus passed
chromium: options drawer layout and annotation sizes passed
chromium: endless with scrollbars passed
Process exit code: 0
```

## Review r1 resolution and historical verification
Review: https://github.com/pepperhorn/ph-scoreview/pull/77#pullrequestreview-5838160914 (reviewed 27b2220).

1. Blocking bass detection: GM program gates all name/icon inference. Bass guitar/electric/acoustic/fretless/e-bass names use word boundaries; plain Bass/Basso never identify a fretted part without a program. Tests cover Bassoon 71, Bass Clarinet 72, Bass Trombone 58, Bass Flute 74, choir Bass/Basso 53, and ABC `V:B nm="Bass"` with zero-based MIDI program 52.
2. Tuning scope: explicit and saved tunings apply only to identities with the same string count. Tests cover standard six-string and Drop D in mixed guitar/bass/ukulele scores, four-string overrides, and a bass5 host override. Proposed README text above now states this policy.
3. Fretless candidates: exact GM 41–44 only; GM 45–52 harp/ensembles do not inherit violin from a sound icon. The same authoritative-GM rule excludes 106–108 from guitar inference. Explicit names work without a program; explicit host identities remain available.
4. Host override is dropped on actual reader instrument switches; octave-only moves retain it. Unit tests and the browser trumpet switch cover this.
5. Removed unused guitarSound/isGuitarPart.
6. Browser regression mounts PepperScore using the existing read-only instrument-switch harness. It reads the real onReady part ID, proves host none hides controls/engraving, proves bass5 draws five physical lines even with six-note tabTuning, and uses the actual Instrument picker to switch to trumpet and remove bass TAB. No harness file was edited.

R1 files changed: lib/tab/string-instruments.ts, lib/tab/string-instruments.test.ts, lib/tab/tab-parts.ts, lib/prefs.ts (tuning documentation), validation/tab.mjs, and this return handoff. No reader.mjs assertion changed in r1; its prior single piano assertion fix remains.

Foreground verification:
```bash
npm run test -w pepperscore && npm run check && npm run build && npm run test:tab && npm run test:fret-assign && npm run test:tab-bake && npm run test:instrument-switch && npm run test:reader
```
- Library tests: 14 files / 234 tests passed.
- check: 0 errors, 0 warnings, 0 hints.
- build: passed; demo dist/worker/Verovio parity passed.
- TAB browser: passed, including the new onReady/host override/tuning-count/instrument-switch regression.
- fret-assign: 2822 checks plus re-entrant checks passed; 2000 events in 7.8 ms (best of 5).
- tab-bake: all 784 checks passed.
- instrument-switch: all passed.
- The combined foreground process then ended with signal 143 during reader (no assertion failure); reader had passed header and core checks. Ran the reader alone at the default budget: failed its fixed frame-sampling timing gate at reader.mjs:1025: `Twelve-staff playback: sampled playback frames (33)`, exit 1. Host load average observed during retry was 25.64 / 17.29 / 12.02.
- Requested load retry: `VALIDATION_BUDGET_SCALE=2 npm run test:reader`, foreground, **exit 0**. reader.mjs does not consume this variable for its fixed sampling assertion; the retry passed without weakening the test. Both failures/interruption and the successful retry are recorded here.

Actual final reader retry tail:
```text
chromium: system paging, overhang and page-jump playback follow passed
chromium: silent playback fallback passed
chromium: TimGM6mb fallback shares one soundfont download passed
chromium: ID-less MusicXML with a multi-measure rest intro passed
chromium: open dialog passed
chromium: score link passed
chromium: stave focus passed
chromium: options drawer layout and annotation sizes passed
chromium: endless with scrollbars passed
Process exit code: 0
```

## Historical verification before review r1
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
