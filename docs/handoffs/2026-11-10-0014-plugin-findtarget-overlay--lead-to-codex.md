# Handoff: 0014 — [quick] findTarget ignores the plugin's own overlay (S20) (lead → codex)

- **Date:** 2026-11-10
- **Type:** quick
- **Ledger:** 0014 (suggestion S20)
- **Branch:** orch/0014-plugin-findtarget-overlay · **Worktree:** created by T3
- **Base commit:** 08e0102 (0003 T3 merged as PR #76)
- **Status:** open

## Goal
`findTarget` in `packages/pepperscore-editor/src/plugin/host.ts` (~line 33) uses a centre `elementFromPoint` check, so when a plugin draws its own overlay over the editor (e.g. a click-blocking spotlight backdrop for the tour), the hit lands on the overlay and `findTarget` returns null. Use `elementsFromPoint` and ignore hits inside `[data-ps-plugin]`, so a visible target under the plugin's own overlay is still found; anything else covering it (another editor element) still counts as hidden. Context: PR #76 review r2 (`gh pr view 76 --comments`).

## Files you own
`packages/pepperscore-editor/src/plugin/host.ts`, `packages/pepperscore-editor/src/plugin/host.test.ts`, `validation/editor.mjs` (one stub-plugin case with a full-screen backdrop), `apps/reader/src/embed/` stub plugin file if the backdrop option is needed there, your own 0014 handoff files.

## Acceptance criteria
- [ ] With the stub plugin's full-screen backdrop on, every `EditorTarget` that was found before is still found after `revealTarget` at 1280, 900 and 390px; a target covered by a non-plugin editor element still returns null.

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run test:editor && npm run build && npm run test:editor-browser && npm run test:editor-phone && npm run check
```

---
## Receiver ack
I will use the centre hit stack to ignore plugin-owned overlays while preserving non-plugin occlusion, clipping and visibility checks. I will change only the owned host, tests, browser validation, optional stub plugin and 0014 handoffs, then run the specified verification and open a draft PR. No open questions. Base 08e0102 is an ancestor of the clean starting HEAD 113540a.

GBrain checked: `default:projects/scoreflow-music-reader` and `default:projects/scoreflow-music-reader/gotchas-abc-import` (build before browser suites; validation uses free ports). No GBrain writes as implementer.
