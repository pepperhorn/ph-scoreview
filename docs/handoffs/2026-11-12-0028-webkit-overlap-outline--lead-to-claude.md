# Handoff: 0028 — [quick] WebKit hairline outline on overlapping reader marks (S36) (lead → claude)

- **Date:** 2026-11-12
- **Type:** quick
- **Ledger:** 0028
- **Branch:** orch/0028-webkit-overlap-outline · **Worktree:** created by T3 · **Port:** 5480
- **Base commit:** 7c2da17
- **Status:** open

## Goal
Fix S36 in `docs/wip/LEDGER.md`, raised in PR #91 review r1. In WebKit, when pitch colours are on and two reader marks overlap on one note, the note keeps a ~1-unit outline in the other mark's colour. The two cases are playing + transposed, and a transposed chord with a note selected.

Start from the pitch-colour rules near `packages/pepperscore/src/styles.css:491` (`[data-ps-pitch-colours] .is-playing .notehead[data-pitch]`) and the `.ps-transposed`, `.ps-selection` and `.is-playing` rules at line 21. Background is in #91's return handoff (`docs/handoffs/*0022*--*-to-lead.md`): WebKit `<use>` resolves `currentColor` differently.

The review suggested two fixes:
- scope the playing selector to `.reader-note.is-playing .notehead[data-pitch]`;
- the chord case needs a non-selector fix.

Confirm the cause in WebKit before you fix it. Chromium and Firefox rendering must not change.

## Files you own
- `packages/pepperscore/src/styles.css` (mark and pitch-colour rules only)
- the code that applies these mark classes, only if the chord case needs it (name the file in the return handoff)
- `validation/pdf.mjs` or `validation/skin.mjs`: a WebKit assertion that reproduces both cases (pick whichever already covers pitch-colour outlines from #91)
- your own 0028 handoff files

## Acceptance criteria
- [ ] Both overlap cases render without a foreign-colour outline in WebKit. The new assertion fails on the base commit and passes after the fix (record both runs).
- [ ] The #91 assertions still pass in chromium, firefox and webkit.

## Verify with
```bash
npm ci && npx playwright-core install chromium webkit firefox
npm run check && npm run build && npm run test:manifest && npm run test:validation
BROWSER=webkit npm run test:pdf; BROWSER=webkit npm run test:skin
```
On a loaded host, use `VALIDATION_BUDGET_SCALE=2` for timing-only failures.
