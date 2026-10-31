# Plan 0001 — Composable player skins

- **Spec:** ../specs/0001-composable-player-skins.md
- **Base:** main @ 320bd6f
- **Verification (whole item):** `npm run check && npm run build && npm run test:manifest && npm run test:validation`

## Approach

A skin is plain data resolved by one new module, `lib/skin.ts`, with no runtime imports, so `validation/api.mjs`-style Node checks can load it like `prefs.ts`. Theme tokens become inline CSS variables on the `.pepperscore` root, so `var(--host-token)` resolves against the host page and a change needs no React work. The bar generalises the existing registry in `lib/header-controls.ts` and its `headerElements` map, rather than building a second header. Pitch colour is CSS over per-note tags, so toggling it never re-engraves.

All tasks touch `PepperScore.tsx` or `styles.css`, so they run **in sequence**, one worktree at a time. Each task extracts what it adds into its own module. TDD: write the validation or unit test first, watch it fail, then implement. Every task's implementer also reads the spec.

Global rules: default rendering stays pixel-identical; contextual class names on elements; Poppins for UI; all selectors stay under `.pepperscore` (`npm run test:css`).

## Tasks

### T1 — Skin module and theme tokens
- **Depends on:** —
- **Route:** implement (default)
- **Owns:** `packages/pepperscore/src/lib/skin.ts` (new), `lib/skin.test.ts` (new), `src/styles.css`, `src/components/open-score-dialog.css`, `src/index.ts`, `components/PepperScore.tsx` (prop and root style only), `apps/reader/src/embed/SkinTest.tsx` (new), `apps/reader/src/pages/embed-skin.astro` (new), `validation/skin.mjs` (new), root `package.json` (`test:skin`, added to `test:validation`)
- **May read:** anything
- **Acceptance:** AC1, AC5, AC6, AC8d
- **Verify:** `npm run check && npm run build && npm run test:css && npm run test:skin && npm run test:reader`
- **Interfaces produced:**
  - `type ThemeToken` from `THEME_TOKENS` (`as const`). Role names, e.g. `surface`, `surfaceRaised`, `text`, `textMuted`, `border`, `accent`, `accentHover`, `onAccent`, `accentWash`, `focusRing`, `playback`. The audit fixes the final list.
  - `tokenVariable(token): string` → `--ps-<kebab-token>`
  - `skinStyle(skin): Record<string, string>` → root inline variables
  - `type PitchClass`, `type PitchPalette = Record<PitchClass, string>`, `CRF_PITCH_COLOURS` (spec table)
  - `BAR_ITEM_IDS` (`as const`) and `type BarItemId`, exact ids from the spec
  - `type PepperScoreSkin`, `mergeSkins(base, ...overrides)`
  - `skinKey(skin): string`, a stable serialisation, used as the memo key so inline literals do no work
- **Notes / gotchas:**
  - Replace every interface colour in `styles.css` with `var(--ps-x,<today's value>)`. Near-identical greens may share a token only if the rendered value stays identical; otherwise use `color-mix` from the token or add a token. Keep the four existing `--ps-*` score-mark variables.
  - AC5 test: set every token to a sentinel, walk computed colours of the player's non-SVG elements, including the open drawer and dialogs, and fail on anything else. Engraved music is excluded.
  - Add a tsc fixture for AC8d that uses `// @ts-expect-error` on a bad token and bad bar id, plus a plain `.mjs` import check.

### T2 — Composable main bar and toggles
- **Depends on:** T1
- **Route:** implement (default)
- **Owns:** `lib/bar-items.ts` (new), `lib/bar-items.test.ts` (new), `lib/chrome.ts`, `lib/header-controls.ts`, `components/SkinBar.tsx` (new), `components/PepperScore.tsx`, `src/styles.css`, `validation/skin.mjs`, `apps/reader/src/embed/SkinTest.tsx`
- **May read:** anything
- **Acceptance:** AC2, AC2b, AC3, AC4, AC7
- **Verify:** `npm run check && npm run build && npm run test:skin && npm run test:embed && npm run test:layout && npm run test:reader`
- **Interfaces produced:**
  - `resolveBar(skin, preset, controls): BarItemId[] | null`. `null` means today's header. Pure, unit tested for every rule: `none` → `null`, `controls.x === false` removed, unknown ids dropped, duplicates once.
  - `resolveChrome(preset, controls, bar?)`: bar items raise their chrome flags, so `options` sets `drawer`, and on `minimal` a bar sets `compactPlay: false`.
- **Notes / gotchas:**
  - Public ids differ from `HeaderControlId`: `tempo`→`bpm`, `viewToggle`→`mode`, `zoom`→`staveScale`. Map them in `bar-items.ts` and keep the private ids.
  - Keep the `headerElements` map as the single source of each control. New elements: `noteNames`, `counts`, `chordSymbols`, `options`, `instrumentSwitch`.
  - `chordSymbols` is on only when both prefs are on. Pressing it sets both to the new value. Use `update()` so persistence and the `settings` flow stay as they are.
  - `instrumentSwitch`: `embedSwitchShown` at `PepperScore.tsx:1815` is gated on `preset === 'minimal'`. Drive it from the bar too, so it works on `full`, and check its menu positioning under the sticky header.
  - Overflow uses the existing More dropdown at `MOBILE_HEADER_BREAKPOINT`: with a skin bar, the first four items stay inline and the rest are secondary. Include the dev-only warning for unknown ids. No window-size checks: container queries only.
  - A skin bar on `minimal` adds a header: check `test:embed` height handling.

