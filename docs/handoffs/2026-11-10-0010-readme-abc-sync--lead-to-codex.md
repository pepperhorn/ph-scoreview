# Handoff: 0010 — [quick] README ABC section: sync with 0008 (lead → codex)

- **Date:** 2026-11-10
- **Type:** quick
- **Ledger:** 0010
- **Branch:** orch/0010-readme-abc-sync · **Worktree:** created by T3
- **Base commit:** 8c19b8f
- **Status:** open

## Goal
PR #67 (0008) made `V:` lines before `X:` work as voice defaults, so the package README's ABC section is now wrong in four places (`packages/pepperscore/README.md` ~515, ~516, ~526, ~629). Bring them in line with the lead's guide, `docs/guides/abc-authoring.md` on main (checklist items 2 and 4, "Tune and header" rule, Known limits): `%%score`/`%%staves` before `V:`; `V:` before `X:` supplies clef/name/transposition defaults that a tune-header `V:` overrides per property; body music before any selector goes to the first declared voice, so select voices explicitly; remove the "`V:` before `X:` has its clef ignored" limit. Docs only; verify the wording against `packages/pepperscore/src/lib/import.ts` and `abc-import.test.ts`.

## Files you own
`packages/pepperscore/README.md` (ABC section only), your own 0010 handoff files.

## Acceptance criteria
- [ ] The four spots match current behaviour and the guide; nothing else changes.
- [ ] "For the ABC guide" note in the return handoff (expected: none).

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run check && npm run build
```

---
## Receiver ack
