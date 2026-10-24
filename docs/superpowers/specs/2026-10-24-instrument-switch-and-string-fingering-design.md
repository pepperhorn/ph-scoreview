# Instrument switch (reader + embeds) and bowed-string fingering / TAB

Date: 2026-10-24. Status: design, awaiting approval.

## Why

Students and teachers open pepperscore scores (full reader, becreative embeds, crf-admin `block_score`) that were written for one instrument (often piano) and want to play them on theirs. Today the reader's instrument picker only swaps the playback sound: a piano melody "switched" to trumpet still shows concert pitch, the piano's clef, and notes the trumpet can't play. Guitar players already get a TAB view (`docs/specs/guitar-tab.md`); violin and cello players get nothing comparable.

Two linked outcomes:

1. **Instrument switch** in the full reader and embeds: choosing an instrument for a part changes its sound, clef, transposition (B♭/E♭ instruments shown at written pitch) and fits it into the instrument's range, reusing the editor's swap and range-fitting logic.
2. **Bowed-string fingering and TAB**: violin and cello parts (including a piano part switched to violin/cello) get computed fingerings, shown in place of note names in notation and in place of fret numbers in a 4-line string TAB, with optional hand-position labels.

Order: (1) first, (2) builds on it. A separate small fix to the cello charts in `~/violintab` and `~/tiles` (below) is independent.

## Goals

- One instrument model and one range-fitting algorithm shared by the editor, the full reader and embeds.
- Embeds can switch instrument per part from a short list; the full reader keeps its full sound list.
- A part switched to a transposing instrument reads at that instrument's written pitch by default; concert pitch stays one switch away (the existing Transposing / Concert control).
- Out-of-range notes are moved by phrase (editor behaviour), highlighted, and fitting can be turned off.
- Readers can choose the range level (Beginner / Intermediate / Advanced); the host sets the initial level.
- Violin and cello: computed string + finger per note, shown as a label in the note-name lane (notation) or as the number on a 4-line string staff (TAB). Position labels optional.
- Fingerings printed in the score are kept as fixed constraints.

## Non-goals

- Viola and double bass fingerings (they are in the switch list; fingering for them is a later step — viola reuses the violin model, double bass needs its own research, Simandl positions).
- Thumb position (cello) and positions above 5th (violin).
- Editing fingerings in the reader (corrections go through MuseScore + re-upload, as for guitar).
- Bowings, string-crossing marks, harmonics.

## Anti-goals (would be a failure even if it "works")

- Wrong fingerings that a string teacher would immediately reject (e.g. the current cello position-label bug, an impossible stretch, a 4th finger where an open string is obvious and in position).
- A switch that silently drops or changes notes without showing what moved.
- Diverging copies of the instrument table / range fitting between editor and reader.
- Embeds becoming cluttered: the switcher and string options must be hideable by the host.

## Part 1 — Instrument switch

### Current state

- Reader: `PepperScore.tsx` `changeInstrument` (≈ line 1519) sets `part.instrument`, `gmProgram`, `gmSoundfont` only (sound). Picker grid lives in the mixer.
- Editor: `packages/pepperscore-editor/src/model/instruments.ts` — `INSTRUMENTS` (16 ids: label, short, GM program, clef, written-minus-sounding transposition, ranges per level) and `engine/layout/range-fit.ts` `fitToRange` (phrases broken at rests and slur ends, joined across ties; a phrase with a note out of range moves an octave as a whole; overrides extend along tie chains; diagnostics) plus `writtenKeyFifths`. These run on the editor's own schema (events/sequences), not on pepperscore's MEI render path.
- Reader rendering goes MusicXML → Verovio MEI → `buildViewMei` transforms (spelling, transposition, TAB injection) — see `lib/notation/mei-view.ts`, `mei-spelling.ts`, `mei-tab.ts`.

### Design

