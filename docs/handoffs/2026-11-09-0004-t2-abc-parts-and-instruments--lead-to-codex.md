# Handoff: 0004-t2 — ABC grand staff, transposition and MIDI sound (lead → codex)

- **Date:** 2026-11-09
- **Type:** dispatch
- **Ledger:** 0004 · **Spec:** docs/specs/0004-abc-import-parity.md · **Plan:** docs/plans/0004-abc-import-parity.md (task T2)
- **Branch:** orch/0004-t2-abc-parts · **Worktree:** created by T3
- **PR:** <url once opened>
- **Base commit:** 8037061 (T1 merged as PR #60)
- **Port (if running a server):** 5242
- **Status:** closed

## Goal
Braced ABC voices become one grand-staff part, ABC can state a transposing instrument and its MIDI sound, and the README documents the honoured headers. Findings 3, 6, 8 of the issue report, plus two review follow-ups from T1 that T2 builds on.

## Context you need
- Spec (decisions, AC6, AC7, AC8, AC9, AC10): `docs/specs/0004-abc-import-parity.md`
- Plan task T2: `docs/plans/0004-abc-import-parity.md`
- Issue report: `docs/handoffs/2026-11-09-adhoc-abc-import-fidelity--scale-to-song-to-lead.md` (findings 3, 6, 8)
- **T1 return handoff, read "Decisions made" carefully:** `docs/handoffs/2026-11-09-0004-t1-abc-engraving-fidelity--codex-to-lead.md`. In particular, octave clefs are already modelled as written pitch + octave `part.transposition`/`measure.transposition` with `pitchBasis: written`; an instrument `transpose=` must ADD to that interval (semitones and diatonic), never replace it.
- T1 PR #60 reviews (`gh pr view 60 --comments`), r2 "Suggestions" 1 and 2 are in scope below.
- Fixtures and tests from T1: `packages/pepperscore/src/lib/__fixtures__/abc/`, `packages/pepperscore/src/lib/abc-import.test.ts`. Spike cases d1/d2/d3 and xml references are still only in `docs/handoffs/assets/2026-11-09-abc-import-spike/`; copy them in.

## Scope
- **In:**
  - Finding 3 / AC6: `%%score {A | B}` braced voices → one source part with two staves (two `Part`s sharing `sourcePartId`, ids `<pid>-1`/`<pid>-2`, as MusicXML multi-staff parts), one name, no "Melody" label, MEI `<staffGrp symbol="brace">` with the label on the group. Unbraced `%%score` and no `%%score` keep today's behaviour.
  - Findings 6 & 8 / AC7: `V: … transpose=N` and `%%MIDI transpose N` (written→sounding semitones; `V:` wins if both apply to a voice); `%%MIDI program N` (0-based GM) sets `gmProgram`/the instrument sound; `%%MIDI channel 10` means drums. Fall back to the voice name. Display stays as written. `d2-sax-transpose` must sound concert C4 like `xml/d-alto-sax.musicxml`. Choose the diatonic interval sensibly (e.g. -9 semitones → -5 diatonic, major sixth down) and document the rule.
  - T1 review r2 suggestion 2 (prerequisite for grand staff): replace the index-based part map (`import.ts` `${staffIndex}-${voiceIndex}`) with a voice-identity map that survives abcjs compressing staff arrays; voice overlay (`&`) voices must share their host voice's key events (mid-bar `[K:]`).
  - T1 review r2 suggestion 1: `<harm tstamp>` in `document.ts` must use the same beat formula as `<dir>` (6/8 mismatch).
  - AC9: README ABC section listing honoured headers and precedence.
- **Out:** MusicXML/MEI import paths; abcjs; lyrics, decorations, tuplets, multi-tune files; the per-layer duplicate mid-bar `<keySig>` (logged as a ledger suggestion).
- **Files you own:** `packages/pepperscore/src/lib/import.ts` (ABC code only), `packages/pepperscore/src/lib/notation/document.ts`, `packages/pepperscore/src/lib/score.ts` (additive type fields only), `packages/pepperscore/src/lib/abc-import.test.ts`, `packages/pepperscore/src/lib/__fixtures__/abc/**`, `packages/pepperscore/README.md` (ABC section only), plus your own handoff files for key 0004-t2.
- **Do not touch:** `docs/handoffs/assets/2026-11-09-abc-import-spike/`, the ledger, anything else. If something outside scope must change (e.g. `instrument-view.ts`, `render.ts`, a validation script), stop and ask the lead.

## Acceptance criteria
- [ ] AC6, AC7, AC9 from the spec; AC10 for cases a, a2, d1, d2, d3.
- [ ] AC8: T1's 23 tests and everything in the issue report's "already works" list still pass; `settings.instrument` and the concert-pitch view still work, including on ABC parts that already carry `transpose=` (no double transposition) and octave clefs (octave + instrument intervals compose).
- [ ] Grand staff works with instrument switch, part hiding (`staffDefXmlId`) and playback highlighting; `generatedPitchId` ids unchanged.
- [ ] A regression test for the voice-identity map (compressed staff arrays) and for overlay voices sharing a mid-bar key.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run test -w pepperscore -- --run src/lib/abc-import.test.ts
npm run check && npm run build && npm run test:manifest && npm run test:validation
```
Run long commands in the foreground. Optional visual check: `npm run dev -- --host 0.0.0.0 --port 5242`.

## Known gotchas / decisions already made
- See T1's Decisions made (octave-clef convention, tie map, mid-bar key changes in `Measure.keyChanges` and `mei-spelling.ts`).
- Probe abcjs `parseOnly` for `%%score`, `V: transpose=`, `%%MIDI` directives first; abcjs may already apply `transpose=` to pitches or expose it under different fields. Record what you found.
- GBrain `projects/scoreflow-music-reader`: beams come from abcjs `startBeam`/`endBeam`; don't rework beam/bar-fit code.

## Open questions
None. Escalate per AGENTS.md §7.

---
## Receiver ack
Codex acknowledges T2: implement braced ABC source-part grouping, written-to-sounding V:/MIDI transposition composed with octave clefs, MIDI sound/channel metadata, stable voice mapping and overlay key sharing, the harmony beat fix, fixtures/tests and ABC README documentation. I will change only the declared owned files, preserve generated note identities and existing import paths, run the required verification, and return a committed handoff with a draft PR. No open questions. GBrain consulted: projects/scoreflow-music-reader; preserve abcjs beam/bar-fit behavior.

---
## Return (in a separate …--<impl>-to-lead.md)
