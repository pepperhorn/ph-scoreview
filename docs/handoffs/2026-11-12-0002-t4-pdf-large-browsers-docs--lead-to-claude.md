# Handoff: 0002-t4 — PDF export: large scores, browsers and docs (lead → claude)

- **Date:** 2026-11-12
- **Type:** dispatch
- **Ledger:** 0002 · **Spec:** docs/specs/0002-pdf-export.md · **Plan:** docs/plans/0002-pdf-export.md (task T4)
- **Branch:** orch/0002-t4-pdf-large-browsers-docs · **Worktree:** created by T3
- **Base commit:** ab759a8 (main after 0001-t5 merged)
- **Port (if running a server):** 5240
- **Status:** open

## Goal
Finish PDF export (item 0002). It must meet these acceptance criteria:
- **AC10:** the large-score fixture exports without freezing the page, and the export can be cancelled.
- **AC11:** export passes in Chromium, Firefox **and WebKit**.

Also update the docs (README and CHANGELOG `Unreleased`, and mark phase 2 done in `docs/specs/pepperscore-plugins-and-embeds.md`).

## Context you need
- Spec and plan above. Read T1–T3's return handoffs in `docs/handoffs/` (`*0002-t1*`, `*0002-t2*`, `*0002-t3*`) for the page model, composition, and overlay.
- Composition runs on the main thread (svg2pdf needs a DOM). Compose page by page and **yield between pages**, for example with `await new Promise(r => setTimeout(r))` or `scheduler.yield` when it's available. Check an AbortSignal between pages so Cancel works. Show progress if the overlay has room for it.
- **Known WebKit blocker (ledger S34), now in scope for you.** `BROWSER=webkit node validation/pdf.mjs` fails on `main`:
  - It times out at about `validation/pdf.mjs:765`, waiting 60 s for "Paper size" after the lazy chunk is aborted, unrouted and the page reloaded.
  - Separately, there's an intermittent strict-locator failure: two `.pdf-trigger` buttons after the reload.
  - See `docs/handoffs/2026-11-11-0022-safari-pitch-outline--codex-to-lead.md` for details.
  - Find the root cause (product bug vs test bug) and fix it properly. Don't weaken the assertion.
- **Large-score fixture:** see the `validation/large-score.mjs` fixture. Measure the export time and the longest main-thread block (a long-task observer is fine) in all three engines, and report the numbers in the PR.
- **CI:** the plan says to add `test:pdf` to the CI browser matrix. CI minutes are a cost concern (memory: GitHub Actions bill; 0021/0024).
  - Add the Firefox and WebKit PDF runs as **steps inside the existing `reader` job**, which is PR-only and already runs in the Playwright container. Don't add a new job.
  - Keep `runs-on: ${{ fromJSON(vars.CI_RUNS_ON || '"ubuntu-latest"') }}` untouched.
  - Raise the job timeout only if you have to, and say why.
- **Local timing gates are noisy** when other agents share the host. Use `VALIDATION_BUDGET_SCALE=2` for the timing suites if they fail on load, and say so. Never change budgets.

## Scope
- **In:** cooperative, cancellable page-by-page composition; the WebKit overlay recovery fix; PDF validation for all 3 engines; reader-job CI steps; docs.
- **Out:** overlay templates or stamping (0015); new paper sizes or new features; S32 (chord/tempo overlap in the PDF), unless it's trivial and falls inside `lib/pdf/**`.
- **Files you own:**
  - `validation/pdf.mjs`
  - `packages/pepperscore/src/lib/pdf/**`
  - the PDF overlay component and its section of `PepperScore.tsx`. That's only if the S34 root cause is there, and only the PDF trigger/overlay code; note it in the return handoff.
  - `packages/pepperscore/README.md`, `packages/pepperscore/CHANGELOG.md`
  - `.github/workflows/ci.yml` (the reader job steps only)
  - `docs/specs/pepperscore-plugins-and-embeds.md` (phase 2 status)
  - your own 0002-t4 handoff files
- **Do not touch:**
  - `packages/pepperscore-editor/**`, root `package.json`/lockfile and `apps/reader/**` (0025 is in flight there)
  - `lib/tab/**`
  - styles.css, except PDF-overlay rules if S34 needs them

## Acceptance criteria
- [ ] AC10: large-score export keeps the page responsive (report the longest task; target under 200 ms per page-composition slice) and Cancel stops it promptly with no leaked worker or overlay state. Validation asserts both.
- [ ] AC11: `npm run test:pdf`, `BROWSER=firefox npm run test:pdf` and `BROWSER=webkit npm run test:pdf` all pass locally, with S34 fixed at its root cause.
- [ ] CI runs PDF validation for Firefox and WebKit inside the PR-only reader job, and the PR's CI is green.
- [ ] README documents PDF export (API, options, cancel, browser support); CHANGELOG `Unreleased` lists the changes.
- [ ] Full verify passes.

## Verify with
```bash
npm ci && npx playwright-core install chromium firefox webkit
npm run check && npm run build && npm run test:manifest && npm run test:validation
npm run test:pdf && BROWSER=firefox npm run test:pdf && BROWSER=webkit npm run test:pdf
```

## Known gotchas / decisions already made
- GBrain: `projects/scoreflow-music-reader`.
- PDF code is lazy-loaded; keep the initial bundle size unchanged and report any gzip delta.
- The Firefox PDF fix from 0020 must keep working.
- Note-text SVG style and pitch-colour rules (0022) must keep their PDF parity checks passing.

---
## Receiver ack
