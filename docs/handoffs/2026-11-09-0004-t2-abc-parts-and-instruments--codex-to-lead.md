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
- **Status:** closed

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
- abcjs leaves `p.pitch` unchanged for `V: transpose=-9`; the interval is stored on the staff clef. The initial probe found MIDI headers in `tune.formatting.midi` and body directives as voice `midi` elements. Review 5825890369 established that the folded header object loses voice attribution; the final implementation reads MIDI directives from source offsets instead. Brace endpoints are `staff.brace: start/end`.
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
- **Initial submission verification output:** setup, focused ABC tests, check, build and manifest passed. Validation suites before reader passed in the full command; reader through instrument-switch were resumed sequentially after a local build overlap interrupted the reader's static server (`ERR_HTTP_HEADERS_SENT`). No validation code was changed. Final check/build/manifest on implementation 8a110c7 passed as well.

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


## Review 5825890369 fixes

Both blocking findings and the requested non-blocking items are addressed on the same branch/PR.

- MIDI source lines are attributed using their preceding V selector, with offsets preserved when masking comments and `w:`/`W:` lyrics. Lines before any V supply tune-wide defaults. Header lines after V declarations and body lines after V selectors belong only to that voice. Defaults inherit per property; later body settings override that voice's earlier MIDI settings. Explicit `V: transpose=` still takes precedence, including zero. The folded abcjs MIDI object and its unattributed MIDI items no longer control imports.
- Resolve the voice's sound/channel before parsing its notes. A body channel-10 directive produces the same percussion part/measure clefs and unpitched staff-position pitches as a header directive, without affecting a flute on another voice. Like the existing reduced Part model, the final program/channel supplies one sound for that voice; MIDI transpose is resolved at each measure's first source note.
- Late voices use `-vN` fallback ids, a namespace disjoint from grand-staff `<pid>-1/-2` ids. The regression uses a bar-only initial voice followed by a later note, forcing abcjs to compress that staff into an occupied coordinate.
- Braced staves share the explicitly specified sound, otherwise the named stave's instrument. A normal channel assignment does not outrank an explicit program on the other stave. Tests cover a named clarinet with an unnamed partner and a church-organ program declared only on LH.
- **Accepted compatibility change:** re-grouped grand-staff scores start with fresh per-part settings. The README ABC section now states this; note ids and playback highlighting remain stable.
- Added `__fixtures__/abc/multivoice-midi.abc` and regressions for header and body attribution, tune defaults, per-voice transpose/program/channel isolation, single-voice compatibility, body-only drums, id collisions, shared sounds, and selectors inside comments/lyrics.

GBrain consulted: `projects/scoreflow-music-reader`. Lead to promote the source-attribution and accepted-settings-reset decisions; implementer performed no GBrain writes. Owned-file scope remains unchanged; no validation scripts or original spike assets were edited.

### Review-round verification
Implementation commit: `5895ed7`. The full unmodified verification chain completed with **exit 0**, sequentially in the foreground, with no overlapping build or reader processes:

```bash
npm ci && npx playwright-core install chromium && npm run test -w pepperscore -- --run src/lib/abc-import.test.ts && npm run check && npm run build && npm run test:manifest && npm run test:validation
```

```text
Focused ABC: 44/44 tests passed
Astro/TypeScript: 0 errors, 0 warnings, 0 hints
Build: library and reader dist match; notices verified
Manifest: 128 GM packs and sound packs verified
Spelling: 7911 checks passed
Library: 120/120 tests passed
Editor: 273/273 tests passed
All browser validation suites passed (editor/phone, reader, chunks, large, guardrails, embeds, clock, layout, TAB)
TAB bake: all 824 checks passed
Instrument switch: full reader picker (Instrument and Sound sections, trumpet, harp sound, level and fit, as written, hidden by the host, drum kit) passed
Instrument switch: saved switch vs host settings (same host: the reader's flute; changed host: alto sax) passed
Instrument switch: octave tool (select, Shift/second-click passage, phrase, 8va/8vb, out of range, auto-fit kept as written, reset, Escape, focus, saved, hidden, embed menu and compact entry) passed
Instrument switch: chunked reader render moves tied notes across chunk boundaries; caches keyed by the spec passed
Full verification chain: exit 0
```

Scope audit: only task-owned ABC implementation/tests/fixture, README ABC section and this return handoff changed in the review round. No test scripts were changed. Ready for the lead's other-family re-review; no PR watching or polling was started.

## Review r2 / 5826251807 — 2026-11-10

