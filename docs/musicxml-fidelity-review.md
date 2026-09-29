# MusicXML fidelity review

Review completed 2026-09-29. Reviewed repository HEAD `cc0f9fa` and installed VexFlow **5.0.0**. This document records findings and a proposed implementation sequence; it does not change the importer or renderer.

## Recommendation

Expand the shared score model before adding individual engraving features. The current MusicXML import discards information that VexFlow needs: written note values, voice identity, changing attributes, per-pitch notation, and relationships between the endpoints of spans. Adding drawing calls alone cannot recover those details.

Basic dynamics already exist: direction-level letter markings are imported and drawn using Bravura/Petaluma glyphs. They are only a small part of expression support. Prior project context in GBrain, `default:projects/scoreflow-music-reader`, describes the initial core-notation scope and subsequent dynamics/beaming additions. The user's current requirement expands that scope to preserving as many MusicXML features as VexFlow supports.

VexFlow provides engraving primitives, not a MusicXML importer or a playback interpretation engine. A supported primitive is an implementation opportunity, not a promise of automatic fidelity for every MusicXML variant.

## Prioritized findings

### 1. High: written rhythm is reconstructed incorrectly

Evidence: `src/lib/import.ts:170`, `src/lib/import.ts:186`, `src/lib/render.ts:8`, `src/lib/render.ts:149`.

MusicXML durations are converted to floating quarter-note units, but the source `<type>`, dot count, `<time-modification>`, tuplet notation and grace attributes are discarded. The renderer guesses a written value from a short lookup table and otherwise chooses a quarter note. A boolean `dotted` cannot represent multiple dots. Rendered tick duration can therefore disagree with the imported playback duration.

Browser probes confirmed:

- Three eighth-note triplets retain durations of 1/3 beat each but render as unflagged quarter notes with no tuplet indication.
- An eighth grace note receives 0.5 beat and moves the following main note from beat 0 to beat 0.5.

Preserve written type and integer dot count separately from exact musical duration. Preserve tuplet ratios and numbered start/stop groups; use `Tuplet`. Store grace notes as attachments with their source timing policy; use `GraceNote`/`GraceNoteGroup`. Represent gaps with exact invisible timing where appropriate, rather than inventing a visible rest of approximately the right value. Preserve measure-rest semantics, including whole-measure rests in non-4/4 meters.

### 2. High: accidental rendering can change the read pitch

Evidence: `src/lib/render.ts:156`.

Only nonzero pitch alterations receive an accidental glyph. The importer ignores the source `<accidental>`, and the renderer has no accidental state across the measure or across voices. F-sharp followed by F-natural in one measure draws the sharp but omits the cancellation. Pitches already altered by the key signature receive unnecessary repeated signs; cautionary/editorial forms are lost.

A browser probe inspected SVG text and found the sharp glyph U+E262 but no natural glyph for an explicitly marked F-natural following F-sharp.

Keep sounding pitch separate from accidental display intent. Track measure/key accidental state jointly across voices and preserve explicit natural, cautionary and parenthesized signs. Recompute the display appropriately when transposing. Map supported microtonal accidentals explicitly rather than using string repetition on fractional alterations.

### 3. High: changing attributes and pickup timing are not preserved

Evidence: `src/lib/import.ts:7`, `src/lib/import.ts:87`, `src/lib/import.ts:110`, `src/lib/import.ts:129`, `src/lib/import.ts:153`, `src/lib/import.ts:37`, `src/lib/render.ts:113`.

Time signature and tempo are single score-wide mutable values; key and clef are effectively initial part properties. A late time or tempo change overwrites the value used at the beginning. Attributes are read from only the first `<attributes>` block in each measure, ahead of the event loop. Clef line and octave change are discarded, so a tenor C clef becomes alto. Staff-specific keys and meters are not retained. Later portrait systems repeat the clef but omit the prevailing key signature.

