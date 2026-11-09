# Handoff: 0008 — [quick] ABC: a V: line before X: keeps its clef (S5) (lead → codex)

- **Date:** 2026-11-10
- **Type:** quick
- **Ledger:** 0008 (suggestion S5)
- **Branch:** orch/0008-abc-voice-before-x · **Worktree:** created by T3
- **PR:** <url once opened>
- **Base commit:** 7eb7fd0
- **Port (if running a server):** n/a
- **Status:** open

## Goal
A `V:` declaration in the file header before the first `X:` loses its `clef=` (pre-existing; found in PR #62 review, `gh pr view 62 --comments`). Make file-header `V:` declarations behave like tune-header ones for clef, name, transpose and `%%MIDI` attribution, within the first-tune scoping rules from PRs #61/#62 (see `docs/handoffs/2026-11-10-0006-abc-directive-scoping--codex-to-lead.md`). If abcjs itself drops the clef and it can't be recovered from source offsets safely, stop and report instead.

## Files you own
`packages/pepperscore/src/lib/import.ts` (ABC code only), `packages/pepperscore/src/lib/abc-import.test.ts`, `packages/pepperscore/src/lib/__fixtures__/abc/**`, your own 0008 handoff files. Don't touch `notation/**` or the README (parallel tasks own them).

## Acceptance criteria
- [ ] Test: `V:1 clef=bass` before `X:1` imports a bass-clef part; same with `treble-8` (octave transposition applied); tune-header `V:` still overrides a file-header one for the same id.
- [ ] All 66 existing ABC tests pass.
- [ ] "For the ABC guide" note in the return handoff.

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run test -w pepperscore -- --run src/lib/abc-import.test.ts
npm run check && npm run build && npm run test:manifest && npm run test:validation
```
Run long commands in the foreground; never overlap `build` with reader tests.

---
## Receiver ack
