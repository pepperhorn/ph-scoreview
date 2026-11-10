# Handoff: 0016 — Instrument names and tuning diagnostic (codex → lead)

- **Date:** 2026-11-11
- **Type:** return
- **Ledger:** 0016 [quick]
- **Dispatch:** [lead-to-codex](2026-11-11-0016-instrument-names--lead-to-codex.md)
- **Branch:** `orch/0016-instrument-names`
- **Worktree:** `/home/shaun/.t3/worktrees/ph-vexflow-view/t3-f4c5a8a8-bae6c18130633ca8`
- **Base:** `e88ac67` (contains requested base `12f4bea`)
- **Implementation commit:** `09c4025da9e4f28ebffb063c35bd8906312ccc28`
- **PR:** draft PR on this branch (URL returned to lead after creation)
- **Status:** closed (implementation done; ready for lead review)

## Goal and scope
Align name-only bass/ukulele playback and TAB detection, and explain ignored custom tuning counts in development. Owned changes: `lib/score.ts` (`instrumentForName` only), `lib/tab/string-instruments.ts`, `lib/tab/tab-parts.ts` (diagnostic only), tests in those areas and `lib/abc-import.test.ts`, and the two 0016 handoffs. No render, components, PDF, prefs/file-state, instrument model, dependencies or ledger changes.

## Acceptance criteria
- [x] Bass, Acoustic Bass, Electric Bass and Bass Guitar select bass guitar sound and bass4 TAB.
- [x] Double Bass, Contrabass, Upright Bass and String Bass select double bass with no generated TAB.
- [x] Choir Bass, Bass voice, Vocal Bass and SATB Bass remain voice/non-TAB; bass wind names remain non-TAB; explicit non-string MIDI programs keep precedence.
- [x] Ukulele sizes select existing nylon guitar sound and their independent ukulele TAB identities.
- [x] ABC `V:1 name="Bass"` without MIDI selects bass guitar (also tested acoustic/electric bass, bass guitar and ukulele).
- [x] Mismatched tuning warns in development with part name/id and bass5 suggestion for five-string tuning on bass4, keeps defaults, stays silent in production and safely skips missing-process hosts. Matching bass5 override applies tuning without warning.

## Decisions made
- Reused `guitar`: GM 25 (nylon guitar). `instrumentDetails.program` is zero-based (24), while the instrument model's `gmProgram` is one-based (25). No new instrument id needed. Bass guitar uses existing GM 34.
- Exact trimmed bare Bass is bass guitar; vocal keywords (voice, vocal, choir, singer, SATB) precede bass-name detection. Explicit MIDI still wins during import/TAB classification. No score-wide sibling-name inference was added: `instrumentForName` receives only a name. SATB producers should keep explicit vocal labels or choir MIDI programs when calling a part simply Bass.
- Tuning warning uses the approved inline try/catch around `process.env.NODE_ENV`, plus a type-only declaration, preserving browser-native safety and production elimination.

## Known gotchas
GBrain searched: `default:projects/scoreflow-music-reader` (historical project context); current repo dispatch controls name rules. Per implementer role, no GBrain writes.

## For the ABC guide
Without an explicit MIDI program: Bass/Acoustic Bass/Electric Bass/Bass Guitar → bass guitar + bass4; Double Bass/Contrabass/Upright Bass/String Bass → double bass, no generated TAB; vocal/choir/SATB labels → voice; ukulele sizes → nylon guitar playback with independent ukulele TAB tuning. Explicit MIDI programs retain precedence. For five-string bass set `settings.tabInstruments: { '<part-id>': 'bass5' }` alongside a five-note `tabTuning`; a mismatched count keeps instrument defaults and emits only a development diagnostic.

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

## Verification output
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
