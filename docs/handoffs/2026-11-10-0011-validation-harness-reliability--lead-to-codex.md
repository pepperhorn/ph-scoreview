# Handoff: 0011 — [quick] Validation harness reliability: ephemeral ports and load-aware timing gates (lead → codex)

- **Date:** 2026-11-10
- **Type:** quick
- **Ledger:** 0011 (suggestions S12, S14; S13 is fixed for skin.mjs in PR #72)
- **Branch:** orch/0011-validation-harness · **Worktree:** created by T3
- **Base commit:** 31b29b5
- **Status:** open

## Goal
One concern: browser/server validation must not give false failures when several worktrees run suites at once.
1. **Ports:** scripts hard-code ports (e.g. `validation/document.mjs:13` 43982, `performance.mjs:15` 43981, `parser-diff.mjs:20` 43984, `clock-contract.mjs:13` 43986, `transpose.mjs:137` 43991) and will happily talk to another worktree's server on that port. Give every harness a free ephemeral port: `listen(0)` for `node:http` servers; for spawned Vite, pick a free port first (shared helper, e.g. new `validation/lib/ports.mjs`) and pass `--strictPort` so a collision fails loudly instead of attaching or moving silently. Grep all of `validation/` (and `scripts/` used by validation) for any other fixed port.
2. **Timing gates:** `validation/editor.mjs:518` (every change-to-redraw under 800 ms) and `validation/large-score.mjs:35` (no main-thread task over 200 ms) fail locally under parallel load (they fail on main too). Keep them strict in CI; locally make them load-aware with one shared scale, generalising the existing `LARGE_SCORE_BUDGET_SCALE` (`large-score.mjs:25`) into a `VALIDATION_BUDGET_SCALE` env var (default 1 in CI; locally default 1 too, but print a clear hint naming the variable when a timing gate fails). Optionally sample the redraw gate as a median of several runs rather than every single run, if that keeps it meaningful; record the decision.
Also fix `editor.mjs:354`'s null click target (custom-layout scenario) if it's a wait/race in the harness; if it's an app bug, stop and report.

## Files you own
`validation/*.mjs` **except** `validation/skin.mjs` and `validation/pdf.mjs` (open PRs #72 and #71 own those), new `validation/lib/**`, `.github/workflows/ci.yml` only if an env var must be set there (CI change: say so in the return handoff), your own 0011 handoff files. No app/library code.

## Acceptance criteria
- [ ] No fixed port left in the owned files (grep shown in the return handoff); Vite spawns use `--strictPort` with a checked free port.
- [ ] Two copies of `npm run test:document` (or another server-backed suite) run concurrently from two shells both pass.
- [ ] Timing gates unchanged in CI; the scale var and failure hint work locally.
- [ ] Full `npm run test:validation` passes.

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run check && npm run build && npm run test:manifest && npm run test:validation
```

---
## Receiver ack

I will isolate owned validation servers with ephemeral ports and strict Vite startup, share explicit timing-budget scaling and local failure hints, and investigate the custom-layout click race without changing app code. I own only the listed validation files/new lib helpers and my 0011 handoffs; skin.mjs, pdf.mjs, app/library code and the ledger remain outside scope. I will run the required checks, concurrent server proof, and full validation, then push the task branch and open a draft PR. No scope questions.
