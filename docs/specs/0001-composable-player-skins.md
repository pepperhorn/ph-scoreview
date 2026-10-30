# 0001 — Composable player skins

- **Status:** approved
- **Ledger:** 0001 · **Plan:** ../plans/0001-composable-player-skins.md
- **Author:** lead · **Date:** 2026-10-31

## Problem

Integrations can only switch whole controls on or off (`chrome` presets and `controls`, `packages/pepperscore/src/lib/chrome.ts`). They can't put a control from the drawer on the main bar, reorder the bar, or match their brand: interface colours are hard-coded in `packages/pepperscore/src/styles.css` (37 uses of `#fff`, 20 of `#345642`, and so on). Only score marks have variables (`--ps-cursor`, `--ps-selection`, `--ps-transposed`, `--ps-out-of-range`).

becreative wants a focused, CRF-coloured player, and other integrations will want their own. This needs one standard way of doing it, not a becreative special case.

## Goals

- A **skin**: plain data an integration passes to `PepperScore` that sets colours and composes the main bar.
- Every interface colour in the player can be set through a named theme variable.
- becreative is the first skin, and proves the system against a real host.
- No skin means no visual or behavioural change.

## Non-goals

- PDF export (0002). This spec only reserves its bar item id, `pdf`.
- Custom host-supplied controls or render slots on the bar. Skins arrange built-in controls only.
- Reordering or restyling the drawer's existing contents. The only drawer change is the additions under "Drawer" below.
- Theming the rest of the engraved music: staves, stems, beams, rests, TAB, and note-name text colour beyond the existing annotation colours. Pitch colours for noteheads are in scope, below.
- Coloured pitch dots for note names. The user decided note names stay plain text.
- Dark mode, and the score editor (`pepperscore-editor`).
- Icon replacement and layout/spacing tokens (radius, sizes). Colours only for now.

## User-visible behaviour

### API

A new optional `skin` prop. Exported type, in the shape of:

```ts
type PepperScoreSkin = {
  /** Theme variable overrides. Any CSS colour value, including var(--host-token). */
  theme?: Partial<Record<ThemeToken, string>>;
  /** Notehead colour per pitch class, C to B. Omitted: pitch colouring isn't offered. */
  pitchColours?: PitchPalette;
  /** Main-bar items, in order. Omitted: today's bar for the chosen chrome. */
  bar?: BarItemId[];
};
```

`chrome` and `controls` keep working unchanged when there's no `skin.bar`. With one:

- An item listed in `skin.bar` is available even if the preset defaults it off, so `minimal` can carry a full bar (user decision). An explicit `controls.x === false` always wins.
- On `minimal`, the skin bar replaces the overlaid compact play button. Listing `options` mounts the drawer and its handle behaviour. The bar's height counts as chrome, so snippet sizing must allow for it.
- On `none`, `skin.bar` is ignored, because that preset loads no audio or controls. `skin.theme` still applies.
- A skin leaves something off the bar by omitting it. That moves it out of sight of the bar, not out of the drawer. To remove a control entirely, use `controls`.

### Addressing a skin from JS or TS

Skins must be easy to write and change from code, with no CSS knowledge and no build step beyond importing `pepperscore`:

- A skin is a plain, JSON-serialisable object, so it works the same from JS and TS and can be stored, shared and tested.
- Exported from the package root: the `PepperScoreSkin`, `ThemeToken`, `BarItemId` and `PitchPalette` types; runtime lists `THEME_TOKENS` and `BAR_ITEM_IDS`, so JS callers can read the valid names; `CRF_PITCH_COLOURS`; and `mergeSkins(base, ...overrides)`, which merges `theme` and `pitchColours` key by key and replaces `bar` whole.
- In TS, a mistyped token or bar id is a compile error. `ThemeToken` keys are short role names (`accent`, `surface`), and the player maps them to `--ps-*` variables.
- Passing a new `skin` object applies it live. Equal content must not cause work, so an inline object literal is safe.
- A host can equally set the same CSS variables from its own stylesheet.

