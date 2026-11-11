# Handoff: 0018 — Choir name variants and horn sounds (codex → lead)

- **Date:** 2026-11-11
- **Type:** return
- **Ledger:** 0018 [quick] (S26, S27)
- **Dispatch:** [lead-to-codex](2026-11-11-0018-choir-and-horn-names--lead-to-codex.md)
- **Branch:** `orch/0018-choir-horn-names`
- **Worktree:** `/home/shaun/.t3/worktrees/ph-vexflow-view/t3-09f66b85-9704b8dd5a4ecf97`
- **Base:** contains requested `7dfd360`
- **Acknowledgement commit:** `400eea3`
- **Implementation commit:** `15300c770f851e8939e6b9639d6b801870aca70a`

## Goal and scope
Recognize the additional name-only choir labels and select the correct existing horn sounds, retaining the PR #80 naming policy. Changed owned files only: `packages/pepperscore/src/lib/score.ts` (instrumentForName/voice pattern), `lib/tab/string-instruments.ts` (existing shared sound-resolution pass), `lib/score.test.ts`, `lib/instrument-names-import.test.ts`, and the two 0018 handoffs. No public ids, dependencies, renderer/components, import call sites, guide or ledger changes.

## Acceptance criteria
- [x] Every requested name covered directly and through ABC, MusicXML DOM and MusicXML worker-reader imports; existing PR #80 policy matrix retained.
- [x] Solo SATB plus piano, slash staves and Mezzo-Soprano/Bass resolve as voices without TAB.
- [x] Added choir range words establish context; Treble needs a vocal hint or another named choir range while arbitrary labels and instrumental nouns retain their defaults/instruments.
- [x] Horn sounds use existing registry ids and packs; explicit source programs retain precedence.
- [x] Added names listed below for the lead's ABC guide update.

## Decisions made
- English Horn / Cor Anglais → GM 70 (`english_horn`, zero-based 69), existing clarinet icon/id. The existing score-level name resolver sets this exact sound just as it does for recorder and French horn.
- Basset Horn → existing clarinet id/default GM 72 (`clarinet`, zero-based 71).
- Flugelhorn → existing trumpet id/default GM 57 (`trumpet`, zero-based 56); the registry has no separate flugelhorn sound.
- French Horn / Horn in F / Horn → existing trombone icon/id with GM 61 (`french_horn`, zero-based 60).
- Split voice staves require a complete voice label on each side of `/` or `&`; plural voice words are accepted. Plain/numbered Bass still needs score-level choir context; Bass Solo explicitly means voice. Instrument nouns still precede all voice matching. TAB and general choir context use instrumentForName; the score-level resolver handles Treble only after finding another named choir range.

## Known gotchas / GBrain
Consulted `default:projects/scoreflow-music-reader` for historical context; current dispatch and ABC guide control the naming policy. No GBrain writes as implementer.

## For the ABC guide
ABC import behavior changes for names without explicit MIDI programs:
- Added voice labels: Soprano Solo, Alto Solo, Tenor Solo, Bass Solo; slash staves Soprano/Alto and Tenor/Bass; Mezzo-Soprano (also Mezzo Soprano), Mezzo, Contralto, Countertenor plus plurals Sopranos/Altos/Tenors/Basses and ampersand staves Soprano & Alto / Tenor & Bass. The added range words accept existing numbering/divisi and vocal hints. Treble alone (including numbered/divisi labels) does not create choir context: Treble/Bass part names retain piano/bass-guitar defaults. Treble becomes voice with a vocal hint (Treble Voice, Treble (Choir)) or another named choir range (Soprano/Alto/Tenor/Baritone/Mezzo/Contralto/Countertenor), preserving instrument nouns such as Treble Recorder. Other choir words establish context for ambiguous Bass when no guitar/drum evidence exists. Bass Solo still means voice even in Guitar/Drums/Bass Solo; use an explicit instrument noun or MIDI program for an instrumental bass solo.
- Added horn distinctions: English Horn/Cor Anglais use GM 70; Basset Horn uses clarinet; Flugelhorn/Flügelhorn use trumpet (name matching normalizes diacritics); French Horn/Horn in F/Horn retain GM 61. Explicit MIDI programs continue to win.
- Lead to update [ABC guide](../guides/abc-authoring.md) Rules and Change log on merge.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run test -w pepperscore
npm run check
npm run build
npm run test:tab
npm run test:document
npm run test:parser-diff
npm run test:manifest
npm run test:validation
git diff --check
```

## Open questions / follow-ups
No implementation blockers or new out-of-scope issues. Lead owns guide/GBrain promotion and review/merge. No PR watch or polling performed.

## Outcome and verification output
**Done.** All commands above exited 0 against implementation commit `15300c7`; only this return handoff changes afterward. No implementation fixes were required after the first green package test run. Scope audit against main contains only the owned files listed above. No PR watch or polling performed; review and CI status are left to the lead.

```text
npm ci: added 378 packages; Chromium installation exit 0

$ package tests (exit 0)
   ✓ ABC parts and instruments > groups a2-piano-fixed while preserving staff and playback identity  736ms

 Test Files  16 passed (16)
      Tests  609 passed (609)
   Start at  15:35:59
   Duration  21.83s (transform 14.38s, setup 0ms, collect 49.32s, tests 42.22s, environment 30ms, prepare 11.42s)


$ check (exit 0)
Result (23 files):
- 0 errors
- 0 warnings
- 0 hints


