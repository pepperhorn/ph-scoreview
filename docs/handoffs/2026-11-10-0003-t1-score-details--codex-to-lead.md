# Handoff: 0003-t1 — Score details fields (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0003 · **Spec:** [0003](../specs/0003-teaching-layer.md) · **Plan:** [0003 T1](../plans/0003-teaching-layer.md)
- **Dispatch / ack:** [lead-to-codex](2026-11-10-0003-t1-score-details--lead-to-codex.md)
- **Branch:** orch/0003-t1-score-details
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-b3887053
- **Base commit:** bed6d80e9879279b6f8062d261b37aaed2b7e36a (contains dispatch base 7eb7fd0)
- **Implementation commit:** e0dd353
- **PR:** pending creation after this handoff is committed
- **Port:** 5231 (no persistent dev server)
- **Status:** closed

## Goal
Deliver plan T1: undoable score details and backward-compatible native file persistence, usable in both editor shells.

## Context you need
Read the linked spec, plan T1 and dispatch. GBrain checked: `default:projects/scoreflow-music-reader`.

## Scope
- **In:** optional description, project, tags and model-only goal; setMeta normalization; native file wrapper/document persistence; Details form in both shells; README.
- **Out:** T2+, tour/plugin copy, parts controls, MusicXML output, golden fixtures and ABC import behavior.
- **Files owned / changed:** editor `src/model/schema.ts`, `src/model/create.ts`, `src/format/pepperscore-file.ts`, `src/format/pepperscore-file.test.ts`, `src/engine/commands/score.ts`, `src/engine/commands/score.test.ts`, new `src/ui/DetailsPanel.tsx`, `src/ui/keymap.ts` (PopoverName only), `src/ui/Popover.tsx`, `src/ui/TopBar.tsx`, `src/ui/phone/PhoneMenu.tsx`, `src/style.css`, README, and these two 0003-t1 handoffs.
- **Do not touch:** `packages/pepperscore/**`, ledger, other docs. Scope audit matches this list.

## Acceptance criteria
- [x] New command/file tests written and run before implementation: 3 failed, 28 passed.
- [x] setMeta sets/trims/clears strings, trims/deduplicates tags, drops empty lists, preserves omitted fields, and supports undo/redo with clean invariants.
- [x] New fields persist in both file metadata locations; old title/composer-only v1 files parse.
- [x] Details is reached through TopBar `data-ps-popover-for="details"` and the phone header menu; contextual ps classes and Poppins.
- [x] Goal has no UI; MusicXML and golden fixtures unchanged.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run test:editor && npm run test:editor-browser && npm run test:editor-phone
npm run check && npm run build && npm run test:manifest && npm run test:validation
```
Long commands run as foreground shell jobs. No build overlapped reader tests.

## Known gotchas / decisions already made
- Reuse MetaSchema for document and file-wrapper validation so fields cannot drift; keep file version 1 because every addition is optional.
- Tags deduplicate exact trimmed strings in first-occurrence order; case is preserved.
- Fields hold local drafts and commit on blur, one undo entry per changed field. Outside-click closing commits the active desktop field before capture-phase unmount.
- Phone Details uses the existing inline-strip architecture, with a vertical form, visible field labels and bounded scrolling. No shell or toolbar files outside scope were edited.
- Project remains a plain label. No accounts or network writes.

## Open questions
None.

## Return (implementer → lead)
- **Outcome:** partial — implementation complete; full validation is not green (failures below).
- **What changed:** shared optional metadata schema, explicit native-file field copying, undoable normalized command and Details form in desktop/phone entry points.
- **Verification output:** see recorded results below.
- **Decisions made:** see above; no ADR needed.
- **Out-of-scope issues found:** validation skin binds hard-coded port 5211; a concurrent listener interrupted the initial suite. A separate transpose run encountered a Vite dynamic dependency fetch error. Neither validation file was edited.
- **Follow-ups:** review and merge through the lead; T2 depends on this task and shares UI files.
- **For the ABC guide:** no ABC import behavior changed.
- **For GBrain (lead to promote):** optional score details now persist in wrapper and document, while MusicXML remains unchanged; phone details reuse the inline strip. Implementer made no GBrain writes.

## Verification results

Setup, `npm run check`, `npm run build`, `npm run test:manifest`, and the final `npm run check -w pepperscore-editor` passed. Required browser checks ran against the built demo. No validation scripts, thresholds, library code or fixtures were changed to bypass failures. These failures were not baseline-tested; do not assume they are pre-existing solely from this handoff.

```text
TDD before implementation: Test Files 2 failed; Tests 3 failed | 28 passed (31)
Focused tests after implementation: Test Files 2 passed; Tests 31 passed
npm run test:editor: Test Files 25 passed; Tests 277 passed (also passed on final commit)
npm run check: Result (22 files): 0 errors, 0 warnings, 0 hints
npm run build: 10 page(s) built; Demo build uses the library dist and ships its notices
npm run test:manifest: 128 local packs, 16 icons and playable voices verified
Sound packs: complete pack.json, generated core (19 FluidR3 sounds) and versions passed
Custom task probe: PASS details desktop 1280x900
Custom task probe: PASS details phone 390x844
  edit, trim/dedupe, undo/redo, close/reopen, horizontal viewport fit, Poppins,
  model-only goal absent, unchanged MusicXML; desktop outside-click commits.