```ts
import { CRF_PITCH_COLOURS, mergeSkins, type PepperScoreSkin } from 'pepperscore';

export const becreativeSkin: PepperScoreSkin = {
  theme: { accent: 'var(--accent-ink)', focusRing: 'var(--accent)' },
  pitchColours: CRF_PITCH_COLOURS,
  bar: ['play', 'tempo', 'instrumentSwitch', 'noteNames', 'counts', 'chordSymbols', 'options'],
};
const quiet = mergeSkins(becreativeSkin, { bar: ['play', 'options'] });
```

### Bar items

Every existing header control gets a stable id, plus new toggle items:

- Existing: `play`, `stop`, `tempo`, `transpose`, `keyFlip`, `bars`, `viewToggle`, `tab`, `zoom`, `mixer`, `openFile`, `instrumentSwitch`, `octaveTool`, `options` (opens the drawer).
- New toggles: `noteNames`, `counts`, `chordSymbols`, `pitchColours`.
- Reserved: `pdf` (0002).

Toggles show pressed state, have accessible names, and write to the same prefs as the drawer, so bar and drawer always agree and persistence is unchanged.

- `noteNames` toggles `prefs.names`.
- `counts` toggles `prefs.counts`. Subdivisions stay in options.
- `chordSymbols` is an icon toggle that sets `prefs.chordSymbols` and `prefs.inferChordSymbols` together, so derived chords appear. In the drawer the two remain separate (lead's call).

### Drawer

The drawer keeps its existing panels, even for controls that are also on the bar, because it holds the further settings (annotation sizes, subdivisions). Its switches stay in sync with the bar (lead's call).

So that "stays in options" is true, the drawer gains the controls it lacks: `stop`, `viewToggle`, `bars`, `zoom`, `mixer` and `openFile` (user decision). Each shows in the drawer only when that control is available and not already on the bar, so the default full reader doesn't change, and `controls` still removes it.

Unknown ids are ignored with a development-only console warning, so a skin written for a newer version doesn't break an older one. Duplicates render once.

### Theme

Theme tokens are `--ps-*` CSS variables, grouped by role (surface, text, muted text, border, accent, accent ink, accent wash, focus ring, playback highlight, and whatever else the audit of `styles.css` needs). Each token's fallback is today's colour.

The token set is a public API: names describe roles, not colours, and are listed in the package README.

### Pitch colours

With a palette supplied, the user can colour every notehead by pitch.

- A new `pitchColours` pref, off by default, also settable through `settings.pitchColours` and `handle.setPitchColours(on)`. It's saved with the other prefs.
- **Toggle:** a tile in the menu (the drawer's annotations panel), also available as bar item `pitchColours`. The tile is a square filled with the palette's C colour (red `#f86e6e` for CRF) showing a white letter C in the house note-text style: Poppins 600, white fill, `rgba(0,0,0,0.35)` stroke drawn behind the fill. It's a real button with `aria-pressed` and the accessible name "Coloured notes". When off, the tile is dimmed; when on, it shows full colour with a selected ring. Without a palette, it doesn't appear.
- The palette has 12 entries, keyed `C`, `C#`, `D`, `D#`, `E`, `F`, `F#`, `G`, `G#`, `A`, `A#`, `B`. Enharmonics share a colour: D♭ uses C♯.
- `CRF_PITCH_COLOURS` holds exactly these values, so notes always match the CRF palette:

| C | C♯ | D | D♯ | E | F | F♯ | G | G♯ | A | A♯ | B |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `#f86e6e` | `#f58841` | `#ffbc57` | `#b8a334` | `#fff56d` | `#b3f888` | `#93d154` | `#6bc6a0` | `#7ee8df` | `#88a7f8` | `#cc97e8` | `#e277b1` |

- Colour follows the **displayed** pitch, so it changes with transposition, instrument transposition and key flip.
- Only noteheads are coloured, on every stave but not on TAB. Each keeps a thin dark outline so pale colours stay visible on white, notably E `#fff56d` (lead's call).
- Playback, selection, moved and out-of-range marks show over pitch colours while they apply (lead's call).
- Changing it must not re-engrave the score. A palette change applies through CSS variables.

### becreative skin

Lives in the becreative repo beside `src/components/score/ScoreEmbed.tsx`, not in pepperscore. Requires a pepperscore release; becreative is on 0.4.0. Delivery has three stages (lead's call): the pepperscore PR, a release by the lead with the user's go-ahead, then a separate becreative PR. Only the first blocks this item.

- **Bar:** `play`, `tempo`, `instrumentSwitch`, `noteNames`, `counts`, `chordSymbols`, `options`. Everything else is in options.
- **Parts switcher** means the existing "Choose your instrument" popover, which today renders only on `minimal`. It must also work on `full` (user decision).
- **Pitch colours:** the skin uses `CRF_PITCH_COLOURS`, which match becreative's `--root-c` … `--root-b` values. The toggle tile sits in the menu, not on the bar. Note names stay plain text.
- **Variants:** applies to `reader` and `snippet`. `static` keeps no bar, and takes the theme only.
- **Colours** (lead's call on mapping) follow becreative's section-based accent system, so a score on a blue page goes blue by itself:
  - play button and "on" toggles: `--accent-ink`
  - selected backgrounds: `--accent-wash` / `--accent-wash-strong`
  - focus: `--accent-ring`
  - pressed and hover tints derive from the same tokens
- "CRF colours" means these brand accents, not the 12 pitch colours (user confirmed).

## Constraints

- Default rendering stays pixel-identical (colours resolve to today's values).
- The theme must work inside the existing style scoping (`.pepperscore`, checked by `npm run test:css`). Token values come from the skin on the player root, so `var(--host-token)` resolves from the host page.
- Changing `skin` must not re-engrave the score.
- `PepperScore.tsx` is 1,984 lines. Pull the bar composition into its own module rather than adding to it.
- Phone: frequent controls sit in the bottom toolbar and occasional ones in the header (`mobile-controls-placement` memory). A skin's bar follows this: items that don't fit wrap or overflow rather than clip. The `viewport` under 580px must stay usable with the becreative bar.
- SSR safe: the first render depends only on props, as today.
- House style: contextual class names on elements, Poppins for UI.

## Acceptance criteria

- [ ] AC1 — With no `skin`, the validation suites pass unchanged and full, minimal and none chrome render as before.
- [ ] AC2 — `skin.bar` renders exactly the listed items, in order, on `full` and `minimal`, excluding items with `controls.x === false`. On `none` it renders nothing and doesn't load audio.
- [ ] AC2a — With a skin that omits them, `stop`, `viewToggle`, `bars`, `zoom`, `mixer` and `openFile` work from the drawer. With no skin, the drawer shows no new rows.
- [ ] AC2b — `instrumentSwitch` opens and works on the bar on both `full` and `minimal`.
- [ ] AC3 — The `noteNames`, `counts` and `chordSymbols` toggles change the score, show pressed state, and stay in sync with the drawer in both directions, including after reload.
- [ ] AC4 — `chordSymbols` shows derived chords on a score with no authored harmony.
- [ ] AC5 — Setting every theme token to a sentinel colour leaves no hard-coded interface colour in the player's computed styles (verified by a validation script). Engraved music is excluded.
- [ ] AC6 — A theme token set to `var(--x)` follows a change to `--x` on the host page, with no re-render or re-engrave.
- [ ] AC7 — Unknown bar ids don't throw, and warn only in development.
- [ ] AC8 — A fixture host page in `apps/reader` using the becreative token mapping shows the agreed bar and follows blue, orange and pink accent changes, on desktop and at 390px wide.
- [ ] AC8a — With the CRF palette on, every notehead of a chromatic scale matches its pitch class, enharmonics match, and transposing updates the colours with no re-engrave. Every notehead, including E, is distinguishable on white.
- [ ] AC8c — The tile renders as specified, toggles noteheads, reports `aria-pressed`, survives a reload, and stays in sync with `settings` and the handle.
- [ ] AC8d — A TS fixture fails to compile on a mistyped token or bar id; a plain JS fixture can import and use the same exports; `mergeSkins` has unit tests.
- [ ] AC8b — With no palette, no pitch-colour control appears and noteheads are unchanged.
- [ ] AC9 — The README documents `skin`, every token and every bar id, and a pepperscore changelog entry is added.

## Open questions

None yet.
