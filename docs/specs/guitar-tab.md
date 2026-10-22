# Guitar TAB view

## Goal

Guitarists can read any pepperscore score as tablature. A reader switch flips between **Notation**, **TAB** and **Both**. Scores that already carry a TAB staff use it; every other score gets TAB generated from its pitches with a fingering solver. Hosts (becreative, the crf-admin `block_score` block) set the initial view and whether readers see the switch.

## Public API (pepperscore 0.3.0)

`PepperScoreSettings` gains:

| Key | Type | Default | Meaning |
|---|---|---|---|
| `tabView` | `'notation' \| 'tab' \| 'both'` | `'notation'` | Which staves guitar parts show |
| `tabTuning` | `number[]` (open-string MIDI, low → high) | `[40,45,50,55,59,64]` (EADGBE) | Tuning for generated TAB |
| `capo` | `number` 0–12 | `0` | Capo fret; generated frets are relative to it |
| `bpm` | `number` 30–240 | `96` | Initial tempo (was internal-only) |
| `keyFlip` | `boolean` | `false` | Enharmonic respelling (was internal-only) |

`controls` gains `tabToggle` (Notation / TAB / Both switch). Off unless set; on in the `full` preset.

## Which staves get TAB

1. **Imported TAB staves** (MusicXML `clef sign=TAB` / `staff-lines` 6 with `staff-tuning`, imported by Verovio as `staffDef notationtype="tab.guitar"`): used as-is when `semitones === 0`. They are flagged in the parser as TAB staves: excluded from the playback timeline and annotation lanes (no doubled audio, no note-name lanes under TAB), but kept so staff numbers map. When transposed, Verovio leaves `tab.fret` stale, so the imported TAB is hidden and a generated one replaces it.
2. **Generated TAB**: for parts whose instrument is a guitar (GM program 24–31, or name matching /guitar/i) that have no TAB staff. If the score has no guitar part, the first pitched, non-percussion part's top staff.

The notation view (`tabView: 'notation'`) is unchanged from today: imported TAB staves are hidden, nothing is generated.

## Generation (render path)

- `ViewSpec` gains `tab: { view, tuning, capo }`; it is part of the worker reload key.
- `buildViewMei` injects TAB **after** spelling/transposition, so frets follow the transposed pitches. Covers whole, probe and chunked paths.
- Each TAB staff is `n = 100 + notation n`, its `staffDef` placed right after the notation one: `notationtype="tab.guitar" lines="6"`, `<clef shape="TAB" line="5"/>`, `<tuning>` with six `<course>`s (always include tuning, or Verovio MIDI pitch is 0).
- Per measure, clone the staff: note/chord → `tabGrp dur dots` + `<tabDurSym/>` + `note tab.course tab.fret`; keep `beam`, `tuplet`, `rest`/`mRest`/`space`; drop verse, grace notes and control events. Ids get a `-tab` suffix. Tie continuations show the fret in parentheses or are omitted.
- `tabView: 'tab'` hides the notation staff via `hiddenStaves` and retargets `harm@staff` to the TAB staff so chord symbols stay.
- Highlighting: `findNote` also looks up `${id}-tab`.
- Layout: staff counting (`stavesOf`, chunk budgets, `spacingStaff`) counts TAB staves.
- Notes that already carry `tab.course`/`tab.fret` (MusicXML `<technical><string>/<fret>` on the notation staff) are fixed constraints for the solver. This is the "preprocessed score" path: an editor can correct fingerings in MuseScore and upload.

## Fingering solver (`packages/pepperscore/src/lib/tab/fret-assign.ts`)

Pure TS, no deps, written fresh. The (shape, hand position) Viterbi idea is credited to knoguchi/fretpath (GPL-3.0). No code is copied.

```ts
export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];
export interface FretPos { string: number; fret: number }          // string 1 = highest
export interface FretEvent { onset: number; durations: number[]; pitches: number[]; fixed?: (FretPos | undefined)[] } // quarter notes, MIDI
export interface FretOptions { tuning?: number[]; capo?: number; maxFret?: number; octaveFold?: boolean }
export type FretResult = (FretPos & { shifted?: number }) | { unplayable: true };
export function assignFrets(events: FretEvent[], options?: FretOptions): FretResult[][];
```

- Candidates per event: one note per string, strictly descending strings, hard fretted span ≤ 4 (≤ 5 from fret 7). Keep the 24 cheapest. Exclude strings still ringing from earlier events.
- State: (shape, hand position). An all-open shape inherits the position.
- Node cost: open bonus, gentle pull to low positions, a body penalty past fret 12 (squared), a stretch penalty `(span)^1.5`, muted interior strings, a tiny high-string tie-break.
- Transition: `(shiftFixed + shiftDist·|Δpos|) / (1 + gapRelief·gapBeats)`.
- Out of range: octave-fold (`shifted = ±12k`) or `unplayable`. Chords with too many notes drop doubled notes, then inner voices. Never fail the whole score.
- Segment at rests of ≥ 2 beats. Target: 2,000 events in under 50 ms.

## Preprocessing (follow-up)

`scripts/tab-bake.mjs <in.musicxml> [--tuning …] [--capo n] [--add-tab-staff]` writes `<technical><string>/<fret>` onto notes using the same solver, and can add a TAB staff. That lets a batch job or Directus flow make the library TAB-ready ahead of time; the reader then treats those fingerings as fixed.

## Hosts

- becreative `ScoreEmbed` / `BlockScore`: pass every reader setting and control through.
- crf-admin `block_score`: one field per reader option, including `tab_view`, `show_tab_toggle`, `tab_tuning`, `capo`.
