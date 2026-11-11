# Handoff: 0018 — [quick] Choir name variants and horn sounds (S26, S27) (lead → codex)

- **Date:** 2026-11-11
- **Type:** quick
- **Ledger:** 0018 (suggestions S26, S27)
- **Branch:** orch/0018-choir-horn-names · **Worktree:** created by T3
- **Base commit:** 7dfd360 (0016 merged as PR #80)
- **Status:** open

## Goal
Two naming gaps found in PR #80's final review (`gh pr view 80 --comments`, review 5853104074), within the human's naming policy (see `docs/guides/abc-authoring.md` "Instrument names" and `docs/handoffs/2026-11-11-0016-instrument-names--codex-to-lead.md` "For the ABC guide"):
1. **S26 voice words** (`packages/pepperscore/src/lib/score.ts` ~130): also recognise "Soprano Solo"/"Bass Solo" (Solo suffix), slash staves "Soprano/Alto", "Tenor/Bass" (each side a voice word), "Mezzo-Soprano"/"Mezzo", "Contralto", "Countertenor", "Treble" (as a voice only alone/numbered/hinted, same rule as the others) as voices that establish choir context. So "Soprano Solo, Alto Solo, Tenor Solo, Bass Solo, Piano", "Soprano/Alto, Tenor/Bass" and "Mezzo-Soprano, Bass" give voices and no TAB.
2. **S27 horns** (~124): English Horn / Cor Anglais → GM 70 (zero-based 69, English horn); Basset Horn → clarinet; Flugelhorn → trumpet (or flugelhorn if the instrument table has it); French Horn / Horn in F / Horn → horn (GM 61). Use whatever icon/id the table offers; record choices.

## Files you own
`packages/pepperscore/src/lib/score.ts` (`instrumentForName` and the voice-word pattern), `lib/tab/string-instruments.ts` (only if its voice pattern is shared/duplicated), their tests, `lib/abc-import.test.ts` (name cases), your own 0018 handoff files.

## Acceptance criteria
- [ ] Tests for every name above (ABC and MusicXML), plus the PR #80 policy matrix still passing.
- [ ] "For the ABC guide" note listing the added names.

## Verify with
```bash
npm ci && npx playwright-core install chromium   # from the repo root
npm run test -w pepperscore && npm run check && npm run build && npm run test:tab && npm run test:document && npm run test:parser-diff
```

---
## Receiver ack

Acknowledged 2026-11-11 (Codex). I will extend name-only voice recognition for solo/slash/mezzo/contralto/countertenor/treble labels and map English Horn/Cor Anglais, Basset Horn, Flugelhorn and French Horn variants to their existing GM sounds/icons. Instrument nouns and explicit MIDI programs retain precedence; the existing PR #80 naming policy remains covered. I will edit only score.ts, the duplicated/shared classification in tab/string-instruments.ts, their tests, abc-import.test.ts and my two 0018 handoffs. I will run the dispatch verification plus the repository manifest/full validation checks, record added ABC names and sound choices in the return handoff, push the named branch and open a draft PR. No open questions.

GBrain consulted: `default:projects/scoreflow-music-reader` (historical context only); current repository handoff controls this task. No GBrain writes as implementer. Worktree starts clean and contains base 7dfd360.
