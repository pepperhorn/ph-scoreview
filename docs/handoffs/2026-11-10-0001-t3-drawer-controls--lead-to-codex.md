# Handoff: 0001-t3 — Drawer gains the missing controls, plus T2 review follow-ups (lead → codex)

- **Date:** 2026-11-10
- **Type:** dispatch
- **Ledger:** 0001 · **Spec:** docs/specs/0001-composable-player-skins.md · **Plan:** docs/plans/0001-composable-player-skins.md (task T3)
- **Branch:** orch/0001-t3-drawer-controls · **Worktree:** created by T3
- **PR:** <url once opened>
- **Base commit:** 13d48eb (T2 merged as PR #66)
- **Port (if running a server):** 5213
- **Status:** closed

## Goal
1. Plan T3 / AC2a: with a skin that omits them, `stop`, `viewToggle`, `bars`, `zoom`, `mixer` and `openFile` work from a new drawer "Playback and view" panel (`drawerExtras`); with no skin, no new drawer rows.
2. Follow-ups from PR #66 review (`gh pr view 66 --comments`), lead decisions:
   - **Phone placement (spec line ~142):** with a skin bar on phones, frequent controls (play/pause and the other playback controls) go in the bottom toolbar and occasional ones (e.g. `instrumentSwitch`, `options`) in the header, like the reader without a skin. T2 currently puts play and the instrument switcher in the top header on phones. Fix it and add a phone-viewport assertion.
   - **Empty bar:** when no listed bar item can be shown (e.g. `['pdf']`, or `['instrumentSwitch']` on a single-part score), render no header bar at all (`lib/chrome.ts` ~37). Add a `resolveChrome` unit test.
   - **Fixed test port:** `validation/skin.mjs` (~436) binds a fixed port (5212; earlier 5211), so parallel worktrees collide. Use an ephemeral port (listen on 0 and read the assigned port).

## Context you need
- Spec and plan task T3 (interface `drawerExtras` and its gotchas: render each header element in one place only; move `openFile`'s hidden input out of the `chrome.header` block): links above.
- T2 return handoff: `docs/handoffs/2026-11-10-0001-t2-skin-bar--codex-to-lead.md`; T1 return handoff (CSS variable registration, inline-try warnings): `docs/handoffs/2026-11-01-0001-t1-skin-module-and-tokens--codex-to-lead.md`.
- Memory note in the spec: phone frequent controls bottom, occasional in header.

## Scope
- **In:** the three items above.
- **Out:** T4 pitch colours, T5 docs; PDF (0002 runs in parallel).
- **Files you own:** `packages/pepperscore/src/components/DrawerControls.tsx` (new), `components/PepperScore.tsx`, `src/styles.css`, `lib/chrome.ts`, `lib/bar-items.ts`, `lib/bar-items.test.ts`, `components/SkinBar.tsx`, `validation/skin.mjs`, plus your own 0001-t3 handoff files.
- **Do not touch:** `lib/pdf/**`, `lib/notation/**`, `lib/import.ts`, root `package.json`, `packages/pepperscore-editor/**`, the ledger.

## Acceptance criteria
- [ ] AC2a, with `drawerExtras` unit-tested (`[]` when bar is null).
- [ ] Phone viewport (< 580px) with the becreative-style skin bar: play in the bottom toolbar; no clipped items; test asserts it.
- [ ] No empty header bar; unit test.
- [ ] `test:skin` uses an ephemeral port.

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run check && npm run build && npm run test:skin && npm run test:embed && npm run test:layout && npm run test:reader
npm run test:manifest && npm run test:validation
```
Foreground, never overlap `build` with browser tests. If a timing gate fails (editor redraw 800 ms, large-score 200 ms), rerun that suite alone and note both results; they also fail on main under load.

## Open questions
None. Escalate per AGENTS.md §7.

---
## Receiver ack

Acknowledged: I will add the six omitted, available controls to a Playback and view drawer panel, preserving no-skin rendering and single-mounted refs. I will also fix phone playback placement, suppress empty composed headers, and use an ephemeral skin-validation port. Only the declared owned files and my task handoffs will change. No open questions. GBrain consulted: projects/scoreflow-music-reader (historical context); the linked spec and plan govern implementation.
