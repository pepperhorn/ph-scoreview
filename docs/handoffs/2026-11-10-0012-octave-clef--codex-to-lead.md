# Handoff: 0012 — Octave-clef parts draw at the right octave (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0012 · **Spec:** [0012](../specs/0012-octave-clef-display.md) · **Plan:** [T1](../plans/0012-octave-clef-display.md)
- **Dispatch:** [lead → codex](2026-11-10-0012-octave-clef--lead-to-codex.md)
- **Branch:** orch/0012-octave-clef
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-ad0cfc0f
- **Base commit:** 0fe23ce (dispatch base); receiver ack 05244bf
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/75 (draft)
- **Status:** open
- **Outcome:** partial — implementation complete; broader browser validation has failures/incomplete gates listed below. Lead review required.

## Goal
ABC octave-clef guitar and written-octave MusicXML render at the same staff positions as the supplied sounding-pitch reference, produce sounding playback and the specified TAB frets, and retain the guitar clef's 8 when switched.

## Context you need
The linked spec and plan define AC1–AC6. Reference assets in `docs/handoffs/assets/2026-11-10-octave-clef-tab/` are unchanged; copies live in `packages/pepperscore/src/lib/__fixtures__/octave-clef/`. GBrain consulted: `projects/scoreflow-music-reader/gotchas-abc-import`. Its written-octave-plus-clef-transposition ABC advice is superseded by the implementation choice explicitly allowed in spec 0012. The former combination engraves an octave too high in Verovio 6.3.0.

## Scope
- **In:** ABC octave-clef pitch import, matching MusicXML octave-transpose normalization, guitar instrument-view clef/engraving shift, sounding-pitch TAB adjustment, assigned README sections, tests/fixtures.
- **Out:** TAB eligibility, tunings, fingering solver, imported TAB policy, UI, PDF, editor, validation harness, ledger and other project docs.
- **Files owned/changed:** T1's `import.ts`, `notation/document.ts`, `notation/musicxml-source.ts`, new `notation/musicxml-octave-clef.ts`, `instrument-view.ts`, `tab/tab-parts.ts`, `abc-import.test.ts`, new `octave-clef.test.ts`, new fixtures under `lib/__fixtures__/octave-clef/`, package README's Guitar TAB and ABC Clefs paragraphs, and the two 0012 handoffs. Paths under `packages/pepperscore/src/lib/` unless stated otherwise.
- **Do not touch:** all dispatch-protected paths remain unchanged.

## Acceptance criteria and evidence
- AC1: native Verovio SVG notehead Y positions relative to the staff match the sounding MusicXML reference for ABC and normalized written MusicXML; all 14 pitches compared.
- AC2: all three fixtures generate exact frets `[0,2,0,5,3,0,2,3,5,4,3,4,2,3]`; first eight sounding MIDI pitches are `[55,57,59,60,62,64,66,67]`.
- AC3: guitar/sax/flute/guitar views retain sounding pitch in written and concert views; guitar written view retains `clef.dis=8`, identical SVG positions and TAB. Direct Score→MEI of the switched guitar also agrees. Existing ABC switch tests cover explicit instrument intervals composed with octave clefs.
- AC4: sounding bass source remains byte-for-byte unchanged by the normalizer. A synthetic written-pitch bass counterpart normalizes to the same sounding pitches and SVG positions. No real MuseScore export was found in the tracked validation fixtures; the committed report cases and the synthetic bass encoding are the verified inputs.
- AC5: package README updated; lead's guide note below.
- AC6: required verification results below. Existing 0004–0010 assertions remain, with octave-model expectations updated for the spec's selected sounding-octave convention. Generated pitch ID code is unchanged and existing dyad identity assertions remain.
- Additional regression coverage: octave-up, staff-numbered transposition without sibling mutation, residual chromatic/diatonic instrument intervals, mismatching encodings left alone, idempotence, source preservation, timewise import and namespaced XML.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run test -w pepperscore
npm run check && npm run build && npm run test:manifest && npm run test:validation
```

## Verification output
Code tested: `656f8ef73d7bd7d0e0035785cbdedd4f9a3e2994`. No code changed after this commit.

- `npm ci && npx playwright-core install chromium`: dependencies installed. The first browser invocation lacked the required headless-shell build; installing Chromium into an isolated cache unblocked subsequent browser checks. After the execution runtime reset and removed `/tmp`, the final retries used the now-available shared Chromium cache.
- `npm run test -w pepperscore`: initially 166/166 passed before adding the fifth new regression. A concurrent run then hit two 5000 ms timeouts (`verovio-warmup` worker and one `document-keysig` test), plus a transient new-test assertion corrected before the final run. Required isolated rerun `npm run test -w pepperscore -- --maxWorkers=1`: **11 files / 167 tests passed**. Both timing failures passed on that rerun.
- `npm run check`: passed on final code, all three packages; reader Astro result: **0 errors, 0 warnings, 0 hints**.
- `npm run build`: passed on final code; demo build verified matching worker/Verovio assets and notices.
- `npm run test:manifest`: passed: **128 local packs, 16 icons**, generated core **19 FluidR3 sounds** and versions verified.
- `npm run test:validation`: **not green as a single chained invocation**. The first run passed API/audio/clock/CSS/skin/assets/sounds/spelling, then stopped at transpose because Chromium headless-shell was missing. A second invocation stalled in skin's native host stage and was stopped after several minutes; its browser-closed error was caused by that termination. The final standalone skin retry **passed**.
- To cover everything after skin, ran the remaining 23 package scripts sequentially. **19 passed, 3 assertion failures, 1 incomplete (300-second command limit)**. No browser test overlapped a build. The full reader's child process was stopped after the limit.

Passed scripts across the initial chain and sequential runs: `test:api`, `test:audio`, `test:clock`, `test:css`, `test:skin` (also final retry), `test:assets`, `test:sounds`, `test:spelling`, `test:transpose`, `test:document`, `test:parser-diff`, `test:score-db`, `test:performance`, `test:clock-contract`, `test:pepperscore`, `test:editor`, `test:chunks`, `test:large`, `test:guardrails`, `test:clock-embed`, `test:layout`, `test:tab`, `test:tab-bake`, `test:instrument-switch`.

Observed successful output tails:
```text
Test Files  11 passed (11)
     Tests  167 passed (167)
