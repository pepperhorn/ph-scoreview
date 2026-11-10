// Tests of the guitar fingering solver (packages/pepperscore/src/lib/tab/fret-assign.ts, docs/specs/guitar-tab.md
// "Fingering solver"), run in Node: the module is pure TypeScript with no imports, so Node's type stripping loads it.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { assignFrets, assignNoteFrets, STANDARD_TUNING } from '../packages/pepperscore/src/lib/tab/fret-assign.ts';

let checks = 0;
const eq = (actual, expected, message) => { checks++; assert.deepEqual(actual, expected, message); };
const ok = (value, message) => { checks++; assert.ok(value, message); };

/** A sequence of single notes, one beat each, legato. */
const melody = pitches => pitches.map((pitch, i) => ({ onset: i, durations: [1], pitches: [pitch] }));
/** Plain [string, fret] pairs for compact comparisons. */
const pairs = results => results.map(r => ('unplayable' in r ? 'x' : [r.string, r.fret]));
/** The sounding pitch of a result in standard tuning. */
const pitchOfResult = r => STANDARD_TUNING[6 - r.string] + r.fret;

// --- Interface basics ------------------------------------------------------------------------------------------
eq(STANDARD_TUNING, [40, 45, 50, 55, 59, 64], 'standard tuning E A D G B E');
eq(assignFrets([]), [], 'no events');
eq(assignFrets([{ onset: 0, durations: [], pitches: [] }]), [[]], 'an empty event gives an empty result');

// --- Open-position C major scale stays in first position with open strings ---------------------------------------
{
  const scale = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67];
  const out = assignFrets(melody(scale)).map(r => r[0]);
  eq(pairs(out), [[5, 3], [4, 0], [4, 2], [4, 3], [3, 0], [3, 2], [2, 0], [2, 1], [2, 3], [1, 0], [1, 1], [1, 3]],
    'C major scale in open position');
  ok(out.every(r => !r.shifted), 'no octave shifts in range');
}

// --- Open chords come out as the standard cowboy shapes ----------------------------------------------------------
{
  const chord = pitches => assignFrets([{ onset: 0, durations: pitches.map(() => 4), pitches }])[0];
  eq(pairs(chord([40, 47, 52, 55, 59, 64])), [[6, 0], [5, 2], [4, 2], [3, 0], [2, 0], [1, 0]], 'E minor');
  eq(pairs(chord([48, 52, 55, 60, 64])), [[5, 3], [4, 2], [3, 0], [2, 1], [1, 0]], 'C major');
  eq(pairs(chord([43, 47, 50, 55, 59, 67])), [[6, 3], [5, 2], [4, 0], [3, 0], [2, 0], [1, 3]], 'G major');
  // Input order is preserved: the same C major chord listed top-down.
  eq(pairs(chord([64, 60, 55, 52, 48])), [[1, 0], [2, 1], [3, 0], [4, 2], [5, 3]], 'C major listed high to low');
  // A progression keeps every chord in its open shape.
  const prog = [[43, 47, 50, 55, 59, 67], [48, 52, 55, 60, 64], [40, 47, 52, 55, 59, 64]]
    .map((pitches, i) => ({ onset: i * 4, durations: pitches.map(() => 4), pitches }));
  eq(assignFrets(prog).map(pairs), [
    [[6, 3], [5, 2], [4, 0], [3, 0], [2, 0], [1, 3]],
    [[5, 3], [4, 2], [3, 0], [2, 1], [1, 0]],
    [[6, 0], [5, 2], [4, 2], [3, 0], [2, 0], [1, 0]],
  ], 'G - C - Em progression in open shapes');
}