The numeric helper uses `Number(value) || fallback`, so valid zero is treated as missing. A key reset from two sharps to zero fifths remains two sharps even in the parser's scalar state.

Each measure starts with the full nominal meter length, and normalization can only increase that length. A one-quarter pickup in 4/4 consequently lasts four beats. Original measure labels and `implicit` are discarded; timewise conversion also drops measure attributes other than number.

Browser probes confirmed a 4/4 → 3/4 and 90 → 140 score returns opening globals of 3/4 and 140 while retaining the initial clef/key; a one-beat pickup becomes four beats; the zero-fifths reset remains two sharps.

Store ordered, staff-scoped attribute changes and a tempo map; process divisions changes in document order. Distinguish absent numeric values from zero. Store nominal meter separately from actual measure length, preserve pickup/source numbering, and repeat prevailing signatures at system starts. Metronome units and dots also need conversion into the playback tempo unit.

### 4. High: voice identity and staff alignment are lost

Evidence: `src/lib/score.ts:6`, `src/lib/import.ts:186`, `src/lib/render.ts:133`, `src/lib/render.ts:181`.

`<voice>` and `<stem>` are discarded. The renderer greedily partitions overlapping events into temporary lanes, which need not match source voices. This loses voice-specific stems, rests, beams, and the context needed to match ties and slurs. It inserts visible rests to fill temporal gaps.

Each staff uses a separate `Formatter`; equal bar width does not align simultaneous beats across staves. A two-staff quarter/eighth-note probe put beat 1 at x=354.5 on one staff and x=351.5 on the other.

Retain part, staff and voice identities. Build stable voices and format a measure's staff voices against shared tick positions, aligning note-start positions after differing clefs/signatures. Retain part grouping instead of flattening every staff into an unrelated part. Use the resulting common timeline for directions and the playhead.

### 5. High: imported ties are unused, and playback ignores expression

Evidence: `src/lib/import.ts:180`, `src/lib/import.ts:186`, `src/components/Reader.tsx:332`, `src/components/Reader.tsx:349`.

The parser records two note-level tie booleans, but neither rendering nor playback consumes them. Equal-duration chord merging also loses pitch-specific tie state. Visual `<notations><tied>` and slurs are ignored.

Every note is attacked separately at velocity **82**, with duration multiplied by **0.92**. Tied notes are therefore rearticulated and shortened, and dynamic markings have no audible effect. The tie probe produced no `StaveTie` elements.

Preserve per-pitch sound ties and visual ties independently, plus numbered slur spans. Draw `StaveTie`/`Curve` segments across measures and systems. Build a playback event stream that joins tied pitches and honors explicit MusicXML performance data. Dynamic-to-velocity and hairpin interpolation without explicit sound data should be a documented interpretation policy. Keep mixer gain independent from score dynamics.

### 6. Medium: dynamics are partial and sometimes misrepresented

Evidence: `src/lib/import.ts:149`, `src/lib/render.ts:28`, `src/lib/render.ts:215`.

Existing support carries a direction's staff, clamped beat offset and lowercase symbol, then draws custom SMuFL text below the staff. It does not preserve:

- Placement above/below, voice, source positioning intent, or note-level `<notations><dynamics>`.
- Crescendo/decrescendo wedges and numbered start/stop/continue relationships.
- Expressive text such as `cresc.`, `dim.`, `dolce`, or `subito`.
- `<sound dynamics>` and note-level performance dynamics.
- Arbitrary `<other-dynamics>` text: the glyph conversion silently strips every character outside `p m f r s z`.

Multiple child marks in one `<dynamics>` are emitted independently at identical coordinates. The valid combined `<sf/><mp/>` probe produced two overlapping text elements at x=126.5, y=141. A source `placement="above"` was still rendered below. Offset placement currently snaps to the next note, or back to the final note, rather than retaining an independent timed anchor.

