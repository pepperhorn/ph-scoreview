# Handoff: 0007 — [quick] Package README carries the ABC authoring rules (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0007 (S4, S6); quick item, no spec or plan
- **Branch:** orch/0007-readme-abc-authoring
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-d0aeb650
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/64 (draft against main)
- **Base commit:** 7eb7fd0
- **Implementation commit:** 265a8f1aedbd7702b25d9ffba77ced254075a999 (ack: 16a6f36)
- **Port:** n/a; no persistent server
- **Status:** closed

## Goal
Make the published package README self-sufficient for ABC authors and clarify body MIDI directive scoping. Dispatch: [lead handoff](2026-11-10-0007-readme-abc-authoring--lead-to-codex.md). Source: [ABC guide](../guides/abc-authoring.md).

## Context you need
The README's ABC section now carries the checklist, rules, all four templates and known limits. Existing MIDI precedence, combined intervals and percussion/grand-staff details are retained. Runtime behavior is unchanged.

## Scope
- **In:** README ABC section and this task's own acknowledgement/return handoffs.
- **Out:** runtime code, tests, package configuration, guide and ledger updates, merge or release.
- **Files owned:** `packages/pepperscore/README.md` (ABC section only), the two 0007 handoff files.
- **Do not touch:** all other files, including the lead-owned guide and ledger.

## Acceptance criteria
- [x] ABC section contains the author-facing guide material without a repo-relative or `docs/` link.
- [x] Body directive before selectors explicitly distinguishes the first voice from real implicit music before every selector.
- [x] All four README templates scratch-parsed with `parseAbc` and asserted to import as described.
- [x] Template corrections and “For the ABC guide” note below.

## Verify with
```bash
npm ci && npx playwright-core install chromium
npm run check && npm run build && npm run test:manifest && npm run test:validation
git diff --check main...HEAD
git diff --stat main...HEAD
```
Scratch check: Node stdin, Vite `ssrLoadModule` (middleware mode, no listening server), `parseAbc` and `soundingMidi`; extract the four README `abc` fences, assert each model and piano MEI brace. No scratch files were added to the repository.

## Known gotchas / decisions already made
GBrain consulted: `default:projects/scoreflow-music-reader/gotchas-abc-import` (root-level install; do not overlap build with browser validation; MIDI source-offset scoping). The repo source and scratch checks establish current behavior.

## Open questions
None within the assigned scope. Lead should reconcile the guide with the corrected templates below.

---
## Return (implementer → lead)
- **Outcome:** done (documentation acceptance criteria met); full validation not green, with exact failures below.
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/64 (draft).
- **Commits:** receiver acknowledgement 16a6f36; README 265a8f1; this return document.
- **What changed:** self-contained ABC reference, clarified header versus body MIDI scope, four verified examples.
- **Decisions made:** move `%%score` before voice declarations because the original guide example parsed as two ungrouped parts; lower guitar ABC spelling by one octave so the model is written G4 / sounding G3. Keep runtime behavior unchanged. Clarify tenor sax as -14 semitones, avoiding the guide's ambiguous “clarinet/trumpet/tenor sax -2 (tenor sax -14)” wording. No ADR needed.
- **Out-of-scope issues found:** source guide's piano and guitar templates did not import as advertised (see below).
- **Follow-ups:** lead updates guide; cross-family review and merge remain with lead.
- **For GBrain (lead to promote):** `%%score` must precede the relevant `V:` declarations for the documented piano template; with `clef=treble-8`, `G,` imports as written G4 / sounding G3, whereas `G` imports as written G5 / sounding G4.

## For the ABC guide
Documentation-only PR; no ABC import behavior changed. Please reconcile the guide's checklist/rules/templates:
1. Put `%%score {RH | LH}` before `V:RH` / `V:LH`, including the suggested header order. Original template had distinct parts, no shared `sourcePartId`, and no MEI brace. Corrected template has two Piano staves sharing `abc-0-0` and a brace, with separate Swing text and C7 harmony.
2. Guitar template body becomes `G, A, B, C | D4 |]`. The original `G A B c | d4 |]` starts at written G5 / sounding G4; the corrected one starts at written G4 / sounding G3. Clarify the clef rule's `G` example accordingly; no extra transpose is needed.
3. Header MIDI before any `V:` is a tune default; that shortcut is not a rule for body directives. Preserve the explicit implicit-default-voice exception already present in the guide.
4. Tenor sax transposition is -14; separate it from the clarinet/trumpet -2 example.

## Verification output
Setup succeeded (`npm ci`: 344 packages installed; Chromium install exited 0). `npm run check`, `npm run build` and `npm run test:manifest` each exited 0. Scope audit: only the README ABC section and the two 0007 handoffs changed; `git diff --check` passed.

Required `npm run test:validation` exited 1 twice. Initial attempt stopped at skin validation with `Error: Port 5211 is already in use`. The port was subsequently free; retry passed skin and spelling (7911 checks), but stopped in transpose validation. Exact retry tail:
```text
Transpose: key changes back to major, and an untransposed concert view keeps one key for transposing and concert parts passed
page.evaluate: TypeError: Failed to fetch dynamically imported module: http://127.0.0.1:43991/node_modules/.vite/deps/abcjs.js?v=e7c80a34
    at validation/transpose.mjs:224:31
Node.js v26.12.0
```
The full suite remains unverified beyond that point. No validation/runtime files were changed. Lead should rerun full validation in an isolated environment; no claim is made that its remaining stages passed.

Passing output tails:
```text
npm run check: Result (22 files): 0 errors, 0 warnings, 0 hints
npm run build: Demo build uses the library dist (worker chunks and Verovio files match) and ships its notices
GM manifest: 128 local packs, 16 icons and playable voices verified.
Sound packs: complete pack.json, generated core (19 FluidR3 sounds) and versions passed
```

Additional relevant regression check:
```bash
npm run test -w pepperscore -- --run src/lib/abc-import.test.ts
```
```text
Test Files  1 passed (1)
Tests  66 passed (66)
```

Scratch results:
```text
PASS template 1: Flute, D major, tempo 90, two bars, final barline.
PASS template 2: Alto sax, written A major, GM 65, written A4 sounds C4.
PASS template 3: One Piano source part, treble/bass staves, MEI brace, Swing text and C7 harmony.
PASS template 4: Guitar, treble-8, GM 24, written G4 sounds G3.
PASS 4/4 README templates parsed with parseAbc; no repo-relative/docs link in ABC section.
```
