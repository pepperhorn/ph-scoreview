# Handoff: 0003-t2 — Add, change and remove parts (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0003 · **Spec:** [0003](../specs/0003-teaching-layer.md) · **Plan:** [0003 task T2](../plans/0003-teaching-layer.md)
- **Dispatch / receiver ack / lead answers:** [lead to codex](2026-11-10-0003-t2-parts--lead-to-codex.md) (ownership extension from lead commit `ecc9b42`)
- **Branch:** orch/0003-t2-parts
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-561b6b7c
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/69 (draft)
- **Base commit:** b8fb939 (required T1 ancestor); dispatch docs base bdf3611
- **Implementation commit:** 624ac3a6d6e04fa23082bab5004f0534f5aa18f6
- **Port:** 5232 (temporary browser probes use the validation helper's ephemeral localhost server)

## Goal
Editor users can add pitched instrument/voice parts, change an empty part's instrument, and remove an empty part through Parts on desktop and phone. The current licence cap counts piano as two staves. The commands are undoable and leave invariants clean.

## Scope / files owned
- **In:** plan T2. New `packages/pepperscore-editor/src/engine/commands/parts.ts` and `parts.test.ts`, `src/engine/commands/index.ts`, new `src/ui/PartsPanel.tsx`, `src/ui/Popover.tsx`, `src/ui/keymap.ts` (PopoverName only), `src/ui/TopBar.tsx`, `src/ui/phone/PhoneMenu.tsx`, `src/style.css`, editor README, own 0003-t2 handoffs.
- **Approved extension:** `src/ui/controls.tsx` adds `maxStaves` to EditorUi; `src/ui/PepperScoreEditor.tsx` passes that cap through the context value and memo dependencies. No other changes in either file. No additional pass-through files needed.
- **Out / untouched:** T3, packages/pepperscore, validation, ledger, other docs, MusicXML golden fixtures, dependencies, schema and migrations.

## What changed
- Exported addPart, setPartInstrument, removePart, canEditPart and canAddPart from the command barrel (and hence package root).
- New parts receive emptyPartMeasure for every existing global bar and join Full score; custom layouts stay unchanged on add. Piano is one two-stave part with treble/bass clefs. Instrument name/program/transposition come from pepperscore/instruments; concert instruments omit transposition.
- Changes and removals refuse parts containing any notes, including grace notes inside tuplets; removal also refuses the last part. Unknown part ids are no-ops. Removing a part drops every layout reference.
- Instrument changes preserve surviving rest sequences and directions, create missing staff rests, and prune removed-staff directions, clef changes, invalid beams/slurs and stale layout staff/override references. Structural changes repair cursor and selection; undo restores the document.
- Shared PartsPanel lists per-part instrument and Remove controls plus the new-part instrument and Add controls. Controls and options explain notes/last-part/cap refusals. Choices exclude drum-kit. Desktop opens a popover; phone opens the same form in its scrolling toolbar strip. Contextual ps-parts classes use Poppins.

## Acceptance criteria
- [x] Every plan T2 checklist case written before implementation. Initial run failed because the new parts module did not exist; subsequent implementation passed all nine tests.
- [x] Added a tenth regression before its fix: shrinking a piano with a cross-staff rest slur produced a slur-target invariant error. Reference pruning fixes it. The ten Parts tests and all 287 editor tests pass.
- [x] Tests cover four-bar flute addition, Full score/custom layouts, piano's two staves, inherited/changed time and refill, instrument metadata, empty/nonempty/missing parts, refusal to remove the last part, layout/cursor/selection repair, licence caps, clean invariants and undo/redo.
- [x] Desktop 1280x900 and touch phone 390x844 task probes pass: actual Parts controls add/change/remove, enforce piano/cap options, show refusal reasons, exclude drums, undo/redo, and disable instrument/removal after entering a note. Native disabled option property checked directly. Poppins and measured panel width verified; screenshots inspected.
- [x] Protected scope and MusicXML goldens unchanged; git diff --check clean.

## Verification commands
```bash
npm ci && npx playwright-core install chromium
npm test -w pepperscore-editor -- --run src/engine/commands/parts.test.ts
npm run test:editor
npm run check && npm run build
node /tmp/0003-t2-parts-browser.mjs
npm run test:editor-browser
npm run test:editor-phone
npm run test:manifest
npm run test:validation
# After the validation shell was interrupted, run its remaining scripts sequentially:
node /tmp/0003-t2-validation-remaining.mjs
```
Commands run in foreground; build and browser tests did not overlap. The resumed runner reads the exact test:validation script list from package.json and executes each script after test:spelling sequentially, recording exit statuses and separate logs.

## Verification history / limitations
- Setup exited 0. An initial browser attempt before building correctly refused the missing dist; built before all subsequent browser runs.
- Initial check caught a test-fixture type error (`grace` takes `{ slash }`, not a boolean); corrected it before final checks.
- Early task-probe issues were harness errors: Playwright isDisabled on an option disagreed with its native disabled property; selectOption did not focus the new control after removal unmounted the focused button; phone starts in Entry so the desktop's unconditional N toggled it out. Corrected probe to inspect native disabled, explicitly focus controls, and enter mode conditionally.
- Screenshot inspection also found a real phone Parts layout issue: inherited 44px row height clipped the larger form. Fixed only ps-popover-parts to height:auto with bounded vertical scrolling; final phone screenshot shows the complete form.
- First built editor-browser suite failed at its final console check with `net::ERR_NETWORK_CHANGED`. Reran that suite alone: PASS, max logged redraw 461ms (below its 800ms failure threshold). It passed again in resumed full validation. Original and rerun logs retained.
- Full `npm run test:validation` passed API, audio, clock, CSS, skin, assets, sounds and spelling, then the shell terminated with signal 143, with no assertion failure. The remaining scripts were executed sequentially and their results are recorded below. Do not describe the interrupted aggregate command itself as a clean exit.
- Browser checks use Chromium automation; no physical-device or production deployment claim. The task-specific browser probe is temporary because validation files remain outside T2 ownership; the committed regressions are the command tests.

## Decisions made
- canAddPart keeps the planned two-argument call for a one-stave check and accepts an optional third instrument argument to count piano as two. The panel also checks changes against the cap after excluding the part being replaced. Document commands do not carry licence state: direct hosts must check the verified cap before dispatch, documented in README.
- Source instrument metadata follows the plan; ordinary MIDI channels survive changes, channel 10 is removed for pitched targets, and obsolete source abbreviations are cleared.
- Custom layouts that explicitly selected only a removed staff fall back to the remaining staff. An explicitly empty stave selection stays empty. Removing a part may leave an empty custom layout; layouts themselves are preserved.
- The expanded files are used only for explicit context propagation; no globals or DOM side channel.

## Known gotchas / GBrain
Read `projects/scoreflow-music-reader` and `projects/scoreflow-music-reader/gotchas-abc-import`; repository spec/plan govern this task. Read PR #68 review for the shared Details pattern. Implementer made no GBrain writes.

## Open questions
None.

## Follow-ups / lead action
- Review PR #69 against the final head; it remains a draft and has not been merged or monitored.
- T3 owns validation/editor.mjs: consider promoting the task-specific Parts browser scenario there alongside its planned Details coverage.
- **For the ABC guide:** no ABC import or authoring behaviour changed.
- **For GBrain (lead to promote):** shared PartsPanel receives the signed cap through EditorUi; cap-aware additions and changes count piano as two. Empty structural edits must prune slurs across removed staves, even when there are no notes.

## Return / final verification output
- **Status:** closed
- **Outcome:** done
- **Commits:** d3abf1b (initial ack), 39d27a9 (initial blocked return), bfe7b9b (scope-extension ack), 624ac3a (implementation), followed by this completed return-handoff commit.
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/69; branch pushed after this handoff commit. CI and reviewer verdict are left to the lead; no PR watch or polling.

```text
npm run check: 0 errors, 0 warnings, 0 hints
npm run build: 10 pages; demo/library dist match
npm run test:manifest: GM manifest and sound packs passed
npm run test:editor: 26 files, 287 tests passed
Parts task probe: desktop 1280x900 PASS; phone 390x844 PASS
test:validation original chain: API/audio/clock/CSS/skin/assets/sounds/spelling passed; shell then exited 143
Sequential remaining-script runner: exit 0
test:transpose: exit 0
test:document: exit 0
test:parser-diff: exit 0
test:score-db: exit 0
test:performance: exit 0
test:clock-contract: exit 0
test:pepperscore: exit 0
test:editor: exit 0
test:editor-browser: exit 0
test:editor-phone: exit 0
test:reader: exit 0
test:chunks: exit 0
test:large: exit 0
test:guardrails: exit 0
test:embed: exit 0
test:clock-embed: exit 0
test:layout: exit 0
test:tab: exit 0
test:tab-bake: exit 0
test:instrument-switch: exit 0
```

All 28 scripts in the root test:validation list have passing results across the original and resumed runs. No timing failure needed a threshold change. The separate editor-browser network-error run and successful isolated rerun are both retained.

Logs: `/tmp/0003-t2-install.log`, `/tmp/0003-t2-red.log`, `/tmp/0003-t2-slur-red.log`, `/tmp/0003-t2-editor-final.log`, `/tmp/0003-t2-check-complete.log`, `/tmp/0003-t2-build-complete.log`, `/tmp/0003-t2-manifest-complete.log`, `/tmp/0003-t2-parts-browser-complete.log`, `/tmp/0003-t2-browser-built.log` (network failure), `/tmp/0003-t2-browser-retry.log` (isolated pass), `/tmp/0003-t2-phone.log`, `/tmp/0003-t2-validation.log` (interrupted), `/tmp/0003-t2-validation-remaining.log`, `/tmp/0003-t2-validation-progress.json` and `/tmp/0003-t2-<suite>-remaining.log` per resumed suite. Temporary task probe: `/tmp/0003-t2-parts-browser.mjs`. Inspected screenshots: `/tmp/0003-t2-parts-desktop.png` and `/tmp/0003-t2-parts-phone.png`.
