# Handoff: 0029 — [quick] Editor pack check in CI + prepublish guard (0025 follow-ups) (lead → codex)

- **Date:** 2026-11-12
- **Type:** quick
- **Ledger:** 0029
- **Branch:** orch/0029-editor-pack-ci · **Worktree:** created by T3
- **Base commit:** 7c2da17
- **Status:** open

## Goal
Two follow-ups from 0025 (#93), before the editor is published to GitHub Packages:
1. **Pack check in CI without touching `ci.yml`.** CI's validate job already runs `npm run test:pack` (`.github/workflows/ci.yml:50`). Make root `test:pack` also run the editor check (`scripts/pack-editor.mjs`, currently `test:pack:editor` only). For example: `"test:pack": "node scripts/pack-smoke.mjs && node scripts/pack-editor.mjs"`. Keep `test:pack:editor` for running it alone. Measure the extra time; the CI step timeout is 12 min (ci.yml:52). If it pushes close to that, report it rather than editing ci.yml (0027 owns ci.yml).
2. **Prepublish guard.** Add a `prepublishOnly` to `packages/pepperscore-editor/package.json` that fails if `dist/index.js`, `dist/index.d.ts` or `dist/style.css` is missing or older than `src/`. Building in it is fine too; pick one and record why. This stops an empty or stale tarball reaching GitHub Packages. `pack-editor.mjs` must still work.

## Files you own
- root `package.json` (`scripts` only, no dependency changes)
- `packages/pepperscore-editor/package.json` (`scripts` only)
- a small guard script if needed (`packages/pepperscore-editor/scripts/prepublish-guard.mjs`)
- your own 0029 handoff files

## Acceptance criteria
- [ ] `npm run test:pack` runs both checks and passes. Record the added time.
- [ ] `npm publish --dry-run -w @pepperhorn/pepperscore-editor` fails cleanly with `dist` removed and passes after a build. Never run a real publish.

## Verify with
```bash
npm ci && npm run check && npm run build && npm run test:manifest && npm run test:pack
rm -rf packages/pepperscore-editor/dist && npm publish --dry-run -w @pepperhorn/pepperscore-editor; npm run build -w @pepperhorn/pepperscore-editor && npm publish --dry-run -w @pepperhorn/pepperscore-editor
```
