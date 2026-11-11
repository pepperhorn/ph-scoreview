# Handoff: 0023 — [quick] Fretless solver: position continuity (S30) (lead → codex)

- **Date:** 2026-11-11
- **Type:** quick
- **Ledger:** 0023 · **Spec:** docs/specs/0013-stringed-instrument-tab.md (fretless finger + position TAB, option D)
- **Branch:** orch/0023-fretless-position-continuity · **Worktree:** created by T3
- **Base commit:** 4311266
- **Status:** open

## Goal
Violin and cello finger TAB currently picks each event's fingering greedily, using a fixed per-note ranking (`fingeringCandidates` in `packages/pepperscore/src/lib/tab/strings/solver.ts`, called from `solveFingerPhrase` in `phrase.ts`). Passages flip between positions (I ↔ II ↔ ½) note by note, and the position labels get dense. Add a **position-continuity cost** so the phrase solver prefers to stay in the current hand position, or to use open strings, and only shifts when that saves enough later. Result: fewer position labels and fewer I/II flips on the existing fixtures, with no change to pitch correctness.

Approach (suggested, your call): use a DP/Viterbi over events in `solveFingerPhrase`. State = the hand position after each event (open strings, position 0, carry the previous position). Cost = the existing candidate rank + a shift penalty when the position changes (higher for a larger jump) + a small penalty for leaving the current string set. Keep the existing constraints: held/tied strings, a common position within a chord, `fixed` notes, and the ≤4-note chord bound. Keep the search bounded (candidates per note are few), so performance must not regress on long scores.

## Files you own
- `packages/pepperscore/src/lib/tab/strings/phrase.ts`, `solver.ts` (only if ranking helpers need exporting), `solver.test.ts`, `integration.test.ts`, and a new `phrase.test.ts` if wanted
- `validation/tab.mjs` (only to update expectations for the label count, with before/after numbers in the return handoff)
- your own handoff files for key 0023

Do not touch: `styles.css` (0022 owns it), README/CHANGELOG/docs (0001-t5 owns them), components, public exports, deps, CI.

## Acceptance criteria
- [ ] New unit tests: (a) a scale passage that fits in I stays in I, with no mid-run flip to II or ½; (b) a passage that really needs a shift shifts once and stays there, rather than bouncing; (c) open strings don't count as a shift; (d) chords, ties and `fixed` notes keep today's behaviour (the existing tests still pass).
- [ ] On the violin and cello fixtures used by `validation/tab.mjs`, the position-label count and the number of position changes do not go up, and fall on at least one fixture. Report before/after numbers.
- [ ] No pitch or string-range regressions. Every note still gets the same sounding pitch, and unsupported notes stay unlabelled.
- [ ] Full verify passes.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run test -w pepperscore -- --run src/lib/tab/strings
npm run check && npm run build && npm run test:manifest && npm run test:validation
```

## Known gotchas / decisions already made
- Option D notation (inline L/H finger modifiers; position labels per system) is settled. Don't change rendering, only the choices.
- Per-system labels: 0013-t3 reviewers confirmed that stacked cello labels were *real* position changes. The goal is fewer real changes, not hiding labels.
- Cello ½ position ranks as 1.25 for chromatic instruments (see `positionRank`). Keep that intent.
- GBrain: `projects/scoreflow-music-reader` (fretless TAB entries).

---
## Receiver ack

Acknowledged 2026-11-11 (Codex). I will replace greedy event choices with bounded phrase-level position continuity, preserving held/tied strings, common chord positions, fixed notes and unsupported-note handling. I will add regression coverage, measure before/after violin and cello fixture labels and shifts, run the required verification, and return a draft PR. Ownership is limited to the listed solver/tests, validation/tab.mjs expectations, and my handoffs; no open questions. GBrain consulted: projects/scoreflow-music-reader (historical context; this dispatch and current code govern). Base 4311266 is an ancestor of HEAD 2c50a1e; clean T3 worktree switched to the requested branch.
