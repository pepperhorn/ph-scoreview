# Handoff: 0004-t2 — ABC grand staff, transposition and MIDI sound (codex → lead)

- **Date:** 2026-11-09
- **Type:** return
- **Ledger:** 0004 · **Spec:** [0004](../specs/0004-abc-import-parity.md) · **Plan:** [0004 T2](../plans/0004-abc-import-parity.md)
- **Dispatch:** [lead → codex](2026-11-09-0004-t2-abc-parts-and-instruments--lead-to-codex.md)
- **Branch:** orch/0004-t2-abc-parts
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-4f2d2f71
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/61
- **Base commit:** 8037061 (T1 merge; dispatch checkout includes lead docs)
- **Port:** 5242 (no manual preview server used)
- **Status:** open

## Goal
Complete T2's ABC grand-staff grouping and instrument/sound headers, retaining written display, sounding pitch, note identity and the T1 engraving behavior.

## Context you need
The linked spec, plan and dispatch define scope and acceptance. Also read [T1 decisions](2026-11-09-0004-t1-abc-engraving-fidelity--codex-to-lead.md) for octave-clef pitch conventions. GBrain consulted: `projects/scoreflow-music-reader`; abcjs beam/bar-fit behavior is preserved.

## Scope
- **In:** braced source parts, voice identity despite compressed staff arrays, overlay host-key propagation, V:/MIDI transpose and GM sound/channel headers, harmony beat timestamps, README ABC headers, fixtures and regression tests.
- **Out:** MusicXML/MEI import, abcjs, lyrics/decorations/tuplets/multi-tune parity, duplicate mid-bar key signatures across MEI layers.
- **Files owned/changed:** `packages/pepperscore/src/lib/import.ts` (ABC implementation and shared import list only), `packages/pepperscore/src/lib/notation/document.ts`, `packages/pepperscore/src/lib/abc-import.test.ts`, `packages/pepperscore/src/lib/__fixtures__/abc/**`, `packages/pepperscore/README.md` (new ABC section only), this return and the dispatch acknowledgement. No model type changes were needed.
- **Do not touch:** ledger, spike assets, all other files. No ownership expansion was needed.

