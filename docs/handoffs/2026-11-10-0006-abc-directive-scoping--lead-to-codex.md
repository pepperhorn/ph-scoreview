# Handoff: 0006 — [quick] ABC directive scoping: body-only voices and header K: before X: (lead → codex)

- **Date:** 2026-11-10
- **Type:** quick
- **Ledger:** 0006 (suggestions S2, S3) · **Spec:** docs/specs/0004-abc-import-parity.md (follow-up) · **Plan:** none
- **Branch:** orch/0006-abc-directive-scoping · **Worktree:** created by T3
- **Base commit:** 2b4d032
- **Status:** open

## Goal
One concern: `parseAbc`'s source scan that attributes `V:` and `%%MIDI` lines (`packages/pepperscore/src/lib/import.ts` ~193–200, from PR #61).
- **S2:** when voices are declared only in the body (no header `V:`), a body `%%MIDI` line is dropped. It must follow the README rule (`packages/pepperscore/README.md` "ABC headers", ~line 517): a body directive after a `V:` selector applies to that voice; one before any selector applies to the first voice (or the implicit default voice).
- **S3:** a `K:` in the file header before the first `X:` makes every `V:` count as body music. File-header lines before `X:` must never end the tune header; the tune header ends at the tune's own first `K:`.
Context: PR #61 review r3 (`gh pr view 61 --comments`), `docs/handoffs/2026-11-09-0004-t2-abc-parts-and-instruments--codex-to-lead.md` (Decisions made).

## Files you own
`packages/pepperscore/src/lib/import.ts` (ABC code only), `packages/pepperscore/src/lib/abc-import.test.ts`, `packages/pepperscore/src/lib/__fixtures__/abc/**`, `packages/pepperscore/README.md` (ABC section only: add one line linking `docs/guides/abc-authoring.md` in the repo as the authoring guide), your own 0006 handoff files. Don't touch `notation/document.ts` (another task owns it).

## Acceptance criteria
- [ ] Tests: body-only voices with per-voice `%%MIDI program`/`channel 10`/`transpose`; a body `%%MIDI` before any selector goes to the first voice; a file with `K:` before `X:` and header `V:` lines imports those voices with their names, clefs and MIDI settings.
- [ ] All existing 60 ABC tests still pass; multi-tune scoping from PR #61 unchanged.
- [ ] Return handoff has a "For the ABC guide" note listing any author-visible behaviour change.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run test -w pepperscore -- --run src/lib/abc-import.test.ts
npm run check && npm run build && npm run test:manifest && npm run test:validation
```
Run long commands in the foreground; don't overlap build with reader tests.

---
## Receiver ack

I will fix only the ABC source scan so body-only voice selectors receive their own MIDI directives, pre-selector body directives belong to the first voice (or implicit default), and file-header K: before X: cannot end the tune header. I will add scoped regressions, retain first-tune isolation, add the README authoring-guide link, run the prescribed verification sequentially, and commit a return handoff and draft PR. No open questions; notation/document.ts and the ledger are outside my scope.

GBrain consulted: projects/scoreflow-music-reader/gotchas-abc-import (source offsets, first-tune isolation, abcjs folded MIDI) and projects/scoreflow-music-reader. Base 2b4d032 is an ancestor of the clean starting HEAD.