Transpose: engraving validation passed (111.5 s)
Streaming MusicXML reader matches the DOM importer
Playback timeline: 9 browser fixtures and 111 review regressions passed
chromium: chunked engraving matches the whole engraving across chunk boundaries passed (76.5 s)
TAB: reader switch (piano and guitar, saved view, transposition, phone More panel, drawer at mid width, embeds) on chromium passed
tab-bake: all 824 checks passed
Instrument switch: saved switch vs host settings (same host: the reader's flute; changed host: alto sax) passed
Instrument switch: octave tool (select, Shift/second-click passage, phrase, 8va/8vb, out of range, auto-fit kept as written, reset, Escape, focus, saved, hidden, embed menu and compact entry) passed
Instrument switch: chunked reader render moves tied notes across chunk boundaries; caches keyed by the spec passed
Skin bar: ordered full/minimal bars, instrument selection, drawer sync, derived chords, persisted toggles, 390px More and unknown/duplicate ids passed
```

Outstanding validation evidence (not attributed to a baseline without reproducing there):
```text
editor-browser, first standalone run:
  validation/editor.mjs:518
  every change-to-redraw time is under 800 ms
  got 350, 356, 199, 192, 365, 1405, 268
editor-browser, final isolated retry:
  validation/editor.mjs:491
  after the momentum a move follows the cursor (scrollLeft 0)
  (stopped before the line-518 timing gate)
editor-phone:
  validation/editor-phone.mjs:296
  after bar 1 the cursor is between the header and the toolbar (scrollTop 0)
embed:
  validation/embed.mjs:190
  Drawer stays inside the root
reader:
  command stopped at 300 s; passed through stave focus, including
  header first paint, import/engraving/layout/annotations/fonts/mixer/persistence/playback,
  zoom/reflow/rotation/tall stacks, paging/follow, silent fallback, shared soundfont,
  ID-less intro, open dialog, score link and stave focus.
  Final drawer/annotation-size and endless-scrollbar groups remain unverified.
```

All assertion locations above are in dispatch-protected validation/UI areas. The redraw timing issue is also tracked by ledger 0011/S12. No claim is made that the cursor or drawer failures are pre-existing; the lead must assess them against the current main/reviewed head. Earlier temporary logs were removed by the runtime reset; these tails were copied from observed command outputs. Final retry logs are `/tmp/0012-final-skin.log` and `/tmp/0012-final-editor-browser.log` (ephemeral).

`git diff --check` passed. Scope audit against main contains only the listed T1 files/fixtures and the two 0012 handoffs. No ledger, guide, upstream ledger, validation, UI, solver, PDF or editor file changed.

## Decisions made
- **ABC:** store the source letters' sounding octaves; the octave clef is carried to MEI as `clef.dis`. An explicit `V: transpose=` / MIDI transpose remains a separate instrument interval. This is the second option in spec 0012. No changes to generated IDs or voice/part identity.
- **MusicXML:** normalize the import copy before the existing streaming reader. A transpose octave is folded into note pitch octaves only when it matches the applicable clef octave(s); remove that octave-change child while retaining residual chromatic/diatonic transposition. Numbered transposes affect their own staff. An unnumbered transpose is normalized only when all declared clefs match; mixed-clef cases are conservatively left alone. Source bytes/text remain available unchanged through the source document. Captures only individual attributes/note trees and splices source spans, without DOM or a whole-document tree.
- **Instrument switch:** use the existing `treble8vb` engraving clef for guitar in written view, compensate its MEI shift by -12/-7, and compensate TAB's switched-staff transposition by +12 because that MEI already uses sounding octaves. The switched Score remains in the existing target-written-pitch convention for playback. Concert instrument views retain the target's ordinary clef and sounding pitches.
- No upstream issue filed. No GBrain writes by the implementer.

## For the ABC guide
Update Clefs and the Change log on merge: octave-clef letters keep their source/sounding octaves in the reduced model and MEI; `G,` under `treble-8` sounds G3, draws at written G4 on the second line, and generates sounding-pitch TAB. `+8` draws one octave lower. Do not add `transpose=-12` to compensate for the guitar clef. Explicit instrument transpose still applies independently. The guitar switch retains the 8. Update the conflicting GBrain gotcha about written octaves plus clef transposition.

## Proposed Verovio upstream ledger row (lead to add)

| # | Limitation | Upstream status | Our workaround | Candidate upstream fix | GFC |
|---|---|---|---|---|---|
| 17 | MusicXML written-pitch notes with matching `clef-octave-change` and transpose `octave-change` engrave an octave high/low relative to an equivalent sounding-pitch octave-clef score in Verovio 6.3.0. | Draft below; not filed, current upstream issue status not researched. | PepperScore `notation/musicxml-octave-clef.ts`: fold the matching octave transpose into pitch octaves in the import copy, retain the displaced clef and residual instrument transposition; preserve original source. | Make MusicXML import yield the same MEI sounding `oct` under a displaced clef as the equivalent sounding-pitch MusicXML. Add guitar, bass, octave-up and playback regressions. | Needs importer investigation |

## Draft upstream issue (not filed)

**Title:** MusicXML octave clef plus octave transpose engraves written guitar/bass pitches one octave too high

**Version:** npm Verovio 6.3.0, native Node/WASM toolkit, default written view (`transposeToSoundingPitch` not enabled).

**Minimal reproduction:** a single part with G-clef line 2 and `clef-octave-change=-1`, `transpose` containing `diatonic=0`, `chromatic=0`, `octave-change=-1`, and a quarter-note G4. Compare with G3 under the same displaced clef and no transpose.

**Expected:** both encode sounding G3, read as G4 at the second treble line, and should occupy the same SVG staff position.

**Actual:** the written G4 + transpose encoding is drawn one octave higher than the sounding G3 encoding. MEI under the displaced clef needs a sounding octave to reproduce the reference position. Both source encodings have the same intended sounding pitch.

**Repro files:** PepperScore report cases `e-guitar.musicxml` and `e2-guitar-sounding.musicxml`, copied into the PR's `packages/pepperscore/src/lib/__fixtures__/octave-clef/`. They include a scalar line and chords; regression tests compare actual SVG notehead positions relative to the staff. A synthetic written bass counterpart of `h-bass-sounding.musicxml` reproduces the corresponding normalization requirement.

**Workaround:** for matching clef/transpose octaves, add transpose octave-change to each pitch octave, remove that transpose octave-change component, retain residual chromatic/diatonic transposition and the octave clef. Source is retained separately. Please advise whether a different MusicXML import representation is intended.

## Open questions
None for implementation. Lead owns review, broader browser validation triage, merge authorization, ABC guide/upstream ledger edits and GBrain promotion. AC6/full definition-of-done cannot be marked entirely green until those gates are resolved or explicitly accepted.

## Follow-ups / For GBrain (lead to promote)
Record the selected ABC convention, matching MusicXML pre-pass, and why guitar instrument-view MEI and Score octaves differ by one. Mixed-clef global transpose normalization is deliberately conservative; no new tuning or TAB-selection behavior is included. Lead may investigate or file the drafted upstream issue after authorization.
