# Handoff: 0012 — Octave-clef parts draw at the right octave (lead → codex)

- **Date:** 2026-11-10
- **Type:** dispatch
- **Ledger:** 0012 · **Spec:** docs/specs/0012-octave-clef-display.md · **Plan:** docs/plans/0012-octave-clef-display.md (T1)
- **Branch:** orch/0012-octave-clef · **Worktree:** created by T3
- **Base commit:** 0fe23ce
- **Port (if running a server):** 5320
- **Status:** closed

## Goal
Guitar-style octave-clef parts (ABC `clef=treble-8`, and MusicXML written pitch + `<clef-octave-change>-1` + `<transpose><octave-change>-1`) draw like `e2-guitar-sounding.musicxml`, play at sounding pitch, generate TAB from sounding pitch, and keep the "8" through the instrument switch. Spec AC1–AC6.

## Context you need
- Spec (decisions: MusicXML pre-pass + drafted upstream entry; ABC fix choice is yours, with constraints): `docs/specs/0012-octave-clef-display.md`; plan T1: `docs/plans/0012-octave-clef-display.md`.
- Problem report with findings, likely causes, screenshots: `docs/handoffs/2026-11-10-adhoc-octave-clef-and-tab--scale-to-song-to-lead.md`; repro `docs/handoffs/assets/2026-11-10-octave-clef-tab/` (read-only; copy into fixtures).
- History: `docs/handoffs/2026-11-09-0004-t1-abc-engraving-fidelity--codex-to-lead.md` (Decisions: octave clef stored as written + octave transposition; PR #60 review r1 found a double shift with `settings.instrument` — don't reintroduce). GBrain `projects/scoreflow-music-reader/gotchas-abc-import`.
- `docs/verovio-upstream-notes.md` (format for the upstream entry), `docs/specs/guitar-tab.md`.

## Scope
- **In:** findings #1, #2, #4 and #1's TAB octave; README "ABC headers" Clefs + "Guitar TAB" wording.
- **Out:** which parts get TAB, new tunings (0013); fingering solver.
- **Files you own:** see plan T1 "Owns", plus your own 0012 handoff files.
- **Do not touch:** `validation/**` (0011 in flight), `components/**` and `src/styles.css` (0001-t3 in flight), `lib/tab/fret-assign.ts`, `lib/pdf/**`, `packages/pepperscore-editor/**`, docs other than your handoffs, the ledger.

## Acceptance criteria
- [ ] Spec AC1–AC6, with vitest coverage: parseAbc + scoreToMei for `e-guitar.abc` (assert the MEI octave under `clef.dis`), the MusicXML pre-pass on `e-guitar.musicxml` (and a bass equivalent), TAB frets for all three guitar cases, instrument switch keeps `clef.dis`.
- [ ] Return handoff includes the proposed `docs/verovio-upstream-notes.md` row and draft upstream issue text, and a "For the ABC guide" note.

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run test -w pepperscore
npm run check && npm run build && npm run test:manifest && npm run test:validation
```
Foreground; never overlap build with browser tests; rerun timing gates alone and record both results if they fail.

## Open questions
None. Escalate per AGENTS.md §7.

---
## Receiver ack

Acknowledged: implement AC1–AC6 within T1 owned files, retaining stable generated pitch IDs and sounding playback. Normalize octave-clef MEI and the MusicXML engraving copy, preserve octave displacement through instrument views, verify guitar TAB against all three fixtures and bass parity, and update only the assigned README sections. Leave TAB selection/tunings, solver, protected code, ledger and other docs untouched. Return the upstream draft and ABC guide note for the lead. No open questions.
