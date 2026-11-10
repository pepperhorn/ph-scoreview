# Handoff: 0016 — Instrument names and tuning diagnostic (codex → lead)

- **Date:** 2026-11-11
- **Type:** return
- **Ledger:** 0016 [quick]
- **Dispatch:** [lead-to-codex](2026-11-11-0016-instrument-names--lead-to-codex.md)
- **Branch:** `orch/0016-instrument-names`
- **Worktree:** `/home/shaun/.t3/worktrees/ph-vexflow-view/t3-f4c5a8a8-bae6c18130633ca8`
- **Base:** `e88ac67` (contains requested base `12f4bea`)
- **Implementation commit:** `09c4025da9e4f28ebffb063c35bd8906312ccc28`
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/80
- **Status:** closed (implementation done; ready for lead review)

## Goal and scope
Align name-only bass/ukulele playback and TAB detection, and explain ignored custom tuning counts in development. Owned changes: `lib/score.ts` (`instrumentForName` only), `lib/tab/string-instruments.ts`, `lib/tab/tab-parts.ts` (diagnostic only), tests in those areas and `lib/abc-import.test.ts`, and the two 0016 handoffs. Review r1 scope additionally includes `lib/import.ts` and `lib/notation/musicxml-source.ts` for calling the score-level choir pass only, plus its import tests. No render, components, PDF, prefs/file-state, instrument model, dependencies or ledger changes.

## Acceptance criteria
- [x] Bass, Acoustic Bass, Electric Bass and Bass Guitar select bass guitar sound and bass4 TAB.
- [x] Double Bass, Contrabass, Upright Bass and String Bass select double bass with no generated TAB.
- [x] Choir Bass, Bass voice, Vocal Bass and SATB Bass remain voice/non-TAB; bass wind names remain non-TAB; explicit non-string MIDI programs keep precedence.
- [x] Ukulele sizes select existing nylon guitar sound and their independent ukulele TAB identities.
- [x] ABC `V:1 name="Bass"` without MIDI selects bass guitar (also tested acoustic/electric bass, bass guitar and ukulele).
- [x] Mismatched tuning warns in development with part name/id and bass5 suggestion for five-string tuning on bass4, keeps defaults, stays silent in production and safely skips missing-process hosts. Matching bass5 override applies tuning without warning.

## Decisions made
- Reused `guitar`: GM 25 (nylon guitar). `instrumentDetails.program` is zero-based (24), while the instrument model's `gmProgram` is one-based (25). No new instrument id needed. Bass guitar uses existing GM 34.
- Names containing the word Bass fall back to bass guitar after wind/voice checks (including Bass 1, Bass I, Synth Bass and Bass line). Explicit double-bass and ukulele rules keep precedence. A score-level pass called after ABC and MusicXML import requires an unresolved Bass/B, plus Soprano/Sop. or at least three distinct SATB roles (letters, full names or abbreviations). It skips scores with numbered vocal labels or drums/percussion, brass, saxophone, guitar or keyboard evidence by name/GM. In a qualifying choir it assigns microphone to unprogrammed vocal labels and Bass/B. TAB respects the resolved microphone identity. Full-name winds such as Tenor Saxophone do not establish choir context.
- Tuning warning uses the approved inline try/catch around `process.env.NODE_ENV`, plus a type-only declaration, preserving browser-native safety and production elimination. A module-level set limits it to one warning per part id per session. Host `tabTuning` points to `settings.tabInstruments` (bass5 for the five-string/bass4 mismatch); reader-saved tuning points to choosing a matching tuning in the reader.

## Known gotchas
GBrain searched: `default:projects/scoreflow-music-reader` (historical project context); current repo dispatch controls name rules. Per implementer role, no GBrain writes.

