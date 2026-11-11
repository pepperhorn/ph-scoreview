# Handoff: 0013-t3 — Violin and cello finger + position TAB in the reader (lead → codex)

- **Date:** 2026-11-11
- **Type:** dispatch
- **Ledger:** 0013 · **Spec:** docs/specs/0013-stringed-instrument-tab.md · **Plan:** docs/plans/0013-stringed-instrument-tab.md (task T3)
- **Branch:** orch/0013-t3-fretless-tab · **Worktree:** created by T3
- **Base commit:** 299d463 (0013 T1 #77, T2 #74; 0001 T4 #81; 0002 T2 #78 merged)
- **Port (if running a server):** 5333
- **Status:** open

## Goal
Violin and cello parts (identified by 0013-T1's classifier) get a four-line finger + position TAB staff in the TAB and Both views, rendered as **option D**: finger numbers on the string lines with inline `L`/`H` modifiers, and position changes as `<dir>` text ("I pos.", "III pos.", "pos. ½" for half position). Viola and double bass get none. Spec AC3.

## Context you need
- Spec decisions (option D, violin + cello only, finger numbers are display only): `docs/specs/0013-stringed-instrument-tab.md`.
- T2 spike (merged #74) — charts and solver in `packages/pepperscore/src/lib/tab/strings/`; return handoff `docs/handoffs/2026-11-10-0013-t2-fretless-spike--codex-to-lead.md` ("What T3 must change": sounding MIDI in; numeric placeholders + stable per-note ids; SVG text substitution in **every** render path; reserve width for two-char labels; position directions incl. re-assert at system/chunk starts; phrase solver so double stops share a hand position; never derive pitches from tuning + finger). Evidence: `docs/handoffs/assets/2026-11-10-0013-t2-fretless-spike/` (incl. `fing-probe/`).
- PR #74 reviews (`gh pr view 74 --comments`): risks to cover — substitution in probe/chunk/whole/PDF; font size and Verovio output order fragility; svg2pdf ignores `paint-order` (use the three-pass text from `lib/pdf/annotations.ts`); dense-passage collisions; L/H lost on MEI round-trip; always pass spelling (incl. key-signature accidentals) to the solver.
- T1 return handoff (physical string order low→high; fretless charts run high→low): `docs/handoffs/2026-11-10-0013-t1-string-instruments--codex-to-lead.md`.
- Existing TAB generation: `docs/specs/guitar-tab.md`, `lib/notation/mei-tab.ts`, `lib/tab/tab-parts.ts`.

## Scope
- **In:** spec AC3 for violin and cello; Both/TAB views; transposed views re-fingered; chunked and whole render; PDF export.
- **Out:** viola/double bass; editing fingerings; docs (T4).
- **Files you own:** `packages/pepperscore/src/lib/tab/**`, `lib/notation/mei-tab.ts`, `lib/render.ts` (label substitution hook only), `lib/verovio.worker.ts` (only if substitution must run in the worker), `lib/pdf/**` (label substitution in export only), `validation/tab.mjs`, `validation/tab-bake.mjs`, your own 0013-t3 handoff files.
- **Do not touch:** `components/**`, `lib/chrome.ts`, `lib/bar-items.ts`, `lib/prefs.ts`, `src/styles.css`, `validation/pdf.mjs` (0002-T3 in flight), `packages/pepperscore-editor/**`, the ledger. If you need one of those, stop and ask.

## Acceptance criteria
- [ ] Spec AC3: violin (1st–4th) and cello (half–4½, Davidoff) finger + position TAB with inline L/H, matching the charts; double stops share a feasible hand position; readable in dense passages (no label collisions, asserted on rendered SVG).
- [ ] Labels appear identically in whole, chunked and PDF output (rasterise one PDF page in a test); playback unchanged (finger numbers never feed audio).
- [ ] Guitar/bass/ukulele TAB unchanged (`test:tab`, `test:tab-bake`, `test:fret-assign` pass).

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run test -w pepperscore && npm run check && npm run build
npm run test:tab && npm run test:tab-bake && npm run test:fret-assign && npm run test:chunks && npm run test:pdf
npm run test:manifest && npm run test:validation
```
Build before browser suites; under load rerun timing gates with `VALIDATION_BUDGET_SCALE=2`.

## Open questions
None. Escalate per AGENTS.md §7 (especially if a render path can't be covered).

---
## Receiver ack
