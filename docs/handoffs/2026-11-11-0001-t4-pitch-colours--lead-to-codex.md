# Handoff: 0001-t4 — Pitch colours and toggle tile (+ PDF parity, 0002 AC8a) (lead → codex)

- **Date:** 2026-11-11
- **Type:** dispatch
- **Ledger:** 0001 (also closes 0002 AC8a) · **Spec:** docs/specs/0001-composable-player-skins.md · **Plan:** docs/plans/0001-composable-player-skins.md (task T4)
- **Branch:** orch/0001-t4-pitch-colours · **Worktree:** created by T3
- **Base commit:** 03d0ac7 (0001 T1–T3 and 0002 T1–T2 merged)
- **Port (if running a server):** 5214
- **Status:** open

## Goal
With a skin palette, the user can colour every notehead by displayed pitch via a "Coloured notes" tile (drawer annotations panel, and bar item `pitchColours`), pref `pitchColours`, `settings.pitchColours` and `handle.setPitchColours(on)`. Plan T4 (AC8a–AC8c of spec 0001). **Plus:** exported PDFs show the same pitch colours with outlines (spec 0002 AC8a).

## Context you need
- Spec 0001 "Pitch colours" section (~lines 105–120) and plan T4 interfaces + gotchas (tag in the existing loop at `render.ts` ~661 on each notehead, displayed pitch, skip percussion/TAB, chunked paging, no re-engrave on toggle, CSS precedence of playing/selection/transposed/out-of-range, tile in the house note-text style, default-off must not change saved files).
- T1–T3 return handoffs (skin tokens, CSS variable registration in the static guard, bar items, drawer extras): `docs/handoffs/2026-11-01-0001-t1-…--codex-to-lead.md`, `docs/handoffs/2026-11-10-0001-t2-skin-bar--codex-to-lead.md`, `docs/handoffs/2026-11-10-0001-t3-drawer-controls--codex-to-lead.md`.
- PDF: spec `docs/specs/0002-pdf-export.md` AC8a; 0002-t2 return handoff `docs/handoffs/2026-11-10-0002-t2-pdf-composition--codex-to-lead.md` (CSS variables don't reach svg2pdf — paint inline `fill`/`stroke`; the three-pass note-text and stroke-scale handling in `lib/pdf/annotations.ts`; reviews on PR #78).
- House note-text style (global): white Poppins 600, `rgba(0,0,0,0.35)` stroke width 3, `paint-order: stroke`, centred.

## Scope
- **In:** plan T4; PDF pitch-colour parity (export applies the same palette when the pref is on, inline fills and outlines, scaled correctly).
- **Out:** T5 docs/changelog; the PDF button/overlay (0002 T3); fretless TAB.
- **Files you own:** plan T4 "Owns" list (`lib/pitch-colours.ts`, `lib/pitch-colours.test.ts`, `components/PitchColourTile.tsx` new; `lib/prefs.ts`, `lib/file-state.ts`, `lib/file-state.schema.json`, `lib/render.ts`, `components/PepperScore.tsx`, `src/styles.css`, `validation/skin.mjs`), plus `components/DrawerControls.tsx` and `lib/bar-items.ts` (tile + bar item), `lib/pdf/**` (pitch-colour painting in export only), `validation/pdf.mjs` (parity test), your own 0001-t4 handoff files.
- **Do not touch:** `lib/tab/**`, `lib/notation/**`, `packages/pepperscore-editor/**`, other validation files, docs, the ledger.

## Acceptance criteria
- [ ] Spec 0001 AC8a–AC8c with the plan's tests (two-note chord in two colours, transposed view colours follow displayed pitch, chunked paging, precedence of playing/selection/transposed/out-of-range, toggle without re-engrave, saved files unchanged when off).
- [ ] Spec 0002 AC8a: with pitch colours on, rasterised PDF noteheads match the screen colours with their outlines (test on a real Verovio page, scale ≠ 1).

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run check && npm run build && npm run test:skin && npm run test:score-db && npm run test:transpose && npm run test:chunks && npm run test:reader && npm run test:pdf
npm run test:manifest && npm run test:validation
```
Build before browser suites; under load rerun timing gates with `VALIDATION_BUDGET_SCALE=2` and record both.

## Open questions
None. Escalate per AGENTS.md §7.

---
## Receiver ack

Acknowledged: implement displayed-pitch notehead tags, palette-driven colours and outlined toggle tile, persisted default-off settings/handle support, and inline PDF colour/outline parity at non-unit scale. I will modify only the declared owned files, preserve percussion/TAB and mark precedence, run the required verification, and return a committed handoff plus draft PR. No open questions. GBrain consulted: default:projects/scoreflow-music-reader (historical context; repo docs govern).
