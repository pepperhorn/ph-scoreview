# Handoff: 0026 — [quick] Release pepperscore 0.5.1: CHANGELOG and version (lead → codex)

- **Date:** 2026-11-12
- **Type:** quick
- **Ledger:** 0026
- **Branch:** orch/0026-release-0-5-1 · **Worktree:** created by T3
- **Base commit:** 86bb9bf (main after #94)
- **Status:** open

## Goal
Prepare the human-approved `pepperscore` 0.5.1 release:
- Bump `packages/pepperscore/package.json` from 0.5.0 to 0.5.1, along with its entry in the root `package-lock.json`.
- Turn `## Unreleased` in `packages/pepperscore/CHANGELOG.md` into `## 0.5.1 - 2026-11-12`, in the existing style.

Publishing is **not** part of this task. The human runs `npm login` and then publishes, as separate steps.

## Context you need
Merged into `packages/pepperscore` since 0.5.0 (`9a3ab8c`). Read each item's return handoff in `docs/handoffs/` for user-facing wording:
- **0002-t4 (#94):** cooperative and cancellable PDF export, WebKit verification, and lazy-chunk recovery on Vite/native-ESM hosts. Already in Unreleased; check the wording.
- **0022 (#91):** pitch-colour outlines drew solid black in Safari/WebKit; they now use the outline colour. *Missing from Unreleased: add it under Fixed.*
- **0023 (#92):** violin and cello finger TAB stays in position more, so there are fewer position labels and shifts (cello fixture: 84 → 55 changes). *Missing: add it under Changed.* Note that it's a display-only change in fingering choice.
- **0001-t5 (#90):** README worked skin example (becreative-style host tokens, `accentHover`). Docs only; add it only if a README change merits a line.
- **0024 (#89):** CI only. Skip it.
- **0025 (#93):** this is the separate `@pepperhorn/pepperscore-editor` package, not pepperscore. Skip it, unless it changed pepperscore's own published files (check `git diff 9a3ab8c..HEAD -- packages/pepperscore`).

The 0.5.0 entry says "Safari/WebKit PDF is not yet verified". Leave the historical text alone. The 0.5.1 Fixed entry already covers WebKit verification.

## Files you own
- `packages/pepperscore/package.json` (version only)
- root `package-lock.json` (pepperscore version entries only)
- `packages/pepperscore/CHANGELOG.md`
- your own 0026 handoff files

## Acceptance criteria
- [ ] Version 0.5.1 in package.json and the lock file. `npm run test:pack` passes, and the packed tarball reports 0.5.1.
- [ ] The CHANGELOG 0.5.1 section is accurate against the merged PRs; every bullet can be traced to one.

## Verify with
```bash
npm ci
npm run check && npm run build && npm run test:pack
```

---
## Receiver ack
