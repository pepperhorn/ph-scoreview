# Plan 0003 — Teaching layer, part 1: goal picker and setup tour

> **For agentic workers:** dispatch per `AGENTS.md` and the `orch-dispatch` skill: one task, one worktree, one PR. Steps use checkbox (`- [ ]`) syntax for tracking.

- **Spec:** ../specs/0003-teaching-layer.md (part 1 only; parts 2 to 4 get their own items)
- **Base:** main @ 8ea6d12
- **Verification (whole item):** `npm run check && npm run build && npm run test:manifest && npm run test:validation`
- **Editor unit tests:** `npm test -w pepperscore-editor` (vitest, node environment, `src/**/*.test.ts` only)

**Goal:** A BeCreative student picks a goal and is coached through setting up a score, by a tour that lives in a private repo and attaches to the open-source editor through a plugin slot.

**Architecture:** T1 to T3 are ordinary MIT editor work in this repo: new score fields, a parts control, and a plugin slot with stable control targets. T4 and T5 are the private tour package. T6 hosts it in BeCreative. No tour wording ever enters this repo.

**Tech stack:** TypeScript, React 19, zustand and immer (editor store), zod, vitest. BeCreative is Astro with React islands and pnpm.

## Global constraints

- Coaching rules from the spec are binding on all tour copy: leading questions only, never "wrong", never the answer.
- Editing commands are undoable through `store.dispatch`. Every command leaves `checkInvariants` clean.
- With no plugin passed, the editor renders and behaves exactly as at base.
- `.pepperscore` files saved before this change still open.
- New elements get contextual class names, using the `ps-` prefix in the editor. UI font is Poppins.
- Both shells: every new control works on desktop and phone. On phone, occasional controls go in the header or its menu.
- Parts cap: never exceed the licence's `maxStaves`, counted with `staffCount`.

## Review focus

1. **A target that isn't on screen** (control collapsed in the phone header, inspector on another tab): the tour must reveal it or wait, never spotlight empty space. Test in T4.
2. **Undo during the tour:** the student presses Undo after adding a part. The tour must not crash or point at a removed row. Test in T4.
3. **The student opens another file mid-tour:** the session remounts, so the overlay unmounts cleanly and no listener leaks. Test in T3.
4. **Keys typed in the coach bubble** must not enter notes or fire shortcuts. Test in T3.
5. **Removing the last part, or adding past the cap:** both are refused with a reason and leave the score unchanged. Test in T2.

## Prerequisites outside the code (owner)

These block T4 to T6, not T1 to T3.

- **P1. Editor distribution.** `pepperscore-editor` is `private: true`, at 0.1.0, and exports raw `.ts` from `src`. BeCreative depends on published `pepperscore` 0.4.0, so it cannot install the editor. The owner decides how it ships. Publishing is run by the owner, with `npm login` as its own separate step. Check `commercial-licence-audit` first.
- **P2. Private repo.** Name and create it, and decide how BeCreative installs its package (private registry or git dependency). Recommended: a static import, which `pepperscore-plugins-and-embeds.md` allows for first-party plugins, so that app-sdk plugins and signed URLs (phase 3 of that spec) are not needed yet.
- **P3. BeCreative licence.** Issue a signed key that `verifyLicence` accepts and store it as a BeCreative secret. This needs the private signing key, which should be rotated before paid release.

## Tasks

### T1 — Score details fields

- **Depends on:** —
- **Route:** implement (default)
- **Owns:** `packages/pepperscore-editor/src/model/schema.ts`, `src/model/create.ts`, `src/format/pepperscore-file.ts` and its tests, `src/engine/commands/score.ts`, `score.test.ts`, new `src/ui/DetailsPanel.tsx`, `src/ui/keymap.ts` (`PopoverName` only), `src/ui/Popover.tsx`, `src/ui/TopBar.tsx`, `src/ui/phone/PhoneMenu.tsx`, `src/style.css`, `packages/pepperscore-editor/README.md`
- **Acceptance:** spec gap 2.
- **Produces:** `meta: { title?, composer?, description?: string, project?: string, tags?: string[], goal?: string }`. `setMeta` accepts all of them. Popover name `'details'`.

- [ ] Write failing tests in `score.test.ts`: `setMeta` sets `description` and `project`; a blank value removes the key; `tags` is trimmed, de-duplicated, and an empty list removes the key; it is undoable.
- [ ] Write a failing test for the file format: a round trip keeps the new fields, and a file with only `title` and `composer` still parses.
- [ ] Run them and confirm they fail. Implement in `schema.ts`, `pepperscore-file.ts` (both the type and the explicit field copy at `writePepperScoreFile`) and `setMeta`.
- [ ] Add `DetailsPanel`: fields for description, project and tags, reached from a new `data-ps-popover-for="details"` button in `TopBar` and an item in `PhoneMenu`. `goal` has no UI.
- [ ] Do not add these fields to the MusicXML output; golden fixtures stay unchanged.
- [ ] Run editor tests and the item verification. Commit.

