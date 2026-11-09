# Handoff: 0005 — [quick] Mid-bar key signature drawn once per staff (lead → codex)

- **Date:** 2026-11-10
- **Type:** quick
- **Ledger:** 0005 (suggestion S1) · **Spec:** none · **Plan:** none
- **Branch:** orch/0005-mid-bar-keysig-once · **Worktree:** created by T3
- **Base commit:** 2b4d032
- **Status:** closed

## Goal
`scoreToMei` (`packages/pepperscore/src/lib/notation/document.ts`, `layerXml` ~line 249) emits a mid-bar `<keySig>` into every layer that has events after the change, and Verovio then draws one signature per layer (probe from PR #61 review: 1 layer → 2 keySig groups, 2 layers → 3). Emit it so a staff draws exactly one mid-bar key signature regardless of layer count, and the following pitches in every layer are still spelled and played in the new key. Context: `docs/handoffs/2026-11-09-0004-t1-abc-engraving-fidelity--codex-to-lead.md` (Decisions made: mid-bar keys) and PR #60/#61 reviews.

## Files you own
`packages/pepperscore/src/lib/notation/document.ts`, new `packages/pepperscore/src/lib/notation/document-keysig.test.ts`, your own 0005 handoff files. Don't touch `import.ts` or `abc-import.test.ts` (another task owns them). If `mei-spelling.ts` must change, stop and ask.

## Acceptance criteria
- [ ] A score with a mid-bar key change and 1 layer, and with 2 layers on one staff, each engrave exactly one mid-bar key signature per staff in Verovio SVG (assert on rendered SVG, as `abc-import.test.ts` does with native Verovio).
- [ ] Pitches after the change keep the new key in every layer (MEI accid/accid.ges and playback MIDI unchanged vs main for the 1-layer case).
- [ ] Existing ABC tests (60) still pass. Report "For the ABC guide: none" (or what changed) in your return handoff.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run test -w pepperscore -- --run src/lib/notation/document-keysig.test.ts src/lib/abc-import.test.ts
npm run check && npm run build && npm run test:manifest && npm run test:validation
```
Run long commands in the foreground; don't overlap build with reader tests.

---
## Receiver ack

Acknowledged 2026-11-10 (Codex). I will emit one mid-bar key signature per staff regardless of layer count, retain post-change pitch spelling and playback, and add native Verovio SVG regression tests for one and two layers. I own only `notation/document.ts`, new `notation/document-keysig.test.ts`, and my 0005 handoffs. I will run the specified setup and verification commands, then push this branch and open a draft PR; no merge or PR watching. No open questions. Base ancestry `2b4d032` verified; starting HEAD `6f3196450a6939e4b237b2f5816ae5403b0f4cc4`, clean worktree.

GBrain consulted: `default:projects/scoreflow-music-reader` and `default:projects/scoreflow-music-reader/gotchas-abc-import` (mid-bar signatures must survive the shared spelling pass). The spelling pass remains outside ownership.
