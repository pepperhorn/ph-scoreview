# WIP Ledger

> Single writer: the **lead**, on the main branch only. Implementers report status through their return handoff.
> Status: proposed · specced · planned · dispatched · in-review · changes-requested · ready · merged · closed · blocked · parked
> Waiting on: `child <taskId>` · `review <taskId>` · `ci` · `human: <why>` · `lead: <next action>`. Set it on every status change. A row needs the lead when it starts with `lead`, or when it's empty and Status is dispatched, in-review, changes-requested, ready, or merged. The lead's Stop hook won't let the lead end its turn while any row needs it.
> Type: normal items have a spec and plan. Quick items have the title prefix `[quick]` (no spec or plan, a short handoff). PRs adopted by `orch-sweep` have the prefix `[pr]`.

Next ID: 0010

## Active

| K | Title | Status | Waiting on | Owner (provider/model) | Branch | PR | Worktree | T3 task/thread | Spec | Plan | Latest handoff | Updated |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0001 | Composable player skins | in-review (t2; t1 merged #59) | review 0001-t2-review-r1 | codex/gpt-6.1-sol | orch/0001-t2-skin-bar | https://github.com/pepperhorn/ph-scoreview/pull/66 | /home/shaun/.t3/worktrees/ph-vexflow-view/t3-206c13e7 | task `0001-t2-impl-r1` / childThread `thread:delegated-task:command%3Amcp%3Ae5873edd-876a-4a1d-b891-229891827778%3Adelegate-task%3A0001-t2-impl-r1` | specs/0001-composable-player-skins.md | plans/0001-composable-player-skins.md | handoffs/2026-11-10-0001-t2-skin-bar--codex-to-lead.md (@3cbc7ef) | 2026-11-10 |
| 0002 | PDF export | planned | child 0001-t2 (T1 depends on 0001 T2) | lead |  |  |  |  | specs/0002-pdf-export.md | plans/0002-pdf-export.md |  | 2026-11-10 |
| 0003 | Teaching layer (part 1: goal picker and setup tour) | in-review (t1) | review 0003-t1-review-r1 | codex/gpt-6.1-sol | orch/0003-t1-score-details | https://github.com/pepperhorn/ph-scoreview/pull/68 | /home/shaun/.t3/worktrees/ph-vexflow-view/t3-b3887053 | task `0003-t1-impl-r1` / childThread `thread:delegated-task:command%3Amcp%3Ae5873edd-876a-4a1d-b891-229891827778%3Adelegate-task%3A0003-t1-impl-r1` | specs/0003-teaching-layer.md | plans/0003-teaching-layer.md | handoffs/2026-11-10-0003-t1-score-details--codex-to-lead.md (@324dafc) | 2026-11-10 |
| 0007 | [quick] Package README carries the ABC authoring rules (S4, S6) | ready | ci | codex/gpt-6.1-sol | orch/0007-readme-abc-authoring | https://github.com/pepperhorn/ph-scoreview/pull/64 | /home/shaun/.t3/worktrees/ph-vexflow-view/t3-d0aeb650 | task `0007-impl-r1` / childThread `thread:delegated-task:command%3Amcp%3Ae5873edd-876a-4a1d-b891-229891827778%3Adelegate-task%3A0007-impl-r1` |  |  | handoffs/2026-11-10-0007-readme-abc-authoring--codex-to-lead.md (@4ab1300) | 2026-11-10 |
| 0008 | [quick] ABC: a V: line before X: keeps its clef (S5) | in-review | review 0008-review-r1 | codex/gpt-6.1-sol | orch/0008-abc-voice-before-x | https://github.com/pepperhorn/ph-scoreview/pull/67 | /home/shaun/.t3/worktrees/ph-vexflow-view/t3-056df41c | task `0008-impl-r1` / childThread `thread:delegated-task:command%3Amcp%3Ae5873edd-876a-4a1d-b891-229891827778%3Adelegate-task%3A0008-impl-r1` |  |  | handoffs/2026-11-10-0008-abc-voice-before-x--codex-to-lead.md (@c70334e) | 2026-11-10 |
| 0009 | [quick] More mid-bar key signature tests (S7) | ready | ci | codex/gpt-6.1-sol | orch/0009-keysig-tests | https://github.com/pepperhorn/ph-scoreview/pull/65 | /home/shaun/.t3/worktrees/ph-vexflow-view/t3-acb160fd | task `0009-impl-r1` / childThread `thread:delegated-task:command%3Amcp%3Ae5873edd-876a-4a1d-b891-229891827778%3Adelegate-task%3A0009-impl-r1` |  |  | handoffs/2026-11-10-0009-keysig-tests--codex-to-lead.md (@62135b7) | 2026-11-10 |

## Done / closed

| K | Title | PR | Merged | Notes |
|---|---|---|---|---|
| 0005 | [quick] Mid-bar key signature drawn once per staff (S1) | https://github.com/pepperhorn/ph-scoreview/pull/63 | 2026-11-10 | c48dc0e; no ABC guide change |
| 0006 | [quick] ABC directive scoping: body-only voices, header K: before X: (S2, S3) | https://github.com/pepperhorn/ph-scoreview/pull/62 | 2026-11-10 | f766e13; ABC guide updated |
| 0004 | ABC import parity with MusicXML | https://github.com/pepperhorn/ph-scoreview/pull/60 , https://github.com/pepperhorn/ph-scoreview/pull/61 | 2026-11-10 | t1 8037061, t2 18ee573; `score=` not supported (documented) |

## Suggestions

> Lead-curated ideas: next steps, improvements, code efficiencies, stack changes, risks. Each needs evidence (file:line, a measurement, or a link). Status: `new` · `accepted → NNNN` · `declined: <why>` · `done`. Keep declined rows so they aren't suggested again. A PR mentioned here isn't tracked: only the PR column of Active or Done rows counts.

| S | Kind | Suggestion | Evidence | Effort (S/M/L) | Value | Source | Status |
|---|---|---|---|---|---|---|---|
| S2 | fix | Body `%%MIDI` is dropped when voices are declared only in the body (contradicts README rule) | `packages/pepperscore/src/lib/import.ts:197`, `packages/pepperscore/README.md:517` | S | medium: common ABC style | PR #61 review r3 | done (0006, PR #62) |
| S3 | fix | A `K:` in the file header before the first `X:` makes every `V:` count as body music | `packages/pepperscore/src/lib/import.ts:193` | S | low: unusual input | PR #61 review r3 | done (0006, PR #62) |
| S4 | fix | README link to `docs/guides/abc-authoring.md` is dead on npm (private repo, no `repository` in package.json); publish the guide content in the package README or a public URL | `packages/pepperscore/README.md` ABC section; `packages/pepperscore/package.json` | S | medium before npm release | PR #62 review | accepted → 0007 |
| S5 | fix | A `V:` line before `X:` has its clef ignored (pre-existing) | `packages/pepperscore/src/lib/import.ts` header scan | S | low | PR #62 review | accepted → 0008 |
| S6 | docs | README sentence on body directives before the first selector is unclear for body-only voices | `packages/pepperscore/README.md` ABC headers | XS | low | PR #62 review | accepted → 0007 |
| S7 | test | Add a transposed case and a held-across-change case (keySig falls back to layer 1, drawn late) to the mid-bar keySig test | `packages/pepperscore/src/lib/notation/document-keysig.test.ts` | XS | low | PR #63 review | accepted → 0009 |
| S8 | fix | Apply ABC 2.1 file-header defaults (`M:`, `L:`, `Q:`, `C:` before `X:`), currently dropped | PR #64 review r1 (`packages/pepperscore/README.md:526`); `packages/pepperscore/src/lib/import.ts` header scan | S | low (authors can put them after X:) | PR #64 review | new |
| S9 | test | Assert which layer carries the fallback mid-bar keySig in the older held-note test (it passes even if the fallback always goes to layer 1) | `packages/pepperscore/src/lib/notation/document-keysig.test.ts` (PR #63 test) | XS | low | PR #65 review | new |
| S10 | risk | Reader (webkit) CI flake: "1280px: a user stave scale is restored instead of the default" failed on README-only PR #64, passed on its twin run | CI run 42699660294 job 129440692432; `validation/reader.mjs` | S | medium: flaky CI blocks merges | PR #64 CI | new |
| S1 | fix | Emit a mid-bar `<keySig>` only in layer 1; Verovio draws one per layer | `packages/pepperscore/src/lib/notation/document.ts:249` (probe: 2 layers → 3 keySig groups) | S | low today (ABC overlays are separate parts); matters for MIDI/multi-layer | PR #60 review r2 | done (0005, PR #63) |

Last health scan: never

## Log
<!-- One line per status change, newest first: YYYY-MM-DD NNNN old→new — note -->
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