Implementation commits: `02a4ef9` and `e7dbcec`. Every listed item is addressed within the original task's owned files.

- **First-tune isolation (blocking):** parsing and source scans now stop before the second `^X:` line. The prefix before the first `X:` is retained for file-header defaults. No later tune's V declarations, program, channel or transpose can affect tune 1. Regression cases compare the first tune alone with the first tune in a book (program only, channel 10 only, both; with/without V declarations in either tune), assert identical parts/MEI and pin the original flute/piano, treble clef and C/D/E/F pitches. Another test preserves a real file-header program and original offsets, including a preamble comment, while ignoring a later same-id voice's settings.
- **Body default voice:** distinguish header V declarations from body selectors at the opening K header. Body directives and notes before a body selector belong to the first declared voice, or implicit voice `1` if there are no header declarations. abcjs otherwise assigns the initial unselected music to the last header voice, so this case receives an explicit default selector only in the parser input; returned element offsets are restored to the original source. A comparison against the explicitly selected form pins model and generated ids. Tests cover program/transpose, channel 10, regular body `V:B`, and implicit music followed by a later body-only voice.
- **Bar-only voices:** register a voice from its first note or barline, and preserve the empty Part with the original staff id/name/instrument, as on `main`. Its padded empty measure engraves using the existing `<rest>` path. The earlier late-voice uniqueness test now expects `abc-2-0`: preserving that voice on its initial bar-only line means it no longer needs a later fallback. The disjoint `-vN` fallback rule is retained.
- **Drum-name decision:** verified `main` uses the drum-kit instrument for a name like `Drums`, but leaves treble pitched notes unless the source has a percussion clef. This PR intentionally makes a drum-like name without a MIDI program unpitched percussion; the README now states that behavior. A valid MIDI program overrides name inference, while an explicit percussion clef/channel remains authoritative. Tests cover the name-only and program-override forms.
- **Brace percussion isolation:** only pitched members participate in sharing a sound. Percussion keeps its own clef, instrument and unpitched notes and cannot change its pitched partners. Tests cover name, clef, header channel and body channel routes. Percussion-first three-staff braces additionally prove the two pitched partners share either an explicit clarinet sound or the named pitched voice's instrument when no program is supplied.
- **Indexed MIDI lookups:** build cumulative directive snapshots per voice (and tune-default bucket) once per parse. Lookup uses a binary search for the latest snapshot at the source offset, then merges defaults and voice overrides; it no longer scans every directive for each measure. A twelve-measure regression covers negative, positive and zero transpose changes at their actual onsets without leaking into another voice.

The README ABC section documents first-tune isolation, the body default voice, drum-name inference and percussion isolation. The accepted fresh per-part settings for re-grouped grand staves remains documented. Original spike assets, the ledger, other import paths and validation scripts are unchanged. GBrain consulted: `projects/scoreflow-music-reader`; the lead may promote these final source-boundary and percussion decisions.

### R2 verification
The full unmodified verification command completed with **exit 0** on the final implementation (`e7dbcec`), sequentially in the foreground with no build/reader overlap:

```bash
npm ci && npx playwright-core install chromium && npm run test -w pepperscore -- --run src/lib/abc-import.test.ts && npm run check && npm run build && npm run test:manifest && npm run test:validation
```

```text
Focused ABC: 60/60 tests passed
Astro/TypeScript: 0 errors, 0 warnings, 0 hints
Build: library and reader dist match; notices verified
Manifest: 128 GM packs and sound packs verified
Spelling: 7911 checks passed
Library: 136/136 tests passed
Editor: 273/273 tests passed
All browser suites passed: editor/phone, reader, chunks, large, guardrails, embed, clock-embed, layout, TAB and instrument-switch
TAB bake: all 824 checks passed
Instrument switch: full reader picker (Instrument and Sound sections, trumpet, harp sound, level and fit, as written, hidden by the host, drum kit) passed
Instrument switch: saved switch vs host settings (same host: the reader's flute; changed host: alto sax) passed
Instrument switch: octave tool (select, Shift/second-click passage, phrase, 8va/8vb, out of range, auto-fit kept as written, reset, Escape, focus, saved, hidden, embed menu and compact entry) passed
Instrument switch: chunked reader render moves tied notes across chunk boundaries; caches keyed by the spec passed
Full unmodified verification command: exit 0
```

Only the ABC importer, its tests, the README ABC section and this return handoff changed in r2. No validation scripts were edited. Ready for the lead's other-family re-review; no PR watch or polling was started.