// --- A high melody stays in one position instead of jumping ------------------------------------------------------
{
  const line = [76, 77, 79, 81, 79, 77, 76, 74, 72, 74, 76, 79, 81, 79, 76, 74];
  const out = assignFrets(melody(line)).map(r => r[0]);
  ok(out.every(r => !('unplayable' in r)), 'all playable');
  const frets = out.map(r => r.fret);
  ok(frets.every(f => f >= 9), `high line stays high on the neck (${frets})`);
  // One hand position covers the whole line: every fret within a five-fret window (four plus one stretch).
  ok(Math.max(...frets) - Math.min(...frets) <= 5, `one position, frets ${frets}`);
  ok(new Set(out.map(r => r.string)).size <= 3, 'uses at most three adjacent strings');
}

// --- Out of range: octave folding and unplayable -----------------------------------------------------------------
{
  const [[low]] = assignFrets([{ onset: 0, durations: [1], pitches: [36] }]);
  eq(low, { string: 5, fret: 3, shifted: 12 }, 'C2 folds up to C3 on the A string');
  const [[deep]] = assignFrets([{ onset: 0, durations: [1], pitches: [24] }]);
  eq(deep.shifted, 24, 'C1 folds up two octaves');
  const [[high]] = assignFrets([{ onset: 0, durations: [1], pitches: [90] }]);
  ok(!('unplayable' in high) && high.shifted === -12, `E7 folds down an octave (${JSON.stringify(high)})`);
  const [[none]] = assignFrets([{ onset: 0, durations: [1], pitches: [36] }], { octaveFold: false });
  eq(none, { unplayable: true }, 'no folding: unplayable');
}

// --- Too many notes: drop notes without throwing -----------------------------------------------------------------
{
  const pitches = [40, 47, 52, 55, 59, 64, 67];
  const [out] = assignFrets([{ onset: 0, durations: pitches.map(() => 2), pitches }]);
  eq(out.length, 7, 'one result per input note');
  const played = out.filter(r => !('unplayable' in r));
  ok(played.length >= 1 && played.length <= 6, 'at most six notes played');
  eq(new Set(played.map(r => r.string)).size, played.length, 'each played note on its own string');
  ok(!('unplayable' in out[0]) && !('unplayable' in out[6]), 'outer voices kept');
  eq(pairs(out), [[6, 0], [5, 2], [4, 2], [3, 0], [2, 0], 'x', [1, 3]], 'E minor with G on top: the doubled E4 goes');
  // Doubled notes go first: E minor plus a doubled E4 drops the doubled E4.
  const doubled = [40, 47, 52, 55, 59, 64, 64];
  const [d] = assignFrets([{ onset: 0, durations: doubled.map(() => 2), pitches: doubled }]);
  eq(d.filter(r => 'unplayable' in r).length, 1, 'one note dropped');
  ok('unplayable' in d[5] || 'unplayable' in d[6], 'the dropped note is the doubled E4');
  // An unplayable stretch (two notes 30 semitones apart on adjacent shapes) never throws.
  const wide = [40, 41, 88, 89];
  const [w] = assignFrets([{ onset: 0, durations: [1, 1, 1, 1], pitches: wide }]);
  eq(w.length, 4, 'wide chord gives four results');
  // Absurd input never throws.
  const [[seven]] = assignFrets([{ onset: 0, durations: [1], pitches: [100] }]);
  eq(seven.shifted, -24, 'E7 folds down two octaves');
  assignFrets([{ onset: 0, durations: [1], pitches: Array.from({ length: 40 }, (_, i) => 20 + i * 3) }]);
}