Create timed directions with staff/voice scope, ordered contents and placement; preserve note-attached dynamics too. Use `TextDynamics` or measured SMuFL sequences for supported letters, text fallback for unknown marks, and `StaveHairpin`/`Crescendo` for wedges. Span splitting and collision handling remain application responsibilities. Do not assume replacing custom SVG with `TextDynamics` alone fixes those issues.

### 7. High for percussion scores: unpitched notes disappear

Evidence: `src/lib/import.ts:171`, `src/lib/import.ts:176`, `src/lib/import.ts:196`, `src/lib/render.ts:152`.

Only `<pitch>` is decoded. An `<unpitched>` note becomes an event with no pitches, is drawn as a rest, and schedules no audio. When a pitched staff exists, the playable-part filter can remove the entire percussion staff.

The browser probe confirmed an unpitched note imports with `pitches: []`. Preserve display step/octave separately from the instrument's playback identity, including `<instrument id>`, `<midi-unpitched>`, staff lines and notehead type. Base silent-staff filtering on actual musical events rather than pitched-note count.

### 8. Medium: regression coverage is unavailable in a fresh checkout

Evidence: `.gitignore:5`, `package.json:12`, `README.md`.

The entire `tests/` and `examples/` directories are ignored, and `git ls-files tests` returns no files. `test:example` relies on a local script and local score assets. Its dynamics assertions check presence and font family, not content, placement or timing.

Commit small original MusicXML fixtures and their tests; keep private scores separately ignored. Cover parser semantics, rendered symbols/geometry and playback scheduling. Preserve the local Cielito score as an additional integration check. Collect import/render diagnostics rather than silently dropping unsupported elements or only warning to the console when a measure fails.

## Feature coverage and VexFlow mapping

The mappings below were checked against the installed 5.0.0 declarations and upstream exports. Some require custom layout and combinations of primitives.

| MusicXML feature | Current status | VexFlow route / application work |
| --- | --- | --- |
| Notes, chords, rests | Basic; written duration, special rests and display attributes incomplete | `StaveNote`, `Dot`, `GhostNote`; preserve exact rhythm and display metadata |
| Voice identity, stems, rest positioning | Source information lost | `Voice`, `Formatter`, `Stem`; joint staff timing |
| Beams | Primary begin/end groups only | `Beam`; preserve higher levels, hooks, breaks, stem direction and grouping |
| Tuplets | Lost; rhythm can be visibly wrong | `Tuplet`; exact ratios and numbered/nested groups |
| Grace/cue notes | Grace consumes ordinary time; cue sizing lost | `GraceNote`, `GraceNoteGroup`, note sizing and explicit playback policy |
| Key/time/clef changes | Initial/basic only | `KeySignature`, `KeySigNote`, `TimeSignature`, `TimeSigNote`, `ClefNote`; attribute timeline |
| Accidentals | Nonzero alterations only | `Accidental`, `Parenthesis`; key/measure state and source display intent |
| Dynamic letters | Partial | `TextDynamics` / measured glyphs; positioning and composite sequences |
| Hairpins | Lost | `StaveHairpin`, `Crescendo`; numbered endpoints and continuation across systems |
| Ties and slurs | Tie flags unused; slurs lost | `StaveTie`, `Curve`; per-pitch and numbered spans |
| Articulations and fermatas | Lost | `Articulation`; map supported symbols and placement |
| Ornaments, tremolos and arpeggios | Lost | `Ornament`, `Tremolo`, `Stroke`, `Vibrato`/`VibratoBracket`; distinguish single-note from paired forms |
| Tempo, rehearsal and expressive text | Scalar playback tempo only | `StaveTempo`, `StaveSection`, `Annotation`/`StaveText`; tempo timeline |
| Repeat/final/double barlines, endings, navigation marks | Lost | `Barline`, `Volta`, `Repetition`; repeat playback requires a separate traversal model |
| MusicXML lyrics | Not imported; only ABC currently populates lyric text | `Annotation`/`TextNote` plus custom verse lanes, syllabic hyphens, elisions and melisma spans |
| Pedal and octave-shift lines | Lost | `PedalMarking`, `TextBracket`; numbered spans and explicit pitch/playback semantics |
| Harmony | Small kind map; attaches only at exact note onset; no staff scope | `ChordSymbol` or text; independent timed event, degrees, alterations, inversions and multiple symbols |
| Percussion and custom noteheads | Unpitched events lose meaning | `StaveNote`/`NoteHead`, staff options; separate visual position from GM percussion mapping |
| Fingering, string/fret, tablature, bends | Lost | `FretHandFinger`, `StringNumber`, `TabStave`, `TabNote`, `Bend`, `TabSlide`, `TabTie` |
| Part groups and multi-staff instruments | Flattened | `StaveConnector` and shared system layout; retain group and instrument identity |
| Cross-staff notation | Lost | Custom coordination of staves, notes, stems, beams and curves; verify representative fixtures before promising broad support |
| Multiple-measure rests, repeat-measure signs | Lost | `MultiMeasureRest`, `RepeatNote`; preserve source structure and playback duration |
| Source layout, measure labels, print visibility | Largely discarded | Preserve source semantics and optional break hints; continuous responsive layout needs a deliberate policy |

