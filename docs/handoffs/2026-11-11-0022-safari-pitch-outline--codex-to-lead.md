# Handoff: 0022 — Safari pitch-colour outlines (codex → lead)

- **Date:** 2026-11-11
- **Type:** return
- **Ledger:** 0022 (quick; no separate spec/plan)
- **Branch:** orch/0022-safari-pitch-outline
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-abd2e15d-6e20c9b0d1427ef3
- **PR:** draft PR to be opened immediately after this committed handoff and the single push; its body links both handoffs
- **Base commit:** 15135bd
- **Commits:** 0720492 (receiver ack), 936e02b (implementation), 02042fa (initial blocked return); this completion update is a subsequent docs commit
- **Status:** closed
- **Outcome:** done; local verification complete under the lead-approved baseline exception and loaded-host budget scale

## Goal
Make default and host-set pitch outlines rasterise consistently in Chromium, Firefox and WebKit while preserving outline thickness, PDF paint and reader highlights. Dispatch: [lead → codex](2026-11-11-0022-safari-pitch-outline--lead-to-codex.md).

## Scope
- **In / files owned:** pitch-colour rules in `packages/pepperscore/src/styles.css`; pitch parity checks in `validation/pdf.mjs`; these two 0022 handoffs. `render.ts` was permitted only if attributes were needed and is unchanged.
- **Out:** overlay implementation/recovery, performance budgets, skin validation, other docs, ledger, public APIs and dependencies.
- Scope audit: `git diff --stat main...HEAD` before this return lists only the dispatch acknowledgement and the two owned code/validation files. This return is the only additional file.

## What changed / decisions made
Verovio emits a path rule `stroke:currentColor`. WebKit applies it inside referenced `<use>` glyphs, where it overrides the stroke inherited from the notehead. The computed notehead stroke is already correct; changing stroke on the `<use>` did not repair the raster. Giving pitch noteheads the same `color` as `--ps-pitch-outline` repairs the glyph paint without changing the existing fill, stroke width or PDF snapshot.

The five existing reader-mark rules also set `color` to their existing respective paint tokens/defaults, so the new outline colour does not leak into playback, cursor, selection, transposed or out-of-range glyphs. PDF parity now exercises these five marks on a real score-system wrapper and requires their currentColor, fill and stroke to agree. Existing raster thresholds are unchanged. No render attributes, public contracts or ABC import behaviour changed.

## Acceptance criteria
- [x] Actual raster parity passes for default and nested host-set outline tokens in all three Playwright engines (full Chromium/Firefox; isolated parity diagnostic in WebKit).
- [x] Outline/head widths remain within the existing strict PDF parity tolerance; default colour is RGB 89,89,89 and host colour RGB 137,167,197.
- [x] Lead accepted the full WebKit command’s pre-existing overlay-recovery failure as an out-of-scope exception (2026-11-11); isolated WebKit raster parity passes. The full WebKit command remains failing and is not claimed green.
- [x] Remaining local suffix passed with `VALIDATION_BUDGET_SCALE=2`, explicitly authorised by the lead for this loaded host. No source budgets or assertions changed.

## Verification
Installed with `npm ci && npx playwright-core install chromium firefox webkit`. `npm run check` passes (reader: 23 files, 0 errors/warnings/hints). `npm run build` passes, including demo-dist consistency. `npm run test:manifest` passes (128 packs, 16 icons, 19 core sounds).

chromium (`npm run test:pdf`, exit 0):
```text
PDF overlay: availability, lazy chunks, defaults, focus trap, fit, remembered paper, local bars, actual download, separate worker, unchanged reader and phone containment passed
PDF nested viewport transforms passed (chromium).
Pitch raster default C: screen 89,89,89 / 0.0456, PDF 89,89,89 / 0.0442
Pitch raster host C: screen 137,167,197 / 0.0516, PDF 137,167,197 / 0.0442
PDF page model spike passed (chromium): A4 4 lines; A3 4; 2 pages for 80 bars.
```

