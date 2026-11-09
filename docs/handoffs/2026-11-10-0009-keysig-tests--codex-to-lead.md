# Handoff: 0009 — More mid-bar key signature tests (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0009 (quick; no spec or plan)
- **Branch:** orch/0009-keysig-tests
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-acb160fd
- **PR:** draft to be opened after this handoff is committed; branch orch/0009-keysig-tests
- **Base commit:** bed6d80 (contains pinned base 7eb7fd0)
- **Port:** n/a
- **Status:** closed (implementation complete; broader validation failures recorded)

## Goal
Complete the regression cases requested by [the dispatch](2026-11-10-0009-keysig-tests--lead-to-codex.md) and [PR #63 review](https://github.com/pepperhorn/ph-scoreview/pull/63): transposed staff-wide mid-bar signatures and fallback when every layer sustains across the change.

## Scope
- **In / files owned:** packages/pepperscore/src/lib/notation/document-keysig.test.ts and the two 0009 handoff files.
- **Out / do not touch:** implementation, including document.ts, import.ts and mei-spelling.ts; other docs and ledger.

## Acceptance criteria
- [x] Transposition by M2 and -m3 produces exactly two rendered SVG signature groups (initial + one mid-bar), with the expected mid-bar signature, spelling in both layers, and correct native MIDI pitches for every note.
- [x] Both layers sustain over beat 2; one mid-bar signature falls back to layer 1 after the dotted-half note ends at beat 3. Test comment documents this existing late placement; rendered SVG survives spelling and all native MIDI pitches match.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run test -w pepperscore -- --run src/lib/notation/document-keysig.test.ts
npm run check && npm run build && npm run test:manifest && npm run test:validation
git diff --check
git diff --stat main...HEAD
```

## Known gotchas / decisions already made
- GBrain consulted: `default:projects/scoreflow-music-reader/gotchas-abc-import` and `default:projects/scoreflow-music-reader`. The gotchas page confirms staff-wide spelling, root dependency installation, and sequential build/validation. Repo docs and live test results take precedence over historical project notes.
- Use native Verovio transpose through spellBaseline, then reload with transposition cleared, as the reader does. Assert spelling separately from native MIDI so accidental display and sounding pitch are both covered.
- Test the layer-1 fallback using emitted MEI order as well as actual rendered SVG counts; no implementation or ABC import behaviour changes.

## Open questions
No implementation questions. Lead to decide how to handle full-suite browser failures before marking ready.

## Return
- **Outcome:** partial: requested tests implemented and passing; full validation is not green due to browser assertions outside owned files.
- **Commits:** receiver ack `2d52751`; tests `328ddfd`; this return handoff is committed separately.
- **What changed:** two test cases, with two parameter rows for transposition (three new test executions, seven total).
- **Verification output:**
  - Root dependency install and Chromium install: exit 0.
  - Targeted test: exit 0; `Test Files 1 passed (1)`, `Tests 7 passed (7)`.
  - `npm run check`: exit 0; Astro `0 errors`, `0 warnings`, `0 hints`.
  - `npm run build`: exit 0; `Demo build uses the library dist (worker chunks and Verovio files match) and ships its notices`.
  - `npm run test:manifest`: exit 0; `GM manifest: 128 local packs, 16 icons and playable voices verified.`; `Sound packs: complete pack.json, generated core (19 FluidR3 sounds) and versions passed`.
  - `npm run test:validation`: exit 1 at editor-browser after API, audio, clock, CSS, skin, assets, sounds, spelling (7911 checks), transpose, document, parser-diff, score-db, performance, clock-contract, pepperscore (149 tests), and editor (273 tests) passed.
  - Desktop editor retry: exit 1 at a different assertion/helper. Continued the remaining validation components sequentially, without changing thresholds or implementation.
  - Phone editor passed. Reader failed on ensemble playback frame sampling; later reader cases were not reached.
  - Remaining script exit statuses: chunks=0, large=1, guardrails=0, embed=0, clock-embed=0, layout=0, tab=0, tab-bake=0, instrument-switch=0.

Failure excerpts (from actual commands):
```text
# npm run test:validation
AssertionError [ERR_ASSERTION]: every change-to-redraw time is under 800 ms (got 454, 394, 434, 33, 611, 880, 613, 181)
    at validation/editor.mjs:518:10
# npm run test:editor-browser (one retry)
TypeError: Cannot read properties of null (reading 'x')
    at clickNote (validation/editor.mjs:34:30)
    at validation/editor.mjs:354:5
# npm run test:reader
AssertionError [ERR_ASSERTION]: Ensemble playback: sampled playback frames (47)
    at followPlayback (validation/reader.mjs:1025:12)
# npm run test:large
AssertionError [ERR_ASSERTION]: No main-thread task over 200 ms while the score imports
    at validation/large-score.mjs:106:12
# Recorded main-thread durations included 1410 ms and 259 ms.
```

Validation logs in this worktree session are available locally at `/tmp/0009-targeted.log`, `/tmp/0009-check.log`, `/tmp/0009-build.log`, `/tmp/0009-manifest.log`, `/tmp/0009-validation.log`, `/tmp/0009-validation-tail.log`, `/tmp/0009-validation-remaining.log`, `/tmp/0009-validation-final.log` and `/tmp/0009-validation-status.log`. These temporary logs are supplementary; the evidence above is the durable record.
- **Decisions made:** held notes end at beat 3, after the key change at beat 2, to pin late placement without changing current behaviour.
- **Out-of-scope issues found:** desktop editor browser, reader playback sampling, and large-score performance assertions failed (details below). No fixes attempted outside ownership; no separate baseline run, so cause is unproven.
- **Follow-ups:** lead to review, assess the browser validation failures, and update ledger; implementer has not watched/polled PR or written to GBrain.
- **For GBrain (lead to promote):** regression coverage now includes M2/-m3 staff-wide mid-bar signatures and the intentional all-layers-held late fallback.
- **For the ABC guide:** no import behaviour change; tests only, no guide update needed.
