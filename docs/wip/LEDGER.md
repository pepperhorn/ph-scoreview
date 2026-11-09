# WIP Ledger

> Single writer: the **lead**, on the main branch only. Implementers report status through their return handoff.
> Status: proposed · specced · planned · dispatched · in-review · changes-requested · ready · merged · closed · blocked · parked
> Waiting on: `child <taskId>` · `review <taskId>` · `ci` · `human: <why>` · `lead: <next action>`. Set it on every status change. A row needs the lead when it starts with `lead`, or when it's empty and Status is dispatched, in-review, changes-requested, ready, or merged. The lead's Stop hook won't let the lead end its turn while any row needs it.
> Type: normal items have a spec and plan. Quick items have the title prefix `[quick]` (no spec or plan, a short handoff). PRs adopted by `orch-sweep` have the prefix `[pr]`.

Next ID: 0005

## Active

| K | Title | Status | Waiting on | Owner (provider/model) | Branch | PR | Worktree | T3 task/thread | Spec | Plan | Latest handoff | Updated |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0001 | Composable player skins | merged (t1) | human: confirm dispatch of T2 | codex/gpt-6.1-sol | orch/0001-t1-skin-tokens | https://github.com/pepperhorn/ph-scoreview/pull/59 | /home/shaun/.t3/worktrees/ph-vexflow-view/t3-66013276 | task/thread `0001-t1-impl-r1` | specs/0001-composable-player-skins.md | plans/0001-composable-player-skins.md | handoffs/2026-11-01-0001-t1-skin-module-and-tokens--lead-to-codex.md | 2026-11-01 |
| 0002 | PDF export | planned | human: confirm dispatch | lead | | | | | specs/0002-pdf-export.md | plans/0002-pdf-export.md | | 2026-10-31 |
| 0003 | Teaching layer (part 1: goal picker and setup tour) | planned | human: confirm dispatch T1–T3 (T4–T6 blocked) | lead | | | | | specs/0003-teaching-layer.md | plans/0003-teaching-layer.md | | 2026-11-02 |
| 0004 | ABC import parity with MusicXML | in-review (t2; t1 merged #60) | review 0004-t2-review-r3 | codex/gpt-6.1-sol | orch/0004-t2-abc-parts | https://github.com/pepperhorn/ph-scoreview/pull/61 | /home/shaun/.t3/worktrees/ph-vexflow-view/t3-4f2d2f71 | task `0004-t2-impl-r1` / childThread `thread:delegated-task:command%3Amcp%3A0e06bfc5-8825-491b-a63c-b7e720534d3b%3Adelegate-task%3A0004-t2-impl-r1` | plans/0004-abc-import-parity.md | handoffs/2026-11-09-0004-t1-abc-engraving-fidelity--lead-to-codex.md | handoffs/2026-11-09-0004-t2-abc-parts-and-instruments--codex-to-lead.md (@e0dfb55)

## Done / closed

| K | Title | PR | Merged | Notes |
|---|---|---|---|---|

## Suggestions

> Lead-curated ideas: next steps, improvements, code efficiencies, stack changes, risks. Each needs evidence (file:line, a measurement, or a link). Status: `new` · `accepted → NNNN` · `declined: <why>` · `done`. Keep declined rows so they aren't suggested again. A PR mentioned here isn't tracked: only the PR column of Active or Done rows counts.

| S | Kind | Suggestion | Evidence | Effort (S/M/L) | Value | Source | Status |
|---|---|---|---|---|---|---|---|
| S1 | fix | Emit a mid-bar `<keySig>` only in layer 1; Verovio draws one per layer | `packages/pepperscore/src/lib/notation/document.ts:249` (probe: 2 layers → 3 keySig groups) | S | low today (ABC overlays are separate parts); matters for MIDI/multi-layer | PR #60 review r2 | new |

Last health scan: never

## Log
<!-- One line per status change, newest first: YYYY-MM-DD NNNN old→new — note -->
2026-11-10 0004-t2 changes-requested→in-review — fix round 2 pushed e0dfb55 (60 ABC tests); review r3
2026-11-10 0004-t2 in-review→changes-requested — r2 on 600d1ea: r1 items fixed; new regression: later tune's %%MIDI leaks into first tune; fix round 2 (last before escalation) also takes r2 non-blocking items
2026-11-09 0004-t2 changes-requested→in-review — fix round pushed 600d1ea; review r2
2026-11-09 0004-t2 in-review→changes-requested — r1 on 5fedffb: header %%MIDI folded score-wide (regression), body channel 10 not unpitched; lead: header MIDI after V: applies to that voice, before any V: is a default; per-part settings reset for regrouped piano ABC accepted
2026-11-09 0004-t2 dispatched→in-review — PR #61 @5fedffb (36 ABC tests; `score=` left unimplemented); review r1
2026-11-09 0004-t2 planned→dispatched — grand staff, transpose/MIDI, README; includes r2 suggestions 1-2 (harm tstamp, voice-identity map)
2026-11-09 0004-t1 in-review→merged — r2 approve on 7744cc2, CI green, merged PR #60 (8037061) per standing merge-when-green preference; GBrain: pending write-back (abcjs key-array naturals, tenor=alto clefPos 8, octave clef as written+transposition, mid-bar keySig through spelling pass)
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