firefox (`BROWSER=firefox node validation/pdf.mjs`, exit 0):
```text
PDF overlay: availability, lazy chunks, defaults, focus trap, fit, remembered paper, local bars, actual download, separate worker, unchanged reader and phone containment passed
PDF nested viewport transforms passed (firefox).
Pitch raster default C: screen 89,89,89 / 0.0430, PDF 89,89,89 / 0.0442
Pitch raster host C: screen 137,167,197 / 0.0365, PDF 137,167,197 / 0.0442
PDF page model spike passed (firefox): A4 4 lines; A3 4; 2 pages for 80 bars.
```

WebKit isolated parity diagnostic (`BROWSER=webkit PITCH_PARITY_ONLY=1 node /tmp/0022-isolated.mjs`, exit 0):
```text
PDF nested viewport transforms passed (webkit).
Pitch raster default C: screen 89,89,89 / 0.0456, PDF 89,89,89 / 0.0442
Pitch raster host C: screen 137,167,197 / 0.0516, PDF 137,167,197 / 0.0442
```
This untracked diagnostic copies the current PDF validation, uses a separate temporary Vite cache and bypasses `assertPdfOverlay` only. It proves the unchanged raster assertions and new mark assertions pass; it does **not** count as the required full WebKit suite passing.

`npm run test:validation` passed API/audio/clock/CSS/skin/assets/sounds/spelling/transpose/document/parser/score-db/performance/clock-contract/package/editor/editor-browser/editor-phone/reader/chunks, then stopped at `test:large`. Package tests: 27 files / 294 tests passed. Skin validation includes 11 unit tests and the browser scenarios. Full log: `/tmp/0022-validation.log`.

### Known baseline failure / prior attempts
1. **Full WebKit PDF command**, `/tmp/0022-webkit.log`: `locator.waitFor: Timeout 60000ms exceeded` at `validation/pdf.mjs:765`, waiting for `Paper size` after the lazy chunk is deliberately aborted, unrouted, and the page reloaded. This same recovery failure occurred in the initial baseline run before the CSS change (`/tmp/0022-baseline.log`, old line 757). An additional overlay-only scratch diagnostic also reproduced an intermittent two-`.pdf-trigger` strict-locator failure at the earlier post-reload click (`/tmp/0022-overlay-debug.log`). Neither failure is a pitch raster assertion. No assertions or overlay behaviour were weakened to conceal these failures.
2. **Full validation timing**, `/tmp/0022-validation.log`: large-score import task 218 ms against 200 ms. Rerunning `npm run test:large` with unchanged budgets (`/tmp/0022-large-retry.log`) passed import timing but failed on-demand playback highlight at 677 ms against 500 ms. The initial attempts used default budgets. The lead subsequently identified concurrent host load and explicitly authorised `VALIDATION_BUDGET_SCALE=2` for the suffix rerun; see the successful rerun below. No budget source changed.
3. An earlier Chromium PDF attempt overlapped the full suite and failed a source-module fetch while skin validation forced Vite dependency-cache refresh. The subsequent sequential full Chromium run passed.

### Lead decision and successful suffix rerun (2026-11-11)
The lead confirmed the WebKit overlay-recovery failure reproduces before this change, accepted it as pre-existing/out of scope, and is logging a separate item. Do not fix it in 0022. Baseline log: `/tmp/0022-baseline.log`; current full WebKit log: `/tmp/0022-webkit.log`. Baseline excerpt (old line 757 corresponds to current line 765):
```text
locator.waitFor: Timeout 60000ms exceeded.
waiting for locator('.skin-reader').getByRole('dialog', { name: 'Export PDF' }).getByLabel('Paper size') to be visible
at assertPdfOverlay (.../validation/pdf.mjs:757:51)
```