### T2 — Add, change and remove parts

- **Depends on:** T1
- **Route:** implement (default)
- **Owns:** new `src/engine/commands/parts.ts`, `parts.test.ts`, `src/engine/commands/index.ts`, new `src/ui/PartsPanel.tsx`, `src/ui/Popover.tsx`, `src/ui/keymap.ts` (`PopoverName` only), `src/ui/TopBar.tsx`, `src/ui/phone/PhoneMenu.tsx`, `src/style.css`, README
- **Acceptance:** spec gap 1.
- **Produces:**
  - `addPart: Command<{ instrument: SwitchInstrumentId }>`
  - `setPartInstrument: Command<{ partId: string; instrument: SwitchInstrumentId }>`
  - `removePart: Command<{ partId: string }>`
  - `canEditPart(doc, partId): boolean` and `canAddPart(doc, maxStaves): boolean`, in `parts.ts`
  - Popover name `'parts'`

Facts: `SwitchInstrumentId` (all but `drum-kit`) and `INSTRUMENTS` come from `pepperscore/instruments`. `piano` is one part with `staves: 2`, clefs treble and bass. Name comes from `instrumentName`, transposition from `INSTRUMENTS[id].transposition`; store it on the part only when non-concert. A new part must get a measure for every existing bar via `emptyPartMeasure`, and be added to the Full score layout (`layouts[0].parts`). Custom layouts are left alone.

- [ ] Write failing tests: adding `flute` to a 4-bar score gives a second part with 4 measures and a new `layouts[0]` entry; adding `piano` gives `staves: 2`; added parts pick up the score's time and refill correctly; `checkInvariants` is empty after each; undo restores the score.
- [ ] Write failing tests: `setPartInstrument` updates name, `gmProgram`, clefs, staves and transposition on an empty part; it is a no-op on a part with notes (`canEditPart` false); `removePart` refuses a part with notes and the last part (the review focus item); removal also drops the part from every layout.
- [ ] Write a failing test: `canAddPart` is false when one more part, or a two-stave piano, would pass `maxStaves`.
- [ ] Confirm failure, implement, confirm pass.
- [ ] Add `PartsPanel`: lists parts, an instrument select for each, remove, and add. Disabled controls say why. Reached from a `data-ps-popover-for="parts"` button and a `PhoneMenu` item. Instrument choices exclude `drum-kit`.
- [ ] Run editor tests and item verification. Commit.

### T3 — Plugin slot and control targets

- **Depends on:** T2
- **Route:** implement (default)
- **Owns:** new `src/plugin/host.ts`, `host.test.ts`, `src/ui/PepperScoreEditor.tsx`, `src/ui/session.ts`, `src/index.ts`, `src/ui/TopBar.tsx`, `src/ui/ScoreTab.tsx`, `src/ui/TempoFields.tsx`, `src/ui/Inspector.tsx`, `src/ui/phone/*`, README, `apps/reader/src/embed/EditorDemo.tsx`, new stub in `apps/reader/src/embed/`, `validation/editor.mjs`
- **Acceptance:** spec gap 3 and the plugin bullet of "Packaging and where it runs".
- **Produces, exported from the package root:**

```ts
export type EditorTarget = 'title' | 'composer' | 'details' | 'key' | 'time' | 'tempo' | 'clef' | 'parts';
export type EditorHost = {
  apiVersion: 1;
  getDocument(): Document;
  subscribe(listener: (document: Document) => void): () => void;
  dispatch<A>(command: Command<A>, args: A): void;
  findTarget(target: EditorTarget): HTMLElement | null; // the visible one, in the active shell
  revealTarget(target: EditorTarget): void;             // switch inspector tab, or open the phone tab or menu holding it
  openPopover(name: PopoverName): void;
  shell: 'desktop' | 'phone';
  editable: boolean;
  origin: 'new' | 'opened';
};
export type EditorPlugin = { id: string; apiVersion: 1; Overlay: ComponentType<{ host: EditorHost }> };
```

New props: `plugins?: EditorPlugin[]`, and `startedNew?: boolean`, which sets `origin: 'new'` for the initial session because a page load is not a new score. The `onNew` action also sets `'new'`; `Open` sets `'opened'`.