- **Move the instrument model into pepperscore core** (e.g. `packages/pepperscore/src/lib/instruments/`): the `INSTRUMENTS` table, levels, ranges, transpositions, clefs, `writtenKeyFifths`. The editor imports it from pepperscore instead of owning it. pepperscore's existing `InstrumentId` union already matches the editor's 16 ids.
- **Split range fitting into a schema-free core + adapters.** The core takes phrases as lists of `{ id, midi, tieChain }` plus target range and returns per-phrase shifts (0 / ±12), moved ids and diagnostics — exactly the editor's current rules. The editor keeps an adapter over its schema; the reader gets an adapter over the view MEI (phrase = run of notes in one layer of one measure, broken at rests and slur ends, joined across ties, same as the editor). Builder decides the exact module boundary; the requirement is one implementation of the rules, tested once.
- **A part's "shown as" instrument** is a reader pref per part: `{ instrument, level, autoRange }`. Unset = as written (the part's own instrument). Applying it in `buildViewMei`, in this order: to sounding pitch → fit range at sounding pitch for the level → (if the view is Transposing) to the target's written pitch and key (`writtenKeyFifths`) → clef change to the target clef → then the existing spelling/transposition (`semitones`) and TAB/fingering injection. Playback follows what is shown (sounding pitch of the fitted notes) and uses the target's GM program.
- **Fit after the score transpose** (my call): the range fit runs on the final sounding pitches, i.e. after `semitones` and key flip, so what the student sees is always playable. The fit is computed once on the Score model (playback reads it: `timeline.ts` `soundingMidi`) and the moved note ids are passed to `buildViewMei`, which covers ties across chunk boundaries.
- **Concert-pitch scores** (my call, from the user's "automatically transposing for E♭ and B♭"): a part switched to a transposing instrument shows its written pitch by default even when the score is concert-basis. The forced-concert rule (`PepperScore.tsx` ≈ 410) no longer applies once any part is switched to a transposing instrument; the Transposing / Concert control then shows, and its hint text covers switched parts.
- **Moved notes** get the editor's transposed-note highlight style (`ps-transposed` / `--ps-transposed`), so it reads the same in editor and reader.
- **Interaction with existing pitch controls:** `semitones` (transpose score) and key flip still apply on top. Transposing / Concert (`scorePitch`) decides written vs sounding for switched parts too; a part switched to a transposing instrument makes the score "have transposing parts", so the control shows.

### Grand staff (piano) parts

The reader splits a multi-staff MusicXML part into one part per staff (`musicxml-source.ts`, ids `${id}-${staff}`). **Switching a grand-staff instrument (e.g. piano) switches both staves together** (user's decision): one choice for the instrument, applied to every staff of the source part — sound, clef, transposition and range fitting on each. The reader can then hide the lower staff with the existing part visibility control if they only want the melody. Fingering (Part 2) runs per staff, so a switched lower staff gets its own fingerings.

### Octave moves by the reader

Readers can move a note or passage by an octave (user's decision), reusing the editor's range overrides (`setRangeOverride`: single events extended along their tie chain; an override wins over auto-fit).

- An **Octave** tool beside the instrument and level controls; selection only happens while it is on (a tap on a note otherwise seeks playback).
- Tap a note → selects it and its tie chain; tap a second note (Shift-click on desktop) → the passage between them in that staff; "Select phrase" widens to the auto-fit phrase.
- **8va ↑ / 8vb ↓** move the selection; a result outside the instrument's range for the level still moves but is flagged. Moved notes use the same highlight as auto-fitted notes. **Reset** clears the reader's octave moves.
- Works on any part, switched or not. Host can hide it (`controls.octaveTool`, name is the builder's).

### Saving

- Everything the reader chooses here (instrument per part, level, fit on/off, octave moves) is stored in the existing per-score IndexedDB record (`lib/score-db.ts`, FileState keyed by source sha256) as a new record version; older records open unchanged with the new keys unset.
- Octave moves are stored by note id + part, so **note ids must be identical every time the same file loads** (Verovio xml:id generation from MusicXML must be deterministic across sessions, whole/probe/chunked paths). The builder must verify this and, if not, key moves by a stable position (part, measure, layer, onset, pitch) instead.
- Storage is per browser and origin; no server sync (out of scope).
- Embeds default to `persist: false`. becreative's `ScoreEmbed` / `BlockScore` pass `persist="becreative"` for every embed (decided), so reader choices survive visits.

### Controls and settings

- **Embed switcher list** (user's decision): Alto Sax, Tenor Sax, Bari Sax, Trumpet, Trombone, Flute, Clarinet, Violin, Viola, Cello, Double Bass — plus "As written" to return to the part's own instrument (my call).
- **Full reader** (my call): the mixer gets an **Instrument** choice (the 16 model instruments, real switch: sound + clef + transposition + range + instrument settings) separate from **Sound** (today's 128-sound GM picker, sound only). Every GM sound maps to a model icon id, so a sound pick must never imply an instrument switch (picking "Orchestral Harp" must not apply violin range or fingerings). Choosing an instrument sets its main sound; the sound can then be changed independently.
- **Where it sits in embeds** (my call, builder may refine with the design system): a compact instrument button in the embed chrome; single-part score → one menu; multi-part → menu lists parts then instruments. Phone placement follows the mobile controls rule (frequent controls in the bottom toolbar).
- **Level** (user's decision): readers can change it (Beginner / Intermediate / Advanced) next to the instrument choice; the host sets the initial level. **Fit to range** on/off toggle beside it, default on.
- **New public API** (names are the builder's to refine): settings `instruments?: Record<partRef, InstrumentId>` (or a single `instrument` for one-part scores), `rangeLevel`, `autoRange`; controls `instrumentSwitch`. Host passthrough in becreative `ScoreEmbed`/`BlockScore` and new crf-admin `block_score` fields (instrument, level, show switcher), following the pattern used for TAB.
- **Saved state:** the per-part choice, level and fit flag persist with the score's other reader prefs (record version bump, unknown/old records leave them unset, like the TAB settings).

## Part 2 — Violin and cello fingering / TAB

### Which parts

Parts whose instrument (as switched, else as written: GM program 41/43 i.e. 0-based 40/42, or name /violin|cello|violoncello/i) is violin or cello. Viola/double bass: not fingered in this step (shown normally).

TAB part selection (my call), extending `tab-parts.ts`: violin/cello parts get string TAB; guitar parts (as written or switched to guitar) get guitar TAB; the "first pitched part gets guitar TAB" fallback applies only when the score has neither guitar nor violin/cello parts. The Notation / TAB / Both switch shows when any part gets TAB.

### Fingering model (pepperscore core)

Do not copy violintab's literal per-position lookup tables. Model per instrument:

- Open strings (MIDI, low → high): violin G3 D4 A4 E5 = 55 62 69 76; cello C2 G2 D3 A3 = 36 43 50 57.
- Positions as **semitone offset of the 1st finger above the open string**, with display names.
  - Cello (Davidoff, *School of Cello Playing*, Part II Art. I): half = 1, 1st = 2, 1½ = 3, 2nd = 4, 3rd = 5, 3½ = 6, 4th = 7 (end of neck positions), 4½ = 8 (Art. IX). No "2½".
  - Violin: positions are diatonic, so the 1st-finger offset depends on the key/note: 1st ≈ 1–2, 2nd ≈ 3–4, 3rd ≈ 5–6, 4th ≈ 7–8, 5th ≈ 8–10 semitones. Builder defines the exact mapping from 1st-finger offset to position name (an offset maps to the nearest diatonic position name for the current key; half position = offset 1 when flat keys need it).
- Hand frames (fingers 1–4 relative to the 1st finger):
  - Cello closed: 0, 1, 2, 3. Cello extended (forward extension, whole step between 1 and 2): 0, 2, 3, 4. Backward extension: 1st finger a semitone lower. Extensions cost more than closed.
  - Violin: each finger can sit a semitone or whole step above the previous one (span 1st→4th = perfect 4th, 5 semitones, typical; augmented 4th / diminished 5th as low/high 4 at a cost).
- **Solver**: reuse the guitar solver's structure (`lib/tab/fret-assign.ts` — Viterbi over (shape, hand position), onset-grouped events, segments at long rests, fixed constraints) with a bowed-string cost profile: open-string bonus (except when the note is mid-passage on a fingered string and the 4th finger is in reach — "4 instead of open" is a cost tie the builder tunes), shifting cost proportional to distance, preference for low positions, penalty for extensions, small string-crossing cost, double stops need adjacent strings. Same event building (`assignNoteFrets` rules) so chords/double stops, ties and multiple voices behave like guitar. Target: same performance budget (2,000 events < 50 ms).
- **Fixed fingerings**: MusicXML `<technical><fingering>` (Verovio `<fing>`) and `<string>` on a note are constraints (finger and/or string kept; the solver fills the rest).

### Display

- **Label format**: string letter + finger, open = `0`: `A1`, `D3`, `G0`.
- **Low / high marks** (my call): violin only. The reference is key-dependent: a finger is "natural" when it lands on the diatonic note of the current key for that position; `L`/`H` mark a semitone below/above it (`aL2`-style, as violintab). Cello shows no L/H: the closed frame is chromatic, and an extension shows only as the finger number it produces (e.g. extended 2 on a whole step), which is how cello parts are printed.
- **Notation view**: a `fingerings` setting. For violin/cello parts, the label replaces the note name in the existing note-name lane (`render.ts` lanes). When both note names and fingerings are on, the string part shows fingerings (the lane is one or the other per part); other parts keep note names.
- **TAB view**: the existing `tabView` (Notation / TAB / Both) extends to violin/cello parts: a generated 4-line staff (top line = highest string: E A D G for violin, A D G C for cello) with the finger number on the string line, not a fret. Built through the existing `mei-tab.ts` path (4 `<course>`s in `<tuning>`); since MEI `tab.fret` is numeric and Verovio draws it, the finger number goes in `tab.fret`, and the TAB staff stays excluded from playback (as now). L/H marks and any non-numeric text are drawn by pepperscore's SVG overlay (builder decides: overlay text vs post-processing Verovio's glyphs).
- **Positions**: a `positions` setting. Label text "½ pos.", "1st pos.", "1½ pos.", "2nd pos.", … placed above the staff at the first note after a change (and "1st pos." on return). **On by default in strings TAB** (user's decision); off by default in notation (my call). Rendered as a MEI `<dir>` above the relevant staff (TAB staff in TAB view) so it lays out with Verovio.
- **Fingering density**: every note gets a label (my call — the user wasn't asked to settle this; every-note suits learners; an "only on changes" mode is a possible follow-up).

### Controls and settings

- `fingerings: boolean` (default false), `positions: boolean` (default true for strings TAB, false in notation), both in the options drawer next to note names, and `controls.fingeringToggle` for hosts to hide them. The Notation / TAB / Both switch (`tabToggle`) also appears when a violin/cello part is present.
- Hosts: becreative passthrough + crf-admin `block_score` fields ("Show string fingerings", "Show hand positions"), in the existing Guitar TAB group renamed "TAB & fingering".
- `tab-bake` later: an option to write computed fingerings as `<fingering>` + `<string>` (not in this scope; note it in the README as follow-up).

## Separate fix — cello charts in violintab and tiles

`~/violintab/src/lib/tab/instruments.ts` `CELLO_FINGER_MIDI` and `~/tiles/src/stringFingering.ts` (copied) have correct pitches but wrong position keys above 2nd (commit `58c97a7` assumed even spacing and invented 2½). Rename keys 2.5→3, 3→3.5, 3.5→4, 4→4.5; update tiles' `AVAILABLE_FINGERING_POSITIONS.cello`, both `positionLabel`/format code, tests, and the doc comment. One PR per repo. Independent of pepperscore.

## Constraints

- Verovio 6.3.0 (pinned); MEI generated in `buildViewMei` for whole, probe and chunked paths (any new transform must cover all three, like TAB).
- Worker reload key must include the new view inputs (instrument choices, level, autoRange, fingerings, positions).
- MIT licence: no copied GPL code (the fretpath credit stands; violintab/tiles are our own MIT code and may be reused).
- Keep the alignment memory: tunings and charts are duplicated across pepperscore, becreative, chordl, violintab, tiles until a shared package exists.
- UI: contextual class names alongside utilities; Poppins; phone controls placement rule.

## Left to the builder

- Module boundaries for the shared instrument model and range-fit core; how the editor re-imports them.
- Exact API names and the per-part addressing scheme for embed settings.
- Solver cost weights (tuned with tests: scales, arpeggios in 1st–4th position, a melody needing a shift, double stops, a piano melody switched to cello).
- Overlay vs Verovio for non-numeric TAB marks.
- Embed chrome layout of the switcher, within the mobile-controls rule.