## Proposed implementation sequence

1. **Model and fidelity baseline.** Commit focused fixtures. Introduce exact timing, written duration/dots, part/staff/voice IDs, per-pitch metadata, actual measure lengths, ordered attribute changes, timed directions, numbered spans and import diagnostics. Keep ABC/MEI/MIDI compatible with sensible optional defaults. Fix zero parsing, pickups, accidentals and changing attributes.
2. **Rhythm, voices and expression.** Use stable voices and shared staff formatting. Implement tuplets, grace notes, ties/slurs, dynamic sequences and placement, wedges, and score-derived playback dynamics. Keep dynamics in this early milestone. Add collision space for directions and split spans at system boundaries.
3. **Common score markings.** Articulations, fermatas, ornaments, tempo/rehearsal text, MusicXML lyrics, barline styles, endings, navigation symbols, richer harmony and part connectors. Add a separate tempo/repeat playback timeline with a defined relationship to the BPM control.
4. **Specialized notation.** Full percussion mapping, octave shifts, pedal, technical markings, tablature, multi-measure rests and selected cross-staff cases. Percussion can move earlier if drum-score fidelity is an immediate priority.

Use a registry from source IDs to rendered note/pitch/tick anchors so spans can resolve after formatting. Measure annotation extents before fixing system height/width. Current dynamics and other custom text are drawn after VexFlow formatting and do not participate in horizontal collision measurement.

Acceptance for each feature should include import preservation, engraving, transposition where applicable, reflow across system boundaries, both notation fonts, and playback only where the feature has performance meaning. Keeping data in the model without rendering it is not completed feature support.

## Validation performed

- `npm run check`: passed, zero errors/warnings/hints.
- `npm run test:example`: passed, including sound manifest validation, production build and the local Cielito Chromium regression. The build reports a chunk-size warning.
- Additional temporary Chromium probes exercised the real `parseMusicXml` and `renderScore` modules for triplets, grace notes, pickup lengths, attribute/tempo changes, zero-fifths reset, accidental cancellation, combined dynamics, cross-staff alignment, ties and unpitched notes. Results are recorded above; these probes are not a committed regression suite.
- Existing broad regression success does not establish support for the additional MusicXML features in this review. No fixes or exhaustive MusicXML conformance testing were performed.

## Primary references

- [VexFlow 5.0.0 exported engraving primitives](https://github.com/vexflow/vexflow/blob/5.0.0/src/index.ts).
- [MusicXML note structure: grace/cue, duration, voice, notation and performance attributes](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/note/).
- [MusicXML direction scope and ordering](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/direction/).
- [MusicXML dynamics, combined marks and note-level placement](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/dynamics/).
- [MusicXML wedge endpoints and attributes](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/wedge/).
- [MusicXML sound dynamics, tempo and offsets](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/sound/).