- [ ] Write failing tests in `host.test.ts` for a `createEditorHost(store, deps)` factory: `dispatch` is undoable, `subscribe` fires on document changes and not cursor moves, unsubscribing stops it.
- [ ] Confirm failure, implement `src/plugin/host.ts`.
- [ ] Add `data-ps-target="<EditorTarget>"` to each control in both shells. `findTarget` picks the match with a non-null `offsetParent`.
- [ ] Render each `Overlay` in a `[data-ps-plugin]` element inside the editor root, only once the shell is measured. In `onKeyDownCapture`, return early when the event target is inside `[data-ps-plugin]`, so typing there reaches neither shortcuts nor note entry.
- [ ] The vitest config runs node only, so verify remounting and key isolation with a browser case in `validation/editor.mjs`, using a small stub plugin at `/editor` under `?stubPlugin=1`. Keep the stub in `apps/reader/src/embed/` so it stays out of the package. Open a file mid-session and assert the stub unmounted and left no listener; type in its input and assert no note was entered.
- [ ] Confirm that with no `plugins` prop no `[data-ps-plugin]` element exists. Run item verification. Commit.

### T4 — Tour engine (private repo)

- **Depends on:** T3, P1, P2
- **Route:** implement (default)
- **Owns:** the new private repo. Working name `pepperscore-coach`; final name from P2.
- **Acceptance:** spec "Setup tour" and "Where it appears and how it ends", without final copy.
- **Produces:** `createCoachPlugin({ script, storage? }): EditorPlugin`, and:

```ts
type Goal = 'transcribe' | 'compose' | 'copy' | 'explore';
type Step = { id: string; target: EditorTarget; question: string; hints: string[]; widget?: 'taps'; when?: (goal: Goal) => boolean };
type Script = { picker: GoalOption[]; steps: Step[] };
```

- [ ] Test and build a pure state machine: `next`, `back`, `skip`, `hint` (walks `hints` in order and stops at the last), and filtering by `when`.
- [ ] Build the goal picker. Show it only when `host.origin === 'new'`, `host.editable` is true, and the local "don't show again" flag is unset. Save the goal with `setMeta({ goal })`.
- [ ] Build the spotlight and bubble. Call `revealTarget`, then `findTarget`. Re-measure on resize, on scroll and on `subscribe`. If the target stays missing after reveal, skip the step quietly (review focus 1). Test undo after adding a part (review focus 2).
- [ ] Build the `taps` widget: it shows the student's count and tap speed, and never dispatches.
- [ ] Add keyboard use, focus trap, a labelled dialog role, and a "reopen" entry for the host to call. Use Poppins and the spec's copy for the picker.
- [ ] Use placeholder script text in tests only. Commit.

### T5 — The script (private repo)

- **Depends on:** T4
- **Route:** lead drafts; owner approves
- **Owns:** the script file in the private repo
- **Acceptance:** every question passes the coaching rules, and there is a hint ladder for each step, per goal.

- [ ] Draft all steps and hints per goal, including the owner's reference example for the time step. No question may imply the coach has judged the song.
- [ ] Add a lint test: no step's text contains imperative "set"/"choose"/"select", "wrong", or "incorrect", and every `question` ends with "?".
- [ ] Owner reviews the script. This is an explicit gate before T6 ships.

### T6 — Host in BeCreative

- **Depends on:** T5, P1, P2, P3
- **Route:** implement (default), in the `becreative` repo, following that repo's `CLAUDE.md`
- **Owns:** decided at dispatch, after a short survey of that repo
- **Acceptance:** the first three "Done means" bullets of the spec, on desktop and phone, in a staging build.

- [ ] Add a signed-in student page that mounts `PepperScoreEditor` with `licenceKey`, `plugins={[coach]}` and `height="100dvh"`, passing `startedNew` only when the student chose to start a score. `/library` and `/learn` are candidates for the entry point; the owner confirms which.
- [ ] Confirm `security-headers.ts` allows what the editor loads (fonts, sounds, Verovio).
- [ ] Saving is the existing `.pepperscore` download until part 2 adds accounts. Tell the owner this before release.
- [ ] Run a manual walk-through of each goal on a real phone and desktop.

## Merge order

T1 → T2 → T3 → T4 → T5 → T6. T1 to T3 touch the same UI files, so they run one at a time.

## Risks

- **P1 is the real schedule risk.** Nothing reaches students until the editor can be installed outside this repo.
- **Licensing:** Verovio LGPL and bundled sounds are flagged in the licence audit and apply to the paid path.
- **Editor churn:** the spec notes the editor is unfinished. `data-ps-target` plus the `EditorHost` interface is what keeps the private repo from breaking; bump `apiVersion` on any breaking change.
- **Saving in T6:** students lose work if they don't download it, until part 2.