## Acceptance criteria
- [x] AC6: both piano cases become one source part with `<pid>-1/-2` staff ids, a shared name and an MEI brace labelled once. Unbraced voices stay separate.
- [x] AC7: d2 is written A major/A4 and sounds C4, matching the copied MusicXML reference; V transpose overrides MIDI including zero; MIDI program supplies the exact GM sound; channel 10 selects unpitched drums.
- [x] AC8: original 23 tests pass; new written/concert instrument-switch tests preserve sounding pitch for plain and octave clefs with explicit instrument transpose. Per-measure octave+instrument intervals compose after clef changes.
- [x] AC9: README ABC section documents headers, precedence, zero-based GM, interval spelling and unsupported `score=` transposition.
- [x] AC10: all 11 ABC spike cases parse and engrave with native Verovio; copied MusicXML references remain read-only fixtures.
- [x] Renderer `planStaves` maps both generated staffDef ids and hides the selected staff through `buildViewMei`; playback timeline events retain part/note identity. `generatedPitchId` implementation is unchanged and T1's pinned ids pass.
- [x] Regressions cover compressed staves with identical names, overlays sharing mid-bar keys across line wraps, and harmony/direction alignment in 6/8.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run test -w pepperscore -- --run src/lib/abc-import.test.ts
npm run check && npm run build && npm run test:manifest && npm run test:validation
```

## Decisions made / abcjs probe results
- abcjs leaves `p.pitch` unchanged for `V: transpose=-9`; the interval is stored on the staff clef. MIDI headers are in `tune.formatting.midi`, while body directives can appear as voice `midi` elements. Brace endpoints are `staff.brace: start/end`.
- abcjs drops explicit `transpose=0`, and a shared staff clef may expose a different voice's transpose. Read V selectors/declarations from source offsets, making the voice's declaration authoritative. Source note `startChar` plus the preceding V selector survives compressed arrays; ordinal overlay identity distinguishes abcjs-generated voices belonging to that host. Names are not used as identity.
- Capture each voice's first source-coordinate prefix independently from its Part id. Grouping changes only Part ids; note ids retain their original prefix. Late/compressed voices receive distinct prefixes if their first coordinates collide.
- Braced voices share `sourcePartId` and name; `scoreToMei` emits their label once on a brace group, with deterministic staffDef ids on the individual staves. No rendering or instrument-view changes are needed.
- Instrument transpose adds to clef transpose at part and measure level. Parsed note octave conversion still compensates only for the clef interval. Diatonic steps use conventional simple intervals with seven steps per octave: semitone classes 0–11 map to steps `[0,1,1,2,2,3,3,4,5,5,6,6]`, then apply sign. Thus -9 is -5 steps.
- ABC GM programs 0–127 become the model's 1–128 programs with the matching FluidR3 soundfont. Drums override a program; absent program falls back to the name. A name alone does not imply a transposition; `score=` remains unimplemented, so d3 retains its concert-input C4.
- Overlay voices retain their current separate-Part behavior, sharing host key events by absolute musical time. This fixes the requested mid-bar key case without introducing layers or touching the deferred duplicate-layer keySig issue.
- Harmony timestamps now use the same meter-unit formula as directions.

## Open questions
None.

## Return
- **Outcome:** done
- **Commits:** receiver ack 9fa5ae9; implementation 8a110c7; return document follows.
- **Verification output:** setup, focused ABC tests, check, build and manifest passed. Validation suites before reader passed in the full command; reader through instrument-switch were resumed sequentially after a local build overlap interrupted the reader's static server (`ERR_HTTP_HEADERS_SENT`). No validation code was changed. Final check/build/manifest on implementation 8a110c7 passed as well.

```text
ABC: Test Files 1 passed (1), Tests 36 passed (36)
Astro/TypeScript: 0 errors, 0 warnings, 0 hints
Build: Demo build uses the library dist (worker chunks and Verovio files match) and ships its notices
GM manifest: 128 local packs, 16 icons and playable voices verified.
Sound packs: complete pack.json, generated core (19 FluidR3 sounds) and versions passed
Speller: 7911 checks passed
Library: Test Files 8 passed (8), Tests 112 passed (112)
Editor: Test Files 25 passed (25), Tests 273 passed (273)
Reader: chromium import, engraving, layout, annotations, fonts, mixer, persistence and playback passed
Chunks: chunked engraving matches the whole engraving across chunk boundaries passed
Large: large score virtualized systems, on-demand drawing, release and playback highlight passed
Guardrails: reopen last file, out-of-memory retry, large-file notice passed
Embed: chrome presets, callbacks, host hooks, settings, containment, engine, instrument switcher passed
Clock embed: playhead/count-in, seeking, re-engrave, subscription and follow passed
Layout validation passed (chromium)
TAB: reader switch on chromium passed
tab-bake: all 824 checks passed
Instrument switch: ABC octave moves and switches engrave (generated MEI ids, split notes) passed
Instrument switch: playback plays alto sax program 66 at the fitted sounding pitch; unswitched transposing parts unchanged in both views passed
Instrument switch: chunked reader render moves tied notes across chunk boundaries; caches keyed by the spec passed
Resumed validation chain: exit 0
```

The resumed command was:
```bash
npm run test:reader && npm run test:chunks && npm run test:large && npm run test:guardrails && npm run test:embed && npm run test:clock-embed && npm run test:layout && npm run test:tab && npm run test:tab-bake && npm run test:instrument-switch
```
- **Out-of-scope issues found:** no new blockers. The existing per-layer duplicate mid-bar keySig suggestion remains deferred.
- **Follow-ups:** lead to arrange the other-family exact-head review and update the ledger. No PR watch or polling was started.
- **For GBrain (lead to promote):** abcjs may drop zero transpose and share another voice's clef transpose; source voice declarations prevent both precedence errors. Source offsets preserve identity when abcjs compresses staff arrays. GM storage is one-based although ABC programs are zero-based.