$ build (exit 0)
15:39:22 [build] ✓ Completed in 7.78s.
15:39:22 [build] 10 page(s) built in 8.97s
15:39:22 [build] Complete!
Demo build uses the library dist (worker chunks and Verovio files match) and ships its notices

$ TAB (exit 0)
TAB: reader switch (piano and guitar, saved view, transposition, phone More panel, drawer at mid width, embeds) on chromium passed

$ document (exit 0)
Document import: timewise, MXL source bytes and hash, percussion, voices, ABC adapter and MEI identity passed
Document review regressions: drum kit program, MEI accidentals/key/meter changes, saved BPM clamp, MXL encoded path and size bound, ABC/MEI navigation engraving passed
Verovio channels: an out-of-memory failure stays in its channel, other channels retry, closed channels stay closed passed

$ parser-diff (exit 0)
ok   worker import case playback marks: articulations, fermata, cue, ornaments, pedals
Streaming MusicXML reader matches the DOM importer

$ manifest (exit 0)
GM manifest: 128 local packs, 16 icons and playable voices verified.
Sound packs: complete pack.json, generated core (19 FluidR3 sounds) and versions passed

$ full validation (exit 0)
PDF page model spike passed (chromium): A4 4 lines; A3 4; 2 pages for 80 bars.

git diff --check: passed
```

Full validation covers API/audio/clock/CSS/skin/assets/sounds/spelling/transpose/document/parser/score DB/performance/package/editor/reader/chunks/large/guardrails/embed/layout/TAB/bake/instrument-switch/PDF. Logs: `/tmp/0018-{unit,check,build,tab,document,parser-diff,manifest,validation}.log`. These are local results, not a claim of green GitHub CI. Installation reported existing dependency audit findings (8); dependency files unchanged.

## Review r1 — requested pre-release refinements
Review: https://github.com/pepperhorn/ph-scoreview/pull/82#pullrequestreview-5854626532
Reviewed head: `50d4ebad6b873c51599f7a293af7ba357ba26e4b`.
Implementation: `52be267`.

Applied the human's follow-up policy before 0.5.0:
- Treble alone/numbered is piano by default and supplies no voice context. Treble + Bass stays piano + bass guitar/bass4. Vocal hints explicitly select voice; another named choir range permits contextual Treble voices. Treble + Alto + Tenor + Bass is a choir without TAB. Explicit GM and instrument nouns still win. Tests include each allowed choir range, numbered Treble, hinted Treble, and misleading explicitly programmed choir names.
- Name matching normalizes Unicode diacritics; both composed Flügelhorn and decomposed Flügelhorn select the existing trumpet sound. No new sound/icon/dependency.
- Ampersands split voice labels just as slashes do. Plural voice words, including Sopranos/Altos/Tenors/Basses, work alone, on split staves, and across score parts. Tests cover singular/plural slash and ampersand labels on ABC, MusicXML DOM and worker-reader imports.
- Bass Solo in a guitar/drum band remains voice/no TAB, as expressly requested, with a regression test. The ABC-guide note above calls out this ambiguity and recommends explicit instrument nouns or MIDI for an instrumental solo.

Owned files only: the two classifiers, their existing tests and this return handoff. ABC-guide additions above are updated for the final behavior; the lead still owns the actual guide edit. GBrain historical project lookup repeated (`default:projects/scoreflow-music-reader`); no implementer write-back.

All six requested commands ran in the foreground and exited 0 against `52be267`. Only documentation changes afterward. The first unit run found two invalid MusicXML test fixtures with unescaped ampersands; the fixture builder now escapes ampersands, and all checks below pass. No parser or validation-harness changes.

```text

$ npm run test -w pepperscore (exit 0)

 Test Files  16 passed (16)
      Tests  683 passed (683)
   Start at  17:17:56
   Duration  20.39s (transform 14.29s, setup 0ms, collect 51.88s, tests 39.48s, environment 75ms, prepare 18.22s)


$ npm run check (exit 0)
Result (23 files):
- 0 errors
- 0 warnings
- 0 hints


$ npm run build (exit 0)
17:20:11 [build] ✓ Completed in 3.40s.
17:20:11 [build] 10 page(s) built in 3.71s
17:20:11 [build] Complete!
Demo build uses the library dist (worker chunks and Verovio files match) and ships its notices

$ npm run test:tab (exit 0)
TAB: reader switch (piano and guitar, saved view, transposition, phone More panel, drawer at mid width, embeds) on chromium passed

$ npm run test:document (exit 0)
Document import: timewise, MXL source bytes and hash, percussion, voices, ABC adapter and MEI identity passed
Document review regressions: drum kit program, MEI accidentals/key/meter changes, saved BPM clamp, MXL encoded path and size bound, ABC/MEI navigation engraving passed
Verovio channels: an out-of-memory failure stays in its channel, other channels retry, closed channels stay closed passed

$ npm run test:parser-diff (exit 0)
ok   worker import case playback marks: articulations, fermata, cue, ornaments, pedals
Streaming MusicXML reader matches the DOM importer

git diff --check: passed
```
Logs: `/tmp/0018-r1-{unit,check,build,tab,document,parser-diff}.log`. Earlier manifest/full-validation results apply to the initial revision only; this follow-up ran exactly the six requested checks. No PR watch or polling performed. Ready for lead review/merge; CI on the new head is not claimed green.