npm run test:validation: FAILED (initial skin port 5211 collision;
  isolated skin retry passed; full-chain retry passed skin then failed transpose)
Transpose: page.evaluate: TypeError: Failed to fetch dynamically imported module:
  http://127.0.0.1:43991/node_modules/.vite/deps/abcjs.js?v=01aa2b5d
  at validation/transpose.mjs:224:31
```

After the full-chain interruption, all remaining commands were executed sequentially, retaining individual exits:

```text
EXIT 1 npm run test:document
EXIT 1 npm run test:parser-diff
EXIT 0 npm run test:score-db
EXIT 0 npm run test:performance
EXIT 0 npm run test:clock-contract
EXIT 1 npm run test:pepperscore
EXIT 0 npm run test:editor
EXIT 1 npm run test:editor-browser
EXIT 0 npm run test:editor-phone
EXIT 0 npm run test:reader
EXIT 0 npm run test:chunks
EXIT 0 npm run test:large
EXIT 0 npm run test:guardrails
EXIT 0 npm run test:embed
EXIT 0 npm run test:clock-embed
EXIT 0 npm run test:layout
EXIT 0 npm run test:tab
EXIT 0 npm run test:tab-bake
EXIT 1 npm run test:instrument-switch
```

Failure details from that remaining sequence:

```text
test:document: AssertionError [ERR_ASSERTION]: Vite dev server started
  at validation/document.mjs:26:10
test:parser-diff: Failed to fetch dynamically imported module:
  http://127.0.0.1:43984/validation/reference/musicxml-dom.ts
  at validation/parser-diff.mjs:93:14 (the source file exists)
test:pepperscore: 2 failed | 144 passed (146)
  abc-import.test.ts: loads and engraves every ABC fixture in Verovio
  verovio-warmup.test.ts: imports and instantiates Verovio on configure
  both: Test timed out in 5000ms.
test:editor-browser: every change-to-redraw time is under 800 ms
  got 705, 835, 1096, 496, 1155, 875, 784; validation/editor.mjs:518:10
  This is the final assertion after the functional scenarios.
test:instrument-switch: page.evaluate: Error: The score could not be read.
  validation/instrument-switch.mjs:263:26 (after the preceding 14 scenario groups passed)
```

Local raw logs: `/tmp/0003-t1-red.log`, `/tmp/0003-t1-editor.log`, `/tmp/0003-t1-check.log`, `/tmp/0003-t1-build.log`, `/tmp/0003-t1-manifest.log`, `/tmp/0003-t1-validation.log`, `/tmp/0003-t1-validation-retry.log`, `/tmp/0003-t1-skin-retry.log`, `/tmp/0003-t1-validation-tail.log`, `/tmp/0003-t1-details-browser4.log`. The temporary task probe is `/tmp/0003-t1-details-browser.mjs`; it is not a tracked test file because browser validation files are outside T1 ownership.

Lead next action: review this draft and resolve or accept the recorded validation gates before merge. Do not infer full-suite approval from the passing task probe.
