# Handoff: 0001-t5 — becreative fixture, docs and changelog (lead → claude)

- **Date:** 2026-11-11
- **Type:** dispatch
- **Ledger:** 0001 · **Spec:** docs/specs/0001-composable-player-skins.md · **Plan:** docs/plans/0001-composable-player-skins.md (task T5)
- **Branch:** orch/0001-t5-skins-docs · **Worktree:** created by T3
- **Base commit:** 15135bd (pepperscore 0.5.0 published from 9a3ab8c)
- **Port (if running a server):** 5215
- **Status:** open

## Goal
Plan T5 (spec AC8, AC9): a becreative-styled skin fixture in the reader's embed test page (copying becreative's `.accent-blue`, `.accent-orange` and pink tokens from `/home/shaun/becreative/src/styles/custom.css:785` and the spec's bar), tested at 1280px and 390px across `reader` and `snippet` shapes (`static` shows no bar), plus README examples for JS and TS. 0.5.0 is already released: the README already documents `skin`, pitch colours and the bar (added by PR #85) — extend it with the worked becreative example rather than rewriting; add an **Unreleased** section to the CHANGELOG only if something user-visible changes. Do not bump the version.

## Context you need
- Spec + plan T5 notes (links above); T1–T4 return handoffs in `docs/handoffs/` (2026-11-01-0001-t1…, 2026-11-10-0001-t2…, 2026-11-10-0001-t3…, 2026-11-11-0001-t4…).
- Current README sections on skins/pitch colours (from PR #85).
- **CI cost:** every push runs paid CI (docs-only changes under `docs/**` don't). Run all checks locally and push once when green.

## Scope
- **Files you own:** `apps/reader/src/embed/SkinTest.tsx`, `apps/reader/src/embed/host.css`, `validation/skin.mjs`, `packages/pepperscore/README.md`, `packages/pepperscore/CHANGELOG.md` (Unreleased section only), your own 0001-t5 handoff files.
- **Do not touch:** library source, `src/styles.css` (quick item 0022 in flight), the ledger.

## Acceptance criteria
- [ ] Spec AC8, AC9; fixture + validation at 1280px and 390px for reader and snippet; static shows no bar.
- [ ] README JS and TS examples compile (type-check them in a scratch file or doc test).

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run check && npm run build && npm run test:skin && npm run test:embed && npm run test:manifest && npm run test:validation
```
Build before browser suites; use `VALIDATION_BUDGET_SCALE=2` for a load-sensitive timing gate and record both results.

---
## Receiver ack

**Ack (claude, 2026-11-11):** I add a becreative-token fixture to the reader's skin test page (`/embed-skin?becreative`): host CSS copies becreative's `.accent-blue/.accent-orange/.accent-pink` scopes; the skin maps `accent`→`--accent-ink`, wash roles→`--accent-wash(-strong)`, focus→`--accent`, with the spec's seven-item bar. Three shapes: reader = `chrome=full`, snippet = `chrome=minimal`, static = `chrome=none` (theme only, no bar). `validation/skin.mjs` gets a block that checks bar order, switches blue→orange→pink with no re-engrave, at 1280px and 390px. README gets a worked becreative JS and TS example, type-checked in a scratch file. CHANGELOG gets an Unreleased section only if user-visible behaviour changes. No library, `src/styles.css`, ledger or version edits. One note: becreative's `--accent-ring` is a box-shadow value, not a colour, so `focusRing` can't take it. I'll use `--accent` and record this in the return handoff.
