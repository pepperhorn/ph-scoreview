# Handoff: 0008 — ABC voice declarations before X: (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0008 (S5; quick, no separate spec or plan)
- **Dispatch:** [lead → codex](2026-11-10-0008-abc-voice-before-x--lead-to-codex.md)
- **Branch:** orch/0008-abc-voice-before-x
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-056df41c
- **Base commit:** 7eb7fd0
- **Implementation commits:** 12ef797131f3cf9673f36df6269ff09989b45d05 (initial), b40644006c70672072c6708f39c6fa1c2d45e255 (r1 fix)
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/67 (draft)
- **Port:** none
- **Status:** open; r1 fixed, all r1-requested verification passed; awaiting re-review

## Goal
Preserve file-header V: clef, name, transpose and MIDI attribution for the first tune, with tune-header overrides and the existing first-tune isolation rules.

## Scope
- **In / files owned:** packages/pepperscore/src/lib/import.ts (ABC only), packages/pepperscore/src/lib/abc-import.test.ts, ABC fixtures if needed, both own 0008 handoffs.
- **Changed:** importer, tests, both 0008 handoffs; no fixture files needed.
- **Out / do not touch:** notation/**, README, ABC authoring guide, ledger, other task files, dependencies, MusicXML/MEI paths. These remain untouched.

## Acceptance criteria
- [x] V:1 clef=bass before X:1 imports bass; treble-8 retains its octave transposition, written pitches, sounding pitches and MEI equivalence to the same declaration in the tune header.
- [x] Tune-header clef/name/transpose/program override the file-header values for the same voice id; unspecified properties are inherited. Explicit transpose=0 still wins over MIDI transpose.
- [x] Multi-voice file-header names, clefs, program/channel/transpose attribution and body selectors retain source identity after inserted text. A later conflicting tune has no effect.
- [x] All 66 existing ABC tests pass; 71 tests total.
- [x] For the ABC guide note below.

## Verify with
Run sequentially from the repo root; never overlap build with reader tests:
```bash
npm ci && npx playwright-core install chromium
npm run test -w pepperscore -- --run src/lib/abc-import.test.ts
npm run check && npm run build && npm run test:manifest && npm run test:validation
```

## Known gotchas / decisions made
GBrain read: `default:projects/scoreflow-music-reader` and `default:projects/scoreflow-music-reader/gotchas-abc-import`. Also read the linked [0006 return handoff](2026-11-10-0006-abc-directive-scoping--codex-to-lead.md) and PR #62's review comment. Implementer made no GBrain writes.

- abcjs TuneBook discards non-%% file-header lines before X:. Replay file-header V: declarations at the first tune-header V: (or K: when there is no V:), after preceding %%score/%%staves and other layout directives. abcjs continues to parse clef syntax; no second clef grammar is introduced.
- Record the replay and existing default-voice selection as insertions, then restore startChar/endChar to original source coordinates before source voice and MIDI attribution. First-tune trimming and original document text remain intact.
- abcjs does not reliably replace titles from repeated declarations. When replay is needed, resolve the latest source header name for that voice to preserve tune-header precedence; keep the existing name fallback otherwise.
- No ADR is proposed; this is a bounded correction of header defaults.

## For the ABC guide
Lead should update docs/guides/abc-authoring.md Rules, Quick checklist and Change log at merge:
- Remove the warning that V: before X: loses its clef.
- File-header V: declarations now supply clef, name and transposition defaults, with MIDI scoped to the selected voice as usual. Tune-header properties for the same id override the corresponding defaults; unspecified properties remain inherited.
- Octave clefs follow the same written-pitch/playback rules as tune-header declarations; only the first tune is imported.

## Open questions
None for the scoped fix.

## Return
- **Outcome:** r1 complete; all requested r1 checks pass. Historical broad local validation failures are retained below for context.
- **Commits:** 6b5353f (receiver acknowledgement), 12ef797 (implementation), return handoff commit follows.
- **Verification output:** setup, focused tests, check, build and manifest exited 0. Full validation was attempted twice and failed; then every remaining constituent command was run sequentially, recording each exit code. Logs: `/tmp/0008-{abc-final,check,build,manifest,validation,validation-retry,validation-remaining}.log`.

```text
Focused ABC: 71/71 passed (all original 66 retained)
TypeScript/Astro: 0 errors, 0 warnings, 0 hints
Build: Demo build uses the library dist (worker chunks and Verovio files match) and ships its notices
GM manifest: 128 local packs, 16 icons and playable voices verified.
Sound packs: complete pack.json, generated core (19 FluidR3 sounds) and versions passed
Speller: 7911 checks passed
Transpose: engraving validation passed (209.7 s) [retry]
Library: 151/151 passed
Editor: 273/273 passed
VERIFY COMPLETE: 18 commands; 4 failures
```

Unresolved failures (no assertions/timeouts were changed):
```text
test:editor-browser (validation/editor.mjs:518): every change-to-redraw time is under 800 ms
  got 776, 847, 673, 408, 190, 365, 773, 938, 233 ms
test:editor-phone (validation/editor-phone.mjs:49,126): headerSettles waitForFunction Timeout 6000ms
test:reader (validation/reader.mjs:1133): Endless playback scrolls along
test:large (validation/large-score.mjs:168): on-demand highlight within 500 ms, took 840 ms
```

The first full attempt stopped on a Vite dynamic abcjs-module fetch failure in transpose; the second passed transpose/document and stopped on a generic MusicXML worker-import error in parser-diff. The isolated parser-diff rerun passed. Other concurrent host validation jobs were observed; their contribution to timing failures is an inference, not a confirmed root cause.

All other validation constituents passed: API, audio, clock, CSS, skin, assets, sounds, spelling, transpose, document, parser-diff (retry), score-db, performance, clock-contract, library, editor units, chunks, guardrails, embed, clock-embed, layout, TAB, TAB bake, instrument switch. Final output:
```text
Instrument switch: chunked reader render moves tied notes across chunk boundaries; caches keyed by the spec passed
VERIFY EXIT: npm run test:instrument-switch: 0
VERIFY COMPLETE: 18 commands; 4 failures
```
- **Scope audit:** `git diff --stat main...HEAD` contains only the owned importer, ABC tests and own 0008 handoffs. `git diff --check` passes.
- **Out-of-scope issues found:** an exploratory CRLF multi-voice/file-header probe already produced an extra part on the pre-fix importer. Final regression coverage uses LF. Broader CRLF/source-coordinate normalization was left outside this correction and should be investigated separately.
- **Follow-ups:** lead to resolve/re-run the four broad browser verification failures, arrange other-family review, update the ABC guide/ledger, and promote the note below to GBrain. No PR watching or polling.
- **For GBrain (lead to promote):** pre-X: V: metadata can be recovered by replay before tune-header overrides, provided inserted text is removed from abcjs event coordinates. Repeated voice names need explicit source precedence because abcjs retains earlier titles.


## Review r1 addressed — 2026-11-10
Review: https://github.com/pepperhorn/ph-scoreview/pull/67#pullrequestreview-5833199705 (reviewed c70334e).
Implementation: b40644006c70672072c6708f39c6fa1c2d45e255; handoff-only commit follows.

- **Blocking grouping regression fixed:** replay immediately before the first tune-header V: or K:, after preceding %%score/%%staves and other layout directives. This follows the lead's decision. The coordinate-restoration loop is unchanged; replay remains before bodyStart, preserving its ascending insertion ordering.
- **Regressions added:** %%score {RH | LH} and %%staves {RH LH}, each with and without a tune-header Piano name override, retain one braced Piano with treble/bass staves. Part ids/sourcePartId/note ids match the same file without pre-X: declarations (the unchanged main behavior); complete parts and MEI match declarations placed in the tune header. %%score (S A) retains abc-0-0 / abc-0-1, pinning both voices to one parsed staff; body MIDI transpose still resolves from original source coordinates.
- **r1 suggestion 2:** retained source-name precedence. A direct abcjs probe with Old then Solo after layout directives still returned the Old title; moving replay does not make the workaround redundant. Updated its comment to describe title replacement accurately.
- **r1 suggestion 1 / For the ABC guide:** a file-header voice that is not explicitly selected can still become the default for unselected body music. First-header-voice selection predates this task, but the newly honoured metadata makes it visible. Lead should document that behavior; this review fix does not change default-voice policy.
- **GBrain:** consulted default:projects/scoreflow-music-reader/gotchas-abc-import again. Lead to promote: abcjs must see tune-header staff grouping before replayed file-header voice declarations. Implementer made no brain writes.
- **Scope audit:** only owned ABC importer/test paths and this return handoff changed for r1. No notation, README, dependency, guide, ledger, or validation-script edits.

Executed sequentially, foreground, repo root; no overlapping browser tests:
```bash
npm run test -w pepperscore -- --run src/lib/abc-import.test.ts
npm run check
npm run build
npm run test:document
npm run test:transpose
```
All exited 0 on the r1 implementation. Logs: /tmp/0008-r1-{abc,check,build,document,transpose}.log. The added grouping tests failed before the fix; the first pre-fix run also hit an existing-test timeout on this loaded host. The final requested chain completed without retries.

```text
ABC: 74/74 passed (all 71 pre-r1 tests retained)
Astro: Result (22 files): 0 errors, 0 warnings, 0 hints
Build: Demo build uses the library dist (worker chunks and Verovio files match) and ships its notices
Document: timewise, MXL source bytes and hash, percussion, voices, ABC adapter and MEI identity passed
Document review regressions: drum kit program, MEI accidentals/key/meter changes, saved BPM clamp, MXL encoded path and size bound, ABC/MEI navigation engraving passed
Verovio channels: an out-of-memory failure stays in its channel, other channels retry, closed channels stay closed passed
Transpose: chunked engraving keeps keys and spellings across chunk boundaries (2520 comparisons) passed
Transpose: engraving validation passed (127.9 s)
```

Full test:validation was not rerun for r1; the user requested the focused chain above. The r1 reviewer reported full CI green on the prior c70334e head; that is prior-head review evidence, not current-head CI verification. Lead/reviewer to re-review this fix and assess current CI. No PR watching or polling.
