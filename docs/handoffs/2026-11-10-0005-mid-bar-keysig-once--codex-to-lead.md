# Handoff: 0005 — Mid-bar key signature drawn once per staff (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0005 · **Spec / Plan:** none (quick)
- **Dispatch:** [lead → codex](2026-11-10-0005-mid-bar-keysig-once--lead-to-codex.md)
- **Branch:** orch/0005-mid-bar-keysig-once
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-d5fb1a89
- **Base commit:** 6f3196450a6939e4b237b2f5816ae5403b0f4cc4 (contains pinned 2b4d032)
- **Implementation commit:** 608dd0e
- **PR:** pending creation after verification
- **Status:** done; ready for lead review

## Goal
Emit exactly one mid-bar key signature per staff with one or two layers, preserving the new key's pitch spelling and playback in every layer.

## Scope / files owned
Changed only `packages/pepperscore/src/lib/notation/document.ts`, new `packages/pepperscore/src/lib/notation/document-keysig.test.ts`, and the two 0005 handoffs. No importer, ABC-test, shared-speller, ledger, dependency or API edits.

## Acceptance criteria
- [x] Native Verovio SVG assertions pin two total signature groups (initial C plus one mid-bar G) for one and two layers, before and after reader respelling.
- [x] MEI implied F-sharp and explicit F-natural attributes retain main's one-layer behavior. Performance timeline and Verovio MIDI pitch readback assert every note's MIDI after normalization/respelling, including both layers.
- [x] Existing 60 ABC tests pass; four new tests pass, including trailing silence and a held note across the change in layer 1.
- [x] Full required verification completes (exit 0 on unchanged retry).

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run test -w pepperscore -- --run src/lib/notation/document-keysig.test.ts src/lib/abc-import.test.ts
npm run check && npm run build && npm run test:manifest && npm run test:validation
```
All long commands ran sequentially; build did not overlap reader tests.

## Decisions made
- Assign each mid-bar key change to exactly one layer. Prefer layer 1, but select another layer when layer 1 sustains across the change; this retains the signature's onset without rewriting held notes or their IDs.
- Flush key changes through trailing silence in the owning layer. Without this, a first layer that ends early would suppress changes needed by the other layers.
- Keep pitch generation and the shared spelling pass unchanged. Tests load Verovio's normalized MEI, respell it with the reader's policy, engrave again and read native MIDI values.
- GBrain consulted: `default:projects/scoreflow-music-reader` and `default:projects/scoreflow-music-reader/gotchas-abc-import` (preserve mid-bar signatures through reader spelling). Implementer did not write to GBrain.

## Verification output
Setup, targeted tests (64 total), check, build and manifest passed (exit 0). Full `npm run test:validation` retry passed (exit 0), including pepperscore 9 files / 140 tests, editor 25 files / 273 tests, and all browser checks. Logs: `/tmp/0005-check.log`, `/tmp/0005-build.log`, `/tmp/0005-manifest.log`.

The first full validation run stopped at `validation/transpose.mjs:224` with a Vite generated-dependency fetch failure for `abcjs.js`. The unchanged full suite was rerun; log `/tmp/0005-validation-retry.log`. The retry passed that exact ABC browser stage and all transposition checks (2,520 chunk comparisons).

## Open questions / follow-ups
None for the lead to decide before review. Other-model-family review and merge remain the lead's responsibility. No PR watching or merging by the implementer.

**For the ABC guide: none.** ABC import behavior did not change; this corrects duplicate MEI engraving for multiple layers on one staff.

## For GBrain (lead to promote)
A staff-wide in-layer MEI key signature must be emitted in one layer only. It may need a different owning layer when the first sustains across its onset; trailing silence must still carry signatures. Native SVG counts and MIDI readback through normalized MEI plus reader respelling cover different failure modes.

Final verification tail (`/tmp/0005-validation-retry.log`):

```text
Instrument switch: reader settings switch both piano staves (clef, written pitch, ps-transposed / ps-out-of-range, host highlights), no double transposition, concert-basis rule passed
Instrument switch: playback plays alto sax program 66 at the fitted sounding pitch; unswitched transposing parts unchanged in both views passed
Instrument switch: full reader picker (Instrument and Sound sections, trumpet, harp sound, level and fit, as written, hidden by the host, drum kit) passed
Instrument switch: saved switch vs host settings (same host: the reader's flute; changed host: alto sax) passed
Instrument switch: octave tool (select, Shift/second-click passage, phrase, 8va/8vb, out of range, auto-fit kept as written, reset, Escape, focus, saved, hidden, embed menu and compact entry) passed
Instrument switch: chunked reader render moves tied notes across chunk boundaries; caches keyed by the spec passed
```

Scope audit: `git diff --stat main...HEAD` contains only the owned implementation/test and 0005 handoffs; `git diff --check` passes. Outcome: done.
