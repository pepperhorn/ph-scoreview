# Handoff: 0013-t2 — Spike: finger + position TAB for fretless strings (lead → codex)

- **Date:** 2026-11-10
- **Type:** dispatch
- **Ledger:** 0013 · **Spec:** docs/specs/0013-stringed-instrument-tab.md · **Plan:** docs/plans/0013-stringed-instrument-tab.md (T2)
- **Branch:** orch/0013-t2-fretless-spike · **Worktree:** created by T3
- **Base commit:** 0fe23ce
- **Status:** open

## Goal
Decide, with rendered evidence, how PepperScore should show **finger + position** TAB for violin, viola, cello and double bass, and port the finger charts. No reader integration.

## Context you need
- Spec decisions and default tunings: `docs/specs/0013-stringed-instrument-tab.md`.
- The violintab app is the reference: `~/violintab/src/lib/tab/` (`instruments.ts` finger charts, `pitch.ts` `L`/`H` modifiers, `layout.ts`, `tabExport.ts`, its spec `~/violintab/docs/superpowers/specs/2026-06-04-violin-tab-writer-design.md`). Read-only; don't edit that repo.
- Known chart bug (memory note): cello positions follow Davidoff — 1st-finger offset above the open string: half 1, 1st 2, 1½ 3, 2nd 4, 3rd 5, 3½ 6, 4th 7, 4½ 8 semitones; there is no "2½" position. violintab's chart keys 2.5/3/3.5/4 should be 3/3.5/4/4.5. Fix in the port and say so.
- How generated guitar TAB is engraved today: `docs/specs/guitar-tab.md`, `packages/pepperscore/src/lib/notation/mei-tab.ts`, `lib/tab/fret-assign.ts`.

## Scope
- **In:** (1) a TypeScript port of the violin and cello charts (add viola and double bass by analogy from tunings; mark them as derived) with a `pitch → {string, position, finger, modifier}` solver that prefers lower positions and open strings, unit-tested; (2) 2–3 rendering prototypes in Verovio (e.g. TAB staff showing the finger number per string with position marks as `<dir>` roman numerals; a 4-line staff with finger numbers; finger numbers + string names as an annotation lane under the notation staff), rendered to SVG in a scratch script; (3) a written recommendation with screenshots/SVG paths, cost, and what T3 would change.
- **Out:** reader/settings integration, fretted instruments (T1), validation scripts.
- **Files you own:** new `packages/pepperscore/src/lib/tab/strings/**` (chart port, solver, tests), your own 0013-t2 handoff files. Put prototype scripts and rendered output in your scratch area, not the repo; reference their paths in the return handoff, and attach key PNGs/SVGs to the PR description.
- **Do not touch:** everything else.

## Acceptance criteria
- [ ] Chart port + solver with unit tests (violin 1st–4th, cello half–4½ Davidoff), passing `npm run test -w pepperscore`.
- [ ] Recommendation with rendered evidence for each prototype and a clear pick; anything needing the human's call listed under Open questions.

## Verify with
```bash
npm ci   # from the repo root
npm run test -w pepperscore && npm run check
```

---
## Receiver ack
