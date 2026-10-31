# Handoff: 0001-t1 — Skin module and theme tokens (lead → codex)

- **Date:** 2026-11-01
- **Type:** dispatch
- **Ledger:** 0001 · **Spec:** docs/specs/0001-composable-player-skins.md · **Plan:** docs/plans/0001-composable-player-skins.md (task T1)
- **Branch:** orch/0001-t1-skin-tokens · **Worktree:** created by T3
- **PR:** to be opened by the implementer
- **Base commit:** 320bd6f9913854ddf88d06cf3b863ba168c5096c
- **Port (if running a server):** 5211
- **Status:** open

## Goal
`pepperscore` gains a `skin` prop whose `theme` can set every interface colour through role-named tokens, and exports the skin module for JS and TS callers. With no skin, the player looks and behaves exactly as today.

## Context you need
Read the spec in full, then plan task T1, which holds the interfaces and gotchas. Later tasks consume the interfaces T1 produces, so keep those names exactly.

## Scope
- **In:** `lib/skin.ts` with all exports listed in T1 (including `BAR_ITEM_IDS`, `CRF_PITCH_COLOURS`, `mergeSkins`, and the `pitchColours` and `bar` fields as types); the `skin` prop applying `theme` only; the colour audit of the stylesheets; the fixture page and `validation/skin.mjs`.
- **Out:** rendering `skin.bar`, toggles, drawer changes, pitch colouring (T2–T4). Those fields exist in the type but do nothing yet. No version bump.
- **Files you own:** the **Owns** list of plan task T1, plus your own handoff files.
- **Do not touch:** anything else, including `lib/render.ts`, `lib/chrome.ts` and `docs/wip/LEDGER.md`.

## Acceptance criteria
- [ ] AC1, AC5, AC6 and AC8d from the spec
- [ ] Default rendering is pixel-identical: every `var()` fallback is today's value

## Verify with
```bash
npm run check && npm run build && npm run test:css && npm run test:skin && npm run test:reader
```
Before opening the PR, also run the full `npm run check && npm run build && npm run test:manifest && npm run test:validation` and paste the tail.

## Known gotchas / decisions already made
- Worktree setup: `npm ci && npx playwright-core install chromium`. `/tests/` and `/examples/` are gitignored and absent from worktrees; don't rely on them.
- Dev server, if needed: port 5211, `--host 0.0.0.0`. A 504 "Outdated Optimize Dep" means restart with `--force`.
- `styles.css` keeps most rules on line 21, so make replacements programmatically and check them. `npm run test:css` rejects unscoped selectors, viewport units and `position:fixed`.
- Tokens go on the `.pepperscore` root as inline style so `var(--host-token)` resolves from the host page. Changing a skin must not re-engrave: don't add it to engrave dependencies.
- Keep the existing `--ps-cursor`, `--ps-selection`, `--ps-transposed`, `--ps-out-of-range` names.
- An invalid token value isn't caught by a `var()` fallback: see plan Risks, and warn in development.
- GBrain: see projects/scoreflow-music-reader. No specific theming gotchas found.

## Open questions
None.

---
## Receiver ack

Acknowledged 2026-11-01 by Codex. I will implement the exact T1 public skin interfaces, theme-only prop/root styles, complete colour-token audit, and executable API/browser validation within the T1 owned files. Existing fallback colours and engraving dependencies will remain unchanged. Bar and pitch fields are data only in T1. No open questions. GBrain consulted: `default:projects/scoreflow-music-reader`; repository spec and plan govern current implementation.

---
## Return (implementer → lead; fill in when done, or in a separate …-to-lead.md)
