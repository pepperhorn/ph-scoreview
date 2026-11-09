# Handoff: 0007 — [quick] Package README carries the ABC authoring rules (S4, S6) (lead → codex)

- **Date:** 2026-11-10
- **Type:** quick
- **Ledger:** 0007 (suggestions S4, S6)
- **Branch:** orch/0007-readme-abc-authoring · **Worktree:** created by T3
- **PR:** <url once opened>
- **Base commit:** 7eb7fd0
- **Port (if running a server):** n/a
- **Status:** open

## Goal
The package README's "ABC headers" section links to `docs/guides/abc-authoring.md`, a path that doesn't exist for npm readers (private repo, no `repository` field). Make the README self-sufficient: fold the guide's author-facing content (quick checklist, rules, the four templates, known limits) into the README's ABC section, and drop the repo-relative link. Also rewrite the unclear sentence on body directives before the first voice selector (S6) to match current behaviour: one before any selector applies to the first voice, unless notes or a barline come before every selector, in which case it belongs to that implicit default voice and later voices don't inherit it. Source text: `docs/guides/abc-authoring.md` (lead keeps it as the change-log ledger and will point it at the README). Don't change behaviour or code.

## Files you own
`packages/pepperscore/README.md` (ABC section only), your own 0007 handoff files.

## Acceptance criteria
- [ ] No repo-relative or `docs/` link in the package README's ABC section; content matches the guide's rules and templates (fix any template that doesn't import as documented, and say so in the return handoff).
- [ ] Each ABC template in the README is parsed by `parseAbc` in a scratch check and imports as described (report the result; don't add files outside your ownership).
- [ ] "For the ABC guide" note in the return handoff.

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run check && npm run build && npm run test:manifest && npm run test:validation
```

---
## Receiver ack