### T3 — Drawer gains the missing controls
- **Depends on:** T2
- **Route:** implement (default)
- **Owns:** `components/DrawerControls.tsx` (new), `components/PepperScore.tsx`, `src/styles.css`, `validation/skin.mjs`
- **May read:** anything
- **Acceptance:** AC2a
- **Verify:** `npm run check && npm run build && npm run test:skin && npm run test:reader`
- **Interfaces:** `drawerExtras(bar: BarItemId[] | null, chrome): BarItemId[]`, returning `stop`, `viewToggle`, `bars`, `zoom`, `mixer`, `openFile` when available and not on the bar. It must return `[]` when `bar` is `null`, so no skin means no new rows.
- **Notes / gotchas:** a new "Playback and view" panel reuses the `headerElements` nodes. Rendering an element twice duplicates state-bound refs (`staveScaleInput`, `fileRef`), so render each in one place only, which `drawerExtras` guarantees because bar and drawer are exclusive here. `openFile` keeps its single hidden input; move it out of the `chrome.header` block so it exists when the header doesn't show it.

### T4 — Pitch colours and toggle tile
- **Depends on:** T2 (T3 may run first; both touch the drawer, so not in parallel)
- **Route:** implement (default)
- **Owns:** `lib/pitch-colours.ts` (new), `lib/pitch-colours.test.ts` (new), `components/PitchColourTile.tsx` (new), `lib/prefs.ts`, `lib/file-state.ts`, `lib/file-state.schema.json`, `lib/render.ts`, `components/PepperScore.tsx`, `src/styles.css`, `validation/skin.mjs`
- **May read:** anything
- **Acceptance:** AC8a, AC8b, AC8c
- **Verify:** `npm run check && npm run build && npm run test:skin && npm run test:score-db && npm run test:transpose && npm run test:chunks && npm run test:reader`
- **Interfaces produced:**
  - `pitchClassOf(midi: number): PitchClass`, by `midi % 12`, so enharmonics match
  - `pitchColours` pref (default `false`), `settings.pitchColours`, `handle.setPitchColours(on: boolean)`
  - root attribute `data-ps-pitch-colours` when on with a palette
  - root variables `--ps-pitch-c`, `--ps-pitch-c-sharp`, … `--ps-pitch-b`, from `skinStyle`
- **Notes / gotchas:**
  - Tag in the existing loop at `render.ts:661`, always, regardless of the pref, so toggling needs no re-engrave. Set `data-pitch` on **each notehead**, not the event element: a chord event holds several pitches. Match Verovio noteheads to `event.pitches`, and test a two-note chord in different colours.
  - `renderScore` receives `displayScore`, so `event.pitches` should already be the displayed pitch. Prove it with a transposed test rather than assuming it.
  - Skip percussion (`part.clef === 'percussion'`) and TAB staves. Tags must appear in chunked paging too (`npm run test:chunks`).
  - Do not add `pitchColours` to the engrave dependency list (`PepperScore.tsx:1113`) or the re-render key list (`:558`).
  - CSS: fill from the variable, thin dark stroke for the outline. Existing `.is-playing`, `.ps-selection`, `.ps-transposed`, `.ps-out-of-range` rules must win: test each.
  - Tile: use the house note-text style exactly. Off state dimmed; on state selected ring. Button with `aria-pressed`, name "Coloured notes", class `ps-pitch-colour-tile`. Fill is the palette's C colour.
  - Default-off pref must not change saved-file output for existing files (`npm run test:score-db`).

### T5 — becreative fixture, docs and changelog
- **Depends on:** T1–T4
- **Route:** implement (alt)
- **Owns:** `apps/reader/src/embed/SkinTest.tsx`, `apps/reader/src/embed/host.css`, `validation/skin.mjs`, `packages/pepperscore/README.md`, `packages/pepperscore/CHANGELOG.md`
- **May read:** anything, including `/home/shaun/becreative/src/styles/custom.css:785`
- **Acceptance:** AC8, AC9
- **Verify:** whole-item command
- **Notes / gotchas:** the fixture copies the `.accent-blue`, `.accent-orange` and pink tokens and the spec's bar, and tests 1280px and 390px widths. Cover `reader` and `snippet` shapes; `static` shows no bar. Add one `README` example for JS and TS. Do not bump the version: release is a lead step.

## Merge order

T1 → T2 → T3 → T4 → T5

After T5 (lead, not this item's blockers):
1. Release pepperscore, with the user's go-ahead.
2. A becreative PR: bump from 0.4.0, add the skin beside `ScoreEmbed.tsx`, pass it for `reader` and `snippet`, and theme-only for `static`.

## Risks

- **Pale notes:** E `#fff56d`, F `#b3f888` and G♯ `#7ee8df` on white, on-screen and when zoomed out. Test at the minimum stave scale that the outline holds. Owner: T4.
- **Host token contains an invalid value** (e.g. a typo): the variable falls back to inherited, not today's colour. `var(--ps-x,fallback)` doesn't catch an invalid custom property value. Test what a bad `skin.theme` value looks like and warn in development. Owner: T1.
- **Skin arrives after first paint** (hydration, async config): tokens must apply with no re-engrave and the bar without a layout jump that scroll-anchoring breaks. Owner: T2.
- **Saved state from a skinned page opened elsewhere:** `persist` keys are shared, so `pitchColours: true` with no palette must draw plain notes and not throw. Owner: T4.
- **Keyboard and focus in a bar with hidden items:** Space must still control playback, and focus mustn't land on hidden controls in the closed More panel. Owner: T2.
- **Large diff in `styles.css`:** line 21 of the file holds most of the CSS. Reviewers should rely on AC1 and AC5, not on reading it.
