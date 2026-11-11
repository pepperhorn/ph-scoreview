# Handoff: 0016 — [quick] Instrument names: bare "Bass", ukulele sound, 5-string tuning warning (lead → codex)

- **Date:** 2026-11-11
- **Type:** quick
- **Ledger:** 0016 (scale-to-song findings 2026-11-11)
- **Branch:** orch/0016-instrument-names · **Worktree:** created by T3
- **Base commit:** 12f4bea
- **Status:** closed

## Goal
Fix three findings from scale-to-song's re-test (`docs/handoffs/2026-11-10-adhoc-abc-authoring-guide--pepperscore-to-scale-to-song.md`, 2026-11-11 section in their copy; summarised here):
1. **Human decision:** a bare part name **"Bass"**, **"Acoustic Bass"** or **"Electric Bass"** (no MIDI program) means **bass guitar** (sound GM 33/34, 4-string TAB). Only "Double Bass", "Contrabass", "Upright Bass", "String Bass" mean double bass. A choir/voice "Bass" (e.g. with "choir", "voice", "vocal", or in a SATB context) stays a voice. Today `instrumentForName` (`packages/pepperscore/src/lib/score.ts:108-125`) maps `acoustic bass` and `\bbass\b` to double bass. Keep 0013-T1's TAB classifier consistent (`lib/tab/string-instruments.ts`): same names → bass4; bassoon/bass clarinet/bass trombone/bass flute stay non-TAB.
2. **`name="Ukulele"`** (any size) without a MIDI program plays piano; give it the nylon guitar sound (GM 25 / the guitar instrument's nylon sound — check `lib/instruments.ts`/`instrument-model.ts` for the right id and record the choice).
3. A `tabTuning` whose string count doesn't match an auto-detected part (e.g. a 5-note tuning on a 4-string bass) is silently ignored (`lib/tab/tab-parts.ts` ~135). Keep the rule, but emit a development-only warning naming the part and suggesting `settings.tabInstruments: { '<id>': 'bass5' }` (use the inline-try dev-warning pattern from 0001-T1's handoff).

## Files you own
`packages/pepperscore/src/lib/score.ts` (`instrumentForName` only), `lib/tab/string-instruments.ts`, `lib/tab/tab-parts.ts` (warning only), `lib/instruments.ts`/`lib/instrument-model.ts` only if the ukulele sound needs an id, their tests (`lib/**/*.test.ts` you add or touch), `lib/abc-import.test.ts` (ABC name cases), your own 0016 handoff files. Don't touch `render.ts`, `components/**`, `lib/pdf/**`, `prefs`/`file-state` (0001-T4 in flight).

## Acceptance criteria
- [ ] Unit tests: "Bass", "Acoustic Bass", "Electric Bass", "Bass Guitar" → bass guitar sound + bass4 TAB; "Double Bass"/"Contrabass"/"Upright Bass"/"String Bass" → double bass, no TAB; "Choir Bass"/"Bass voice" → voice; bassoon etc. unchanged; "Ukulele"/"Tenor Ukulele" → nylon guitar sound + ukulele TAB; ABC `V:1 name="Bass"` with no %%MIDI imports as bass guitar.
- [ ] Dev warning for a mismatched `tabTuning` (tested), none in production.
- [ ] "For the ABC guide" note in the return handoff listing the name rules.

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run test -w pepperscore && npm run check && npm run build && npm run test:tab && npm run test:instrument-switch
```

---
## Receiver ack

Acknowledged 2026-11-11 (Codex). I will map bare Bass/Acoustic Bass/Electric Bass to bass guitar while preserving explicit double-bass and vocal names, assign ukulele the existing nylon-guitar sound, and add a development-only mismatched-tuning warning. I will change only the owned name/classifier/warning code, its tests, and my 0016 handoffs; run the requested checks; push the task branch and open a draft PR. No open questions.

GBrain lookup: `default:projects/scoreflow-music-reader` provides historical reader context; the current dispatch handoff is authoritative for these name rules.