The lead authorised the following sequential suffix on the loaded host. The whole chain exited **0**, with `VALIDATION_BUDGET_SCALE=2` exported to all eight commands. Log: `/tmp/0022-suffix-scale2.log`. No code budgets, thresholds or assertions were edited.
```bash
export VALIDATION_BUDGET_SCALE=2
npm run test:large && npm run test:guardrails && npm run test:embed && npm run test:clock-embed && npm run test:layout && npm run test:tab && npm run test:tab-bake && npm run test:instrument-switch
```

```text
> pepperscore-monorepo@0.0.0 test:large
chromium: large score virtualized systems, on-demand drawing, release and playback highlight passed (13.0 s)
chromium: opening scores while a large one draws stays responsive (worst timer lag 6 ms) passed
chromium: Endless zoom on a long virtualized score keeps the reading position passed
> pepperscore-monorepo@0.0.0 test:guardrails
chromium: reopen last file after reload passed
chromium: out-of-memory message and retry passed
chromium: large-file notice passed
> pepperscore-monorepo@0.0.0 test:embed
chromium: embedding (chrome presets, callbacks, host hooks, ref, settings, sounds and asset base, style isolation, containment, unique ids, focused keyboard, focus ring, landmark names, shared engine, persist, missing assets, verovioBaseUrl, instrument switcher) passed
> pepperscore-monorepo@0.0.0 test:clock-embed
chromium: clock playhead and count-in, onSeek note/measure clicks, clock handle, re-engrave while paused, one subscription, Endless follow, silent self-driven playback, onTimeUpdate and seek passed
> pepperscore-monorepo@0.0.0 test:layout
Layout validation passed (chromium)
> pepperscore-monorepo@0.0.0 test:tab
Finger TAB: dense violin/cello, Notation/Both/TAB, whole/chunk/probe, transposition, playback and rasterized PDF passed
TAB: an imported TAB staff or part is flagged, linked to its notation part and performed once (26 notes) passed
TAB: imported TAB staff shows in TAB and Both views only, with chord symbols in TAB view passed
TAB: a notation-only guitar score gets 15 tabGrps and 26 frets in TAB and Both views passed
TAB: transposed views regenerate frets (imported TAB replaced) passed
TAB: capo, tuning and fixed MusicXML fingerings passed
TAB: chunked engraving keeps fingerings across chunks passed
TAB: non-string exclusion, bass and ukulele defaults, octave-clef regressions passed
TAB: settings round trip (prefs, saved record, legacy record, repair) passed
TAB: an octave-transposing guitar gets frets at sounding pitch and keeps its TAB part passed
TAB: a part switched to guitar gets frets at its sounding pitch (with transposition and capo) passed
TAB: fractional capo and mismatched tuning counts preserve instrument defaults passed
TAB: voices are fingered in time order, same-onset voices are one chord, unisons share a string passed
TAB: a transposed TAB-only score is re-fingered passed
TAB: tie continuations keep their rhythm; measure repeats and fermatas show on TAB passed
TAB: staff count without mapped parts and hidden TAB parts passed
TAB: PepperScore onReady ids, host none/bass5, tuning count and reader instrument switch passed
TAB: reader switch (piano and guitar, saved view, transposition, phone More panel, drawer at mid width, embeds) on chromium passed
> pepperscore-monorepo@0.0.0 test:tab-bake
tab-bake: 27 notes of guitar-notation get the reader's string/fret; the rest of the file is unchanged passed
tab-bake: idempotent passed
tab-bake: --add-tab-staff renders 15 tabGrps in Verovio, is flagged as TAB (tabOf) and played once passed
tab-bake: transposing guitar fingered by sounding pitch passed
tab-bake: voices, backup/forward, grace/cue, merged notations, fixed fingerings, folding and unplayable notes passed
tab-bake: CLI with .mxl, batch directory and dry run passed
tab-bake: the bake matches the reader on 46 notes of 17 fixtures (voices, unisons) passed
tab-bake: string numbers without frets are kept as constraints passed
tab-bake: TAB staff tuning read back and rewritten passed
tab-bake: later <staves> updated passed
tab-bake: CLI refuses to overwrite its input, keeps ISO-8859-1, writes .mxl containers passed
tab-bake: all 784 checks passed
> pepperscore-monorepo@0.0.0 test:instrument-switch
Instrument switch: both piano staves share sourcePartId passed
Instrument switch: slurStop marks the last note of a slurred phrase passed
Instrument switch: ScoreNote ids and MEI xml:ids are stable across loads passed
Instrument switch: piano as alto sax engraves both staves in treble a sixth up, the low phrase an octave up passed
Instrument switch: a reader octave move engraves that note an octave down (switched) or up (as written) passed
Instrument switch: ABC octave moves and switches engrave (generated MEI ids, split notes) passed
Instrument switch: concert view, transposed score and alto/bass clefs engrave as the Score passed
Instrument switch: a transposing source engraves from its sounding pitch in both views passed
Instrument switch: a two-voice piano staff switched to violin, alto sax and trumpet: note names agree with the noteheads per voice passed
Instrument switch: octave moves re-evaluate accidentals, keep courtesy accidentals, move single chord notes passed
Instrument switch: chromatic passing notes on a switched staff agree with the Score (A5 A#5 B5 G5 B5 A#5 A5 G5) passed
Instrument switch: a concert-pitch score renders the switched piano at alto written pitch and key passed
Instrument switch: MEI clef mapping (treble, bass, alto, tenor, treble 8vb) passed
Instrument switch: chunked spelling moves both tied notes and drops the source clef changes passed
Instrument switch: reader settings switch both piano staves (clef, written pitch, ps-transposed / ps-out-of-range, host highlights), no double transposition, concert-basis rule passed
Instrument switch: playback plays alto sax program 66 at the fitted sounding pitch; unswitched transposing parts unchanged in both views passed
Instrument switch: full reader picker (Instrument and Sound sections, trumpet, harp sound, level and fit, as written, hidden by the host, drum kit) passed
Instrument switch: saved switch vs host settings (same host: the reader's flute; changed host: alto sax) passed
Instrument switch: octave tool (select, Shift/second-click passage, phrase, 8va/8vb, out of range, auto-fit kept as written, reset, Escape, focus, saved, hidden, embed menu and compact entry) passed
Instrument switch: chunked reader render moves tied notes across chunk boundaries; caches keyed by the spec passed
```