// --- Capo, alternate tunings -------------------------------------------------------------------------------------
{
  const fsm = [42, 49, 54, 57, 61, 66];
  const [out] = assignFrets([{ onset: 0, durations: fsm.map(() => 4), pitches: fsm }], { capo: 2 });
  eq(pairs(out), [[6, 0], [5, 2], [4, 2], [3, 0], [2, 0], [1, 0]], 'F#m with capo 2 is the E minor shape, frets relative to the capo');
  const [[c]] = assignFrets([{ onset: 0, durations: [1], pitches: [60] }], { capo: 2 });
  eq([c.string, c.fret], [3, 3], 'C4 with capo 2: G string, 3 above the capo');
  const dropD = [38, 45, 50, 55, 59, 64];
  const [[d]] = assignFrets([{ onset: 0, durations: [1], pitches: [38] }], { tuning: dropD });
  eq(d, { string: 6, fret: 0 }, 'drop D low D is string 6 open');
  const [[e]] = assignFrets([{ onset: 0, durations: [1], pitches: [38] }]);
  eq(e.shifted, 12, 'low D folds in standard tuning');
  const bass = assignFrets(melody([28, 43]), { tuning: [28, 33, 38, 43] }).map(r => r[0]);
  eq(pairs(bass), [[4, 0], [1, 0]], 'four-string bass tuning');
  const [[mx]] = assignFrets([{ onset: 0, durations: [1], pitches: [64 + 20] }], { maxFret: 19 });
  ok(mx.shifted === -12, 'pitch above a 19-fret neck folds down');
}

// --- Fixed fingerings ----------------------------------------------------------------------------------------------
{
  const [[a]] = assignFrets([{ onset: 0, durations: [1], pitches: [64], fixed: [{ string: 2, fret: 5 }] }]);
  eq(a, { string: 2, fret: 5 }, 'fixed E4 on the B string');
  const [[b]] = assignFrets([{ onset: 0, durations: [1], pitches: [64], fixed: [{ string: 1, fret: 7 }] }]);
  eq(b, { string: 1, fret: 0 }, 'an impossible fixed fingering is ignored');
  const c = [48, 52, 55, 60, 64];
  const [out] = assignFrets([{ onset: 0, durations: c.map(() => 1), pitches: c, fixed: [undefined, undefined, undefined, undefined, { string: 2, fret: 5 }] }]);
  eq(out[4], { string: 2, fret: 5 }, 'fixed note inside a chord');
  ok(out.every(r => !('unplayable' in r)), 'rest of the chord still placed');
  eq(new Set(out.map(r => r.string)).size, 5, 'distinct strings');
  // A string-only constraint (a circled string number): the string is fixed, the solver picks the fret.
  const [[s]] = assignFrets([{ onset: 0, durations: [1], pitches: [64], fixed: [{ string: 3 }] }]);
  eq(s, { string: 3, fret: 9 }, 'string-only: E4 on the G string');
  const [[s5]] = assignFrets([{ onset: 0, durations: [1], pitches: [52], fixed: [{ string: 5 }] }]);
  eq(s5, { string: 5, fret: 7 }, 'string-only: E3 on the A string');
  const [[sx]] = assignFrets([{ onset: 0, durations: [1], pitches: [40], fixed: [{ string: 1 }] }]);
  eq(sx, { string: 6, fret: 0 }, 'an impossible string-only constraint is ignored');
  const [chordS] = assignFrets([{ onset: 0, durations: c.map(() => 1), pitches: c, fixed: [{ string: 6 }, undefined, undefined, undefined, undefined] }]);
  eq(chordS[0], { string: 6, fret: 8 }, 'string-only inside a chord: C3 on the low E string');
  eq(new Set(chordS.map(r => r.string)).size, 5, 'string-only chord: distinct strings');
}

