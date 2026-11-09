# Handoff: 0001-t2 — Composable main bar and toggles (lead → codex)

- **Date:** 2026-11-10
- **Type:** dispatch
- **Ledger:** 0001 · **Spec:** docs/specs/0001-composable-player-skins.md · **Plan:** docs/plans/0001-composable-player-skins.md (task T2)
- **Branch:** orch/0001-t2-skin-bar · **Worktree:** created by T3
- **PR:** <url once opened>
- **Base commit:** 7eb7fd0
- **Port (if running a server):** 5212
- **Status:** open

## Goal
`skin.bar` renders a composable main bar of controls (including new `noteNames`, `counts`, `chordSymbols`, `options`, `instrumentSwitch` toggles) on `full` and `minimal`, per plan task T2 and spec AC2, AC2b, AC3, AC4, AC7.

## Context you need
- Spec: `docs/specs/0001-composable-player-skins.md`; plan task T2 (interfaces `resolveBar`, `resolveChrome`, and all Notes / gotchas): `docs/plans/0001-composable-player-skins.md`.
- T1 return handoff (merged as PR #59), especially "Known gotchas / decisions made" (inline-try dev warning, registering new CSS variables in the static guard): `docs/handoffs/2026-11-01-0001-t1-skin-module-and-tokens--codex-to-lead.md`.
- GBrain: `projects/scoreflow-music-reader`; memory note: phone controls go in a bottom toolbar, occasional ones in the header.

## Scope
- **In:** plan T2 exactly.
- **Out:** T3 drawer controls, T4 pitch colours, T5 docs/changelog; anything ABC.
- **Files you own:** `packages/pepperscore/src/lib/bar-items.ts` (new), `lib/bar-items.test.ts` (new), `lib/chrome.ts`, `lib/header-controls.ts`, `components/SkinBar.tsx` (new), `components/PepperScore.tsx`, `src/styles.css`, `validation/skin.mjs`, `apps/reader/src/embed/SkinTest.tsx`, plus your own 0001-t2 handoff files.
- **Do not touch:** `lib/import.ts`, `lib/notation/**`, `packages/pepperscore-editor/**`, the package README, the ledger. Other tasks run in parallel on those.

## Acceptance criteria
- [ ] AC2, AC2b, AC3, AC4, AC7 from the spec, with `resolveBar` unit tests for every rule in the plan.
- [ ] Contextual class names on new elements; Poppins; container queries only.

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run check && npm run build && npm run test:skin && npm run test:embed && npm run test:layout && npm run test:reader
npm run test:manifest && npm run test:validation
```
Run long commands in the foreground; never overlap `build` with reader tests.

## Open questions
None. Escalate per AGENTS.md §7.

---
## Receiver ack

I will implement T2 only: resolve and render ordered skin bars on full/minimal, preserve default chrome, connect annotation toggles to existing prefs, and enable the instrument switcher on both presets. I own only the listed files and task handoffs. I will run the specified verification, open a draft PR, and return evidence without merging or watching. No open questions. GBrain consulted: projects/scoreflow-music-reader.
