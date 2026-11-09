# Handoff: 0008 — ABC voice declarations before X: (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0008 (S5; quick, no separate spec or plan)
- **Dispatch:** [lead → codex](2026-11-10-0008-abc-voice-before-x--lead-to-codex.md)
- **Branch:** orch/0008-abc-voice-before-x
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-056df41c
- **Base commit:** 7eb7fd0
- **Implementation commit:** 12ef797131f3cf9673f36df6269ff09989b45d05
- **PR:** pending creation after this handoff commit
- **Port:** none
- **Status:** open; implementation complete, full verification has failures; awaiting lead/reviewer

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

- abcjs TuneBook discards non-%% file-header lines before X:. Replay file-header V: declarations immediately after the first X:, before the original tune header. abcjs continues to parse clef syntax; no second clef grammar is introduced.
- Record the replay and existing default-voice selection as insertions, then restore startChar/endChar to original source coordinates before source voice and MIDI attribution. First-tune trimming and original document text remain intact.
- abcjs appends names from repeated declarations rather than replacing them. When replay is needed, resolve the latest source header name for that voice to preserve tune-header precedence; keep the existing name fallback otherwise.
- No ADR is proposed; this is a bounded correction of header defaults.

## For the ABC guide
Lead should update docs/guides/abc-authoring.md Rules, Quick checklist and Change log at merge:
- Remove the warning that V: before X: loses its clef.
- File-header V: declarations now supply clef, name and transposition defaults, with MIDI scoped to the selected voice as usual. Tune-header properties for the same id override the corresponding defaults; unspecified properties remain inherited.
- Octave clefs follow the same written-pitch/playback rules as tune-header declarations; only the first tune is imported.

## Open questions
None for the scoped fix.

## Return
- **Outcome:** partial: implementation and ABC acceptance tests complete; full verification is not green
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
- **For GBrain (lead to promote):** pre-X: V: metadata can be recovered by replay before tune-header overrides, provided inserted text is removed from abcjs event coordinates. Repeated voice names need explicit source precedence because abcjs appends titles.