The full validation command’s initial default-budget failure remains recorded above; its previously unreached suffix now passes under the authorised scale. Skin/CSS passed earlier inside full validation and are unchanged. Chromium and Firefox full PDF runs pass; WebKit isolated parity passes with the accepted full-suite baseline exception. No full WebKit or default-budget full-validation green result is claimed.

## Open questions / next action for lead
None for implementation. Lead owns the separate WebKit overlay-recovery item and PR review/merge. This work is authorised for one push and a draft PR after the successful suffix rerun. Do not merge from the implementer worktree.

## Verification commands
```bash
npm run check && npm run build && npm run test:manifest
npm run test:pdf
BROWSER=firefox node validation/pdf.mjs
# Known baseline exception, not green:
BROWSER=webkit node validation/pdf.mjs
# Earlier full run: skin/CSS and the prefix through chunks passed; timing failure at large:
npm run test:validation
# Successful remaining suffix, with lead-authorised scale:
export VALIDATION_BUDGET_SCALE=2
npm run test:large && npm run test:guardrails && npm run test:embed && npm run test:clock-embed && npm run test:layout && npm run test:tab && npm run test:tab-bake && npm run test:instrument-switch
```

## Known context / for GBrain (lead to promote)
GBrain searched: `projects/scoreflow-music-reader` (general background; no Safari-specific advice found). Implementer made no GBrain writes. Useful lesson: for WebKit SVG `<use>` raster bugs, inspect upstream glyph `stroke:currentColor` rules as well as computed style on the notehead; a correct computed inherited stroke does not prove the referenced glyph paints with it. No ADR needed.
