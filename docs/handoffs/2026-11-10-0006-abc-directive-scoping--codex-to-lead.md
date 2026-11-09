# Handoff: 0006 — ABC directive scoping (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0006 · **Spec:** [0004 follow-up](../specs/0004-abc-import-parity.md) · **Plan:** none (quick)
- **Dispatch:** [lead → codex](2026-11-10-0006-abc-directive-scoping--lead-to-codex.md)
- **Branch:** orch/0006-abc-directive-scoping
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-228ee709
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/62 (draft)
- **Base commit:** 6f31964 (includes dispatch docs; descends from pinned 2b4d032)
- **Implementation commit:** 15ebd62
- **Port:** none; no manual preview server
- **Status:** open

## Goal
Fix source attribution of body-only ABC voice MIDI and locate the tune's opening K: independently of file-header K: lines, preserving first-tune isolation.

## Scope
- **In:** ABC source scan, regression tests, README ABC authoring-guide link, own acknowledgement and return handoff.
- **Out:** MusicXML/MEI import, notation/document.ts, dependency changes, ABC authoring guide edits, ledger, other task files.
- **Files owned/changed:** packages/pepperscore/src/lib/import.ts (ABC only), packages/pepperscore/src/lib/abc-import.test.ts, packages/pepperscore/README.md (ABC section only), both 0006 handoffs.
- **Do not touch:** all other paths. No ownership expansion was needed.

## Acceptance criteria
- [x] Body-only voices receive per-voice program, channel 10, and transpose settings, using both V: and inline [V:] selectors.
- [x] Pre-selector body MIDI applies to the first body-only voice if no implicit music exists; otherwise it stays on the implicit voice. Tests cover program/transpose, channel isolation, an implicit bar-only part, and the existing implicit-note case.
- [x] File-header K: before X: does not terminate the tune header. A regression pins voice names, alto/bass clefs, programs, transposition, unselected music assigned to the first voice, and identical results with a later conflicting tune.
- [x] All original 60 ABC tests remain green; 66 total pass.
- [x] README links the repository ABC authoring guide.
- [x] Author-visible changes listed below for the lead's guide update.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run test -w pepperscore -- --run src/lib/abc-import.test.ts
npm run check && npm run build && npm run test:manifest && npm run test:validation
```
Run sequentially in the foreground, without overlapping build and reader tests.

## Known gotchas / decisions made
GBrain consulted: `projects/scoreflow-music-reader/gotchas-abc-import` and `projects/scoreflow-music-reader`. The gotchas page confirms abcjs folds header MIDI score-wide, and source offsets and the first-tune span must be preserved. No GBrain writes were made by this implementer.

- Search for the header-ending K: starting at the first X:; use the beginning of the input when no X: exists. Keep the original source offsets and file-header defaults.
- Resolve the body-only fallback voice after abcjs parsing, using parsed note/bar source offsets to distinguish actual implicit music from directives, comments and whitespace. No new text scanner or note grammar is introduced. The existing source selectors still attribute post-selector directives.
- Post-selector body-only directives already passed on the base; the reproduced S2 failure is specifically before the first body-only selector. New tests pin both routes.
- A body-only first voice is distinct from an implicit voice with music before all selectors. Preserve that implicit voice, including a bar-only part. Existing note IDs and first-tune trimming are unchanged.

## For the ABC guide
Lead should update docs/guides/abc-authoring.md Rules, Quick checklist and Change log when merging:
- Body-only voice declarations are supported: body MIDI after a selector belongs to that voice; MIDI before any selector belongs to the first body-only voice when no implicit music precedes it.
- If notes or a barline precede all selectors, that implicit default voice receives the earlier body directives; later voices do not inherit them.
- A file-header K: before X: no longer misclassifies tune-header V: declarations. The tune's own first K: ends its header. Remove the two ledger-0006 Known limits after merge.

## Open questions
None.

## Return
- **Outcome:** done
- **Commits:** 3d13f67 (ack), 15ebd62 (implementation), return-document commit follows.
- **Verification output:** all prescribed commands exited 0 on implementation 15ebd62, sequentially in the foreground. Full validation log: `/tmp/0006-validation.log`.

```text
Setup: npm ci and Chromium install exit 0
Focused ABC: 66/66 tests passed (all original 60 retained)
Astro/TypeScript: 0 errors, 0 warnings, 0 hints
Build: demo library dist, worker chunks, Verovio files and notices match
GM manifest: 128 local packs, 16 icons and playable voices verified
Sound packs: complete pack.json, generated core (19 FluidR3 sounds) and versions passed
Speller: 7911 checks passed
Library: 8 test files, 142/142 tests passed
Editor: 25 test files, 273/273 tests passed
All browser validation suites passed: editor/phone, reader, chunks, large, guardrails, embed, clock-embed, layout, TAB and instrument-switch
TAB bake: all 824 checks passed
Full check/build/manifest/validation chain: exit 0
```

Actual final validation tail:
```text
Instrument switch: full reader picker (Instrument and Sound sections, trumpet, harp sound, level and fit, as written, hidden by the host, drum kit) passed
Instrument switch: saved switch vs host settings (same host: the reader's flute; changed host: alto sax) passed
Instrument switch: octave tool (select, Shift/second-click passage, phrase, 8va/8vb, out of range, auto-fit kept as written, reset, Escape, focus, saved, hidden, embed menu and compact entry) passed
Instrument switch: chunked reader render moves tied notes across chunk boundaries; caches keyed by the spec passed
```

Scope audit: `git diff --stat main...HEAD` contains only the owned implementation, ABC tests, README ABC section and 0006 handoffs. No validation scripts, dependencies, ledger or notation/document.ts edits.
- **Out-of-scope issues found:** none.
- **Follow-ups:** lead to update the ABC guide, ledger and GBrain gotchas; arrange the other-family review. No PR watching or polling.
- **For GBrain (lead to promote):** default body voice must distinguish actual implicit music from body-only declarations; tune header boundary ignores file-header K: before X:.