// --- Note-level helper: same-onset notes of every voice are one event; unisons; ties ----------------------------------
{
  const res = out => out.map(r => r.result && ('unplayable' in r.result ? 'x' : [r.result.string, r.result.fret]));
  // Voice 1: E4 G4 A4(half); voice 2: E4(half) A2(half). The two E4s are one string held for two beats, so G4 at
  // beat 2 cannot use it; A4 and A2 at beat 3 are one event.
  const unison = [
    { onset: 0, duration: 1, pitch: 64 }, { onset: 1, duration: 1, pitch: 67 }, { onset: 2, duration: 2, pitch: 69 },
    { onset: 0, duration: 2, pitch: 64 }, { onset: 2, duration: 2, pitch: 45 },
  ];
  const out = assignNoteFrets(unison);
  eq(out[0].result, out[3].result, 'unison across voices: one string and fret for both');
  ok(out[1].result.string !== out[0].result.string, `G4 avoids the unison E4 still held in voice 2 (${JSON.stringify(res(out))})`);
  ok(out.every(r => !r.continuation), 'no continuations');
  for (const [i, note] of unison.entries()) eq(pitchOfResult(out[i].result), note.pitch, `unison: note ${i} sounds its pitch`);
  // The same, the shorter E4 tied over into beat 2: the tie continuation takes the unison's fingering.
  const tied = [
    { onset: 0, duration: 1, pitch: 64, tieStart: true }, { onset: 1, duration: 1, pitch: 64, tieStop: true }, { onset: 2, duration: 1, pitch: 67 },
    { onset: 0, duration: 1, pitch: 64 }, { onset: 1, duration: 1, pitch: 59 },
  ];
  const t = assignNoteFrets(tied);
  ok(t[1].continuation && !t[0].continuation && !t[3].continuation, 'the tie stop is a continuation');
  eq([t[1].result, t[3].result], [t[0].result, t[0].result], 'continuation and unison take the tied note\'s fingering');
  ok(t[4].result.string !== t[0].result.string, 'B3 at beat 2 avoids the tied E4');
  // The order the voices come in does not matter.
  const reversed = assignNoteFrets([...unison].reverse()).reverse();
  eq(res(reversed), res(out), 'voices in either order give the same fingerings');
  // A continuation with nothing open (a chunk starting mid-tie) is fingered as a note.
  const lone = assignNoteFrets([{ onset: 0, duration: 1, pitch: 64, tieStop: true }]);
  ok(!lone[0].continuation && lone[0].result.string, 'a continuation with no tie start is fingered');
  eq(assignNoteFrets([{ onset: 0, duration: 1, pitch: null }]), [{ continuation: false }], 'an unpitched note gets no result');
  // Same-onset notes of two voices are one chord: the reader and the bake agree (assignFrets over one merged event).
  const merged = assignNoteFrets([{ onset: 0, duration: 1, pitch: 40 }, { onset: 0, duration: 4, pitch: 50 }]);
  eq(res(merged), pairs(assignFrets([{ onset: 0, durations: [1, 4], pitches: [40, 50] }])[0]), 'two voices at one onset are one event');
}

// --- Ringing strings are not reused ----------------------------------------------------------------------------------
{
  // A sustained open high E, then another E4 while it still rings: the second goes to the B string.
  const out = assignFrets([
    { onset: 0, durations: [4], pitches: [64] },
    { onset: 1, durations: [1], pitches: [64] },
  ]).map(r => r[0]);
  eq(pairs(out), [[1, 0], [2, 5]], 'second E4 avoids the ringing string');
  // Without overlap the open string is reused.
  const legato = assignFrets([
    { onset: 0, durations: [1], pitches: [64] },
    { onset: 1, durations: [1], pitches: [64] },
  ]).map(r => r[0]);
  eq(pairs(legato), [[1, 0], [1, 0]], 'no overlap: same string');
  // A held bass note keeps its string while a melody moves above it.
  const pedal = assignFrets([
    { onset: 0, durations: [4, 1], pitches: [45, 57] },
    { onset: 1, durations: [1], pitches: [55] },
    { onset: 2, durations: [1], pitches: [52] },
    { onset: 3, durations: [1], pitches: [50] },
  ]);
  const bassString = pedal[0][0].string;
  ok(pedal.slice(1).every(r => r[0].string !== bassString), 'melody avoids the ringing bass string');
  // If the only place for a note is a ringing string, the sustain constraint gives way.
  const forced = assignFrets([
    { onset: 0, durations: [4], pitches: [40] },
    { onset: 1, durations: [1], pitches: [40] },
  ]).map(r => r[0]);
  eq(pairs(forced), [[6, 0], [6, 0]], 'low E has nowhere else to go');
  // Two voices, events in time order: voice 2 holds D3 (from beat 0) under voice 1's E2 A2 E3 G3. Notes that end
  // earlier (A2) come between, so ringing is looked up past them: E3 at beat 2 must not take the held D3's string.
  const voices = assignFrets([
    { onset: 0, durations: [1], pitches: [40] },
    { onset: 0, durations: [4], pitches: [50] },
    { onset: 1, durations: [1], pitches: [45] },
    { onset: 2, durations: [1], pitches: [52] },
    { onset: 3, durations: [1], pitches: [55] },
  ]).map(r => r[0]);
  ok([2, 3, 4].every(i => voices[i].string !== voices[1].string), `voice 1 avoids the held voice 2 string (${JSON.stringify(pairs(voices))})`);
}

