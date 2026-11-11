# WIP Ledger

> Single writer: the **lead**, on the main branch only. Implementers report status through their return handoff.
> Status: proposed · specced · planned · dispatched · in-review · changes-requested · ready · merged · closed · blocked · parked
> Waiting on: `child <taskId>` · `review <taskId>` · `ci` · `human: <why>` · `lead: <next action>`. Set it on every status change. A row needs the lead when it starts with `lead`, or when it's empty and Status is dispatched, in-review, changes-requested, ready, or merged. The lead's Stop hook won't let the lead end its turn while any row needs it.
> Type: normal items have a spec and plan. Quick items have the title prefix `[quick]` (no spec or plan, a short handoff). PRs adopted by `orch-sweep` have the prefix `[pr]`.

Next ID: 0026

## Active

| K | Title | Status | Waiting on | Owner (provider/model) | Branch | PR | Worktree | T3 task/thread | Spec | Plan | Latest handoff | Updated |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0002 | PDF export | dispatched (t4; t1 #71, t2 #78, t3 #83 merged) | child 0002-t4-impl-r1 | claudeAgent/claude-sonnet-5-5 | orch/0002-t4-pdf-large-browsers-docs |  |  | task `0002-t4-impl-r1` / childThread `thread:delegated-task:command%3Amcp%3A51c1bb6f-63bb-41c0-a9cd-7cbd193eebe7%3Adelegate-task%3Ace713e8b-52ec-48e9-904a-abbf4a1e789f` | specs/0002-pdf-export.md | plans/0002-pdf-export.md | handoffs/2026-11-12-0002-t4-pdf-large-browsers-docs--lead-to-claude.md | 2026-11-12 |
| 0003 | Teaching layer (part 1: goal picker and setup tour) | planned (t4–t6; t1 #68, t2 #69, t3 #76 merged) | 0025 (P1 packaging + P3 key rotation); P2 done: repo pepperhorn/pepperscore-pt | codex/gpt-6.1-sol |  |  |  |  | specs/0003-teaching-layer.md | plans/0003-teaching-layer.md |  | 2026-11-10 |
| 0015 | PDF overlay templates (stamping, PepperHorn stamp schema v1) | specced (draft) | human: shared stamp schema v1 in pepperhorn-platform first (handoff sent) | lead |  |  |  |  | specs/0015-pdf-overlay-templates.md |  | handoffs/2026-11-11-adhoc-stamp-template-schema-v1--pepperscore-to-pepperhorn-platform.md | 2026-11-11 |
| 0024 | [quick] Self-hosted runner on t3box: ci.yml runs-on from CI_RUNS_ON var | merged | human: install runner on t3box + set CI_RUNS_ON (docs/guides/self-hosted-runner.md) | codex/gpt-6.1-sol | orch/0024-ci-runs-on-variable | https://github.com/pepperhorn/ph-scoreview/pull/89 |  | task `0024-impl-r1` / childThread `thread:delegated-task:command%3Amcp%3A51c1bb6f-63bb-41c0-a9cd-7cbd193eebe7%3Adelegate-task%3A9cbab5d4-201b-4809-8342-6c4ce4f87509` |  |  | handoffs/2026-11-11-0024-ci-runs-on-variable--lead-to-codex.md | 2026-11-11 |
| 0025 | Editor via private GitHub Packages + licence tooling (0003 P1/P3) | changes-requested | child 0025-impl-r1 (fix r1); human: merge OK + rotated public JWK/demo key | codex/gpt-6.1-sol | orch/0025-editor-github-packages | https://github.com/pepperhorn/ph-scoreview/pull/93 |  | task `0025-impl-r1` / childThread `thread:delegated-task:command%3Amcp%3A51c1bb6f-63bb-41c0-a9cd-7cbd193eebe7%3Adelegate-task%3A659e21e6-7e3f-4cec-809b-062024e53050` | specs/0003-teaching-layer.md | plans/0003-teaching-layer.md | handoffs/2026-11-11-0025-editor-github-packages--lead-to-codex.md | 2026-11-11 |

## Done / closed

| K | Title | PR | Merged | Notes |
|---|---|---|---|---|
| 0001-t5 | Skins docs, becreative fixture and validation (task of 0001; closes 0001) | https://github.com/pepperhorn/ph-scoreview/pull/90 | 2026-11-12 | ab759a8; focus token --accent |
| 0022 | [quick] Safari pitch-colour outlines (S31) | https://github.com/pepperhorn/ph-scoreview/pull/91 | 2026-11-12 | merged; for 0.5.1; S36 follow-up |
| 0023 | [quick] Fretless solver position continuity (S30) | https://github.com/pepperhorn/ph-scoreview/pull/92 | 2026-11-12 | merged; cello shifts 84→55; S35 perf follow-up |
| 0017 | Release pepperscore 0.5.0 | https://github.com/pepperhorn/ph-scoreview/pull/85 | 2026-11-11 | 9a3ab8c; published to npm 2026-11-11 (human) |
| 0013 | TAB for stringed instruments | #74, #77, #84 (+ README in #85) | 2026-11-11 | T4 docs covered by the 0.5.0 README; viola/double bass await teacher charts |
| 0002-t3 | PDF overlay, button and controls.pdf (task of 0002) | https://github.com/pepperhorn/ph-scoreview/pull/83 | 2026-11-11 | merged; +1,497 B gzip initial |
| 0021 | [quick] Cut CI minutes (docs skip, one run per PR, reader PR-only, validate in Playwright image) | https://github.com/pepperhorn/ph-scoreview/pull/88 | 2026-11-11 | merged; PR run: one run, validate 19.5 min |
| 0020 | [quick] PDF export in Firefox: notation at the right size (S22) | https://github.com/pepperhorn/ph-scoreview/pull/87 | 2026-11-11 | merged; chromium rasters unchanged |
| 0019 | [quick] CI validation timeout 15 → 25 min, job 30 → 45 (S28) | https://github.com/pepperhorn/ph-scoreview/pull/86 | 2026-11-11 | merged with human OK |
| 0013-t3 | Violin and cello finger + position TAB (task of 0013) | https://github.com/pepperhorn/ph-scoreview/pull/84 | 2026-11-11 | merged; option D |
| 0018 | [quick] Choir name variants and horn sounds (S26, S27) | https://github.com/pepperhorn/ph-scoreview/pull/82 | 2026-11-11 | 9d3c36e; ABC guide updated |
| 0001-t4 | Pitch colours and toggle tile + PDF parity (task of 0001; closes 0002 AC8a) | https://github.com/pepperhorn/ph-scoreview/pull/81 | 2026-11-11 | 299d463; ci.yml poppler-utils (S21) |
| 0016 | [quick] Instrument names: Bass, ukulele sound, tuning warning | https://github.com/pepperhorn/ph-scoreview/pull/80 | 2026-11-11 | c1415a0; human naming policy; ABC guide updated |
| 0002-t2 | PDF composition (task of 0002) | https://github.com/pepperhorn/ph-scoreview/pull/78 | 2026-11-11 | 03d0ac7; AC8a parity moved into 0001-T4 |
| 0013-t1 | String instruments, TAB part selection and tunings (task of 0013) | https://github.com/pepperhorn/ph-scoreview/pull/77 | 2026-11-11 | d248d7b; settings.tabInstruments; README text proposed for T4 |
| 0014 | [quick] findTarget ignores the plugin's own overlay (S20) | https://github.com/pepperhorn/ph-scoreview/pull/79 | 2026-11-11 | merged |
| 0003-t3 | Plugin slot and control targets (task of 0003) | https://github.com/pepperhorn/ph-scoreview/pull/76 | 2026-11-10 | merged; public EditorHost API |
| 0001-t3 | Drawer controls, phone toolbar, skin bar follow-ups (task of 0001) | https://github.com/pepperhorn/ph-scoreview/pull/72 | 2026-11-10 | 9205fc6 |
| 0002-t1 | PDF page model and per-line break spike (task of 0002) | https://github.com/pepperhorn/ph-scoreview/pull/71 | 2026-11-10 | 6d0d41a; plan stands |
| 0013-t2 | Spike: finger + position TAB for fretless strings (task of 0013) | https://github.com/pepperhorn/ph-scoreview/pull/74 | 2026-11-10 | merged; option D chosen; violin + cello |
| 0012 | Octave-clef parts draw at the right octave | https://github.com/pepperhorn/ph-scoreview/pull/75 | 2026-11-10 | 3927afd; ABC guide + upstream row 21 updated |
| 0011 | [quick] Validation harness reliability (S12, S14) | https://github.com/pepperhorn/ph-scoreview/pull/73 | 2026-11-10 | merged; VALIDATION_BUDGET_SCALE; startVite/listen(0) |
| 0003-t2 | Add, change and remove parts (task of 0003) | https://github.com/pepperhorn/ph-scoreview/pull/69 | 2026-11-10 | merged; 0003 continues with T3 |
| 0010 | [quick] README ABC section: sync with 0008 | https://github.com/pepperhorn/ph-scoreview/pull/70 | 2026-11-10 | merged; docs only |
| 0008 | [quick] ABC: a V: line before X: keeps its clef (S5) | https://github.com/pepperhorn/ph-scoreview/pull/67 | 2026-11-10 | 8c19b8f; ABC guide updated; README sync → 0010 |
| 0001-t2 | Composable main bar and toggles (task of 0001) | https://github.com/pepperhorn/ph-scoreview/pull/66 | 2026-11-10 | 13d48eb; 0001 continues with T3 |
| 0001-t1 | Skin module and theme tokens (task of 0001) | https://github.com/pepperhorn/ph-scoreview/pull/59 | 2026-11-01 | 9afa2f2 |
| 0003-t1 | Score details fields (task of 0003) | https://github.com/pepperhorn/ph-scoreview/pull/68 | 2026-11-10 | b8fb939; 0003 continues with T2 |
| 0007 | [quick] Package README carries the ABC authoring rules (S4, S6) | https://github.com/pepperhorn/ph-scoreview/pull/64 | 2026-11-10 | c19e361; docs only; guide points at README |
| 0009 | [quick] More mid-bar key signature tests (S7) | https://github.com/pepperhorn/ph-scoreview/pull/65 | 2026-11-10 | 4629f1a; tests only |
| 0005 | [quick] Mid-bar key signature drawn once per staff (S1) | https://github.com/pepperhorn/ph-scoreview/pull/63 | 2026-11-10 | c48dc0e; no ABC guide change |
| 0006 | [quick] ABC directive scoping: body-only voices, header K: before X: (S2, S3) | https://github.com/pepperhorn/ph-scoreview/pull/62 | 2026-11-10 | f766e13; ABC guide updated |
| 0004 | ABC import parity with MusicXML | https://github.com/pepperhorn/ph-scoreview/pull/60 , https://github.com/pepperhorn/ph-scoreview/pull/61 | 2026-11-10 | t1 8037061, t2 18ee573; `score=` not supported (documented) |

## Suggestions

> Lead-curated ideas: next steps, improvements, code efficiencies, stack changes, risks. Each needs evidence (file:line, a measurement, or a link). Status: `new` · `accepted → NNNN` · `declined: <why>` · `done`. Keep declined rows so they aren't suggested again. A PR mentioned here isn't tracked: only the PR column of Active or Done rows counts.

| S | Kind | Suggestion | Evidence | Effort (S/M/L) | Value | Source | Status |
|---|---|---|---|---|---|---|---|
| S2 | fix | Body `%%MIDI` is dropped when voices are declared only in the body (contradicts README rule) | `packages/pepperscore/src/lib/import.ts:197`, `packages/pepperscore/README.md:517` | S | medium: common ABC style | PR #61 review r3 | done (0006, PR #62) |
| S3 | fix | A `K:` in the file header before the first `X:` makes every `V:` count as body music | `packages/pepperscore/src/lib/import.ts:193` | S | low: unusual input | PR #61 review r3 | done (0006, PR #62) |
| S4 | fix | README link to `docs/guides/abc-authoring.md` is dead on npm (private repo, no `repository` in package.json); publish the guide content in the package README or a public URL | `packages/pepperscore/README.md` ABC section; `packages/pepperscore/package.json` | S | medium before npm release | PR #62 review | done (0007, PR #64) |
| S5 | fix | A `V:` line before `X:` has its clef ignored (pre-existing) | `packages/pepperscore/src/lib/import.ts` header scan | S | low | PR #62 review | done (0008, PR #67) |
| S6 | docs | README sentence on body directives before the first selector is unclear for body-only voices | `packages/pepperscore/README.md` ABC headers | XS | low | PR #62 review | done (0007, PR #64) |
| S7 | test | Add a transposed case and a held-across-change case (keySig falls back to layer 1, drawn late) to the mid-bar keySig test | `packages/pepperscore/src/lib/notation/document-keysig.test.ts` | XS | low | PR #63 review | done (0009, PR #65) |
| S8 | fix | Apply ABC 2.1 file-header defaults (`M:`, `L:`, `Q:`, `C:` before `X:`), currently dropped | PR #64 review r1 (`packages/pepperscore/README.md:526`); `packages/pepperscore/src/lib/import.ts` header scan | S | low (authors can put them after X:) | PR #64 review | new |
| S9 | test | Assert which layer carries the fallback mid-bar keySig in the older held-note test (it passes even if the fallback always goes to layer 1) | `packages/pepperscore/src/lib/notation/document-keysig.test.ts` (PR #63 test) | XS | low | PR #65 review | new |
| S10 | risk | Reader (webkit) CI flake: "1280px: a user stave scale is restored instead of the default" failed on README-only PR #64, passed on its twin run | CI run 42699660294 job 129440692432; `validation/reader.mjs` | S | medium: flaky CI blocks merges | PR #64 CI | new |
| S11 | fix | Details field keeps showing untidied text when the tidied value equals the saved one (e.g. `jazz,jazz`) | `packages/pepperscore-editor/src/ui/DetailsPanel.tsx` | XS | low | PR #68 review | new |
| S12 | risk | Editor browser validation is load-sensitive: redraw <800 ms (`validation/editor.mjs:518`) and null click target in custom layout (`:354`) fail under parallel worktrees | PR #68 and #65 local runs | S | medium: false failures slow every task | PR #68 review | done (0011, PR #73) |
| S13 | risk | `validation/skin.mjs` binds a hard-coded port 5211, so parallel worktrees collide | 0003-t1 return handoff | XS | medium: parallel tasks | 0003-t1 return | accepted → 0001-t3 (skin.mjs port) |
| S14 | risk | Browser validation harnesses bind fixed ports (e.g. `validation/transpose.mjs:137` → 43991) and silently attach to another worktree's server; parser-diff also fetch-flakes | 0002-t1 return handoff | S | high while tasks run in parallel | 0002-t1 return | done (0011, PR #73) |
| S15 | fix | `VALIDATION_BUDGET_SCALE=` (empty) throws; hint should suggest a value; `startVite` could retry once on bind race | `validation/lib/budgets.mjs:4,10`, `validation/lib/ports.mjs:20` | XS | low | PR #73 review | new |
| S16 | risk | `validation/editor.mjs:494` momentum-scroll assertion is load-sensitive and not covered by the budget scale | PR #73 review | S | medium | PR #73 review | new |
| S17 | fix | MusicXML octave-clef pre-pass doesn't re-check a mid-part clef change; notes after it can draw an octave off (playback fine) | `packages/pepperscore/src/lib/notation/musicxml-octave-clef.ts:39-53` | S | low | PR #75 review | new |
| S18 | test | Instrument-switch validation covers only the ABC guitar; add a MusicXML-source leg | `validation/instrument-switch.mjs` | XS | low | PR #75 review | new |
| S19 | risk | Reader (webkit) flake: "Extra large note names keep clear of the count row" (gap −1.7 → −3.5) failed on PDF-only PR #71's push run, passed on its PR run | CI run 42740873297; `validation/reader.mjs` | S | medium (blocks merges) | PR #71 CI | new |
| S20 | fix | `findTarget` returns null when the plugin's own overlay (e.g. a spotlight backdrop) covers the target centre; use `elementsFromPoint` and ignore hits inside `[data-ps-plugin]` — needed before 0003 T4 | `packages/pepperscore-editor/src/plugin/host.ts:33` | XS | high for T4 | PR #76 review r2 | done (0014, PR #79) |
| S21 | ci | Install `poppler-utils` in the CI validate job so the PDF raster check runs in CI, not only locally | PR #78 review r2 | XS | medium | PR #78 review | done (0001-t4, PR #81) |
| S22 | fix | Firefox PDF export: notation ~10× too large (offscreen layout root has no width/height, so Firefox returns identity CTM); give the root SVG explicit size before measuring — goes in 0002 T4 handoff | PR #78 review r3; `BROWSER=firefox node validation/pdf.mjs` | S | high before shipping PDF | PR #78 review | done (0020, PR #87) |
| S23 | fix | PDF annotations: TAB staves default to none when not passed; shadow offset drops multi-value `dy` | PR #78 review r3 | XS | low | PR #78 review | new |
| S24 | fix | tabTuning mismatch warning always says "host": `PepperScore.tsx:495-497` passes host and reader-saved tunings through the same field | PR #80 review r2 | XS | low | PR #80 review | new |
| S25 | fix | A "Bass" part with an explicit Acoustic Bass program shows the double-bass icon alongside bass-guitar TAB | PR #80 review r4 | XS | low | PR #80 review | new |
| S26 | fix | Choir names missed by the voice-word pattern: "Soprano Solo"… "Bass Solo", slash staves "Soprano/Alto, Tenor/Bass", "Mezzo-Soprano", "Contralto" → Bass becomes bass guitar with TAB | `packages/pepperscore/src/lib/score.ts:130` (PR #80 r5) | XS | medium (hymns, solos) | PR #80 review | done (0018, PR #82) |
| S27 | fix | `/horn/` gives English Horn, Basset Horn, Flugelhorn the French horn sound; should be GM 70 (cor anglais), clarinet, trumpet/flugelhorn | `packages/pepperscore/src/lib/score.ts:124` | XS | low | PR #80 review | done (0018, PR #82) |
| S28 | ci | CI "Validation suite" step (timeout 15 min) takes ~12 min and times out on busy runs (PR #82 push run, two main runs) | `.github/workflows/ci.yml:41` | XS | high (false reds) | PR #82 review r2 | done (0019, PR #86) |
| S29 | fix | Fretless position-label pruning happens after Verovio layout, so a removed label can leave a neighbour one row higher than needed | PR #84 review r2 | S | low (cosmetic) | PR #84 review | new |
| S30 | improvement | Fretless solver: add a position-continuity cost (prefer staying in position) to cut label density and I/II flips | 0013-t3 return handoff; PR #84 reviews | M | medium (readability) | PR #84 | accepted → 0023 |
| S31 | fix | Safari (WebKit) reader draws pitch-colour notehead outlines solid black, ignoring `--ps-pitch-outline` (PDF is correct); `validation/pdf.mjs:511` fails on webkit, main too | PR #87 review | S | medium (Safari users see heavy outlines) | PR #87 review | done → 0022 |
| S32 | fix | PDF page 1: chord symbol "C" overlaps the tempo mark (all browsers, main too) | PR #87 review | S | low | PR #87 review | new |
| S33 | fix | PDF dialog: first close returns focus to the reader, not the PDF button; focus from outside the reader can land behind any reader dialog (mixer too) | PR #83 review r2 | S | low | PR #83 review | new |
| S34 | bug | WebKit: PDF overlay does not recover after an aborted lazy chunk + reload (validation/pdf.mjs:765 waits 60 s for "Paper size"); intermittent duplicate .pdf-trigger after reload | 0022 return handoff (/tmp/0022-baseline.log reproduces before the change) | S | medium (Safari users after a network blip) | 0022 | in 0002-t4 |
| S35 | efficiency | Fretless phrase DP: 2,000 four-note cello chords 0.19 s → 5.2 s (realistic parts <1 s); prune chord states / beam width; also document weights tied to candidate count, and chunked renders see less lookahead | PR #92 review r1 | S | low–medium (pathological scores) | 0023 | new |
| S36 | bug | WebKit: overlapping reader marks (playing+transposed, chord transposed+note selected) leave a ~1-unit outline in the other mark's colour; scope playing selector to `.reader-note.is-playing .notehead[data-pitch]`, chord case needs a non-selector fix | PR #91 review r1 | S | low (hairline) | 0022 | new |
| S1 | fix | Emit a mid-bar `<keySig>` only in layer 1; Verovio draws one per layer | `packages/pepperscore/src/lib/notation/document.ts:249` (probe: 2 layers → 3 keySig groups) | S | low today (ABC overlays are separate parts); matters for MIDI/multi-layer | PR #60 review r2 | done (0005, PR #63) |

Last health scan: never

## Log
2026-11-11 human decisions — runner host t3box (0024 dispatched: CI_RUNS_ON variable; human installs runner, tailnet SSH blocks agents); 0003 P1 private GitHub Packages, P2 pepperhorn/pepperscore-pt (created), P3 rotate key now → 0025 dispatched
<!-- One line per status change, newest first: YYYY-MM-DD NNNN old→new — note -->
2026-11-12 0001 merged→closed — CI green on 07f9f2c, merged PR #90 (human OK); all 5 tasks done. 0002-t4 planned→dispatched (Claude Sonnet; owns S34 WebKit overlay recovery; PDF CI steps inside PR-only reader job)
2026-11-12 0025 in-review→changes-requested — Claude r1 on 2d281ad: dist/style.css 702 KB (Poppins inlined as base64); CI green; local timing failures not caused by diff
2026-11-12 0022 in-review→closed — Claude r1 approve on e57d4aa, CI green, merged PR #91 (quick lane); S36 logged
2026-11-12 0023 ready→closed — CI green on a1107a5, merged PR #92 (quick lane)
2026-11-12 0001-t5 in-review→ready — Codex r2 approve on 07f9f2c; human OK merge on green
2026-11-11 0001-t5 changes-requested→in-review — r1 fixes 07f9f2c (accentHover color-mix, hover + 390px hit-test assertions with negative controls); Codex review r2
2026-11-11 0025 dispatched→in-review — PR #93 @2d281ad (dist build, publishConfig restricted, licence CLIs, pack check); local timing gates red on loaded host (4 agents), CI is authority; Claude review r1
2026-11-11 0023 in-review→ready — Claude r1 approve on a1107a5 (600 random passages: pitch preserved; cello D maj shifts 8→0, Eb 16→0); S35 perf on dense chords logged
2026-11-11 0001-t5 in-review→changes-requested — Codex r1 on 9742645: play button hover falls back to default green (no accentHover in fixture/README); 390px bar assertion too weak. focusRing→--accent accepted, spec line fixed. CI run cancelled pending fix
2026-11-11 0023 dispatched→in-review — PR #92 @a1107a5; cello position changes 84→55, PDF labels 85→56, violin unchanged; Claude review r1
2026-11-11 0022 dispatched→in-review — PR #91 @e57d4aa; suffix green with VALIDATION_BUDGET_SCALE=2; WebKit overlay recovery accepted as pre-existing (S34); Claude review r1
2026-11-11 0024 ready→merged — CI green on 4128305, merged PR #89 (human OK); runner install + CI_RUNS_ON pending with human
2026-11-11 0001-t5 dispatched→in-review — PR #90 @9742645 (becreative fixture, skin.mjs checks, README example; focusRing→--accent since becreative --accent-ring is a box-shadow: spec wording to fix); Codex review r1
2026-11-11 0022 — impl done @02042fa (color = outline token fixes WebKit <use> currentColor); full WebKit pdf.mjs overlay-recovery failure is pre-existing on baseline (S34); large-score budgets failed on a loaded host → rerun with budget scale, then push
2026-11-11 0024 in-review→ready — r1 approve on 4128305; human OK to merge on green
2026-11-11 0024 dispatched→in-review — PR #89 @4128305 (two runs-on lines); Claude review r1; CI-workflow change → merge needs human OK
2026-11-11 0023 new→dispatched — human accepted S30 (position continuity); Codex, owns lib/tab/strings/**. 0024 proposed — human OK for a self-hosted runner; host choice pending (syd1 is 2 vCPU/8 GB with prod apps; make-1 has 12 cores/39 GB with docker 29.9)
2026-11-11 0017 merged→closed — npm shows pepperscore 0.5.0 (published by human). 0013 closed (T4 docs landed in the 0.5.0 README). 0001-t5 dispatched (route alt: Claude Sonnet; review by Codex). 0022 (S31 Safari outline) dispatched for 0.5.1. 0002-t4 after 0001-t5
2026-11-11 0017 ready→merged — CI green on 95e3418, merged PR #85 (9a3ab8c); pack dry run reports pepperscore@0.5.0; human to publish
2026-11-11 0017 changes-requested→ready — 95e3418 merges main and documents PDF export (lead checked the docs-only delta); waiting on CI, then publish
2026-11-11 0002-t3 in-review→merged — r2 approve on 3a454d0 (Firefox header fits, keys scoped), PR CI green, merged PR #83 per human. 0017: update #85 docs for PDF export; S33 logged
2026-11-11 0021 in-review→closed — r1 approve, single green PR run, merged PR #88; this docs-only push is the check that no CI run starts
2026-11-11 0002-t3 changes-requested→in-review — fixes pushed 3a454d0; review r2
2026-11-11 0020 in-review→closed — r1 approve (firefox = chromium rasters; chromium unchanged), CI green (single PR run + push run, pre-0021), merged PR #87; reviewer installed webkit apt deps on the dev machine via sudo; S31, S32 logged
2026-11-11 0021 dispatched→in-review — PR #88 @e2e9911 (push main only, paths-ignore, PR-number concurrency, reader PR-only, validate in Playwright container); review r1
2026-11-11 0020 dispatched→in-review — PR #87 @62d7324 (chromium + firefox PDF pass, chromium rasters unchanged; webkit can't launch locally); review r1
2026-11-11 0002-t3 in-review→changes-requested — r1: Firefox header overflows at 761px (PDF button); overlay keys on document steal Tab/Escape from other readers; rest verified
2026-11-11 0021 new→dispatched — human: ph-scoreview is most of the Actions bill (~45 billed min/run; docs commits and duplicate push+PR runs); cancelled 3 redundant in-flight runs (main docs, #85 push+PR while release is on hold). Lead process: batch ledger commits, never wait on ci for docs-only commits
2026-11-11 0020 new→dispatched — human: release also waits for a quick Firefox PDF fix (S22); runs in parallel with #83 (lib/pdf vs components)
2026-11-11 0017 — human: 0.5.0 waits for the PDF button (#83); #85 held; human already ran npm login
2026-11-11 0017 changes-requested→ready — 6733f80 merges main and adds violin/cello finger TAB to CHANGELOG/README (lead checked the docs-only delta against #84; no further review round); waiting on CI
2026-11-11 0019 in-review→closed — CI green on 7366227, merged PR #86 (human OK)
2026-11-11 0017 ready→changes-requested — #84 merged first, so CHANGELOG/README must describe violin/cello finger TAB; implementer merging main and updating docs
2026-11-11 0013-t3 ready→merged — CI green on a77ca15, merged PR #84 per human
2026-11-11 0002-t3 dispatched→in-review — PR #83 @3d90d5d; initial package +1,376 B gzip; chunking via reader static-graph grouping, finalizer guard unchanged; review r1
2026-11-11 0013-t3 in-review→ready — r2 approve on a77ca15 (key changes, per-system labels, naturals, grace notes fixed; stacked cello labels are real position changes); waiting on chromium CI; S29, S30 logged
2026-11-11 0019 dispatched→in-review — PR #86 @7366227 (two timeout values); human OK to merge on green
2026-11-11 0013-t3 changes-requested→in-review — r1 fixes pushed a77ca15; new evidence archived (violin naturals 1-2-3-0 correct; cello stress passage shows position labels stacked in two rows); review r2
2026-11-11 0019 new→dispatched — both #85 chromium runs timed out at the 15-min validation step (all suites that ran passed); CI timeout raise needs human OK at merge
2026-11-11 0017 in-review→ready — r2 approve on 6ca54cc; waiting on CI, then human npm login + publish
2026-11-11 0013-t3 in-review→changes-requested — r1: suspected labels were correct (fixture hid accidentals: B♭3/C♯4, C♯2); real issues: later key changes ignored (wrong pitch), position label every bar, fixture lacks visible accidentals/naturals, grace note steals label; continuity cost optional
2026-11-11 0017 changes-requested→in-review — reader pin + README pushed 6ca54cc; review r2
2026-11-11 0017 in-review→changes-requested — r1: reader app pins pepperscore@0.4.1 so npm ci fails; README still describes the TAB fallback and lacks skin/pitchColours/tabInstruments docs; lead granted reader pin + README sections
2026-11-11 0017 dispatched→in-review — PR #85 @9c0eae5 (0.5.0 + CHANGELOG); review r1
2026-11-11 0013-t3 dispatched→in-review — PR #84 @d71c6ab (502 tests, full validation); evidence archived; lead spotted suspicious labels in the evidence (violin B3 'L2', C4 'H3'; cello lowest note '1 pos ½'); review r1
2026-11-11 0002-t3 — lead granted validation/reader.mjs for the PDF-button tab-order expectation only
2026-11-11 0018 in-review→closed — r2 approve on c2be5a3, PR-run CI green (push run hit the 15-min validation timeout, S28), merged PR #82 (9d3c36e); guide updated. 0017 release dispatched
2026-11-11 0018 changes-requested→in-review — Treble/umlaut/& fixes pushed c2be5a3 (683 tests); review r2
2026-11-11 0002-t3 dispatched→blocked→dispatched — draft PR #83; blocked on build finalizer (lazy PDF moved runtime asset URLs into shared chunks) and outdated PDF-reserved tests; lead granted vite.config/finalize-dist/runtime files and the three test files; AC2 = no PDF engine in initial graph + lazy overlay, <~2 KB gz increase
2026-11-11 0018 in-review→changes-requested — r1 approve (73-case probe) but lead asked to fix before release: "Treble, Bass" piano-staff names became voices; Flügelhorn umlaut; & and plural voice words
2026-11-11 0018 dispatched→in-review — PR #82 @50d4eba (609 tests, full validation green); review r1
2026-11-11 0001-t4 ready→merged — human OK for the ci.yml change, CI green, merged PR #81 (299d463). 0002-t3 and 0013-t3 dispatched in parallel (disjoint files)
2026-11-11 0001-t4 in-review→ready — r3 approve on 50265da; CI green (Poppler step ran); needs human OK for the ci.yml change
2026-11-11 0016 ready→closed — CI back (billing resolved), green on af741f6, merged PR #80 (c1415a0); guide updated. Human: until CI is reliable, an approved PR may merge on the reviewer's full local suite; S26+S27 quick fix before 0.5.0
2026-11-11 0016 in-review→ready — r5 approve on af741f6; full local suite green (490 tests; editor-phone, reader, large needed reruns under load avg up to 72); CI billing-blocked; S26, S27 logged
2026-11-11 0001-t4 changes-requested→in-review — Poppler/ci.yml fix pushed 50265da; review r3 with full local suite
2026-11-11 0016 changes-requested→in-review — instrument-word priority pushed af741f6; review r5 with full local suite (CI billing-blocked)
2026-11-11 0001-t4 in-review→changes-requested — r2: PDF outline parity confirmed; CI lacks Poppler (pdftoppm ENOENT); lead granted ci.yml for poppler-utils only (S21) + clear error; CI change needs human OK at merge
2026-11-11 0016 in-review→changes-requested — r4: policy cases pass; bugs: Electric/Acoustic/Fretless Bass became voices with Soprano present; voice words beat instrument words (Alto Flute, Tenor Trombone, Tenor Guitar → voice). Lead: instrument words first, voice words only alone/numbered. GitHub Actions blocked by billing (all jobs fail in 2–3 s) — human to fix; S25 logged
2026-11-11 0016 changes-requested→in-review — naming policy pushed af36de1; review r4
2026-11-11 0001-t4 changes-requested→in-review — PDF outline fix pushed 5fe13cb; review r2
2026-11-11 0016 in-review→changes-requested — r3: choir+piano regression (lead's r2 rule). Human: one more round; naming policy — sax parts always say Sax; Soprano/Alto/Tenor/Baritone without sax are voices; vocal hints (Voice/Vocal/Choir) mean voice; Bass is a voice only with a vocal hint or other voice parts and no guitar/drums, otherwise bass guitar; keys don't affect choir detection
2026-11-11 0001-t4 in-review→changes-requested — r1: screen behaviour all confirmed; PDF notehead outlines opaque black and 2–3× wide (svg2pdf resets stroke opacity per glyph); tile C off house style
2026-11-11 0016 changes-requested→in-review — choir-rule fix pushed db926d4; review r3 (last)
2026-11-11 0016 in-review→changes-requested — r2: CI parser-diff fails, lone "A" became a voice; lead: choir only with a Bass/B part + (Soprano or ≥3 of S/A/T/B), skip with drums/brass/sax/guitar/keys or numbered labels (big band); last round; S24 logged
2026-11-11 0016 changes-requested→in-review — fixes pushed bda5923; review r2
2026-11-11 0016 in-review→changes-requested — r1: other "bass" names fell to piano; lead: fallback to bass guitar; SATB context → Bass/B is a voice (score-level pass, import.ts/musicxml-source.ts granted); warning once per part, worded by source
2026-11-11 0001-t4 dispatched→in-review — PR #81 @96809a0 (full validation green); review r1
2026-11-11 0016 dispatched→in-review — PR #80 @df68cd0 (270 pkg tests, full validation green); review r1
2026-11-11 — scale-to-song re-test: all cases pass on main 12f4bea; they display MusicXML; need an npm release. Human: merge 0002 T3/T4 on green; release 0.5.0 now; bare "Bass" = bass guitar. 0016 dispatched (names/ukulele sound/tuning warning); 0017 release after 0016; README TAB wording → 0013-T4
2026-11-11 0002-t2 ready→merged — CI green on 7c40488, merged PR #78 (03d0ac7). 0001-t4 dispatched incl. 0002 AC8a PDF parity
2026-11-11 0002-t2 in-review→ready — r3 approve on 7c40488 (outline within 1 px of screen at 600 dpi); waiting on chromium CI; S22 (Firefox export 10× scale, for T4), S23 logged
2026-11-11 0002-t2 changes-requested→in-review — stroke-width fix pushed 7c40488; review r3 (last)
2026-11-11 0013-t1 in-review→merged — r3 approve on 5bf0068 (55-case switch probe), CI green, merged PR #77 (d248d7b), 240 pkg tests on main. 0001-T4 and 0013-T3 both wait on #78 (render.ts/lib/pdf); 0001-T4 goes first (AC8a), then 0013-T3
2026-11-11 0015 new→specced (draft) — PDF overlay templates; human: shared typesafe PepperHorn stamp schema v1 first, anchor-to-edge paper fit, all zone types incl. watermark and licence marks; handoff to pepperhorn-platform lead (copied into its docs/handoffs, not committed there)
2026-11-11 0014 ready→closed — CI green on 3eef105, merged PR #79
2026-11-11 0002-t2 in-review→changes-requested — r2: notation size, ♯/♭, font/centring, shared lanes fixed; outline stroke ~10× too thick (svg2pdf doesn't scale stroke width); last fix round; S21 logged
2026-11-11 0013-t1 changes-requested→in-review — switch-target fix pushed 5bf0068; review r3 (last)
2026-11-11 0014 — human: merge #79 on green; quick-lane PRs merge on green regardless of size (AGENTS.md project note)
2026-11-10 0014 in-review→ready — r1 approve on 3eef105; 73 changed code lines, asking human
2026-11-10 0002-t2 changes-requested→in-review — fixes pushed 6bac927; review r2
2026-11-10 0013-t1 in-review→changes-requested — r2 on ea515d5: r1 fixed; new: part switched to Double Bass (GM 33) gets bass-guitar TAB; use target instrument id after a switch; last fix round
2026-11-10 0014 dispatched→in-review — PR #79 @3eef105 (full validation green); review r1
2026-11-10 0013-t1 changes-requested→in-review — fixes pushed ea515d5; review r2
2026-11-10 0002-t2 in-review→changes-requested — r1 rendered real PDFs: notation at ~1/11 size (nested SVG scale doubled), ♯/♭ chords abort export, three-pass note text off-style; lane placement copied not shared; AC8a deferral accepted once note text is fixed
2026-11-10 0013-t1 in-review→changes-requested — r1: /bass/ matched bassoon/bass clarinet/choir bass; lead: tabTuning applies only to parts whose string count matches its length; GM 45–52 (harp, ensembles) not fretless candidates
2026-11-10 0003-t3 ready→merged — human OK, CI green, merged PR #76. 0014 (S20) dispatched. Human: don't mirror new tunings to becreative/chordl yet (memory updated)
2026-11-10 0003-t3 in-review→ready — r2 approve on fc14847 (95/96 target probes; the 1 is the empty phone composer after the revert); asked human to merge; S20 logged
2026-11-10 0002-t2 dispatched→in-review — PR #78 @92b0d8c (1029+/44-; full validation green); AC8a screen-colour parity deferred as an integration gate on 0001-T4 + 0002-T3; review r1
2026-11-10 0013-t1 dispatched→in-review — PR #77 @27b2220, full validation green; review r1
2026-11-10 0003-t3 changes-requested→in-review — fixes pushed fc14847; review r2
2026-11-10 0003-t3 in-review→changes-requested — r1 on d575ff3: clef target hidden in medium-width drawer; unplanned phone title/composer editing (lead: rejected, revert) caused a 4 s focus regression; Escape in plugin closes inspector (DesktopShell.tsx granted for that guard)
2026-11-10 0013-t1 — PR #77 @b570210 (230 pkg tests); full validation blocked by reader.mjs:115 expecting a TAB control on the piano sample; lead granted reader.mjs for that expectation (AC1)
2026-11-10 0003-t3 dispatched→in-review — PR #76 @d575ff3; review r1
2026-11-10 0001-t3 in-review→merged — r3 approve on a7355cf (390px main reader byte-identical), CI green, merged PR #72 per human. 0013-t1 dispatched. 0001-t4 held until 0002-t2 and 0013-t1 (shared render.ts/PepperScore.tsx/prefs)
2026-11-10 0002-t1 ready→merged — webkit rerun green, merged PR #71 (6d0d41a) per human. 0002-t2 dispatched (adds jspdf + svg2pdf.js, approved in spec)
2026-11-10 0013-t2 ready→merged — CI green on 044aa8c, merged PR #74 per human
2026-11-10 0002-t1 in-review→ready — r3 approve on 0af4a6c (60-case independent probe, full first lines, max 0.990); webkit note-name flake on push run, rerun started; S19 logged
2026-11-10 0001-t3 changes-requested→in-review — switcher gate fix pushed a7355cf (skin.mjs on port 0 confirmed); review r3
2026-11-10 0012 in-review→closed — r1 approve on a373096 (AC1–AC4 rendered by reviewer), CI green, merged PR #75 (3927afd); guide, spec AC1 wording, upstream row 21 updated; S17, S18 logged
2026-11-10 0003-t3 planned→dispatched — plugin slot and control targets
2026-11-10 0011 in-review→closed — r1 approve on 24165c4, CI green, merged PR #73 per human; S15, S16 logged; 0003 T3 unblocked
2026-11-10 — human: merge #71, #73, #74, #75 on approve + green
2026-11-10 0013-t2 in-review→ready — r3 approve on 044aa8c (5,800-candidate round trip); asking human to merge
2026-11-10 0013-t2 changes-requested→in-review — fixes pushed 044aa8c (212 tests); <fing> probe archived under assets/…/fing-probe; review r3
2026-11-10 0013-t2 in-review→changes-requested — r2 on 32f3608: r1 fixed; new: cello/bass half position outranks first (D2 → half 2); violin unhinted C#/G#/D# → low 4; reviewer agrees SVG substitution over <fing>; last fix round
2026-11-10 0013-t2 changes-requested→in-review — solver fixes pushed 32f3608 (198 tests); <fing> probe didn't reproduce D placement, SVG substitution kept; review r2
2026-11-10 0012 dispatched→in-review — PR #75 @a373096 (365+/31-; 167 pkg tests); ABC stores sounding octaves + clef.dis; MusicXML pre-pass; editor cursor failures under load to be checked vs main; review r1
2026-11-10 0001-t3 in-review→changes-requested — r2 on 429caad: overlap fixed (12 hit-test cases); new regression: no-skin full phone shows a toolbar with a dead switcher (embedSwitchShown gate lost); last fix round
2026-11-10 0013-t2 in-review→changes-requested — r1: charts correct; solver picks 1H over 2L (violin), half 4H over I 4 (cello), no enharmonic hint; reviewer agrees D with T3 risks (all render/export paths, font/order fragility, paint-order in PDF, dense collisions, MEI round-trip); fix + <fing> probe requested
2026-11-10 0002-t1 changes-requested→in-review — first-line fix pushed 0af4a6c; review r3 (last planned)
2026-11-10 0013 — human: option D (inline L/H); violin + cello now, viola/double bass later with teacher charts; spec updated
2026-11-10 0013-t2 dispatched→in-review — PR #74 @1d8a451 (charts + solver, 17 tests); recommends D (4-line TAB, inline L/H via SVG text; Verovio 6.3 throws on letter tab.fret); evidence archived to handoffs/assets/2026-11-10-0013-t2-fretless-spike/
2026-11-10 0011 dispatched→in-review — PR #73 @24165c4 (14 files, 184+/37-); concurrent suites pass; review r1
2026-11-10 0001-t3 changes-requested→in-review — toolbar fixes pushed 429caad; review r2
2026-11-10 0002-t1 in-review→changes-requested — r2 on 70b782c: overflow fixed (max 0.976); new: first-line overhead double-counted (uniform A4 plans 3,4,4,4,1); last fix round before escalation
2026-11-10 0003 — T3 already authorised by human ("dispatch T1–T3"); held until 0011 (#73) merges because both own validation/editor.mjs
2026-11-10 0003-t2 in-review→merged — r2 approve (code 434e5e9, unchanged by docs-only merge 4bae26a), CI green, merged PR #69 per human
2026-11-10 0012, 0013 new→planned→dispatched — from scale-to-song octave-clef/TAB report; human: TAB for all stringed instruments (guitar, bass 4/5, ukulele ×4, violin family with finger+position), MusicXML pre-pass + upstream report, bass 4-string default, ukulele by name + host override. 0012 T1 and 0013 T2 spike dispatched; 0013 T1 waits on 0012 and 0001-t3
2026-11-10 0003-t2 in-review — PR #69 conflicts with main only in its dispatch handoff (lead answers vs ack); implementer merging main (docs-only merge commit, review r2 continues on 434e5e9 code)
2026-11-10 0002-t1 changes-requested→in-review — measurement fix pushed 70b782c; review r2
2026-11-10 0003-t2 changes-requested→in-review — fixes pushed 434e5e9; review r2
2026-11-10 0001-t3 in-review→changes-requested — r1 on 2a185b5: drawer tab covers Play in phone bottom toolbar (blocking); wrapped toolbar overlaps; lead: an all-unavailable bar = no bar (minimal keeps compact play)
2026-11-10 0010 ready→closed — CI green on 86d42fa, merged PR #70
2026-11-10 0011 new→dispatched — human OK for harness reliability item; human: merge #69 and #72 on approve + green
2026-11-10 0003-t2 in-review→changes-requested — r1 approve on 66352a9 with 3 minor UX findings (empty part layout left active, stale layout name, misleading stave-limit message); lead asked to fix before merge
2026-11-10 0002-t1 in-review→changes-requested — r1 on 1d72271: plan stands (T2–T4 as written); bar widths under-measured (top-stave first note only; mid-line key/time lost) → lines up to 155% of width silently compressed; fix: in-context measurement + fit check; AC6 property test
2026-11-10 0003-t2 dispatched→in-review — PR #69 @66352a9; all 28 validation scripts pass (with documented retries); review r1
2026-11-10 0001-t3 dispatched→in-review — PR #72 @2a185b5 (224+/12-); suites pass individually; review r1
2026-11-10 0002-t1 dispatched→in-review — PR #71 @1d72271; spike says breaks work (breaks:'line' + per-system check, A4 [4,1,4,4]); whole-document shrink fallback; review r1; S14 logged
2026-11-10 0010 in-review→ready — r1 approve on 86d42fa; auto-merge on green (docs, 7 lines)
2026-11-10 0010 dispatched→in-review — PR #70 @86d42fa (7 README lines, within auto-merge limit); review r1
2026-11-10 0008 in-review→closed — r2 approve on a84e9f9, CI green, merged PR #67 (8c19b8f), 74 ABC tests on main; guide updated. 0010 dispatched to sync package README
2026-11-10 0003-t2 dispatched→blocked→dispatched — implementer blocked on maxStaves plumbing outside ownership; lead granted PepperScoreEditor.tsx/controls.tsx for pass-through only (answers appended to dispatch handoff); resumed
2026-11-10 0008 changes-requested→in-review — fix pushed a84e9f9 (74 ABC tests); review r2
2026-11-10 0001-t2 in-review→merged — r1 approve on 3cbc7ef, CI green, merged PR #66 (13d48eb) per human. 0001-t3 dispatched with r1 follow-ups (phone: play in bottom toolbar per spec; no empty bar; ephemeral skin.mjs port). 0002-t1 dispatched (unblocked by 0001 T2)
2026-11-10 0003-t1 ready→merged — human approved; merged PR #68 (b8fb939), 277 editor tests pass on main. 0003-t2 planned→dispatched. Human: merge 0001-t2 (#66) on approve + green
2026-11-10 0003-t1 in-review→ready — r1 approve on 324dafc; over auto-merge limit, asked human; S11, S12 logged (T3 to add a Score details browser scenario)
2026-11-10 0008 in-review→changes-requested — r1 on c70334e: replayed V: lines precede %%score so grouping is lost; lead: insert after %%score/%%staves, before first tune-header V:
2026-11-10 0007 ready→closed — CI green on 4ab1300 (webkit rerun passed), merged PR #64 (c19e361); ABC guide now names the README as the published reference
2026-11-10 0009 ready→closed — CI green on 62135b7, merged PR #65 (4629f1a)
2026-11-10 0003-t1 dispatched→in-review — PR #68 @324dafc (298+/19-; 277 editor tests); review r1
2026-11-10 0008 dispatched→in-review — PR #67 @c70334e (71 ABC tests); replays pre-X: V: after X: and restores source coordinates; review r1
2026-11-10 0009 in-review→ready — r1 approve on 62135b7 (mutation-checked); waiting on CI. 0007: webkit reader failed once on README-only head (stave-scale restore), rerun started; S9, S10 logged
2026-11-10 0001-t2 dispatched→in-review — PR #66 @3cbc7ef (338+/64-); T2 checks pass, reader/editor timing failures under parallel load; reviewer to compare against main
2026-11-10 0009 dispatched→in-review — PR #65 @62135b7 (tests only, 7 pass); local full validation had timing/browser failures likely from parallel-worktree load; CI decides
2026-11-10 0007 changes-requested→ready — 4ab1300 applies exactly r1's three README wording fixes (lead checked the 6-line diff; no further review round for a docs-only delta the reviewer specified); watching CI
2026-11-10 0007 in-review→changes-requested — r1 approve on 3c99f49 with 3 README wording fixes; lead asked for them before merge; guide file-header sentence corrected; S8 logged
2026-11-10 0007 dispatched→in-review — PR #64 @3c99f49; implementer found guide piano/guitar templates wrong; lead corrected guide + scale-to-song handoff copy; local validation hit port contention (parallel worktrees), CI to confirm
2026-11-10 0001-t2, 0003-t1, 0007, 0008, 0009 →dispatched — human go-ahead; 0002 waits on 0001 T2 (plan dependency); 0004–0006 worktrees and branches removed; ABC guide handoff sent to scale-to-song (handoffs/2026-11-10-adhoc-abc-authoring-guide--pepperscore-to-scale-to-song.md, copied into its docs/handoffs)
2026-11-10 0005 in-review→closed — r1 approve on bc487b1, CI green, merged PR #63 (c48dc0e); 70 tests pass on main; S7 logged; GBrain gotchas updated
2026-11-10 0006 in-review→closed — r1 approve on e4a6934, CI green, merged PR #62 (f766e13); ABC guide updated; S4–S6 logged
2026-11-10 0005 dispatched→in-review — PR #63 @bc487b1; review r1
2026-11-10 0006 dispatched→in-review — PR #62 @e4a6934 (66 ABC tests); review r1
2026-11-10 0005, 0006 new→dispatched — human accepted S1–S3 as quick items; ABC authoring guide started at docs/guides/abc-authoring.md (human request)
2026-11-10 0004 merged→closed — t2 r3 approve on e0dfb55, CI green, merged PR #61 (18ee573); 60 ABC tests pass on main; handoffs closed; r3 follow-ups logged as S2, S3
2026-11-10 0004-t2 changes-requested→in-review — fix round 2 pushed e0dfb55 (60 ABC tests); review r3
2026-11-10 0004-t2 in-review→changes-requested — r2 on 600d1ea: r1 items fixed; new regression: later tune's %%MIDI leaks into first tune; fix round 2 (last before escalation) also takes r2 non-blocking items
2026-11-09 0004-t2 changes-requested→in-review — fix round pushed 600d1ea; review r2
2026-11-09 0004-t2 in-review→changes-requested — r1 on 5fedffb: header %%MIDI folded score-wide (regression), body channel 10 not unpitched; lead: header MIDI after V: applies to that voice, before any V: is a default; per-part settings reset for regrouped piano ABC accepted
2026-11-09 0004-t2 dispatched→in-review — PR #61 @5fedffb (36 ABC tests; `score=` left unimplemented); review r1
2026-11-09 0004-t2 planned→dispatched — grand staff, transpose/MIDI, README; includes r2 suggestions 1-2 (harm tstamp, voice-identity map)
2026-11-09 0004-t1 in-review→merged — r2 approve on 7744cc2, CI green, merged PR #60 (8037061) per standing merge-when-green preference; GBrain written 2026-11-10 (projects/scoreflow-music-reader timeline + gotchas-abc-import)
2026-11-09 0004-t1 changes-requested→in-review — fix round 2 pushed 7744cc2; review r2
2026-11-09 0004-t1 changes-requested — lead granted notation/mei-spelling.ts (narrow: keep mid-bar keySig through the reader spelling pass)
2026-11-09 0004-t1 in-review→changes-requested — r1 posted after all on b852bf0 (octave-clef double shift with instrument switch, tie accidental, mid-bar K:); r1b cancelled; fix round 2 sent, may touch instrument-view.ts/transpose.ts if needed
2026-11-09 0004-t1 in-review — review r1 ended without posting (suite still running); relaunched as r1b
2026-11-09 0004-t1 changes-requested→in-review — head b852bf0, full validation green; review r1 (claude-opus-5-5)
2026-11-09 0004-t1 dispatched→changes-requested — PR #60 @f1ba720; lead granted validation/document.mjs to update stale final-barline assertion (AC4)
2026-11-09 0004-t1 planned→dispatched — engraving fidelity (findings 1,2,4,5,7)
2026-11-09 0004 new→planned — from scale-to-song ABC fidelity report; route: extend reduced model→MEI (human); V: transpose= wins over %%MIDI transpose (lead)
2026-11-09 0001-t1 ready→merged — PR #59 was merged 2026-11-01 (9afa2f2); ledger caught up during orch-init v3 upgrade
2026-10-31 0001 new→proposed — spec drafted
2026-10-31 0002 new→proposed — spec drafted
2026-10-31 0001 proposed→specced — spec approved
2026-10-31 0002 proposed→specced — spec approved
2026-10-31 0001 specced→planned — plan written
2026-10-31 0002 specced→planned — plan written
2026-11-01 0001-t1 planned→dispatched — skin module and tokens
2026-11-01 0001-t1 dispatched→in-review — PR #59, head 462eb0e
2026-11-01 0001-t1 in-review→changes-requested — review r1 on 462eb0e; playback token also covers playing notes (lead decision)
2026-11-01 0001-t1 changes-requested — review r2 on 61ef6b2 raised a host crash and focus outlines; fix round 2 sent
2026-11-01 0001-t1 changes-requested — review r3 on a0e55f2 raised the dev warning; user approved one more fix and a narrow fourth review
2026-11-01 0001-t1 changes-requested→ready — review r4 approved head 99c012a
2026-11-02 0003 new→specced — spec approved; tour and script go in a private repo, first home is BeCreative
2026-11-02 0003 specced→planned — plan written; T4 to T6 blocked on editor distribution, private repo and BeCreative licence
