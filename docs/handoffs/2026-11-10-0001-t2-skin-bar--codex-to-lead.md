# Handoff: 0001-t2 — Composable main bar and toggles (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0001 · **Spec:** [0001](../specs/0001-composable-player-skins.md) · **Plan:** [T2](../plans/0001-composable-player-skins.md)
- **Dispatch:** [lead → codex](2026-11-10-0001-t2-skin-bar--lead-to-codex.md)
- **Branch:** orch/0001-t2-skin-bar
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-206c13e7
- **Base commit:** bed6d80 (contains required base 7eb7fd0)
- **Port:** 5212 (development consumer validation)
- **Status:** closed

## Goal
Deliver T2: ordered built-in skin bars on full/minimal, existing-control overrides, annotation toggles and the instrument switcher. Preserve the legacy header when no bar is supplied.

## Scope
- **In / files owned:** `packages/pepperscore/src/lib/bar-items.ts`, `lib/bar-items.test.ts`, `lib/chrome.ts`, `lib/header-controls.ts`, `components/SkinBar.tsx`, `components/PepperScore.tsx`, `src/styles.css`, `validation/skin.mjs`, `apps/reader/src/embed/SkinTest.tsx`, and the two 0001-t2 handoffs.
- **Out:** T3 drawer extras, T4 pitch colours, T5 documentation, ABC import, editor, dependencies and ledger. No changes to these scopes.

## Acceptance criteria
AC2/AC2b/AC3/AC4/AC7 are exercised by pure resolver tests and the built-host skin validation: order, explicit false controls, both chrome presets, instrument choice, pressed states, drawer sync, persisted prefs, inferred harmony, unknown/duplicate ids and development-only warnings. The minimal fixture checks natural height includes the new header. New elements use contextual classes, Poppins and container queries.

## What changed
`resolveBar` filters/deduplicates public ids and maps private header names. Optional bars raise chrome availability without overriding explicit false controls, and replace minimal's compact player. `SkinBar` reuses the single header-elements map and the existing More dropdown, keeping the first four available items inline. The three annotation toggles call `update`; chord symbols sets authored and inferred prefs together. Options mounts/opens the existing drawer; instrumentSwitch works in either preset, including from More. Default header composition is retained.

## Known gotchas / decisions made
- GBrain consulted: `projects/scoreflow-music-reader`; repo spec/plan and T1 return remain the task's source of truth. Implementer writes no GBrain pages.
- Unknown-id warnings share T1's inline try/catch consumer-environment gate. Production strips them; native ESM without `process` stays mounted. Resolver stays pure.
- Runtime imports used by `chrome.ts` need explicit `.ts` extensions because `validation/api.mjs` loads source modules directly in Node.
- More's outside-click and Escape handlers respect the instrument popover, so choosing an instrument in the secondary tier leaves its anchor visible.
- `pdf` stays reserved and `pitchColours` stays data-only until its owning task supplies an element. No new theme variables were needed.
- No skin means the original controls, tiers, presets and rendering remain in use. Skin bars wrap rather than clipping unusually wide items.
- The fixture's `?bar` mode enables the agreed bar and an isolated `skin-bar-test` persistence namespace. Its unquoted ABC triads allow derived harmony to be verified.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run check && npm run build && npm run test:skin && npm run test:embed && npm run test:layout && npm run test:reader
npm run test:manifest && npm run test:validation
```
Build completed before browser suites; no build overlaps reader tests. `test:skin` also runs `bar-items.test.ts` without changing root scripts.

## Verification output
Code head: `812fd25b8142c13f62d97963d3f47e926d629c10`. No source changes after these checks. Verification is incomplete; do not treat this as all-green.

- PASS: `npm ci && npx playwright-core install chromium`.
- PASS: `npm run check` (reader: 22 files, 0 errors/warnings/hints) and `npm run build`.
- PASS: `npm run test:skin` (5 skin + 5 bar unit tests, all browser checks), repeated successfully inside full validation.
- PASS on rerun: `npm run test:embed`. First run failed the unskinned drawer containment assertion after its fixed 450 ms animation delay; no code changes were made before the successful full rerun.
- PASS: `npm run test:layout`, `npm run test:manifest`, direct `node validation/api.mjs`, and `git diff --check`.
- FAIL: standalone `npm run test:reader` at `validation/reader.mjs:1025`, `Twelve-staff playback: sampled playback frames (73)`. This checks more than 20 sampled frames per second. Earlier reader stages passed; later stages were not reached.
- FAIL: `npm run test:validation` at `validation/editor.mjs:518`, redraw samples `1638, 1173, 940, 3369, 1722, 1549, 656, 337, 535` ms against the 800 ms maximum. It passed API, audio, clock, CSS, skin, assets, sounds, spelling, transpose, document, parser-diff, score-db, performance, clock-contract, PepperScore unit tests and all 273 editor unit tests before this failure. The remaining full-chain browser checks were not reached. No claim is made that the failing timing gates were reproduced on the base.

```text
Skin bar: ordered full/minimal bars, instrument selection, drawer sync, derived chords, persisted toggles, 390px More and unknown/duplicate ids passed
chromium: embedding (chrome presets, callbacks, host hooks, ref, settings, sounds and asset base, style isolation, containment, unique ids, focused keyboard, focus ring, landmark names, shared engine, persist, missing assets, verovioBaseUrl, instrument switcher) passed
Layout validation passed (chromium)
GM manifest: 128 local packs, 16 icons and playable voices verified.
Sound packs: complete pack.json, generated core (19 FluidR3 sounds) and versions passed
AssertionError: Twelve-staff playback: sampled playback frames (73)
AssertionError: every change-to-redraw time is under 800 ms (got 1638, 1173, 940, 3369, 1722, 1549, 656, 337, 535)
```

Logs for this session: `/tmp/t2-check-final.log`, `/tmp/t2-build-final.log`, `/tmp/t2-skin-final.log`, `/tmp/t2-embed.log` (first failure), `/tmp/t2-embed-retry.log` (pass), `/tmp/t2-layout.log`, `/tmp/t2-reader.log`, `/tmp/t2-manifest.log`, `/tmp/t2-validation.log`.
Scope audit: `git diff --stat main...HEAD` contains only owned source files and the acknowledgement; this return adds the remaining owned handoff. Protected editor/import/notation/README/ledger files were not changed.

## Open questions
Lead: rerun reader and editor timing gates and finish the interrupted full validation before marking this ready. No scope expansion or threshold changes were attempted.

## Receiver ack
Lead to acknowledge through the ledger on main.

## Return
- **Outcome:** partial — implementation and T2 acceptance checks complete; required global verification has timing failures
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/66 (draft)
- **Commits:** receiver ack `1c4a9e4`; implementation `812fd25`; this return is a docs-only follow-up.
- **Out-of-scope issues found:** reader frame sampling and editor redraw timing failures above. The editor is explicitly protected; no editor code or performance thresholds were changed.
- **Follow-ups:** other-family review; T3/T4/T5 remain separate. No release, merge, PR watching or polling.
- **For the ABC guide:** no ABC import behaviour changed.
- **For GBrain (lead to promote):** Node source validation requires explicit extensions on new runtime imports; bar-mounted popovers must coordinate outside-click handling with More.