## For the ABC guide
For existing ABC and MusicXML files **without an explicit MIDI program**, defaults now change as follows:
- Bass/Acoustic Bass/Electric Bass/Bass Guitar and other names containing the word Bass (Bass 1, Bass I, Synth Bass, Bass line, Jazz Bass, Bass (8vb)) → bass guitar + bass4 TAB, instead of double bass/no TAB. The reviewed r1 piano regression for the broader names is fixed.
- Double Bass/Contrabass/Upright Bass/String Bass → double bass, no generated TAB.
- Bass Clarinet/Trombone/Flute → the respective wind sound instead of double bass; Bass Sax/Saxophone → existing alto-sax approximation, no TAB. Bassoon remains non-TAB.
- Vocal/choir/SATB labels → voice. Bass/B becomes microphone with no TAB only when Soprano/Sop. is present or at least three distinct SATB roles establish choir context. A Bass/B candidate must exist; lone A, A+B and A+Bass keep their prior sounds. Numbered labels (Alto 1/Tenor 2) and any drums/percussion, brass, saxophone, guitar or keyboard evidence by name/GM disable the pass. In qualifying choirs the unprogrammed upper vocal labels also use microphone. Bands retain bass guitar and bass4 TAB.
- Ukulele sizes → nylon guitar playback instead of piano, with independent ukulele TAB tuning.
- Explicit MIDI programs retain precedence in both formats. Existing saved per-part sound choices continue to override import defaults when restored (review r1 notes); new defaults affect fresh imports without those saved overrides.
- For five-string bass set `settings.tabInstruments: { '<part-id>': 'bass5' }` alongside five-note host `tabTuning`. A mismatched count keeps instrument defaults and emits a development-only diagnostic once per part id/session, with advice for host settings versus reader tuning as appropriate.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run test -w pepperscore
npm run check
npm run build
npm run test:tab
npm run test:instrument-switch
npm run test:manifest
npm run test:validation
```

## Verification output (initial implementation)
All commands above exited 0 on implementation commit `09c4025`; only this handoff changes afterward. Logs: `/tmp/0016-{unit,check,build,tab,switch,manifest,validation}.log`.

```text
npm ci: added 378 packages; Chromium install exit 0
package tests: Test Files 15 passed (15); Tests 270 passed (270)
check: 0 errors, 0 warnings, 0 hints
build: Complete! Demo build uses the library dist and ships its notices
TAB: reader switch (piano and guitar, saved view, transposition, phone More panel, drawer at mid width, embeds) on chromium passed
Instrument switch: chunked reader render moves tied notes across chunk boundaries; caches keyed by the spec passed
GM manifest: 128 local packs, 16 icons and playable voices verified
Sound packs: complete pack.json, generated core (19 FluidR3 sounds) and versions passed
full test:validation: exit 0 (API/audio/clock/CSS/skin/assets/sounds/spelling/transpose/document/parser/storage/performance/package/editor/reader/chunks/large/guardrails/embed/layout/TAB/bake/instrument-switch/PDF)
PDF page model spike passed (chromium): A4 4 lines; A3 4; 2 pages for 80 bars.
production reader JS: tuning diagnostic absent (23 JS files scanned)
git diff --check: pass
```

Initial checks caught a test's zero-/one-based program expectation and missing type-only `process` declaration/test typing; all corrected before the final green run. Installation reported existing dependency audit findings (8); no dependency changes made.

## Outcome / scope audit
Done. Receiver ack committed first (`8b874d1`), implementation committed (`09c4025`); return handoff committed separately. Only owned files changed against main. Branch is ready for draft PR review; no PR watch or polling requested or performed.

## Open questions / follow-ups
No implementation blockers. Lead to update the ABC guide on merge and promote the diagnostic/native-host lesson to GBrain if useful. Release is owned separately by 0017.


## Review r1 — 5850219867
Review: https://github.com/pepperhorn/ph-scoreview/pull/80#pullrequestreview-5850219867

Lead-authorized scope expansion implemented the score-level choir pass in `lib/tab/string-instruments.ts`, with call sites only in `lib/import.ts` and `lib/notation/musicxml-source.ts`. Broader bass fallback, contextual choir identity and once-per-session source-specific warnings are all covered by tests. The r1 requests were addressed in that revision; the stricter r2 decision below supersedes its choir threshold. See the r2 follow-up for the component-level warning-source limitation.

All requested r1 commands ran in the foreground and exited 0 against the code in this revision:

```text
npm run test -w pepperscore: 16 test files, 305 tests passed
npm run check: 0 errors, 0 warnings, 0 hints
npm run build: Complete; demo/library dist check passed
npm run test:tab: pipeline and reader switch checks passed (chromium)
npm run test:instrument-switch: full suite passed, including saved switches and chunked render
npm run test:document: import workers, 48 MEI view cases, MusicXML chunks/identity, timewise/MXL, ABC adapter and navigation regressions passed
Production reader JS: no host/reader tuning diagnostic strings
git diff --check: passed
```

Tests cover numbered/synth/line bass names, bass saxophone exclusion, full and abbreviated choir labels on ABC/MusicXML plus the worker reader, explicit-program precedence, Guitar+Bass bands, tenor-sax exclusion, repeated render/chunk warning suppression and source-specific advice. Initial two-part-choir test failures exposed the upper voice retaining piano; fixed before the final green run.

Scope audit from reviewed head `df68cd0`: only owned classifier/warning/tests, the newly authorized two import call sites, and this return handoff. No render/component/PDF/prefs/file-state/dependency/ledger changes. Logs: `/tmp/0016-r1-{unit,check,build,tab,switch,document}.log`.


## Review r2 — final fix round
Review: https://github.com/pepperhorn/ph-scoreview/pull/80#pullrequestreview-5850373028
Reviewed base: `bda592305fbf8f3017b58a5eda57499cba394d94`.

The lead narrowed choir inference after CI parser-diff caught placeholder A and A+B changing to voice. The pass now requires an unprogrammed Bass/B and either Soprano/Sop. or at least three distinct SATB role labels. Instrumental names/GM families and numbered vocal labels prevent any choir inference. This intentionally changes the r1 A+Bass and Ten.+Bass tests: these are no longer choirs and Bass remains bass guitar. Lone A and A+B retain piano defaults. Full-word SATB and S/A/T/B remain voices without TAB; big-band Alto 1/Tenor 1/Trumpet/Bass/Drums retains bass guitar and bass4 TAB. Explicit programs remain authoritative.

Scope: classifier, import regression tests and this return handoff only. The parser comparison harness and reference parser were not changed.

Follow-up for lead (reviewer r2 finding 3, out of scope): real PepperScore currently passes saved reader tunings through configured.tabSettings.tuning too, so planTab cannot reliably distinguish host versus reader source. Its direct unit tests cover both branches, but proving/correcting real-component advice requires separate components/** ownership and provenance plumbing. No component changes made in this task.

Final r2 verification: all requested commands ran in the foreground and exited 0.

```text
npm run test -w pepperscore: 16 files, 365 tests passed
npm run check: 0 errors, 0 warnings, 0 hints
npm run build: Complete; demo/library dist check passed
npm run test:tab: pipeline and reader switch checks passed (chromium)
npm run test:instrument-switch: full suite passed
npm run test:document: import, worker, navigation and channel regressions passed
npm run test:parser-diff: Streaming MusicXML reader matches the DOM importer
  ok case timewise with xmlns and comments
  ok case note IDs: native, duplicate, xml:id, empty, self-closing
git diff --check: passed
```

Tests include lone A, A+B, S+B, duplicate A+A+B, A+Bass, no-bass SAT upper voices, numbered labels, the requested big band, word/letter SATB, the three-role threshold, named instrumental exclusions and anonymous parts with keyboard/guitar/brass/sax/percussion GM programs. The final package/type/build checks were repeated after the last label-lookup adjustment and two extra distinct-role regressions. No review-harness changes. Last authorized fix round complete; ready for lead disposition.

Logs `/tmp/0016-r2-{unit,check,build,tab,switch,document,parser-diff}.log`.