// --- Determinism ---------------------------------------------------------------------------------------------------
function randomEvents(count, seed) {
  let s = seed >>> 0;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const shapes = [[0, 4, 7], [0, 3, 7], [0, 4, 7, 10], [0, 3, 7, 10], [0, 7, 12], [0, 4, 7, 11]];
  const events = []; let onset = 0;
  for (let i = 0; i < count; i++) {
    const dur = [0.5, 1, 1, 2][Math.floor(rand() * 4)];
    if (rand() < 0.35) {
      const root = 40 + Math.floor(rand() * 15);
      const pitches = shapes[Math.floor(rand() * shapes.length)].map(x => root + x);
      events.push({ onset, durations: pitches.map(() => dur), pitches });
    } else {
      events.push({ onset, durations: [dur], pitches: [52 + Math.floor(rand() * 30)] });
    }
    onset += rand() < 0.03 ? dur + 2 : dur;
  }
  return events;
}
{
  const events = randomEvents(500, 7);
  eq(assignFrets(events), assignFrets(events), 'same input, same output');
  const out = assignFrets(events);
  eq(out.length, events.length, 'one result per event');
  for (let i = 0; i < out.length; i++) {
    eq(out[i].length, events[i].pitches.length, `event ${i}: one result per pitch`);
    const played = out[i].filter(r => !('unplayable' in r));
    eq(new Set(played.map(r => r.string)).size, played.length, `event ${i}: distinct strings`);
    out[i].forEach((r, k) => {
      if ('unplayable' in r) return;
      const sounding = STANDARD_TUNING[6 - r.string] + r.fret;
      eq(sounding, events[i].pitches[k] + (r.shifted ?? 0), `event ${i} note ${k}: string/fret sounds the pitch`);
      ok(r.fret >= 0 && r.fret <= 22, 'fret in range');
    });
  }
}

// --- Performance: 2000 mixed events in under 50 ms -------------------------------------------------------------------
{
  const events = randomEvents(2000, 42);
  for (let i = 0; i < 3; i++) assignFrets(events); // warm up the JIT
  let best = Infinity;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now(); assignFrets(events); best = Math.min(best, performance.now() - t0);
  }
  console.log(`perf: 2000 events in ${best.toFixed(1)} ms (best of 5)`);
  ok(best < 50, `2000 events took ${best.toFixed(1)} ms`);
}

console.log(`fret-assign: ${checks} checks passed`);

// Re-entrant GCEA: the high fourth string is physically below C/E/A, not sorted by pitch.
{
  const tuning = [67, 60, 64, 69];
  const pitches = [60, 64, 67, 69];
  const chord = assignFrets([{ onset: 0, pitches, durations: [1, 1, 1, 1] }], { tuning, octaveFold: false })[0];
  eq(pairs(chord), [[3, 0], [2, 0], [4, 0], [1, 0]], 'Re-entrant uke open chord keeps all physical strings');
  const held = assignFrets([
    { onset: 0, pitches: [67], durations: [4], fixed: [{ string: 4, fret: 0 }] },
    { onset: 1, pitches: [60, 64, 69], durations: [1, 1, 1] },
  ], { tuning, octaveFold: false });
  eq(pairs(held[0]), [[4, 0]], 'High fourth string can be held');
  ok(held[1].every(note => !('unplayable' in note) && note.string !== 4), 'Other voices avoid the ringing high fourth string');
  console.log('fret-assign: re-entrant open chord and ringing high fourth string passed');
}
