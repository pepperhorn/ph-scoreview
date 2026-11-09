# Handoff: 0009 — [quick] More mid-bar key signature tests (S7) (lead → codex)

- **Date:** 2026-11-10
- **Type:** quick
- **Ledger:** 0009 (suggestion S7)
- **Branch:** orch/0009-keysig-tests · **Worktree:** created by T3
- **PR:** <url once opened>
- **Base commit:** 7eb7fd0
- **Port (if running a server):** n/a
- **Status:** closed

## Goal
Add two regression cases to `document-keysig.test.ts` (from PR #63 review, `gh pr view 63 --comments`): (1) a transposed score (e.g. up a whole tone and down a minor third) still draws exactly one mid-bar key signature per staff with correct pitches in every layer; (2) every layer holds a note across the key change, so the signature falls back to layer 1 and is drawn late (as on main), documented in a test comment. Tests only; if a case fails, stop and report rather than changing `document.ts`.

## Files you own
`packages/pepperscore/src/lib/notation/document-keysig.test.ts`, your own 0009 handoff files.

## Acceptance criteria
- [ ] Both cases added and passing on rendered Verovio SVG, like the existing cases.

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run test -w pepperscore -- --run src/lib/notation/document-keysig.test.ts
npm run check && npm run build && npm run test:manifest && npm run test:validation
```

---
## Receiver ack

I will add rendered-Verovio regression coverage for M2 and -m3 transposition across all layers, and for every layer sustaining across a mid-bar key change (one signature, owned by layer 1 and drawn late). I own only document-keysig.test.ts and my 0009 handoffs. I will stop and report if either case fails without editing document.ts, run all required verification, and open a draft PR. No open questions.

Context checked: GBrain `default:projects/scoreflow-music-reader/gotchas-abc-import` (staff-wide key signatures, root npm install, sequential build/validation); PR #63 review.
