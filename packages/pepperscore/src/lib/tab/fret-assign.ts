// Guitar fingering solver: assigns a string and fret to every note of a sequence of note events.
//
// The approach — a Viterbi search over (chord shape, hand position) states, where an all-open shape inherits the
// hand position — is credited to knoguchi/fretpath (GPL-3.0). This file is an independent implementation written
// from a prose description of that idea; no fretpath code was copied or translated. See docs/specs/guitar-tab.md.
//
// Outline
// - Each event's pitches are octave-folded into the instrument's range (or marked unplayable).
// - Candidate shapes per event: one note per string, pitches high→low on strings high→low (no crossing), a hard
//   fretted span (≤ 4, ≤ 5 from fret 7 up), the 24 cheapest kept. Strings still ringing from earlier notes on the
//   best path so far are excluded; if that leaves nothing the sustain constraint is dropped. Chords that cannot be
//   placed lose doubled pitches first, then inner voices; dropped notes come back as `{ unplayable: true }`.
// - States are (shape, hand position) where the position is the index-finger fret and the fretted notes lie in
//   [pos, pos + 3] (a 4–5 fret stretch, which no position covers, is anchored on its lowest fret). An all-open shape
//   is an INHERIT shape: it is expanded to one state per position that the previous layer reached, at transition
//   cost 0 from that same position (it keeps the hand where it was); at a segment start it may take any position.
// - Which strings are ringing depends on the path, so it is read off the cheapest partial path at the previous
//   layer (a deterministic approximation; candidate lists are cached per pitches + ringing mask + fixed).
// - DP: each layer is collapsed to its best cost per position (cost, shape, previous position in flat typed arrays).
//   Transitions are affine in |Δpos|, so arrival costs come from two linear sweeps: a layer costs O(positions + states).
//   Segments separated by ≥ 2 beats of silence are solved independently.
//
// Never throws for musical input.

export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];
export interface FretPos { string: number; fret: number }          // string 1 = highest
/** A fixed fingering, or a string only (a circled string number: the solver picks the fret on that string). */
export interface FretFixed { string: number; fret?: number }
export interface FretEvent { onset: number; durations: number[]; pitches: number[]; fixed?: (FretFixed | undefined)[] } // quarter notes, MIDI
export interface FretOptions { tuning?: number[]; capo?: number; maxFret?: number; octaveFold?: boolean }
export type FretResult = (FretPos & { shifted?: number }) | { unplayable: true };

// --- Weights ---------------------------------------------------------------------------------------------------------
const W_OPEN = -0.3;          // per open string
const W_HEIGHT = 0.08;        // per hand-position fret
const W_BODY = 0.3;           // × (maxFret − 12)² past the body joint
const W_STRETCH = 1.0;        // × span^1.5
const W_SKIP = 0.5;           // per unused string inside a chord
const W_HIGH_STR = 0.05;      // × string index from the top (tie-break toward higher strings)
const SHIFT_FIXED = 1.5;
const SHIFT_DIST = 2.0;
const GAP_RELIEF = 0.5;
const SEGMENT_GAP = 2;        // beats of silence that split the problem
const MAX_SHAPES = 24;
const HAND = 3;               // a position covers pos..pos+HAND
const EPS = 1e-9;

interface Shape {
  /** Per sorted note (pitch high→low): string index from the top (0 = string 1). */
  str: Int8Array;
  fret: Int8Array;
  open: boolean;        // no fretted notes: inherits the hand position
  posLo: number;
  posHi: number;
  cost: number;         // node cost without the height term
  rank: number;         // cost plus the cheapest height, for pruning
}

interface Note { pitch: number; orig: number; shifted: number; fixedT: number; fixedFret: number }

/** Shapes for one event, plus which of its sorted notes they place (the rest were dropped). */
interface EventPlan { shapes: Shape[]; kept: number[] }

interface Layer {
  event: number;
  plan: EventPlan;
  notes: Note[];          // sorted high→low, all playable notes of the event before dropping
  onset: number;
  end: number;            // onset + longest duration
  reach: number;          // the latest end of this layer and every earlier one in the segment
}

export function assignFrets(events: FretEvent[], options: FretOptions = {}): FretResult[][] {
  const tuning = options.tuning && options.tuning.length ? options.tuning : STANDARD_TUNING;
  const capo = Math.max(0, Math.floor(options.capo ?? 0));
  const maxFret = Math.floor(options.maxFret ?? 22);
  const fold = options.octaveFold ?? true;
  const nStr = Math.min(tuning.length, 31); // string sets are 32-bit masks
  const frets = Math.max(0, maxFret - capo);
  /** Open pitch per string index from the top (0 = string 1, the highest). */
  const openTop = new Int32Array(nStr);
  for (let t = 0; t < nStr; t++) openTop[t] = tuning[tuning.length - 1 - t] + capo;
  const positions = Math.max(1, frets);           // hand positions 1..positions
  const P = positions + 1;

  const playable = (p: number) => { for (let t = 0; t < nStr; t++) if (p >= openTop[t] && p <= openTop[t] + frets) return true; return false; };
  const foldPitch = (p: number): number | undefined => {
    if (!Number.isFinite(p)) return undefined;
    if (playable(p)) return 0;
    if (!fold) return undefined;
    for (let k = 1; k <= 10; k++) { if (playable(p + 12 * k)) return 12 * k; if (playable(p - 12 * k)) return -12 * k; }
    return undefined;
  };

  // --- Candidate enumeration ---------------------------------------------------------------------------------------
  function enumerate(pitches: number[], fixedT: number[], fixedFret: number[], mask: number): Shape[] {
    const n = pitches.length;
    const out: Shape[] = [];
    if (n === 0 || n > nStr) return out;
    const str = new Int8Array(n); const fr = new Int8Array(n);
    const push = () => {
      let minF = 99, maxF = -1, opens = 0, sumT = 0;
      for (let j = 0; j < n; j++) {
        const f = fr[j]; sumT += str[j];
        if (f === 0) opens++; else { if (f < minF) minF = f; if (f > maxF) maxF = f; }
      }
      const open = maxF < 0;
      let posLo = 1, posHi = 1, span = 0;
      if (!open) {
        span = maxF - minF;
        posLo = Math.max(1, maxF - HAND); posHi = Math.max(1, minF);
        if (posLo > posHi) posLo = posHi = Math.max(1, minF); // a stretch beyond the hand: anchor on the lowest fret
      }
      const skipped = n > 1 ? (str[n - 1] - str[0] + 1) - n : 0;
      const cost = W_OPEN * opens + W_BODY * Math.max(0, maxF - 12) ** 2 + W_STRETCH * span ** 1.5 + W_SKIP * skipped + W_HIGH_STR * sumT;
      const rank = cost + W_HEIGHT * posLo;
      // Insert sorted by rank (stable), keep the cheapest MAX_SHAPES.
      if (out.length === MAX_SHAPES && rank >= out[MAX_SHAPES - 1].rank) return;
      const shape: Shape = { str: str.slice(), fret: fr.slice(), open, posLo, posHi, cost, rank };
      let i = out.length;
      while (i > 0 && out[i - 1].rank > rank) i--;
      out.splice(i, 0, shape);
      if (out.length > MAX_SHAPES) out.pop();
    };
    const dfs = (j: number, fromT: number, minF: number, maxF: number) => {
      if (j === n) { push(); return; }
      const p = pitches[j];
      const lastT = nStr - (n - j);               // leave room for the remaining notes
      for (let t = fromT; t <= lastT; t++) {
        if (fixedT[j] >= 0 && t !== fixedT[j]) continue;
        if (mask & (1 << t)) continue;
        const f = p - openTop[t];
        if (f < 0 || f > frets) continue;
        if (fixedFret[j] >= 0 && f !== fixedFret[j]) continue;
        let lo = minF, hi = maxF;
        if (f > 0) {
          if (f < lo) lo = f; if (f > hi) hi = f;
          if (hi - lo > (lo >= 7 ? 5 : 4)) continue;
        }
        str[j] = t; fr[j] = f;
        dfs(j + 1, t + 1, lo, hi);
      }
    };
    dfs(0, 0, 99, -1);
    return out;
  }

  const planCache = new Map<string, EventPlan>();
  /** Shapes for a sorted note list under a ringing mask, dropping notes until something fits. */
  function plan(notes: Note[], mask: number): EventPlan {
    let key = String(mask);
    for (const note of notes) key += `,${note.pitch}:${note.fixedT}:${note.fixedFret}`;
    const hit = planCache.get(key);
    if (hit) return hit;
    let kept = notes.map((_, i) => i);
    let result: EventPlan = { shapes: [], kept: [] };
    while (kept.length) {
      if (kept.length <= nStr) {
        const pitches = kept.map(i => notes[i].pitch);
        const fT = kept.map(i => notes[i].fixedT), fF = kept.map(i => notes[i].fixedFret);
        const hasFixed = fT.some(t => t >= 0);
        const none = kept.map(() => -1);
        const attempts: [number[], number[], number][] = [];
        // Fixed fingerings before the sustain constraint; each without the ringing mask as a fallback.
        if (hasFixed) { attempts.push([fT, fF, mask]); if (mask) attempts.push([fT, fF, 0]); }
        attempts.push([none, none, mask]); if (mask) attempts.push([none, none, 0]);
        let shapes: Shape[] = [];
        for (const [t, f, m] of attempts) {
          shapes = enumerate(pitches, t, f, m);
          if (shapes.length) break;
        }
        if (shapes.length) { result = { shapes, kept }; break; }
      }
      kept = dropOne(notes, kept);
    }
    planCache.set(key, result);
    return result;
  }

  /**
   * Remove one note: an exact doubling, then an inner octave doubling, then an inner voice, then the bass. Within a
   * tier the note whose removal leaves the cheapest fingering goes (ties: the first candidate).
   */
  function dropOne(notes: Note[], kept: number[]): number[] {
    const n = kept.length;
    const without = (k: number) => kept.filter((_, i) => i !== k);
    const cheapest = (candidates: number[]): number[] => {
      let pick = candidates[0], min = Infinity;
      if (candidates.length > 1 && n - 1 <= nStr) {
        const none = new Array<number>(n - 1).fill(-1);
        for (const k of candidates) {
          const shapes = enumerate(without(k).map(i => notes[i].pitch), none, none, 0);
          const rank = shapes.length ? shapes[0].rank : Infinity;
          if (rank < min) { min = rank; pick = k; }
        }
      }
      return without(pick);
    };
    const unisons: number[] = [];
    for (let k = 1; k < n; k++) if (notes[kept[k]].pitch === notes[kept[k - 1]].pitch) unisons.push(k);
    if (unisons.length) return cheapest(unisons);
    if (n > 2) {
      const pcs = kept.map(i => ((notes[i].pitch % 12) + 12) % 12);
      const inner: number[] = [], doubled: number[] = [];
      for (let k = 1; k < n - 1; k++) {
        inner.push(k);
        if (pcs.some((pc, i) => i !== k && pc === pcs[k])) doubled.push(k);
      }
      return cheapest(doubled.length ? doubled : inner);
    }
    return without(n - 1); // two notes left: keep the top (melody)
  }

  // --- Per-event preparation ----------------------------------------------------------------------------------------
  const results: FretResult[][] = events.map(e => (e.pitches ?? []).map(() => ({ unplayable: true as const })));
  const prepared: (Note[] | undefined)[] = events.map(event => {
    const notes: Note[] = [];
    (event.pitches ?? []).forEach((raw, orig) => {
      const shifted = foldPitch(raw);
      if (shifted === undefined) return;
      const pitch = raw + shifted;
      let fixedT = -1, fixedFret = -1;
      const fx = event.fixed?.[orig];
      if (fx) {
        // A string with no fret (or a fret that is not a number) fixes the string only: the fret follows from the pitch.
        const t = Math.floor(fx.string) - 1, given = fx.fret !== undefined && fx.fret !== null && Number.isFinite(fx.fret);
        const f = given ? Math.floor(fx.fret!) : pitch - (openTop[t] ?? NaN);
        if (t >= 0 && t < nStr && f >= 0 && f <= frets && openTop[t] + f === pitch) { fixedT = t; fixedFret = given ? f : -1; }
      }
      notes.push({ pitch, orig, shifted, fixedT, fixedFret });
    });
    notes.sort((a, b) => b.pitch - a.pitch || a.orig - b.orig);
    return notes.length ? notes : undefined;
  });

  // --- Viterbi over segments ------------------------------------------------------------------------------------------
  // Layer i of the current segment occupies [i * P, (i + 1) * P) of the flat buffers: per hand position, the best cost
  // of any state there, the shape index achieving it and the position it came from in layer i - 1 (-1 at the start).
  // Keeping only the best state per position is exact: transitions depend on position alone.
  const bestCost = new Float64Array(events.length * P);
  const bestShape = new Int32Array(events.length * P);
  const bestPrev = new Int32Array(events.length * P);
  const arrival = new Float64Array(P);
  const arrivalFrom = new Int32Array(P);
  let layers: Layer[] = [];
  let prevEnd = -Infinity, prevOnset = 0;

  const argminPosition = (li: number) => {
    let q = -1, min = Infinity;
    for (let p = 1, o = li * P + 1; p < P; p++, o++) if (bestCost[o] < min) { min = bestCost[o]; q = p; }
    return q;
  };

  /** Strings still sounding at `onset`, following the cheapest partial path back while earlier notes may ring. */
  const ringingMask = (onset: number): number => {
    let mask = 0;
    let q = layers.length ? argminPosition(layers.length - 1) : -1;
    for (let li = layers.length - 1; li >= 0 && q >= 0; li--) {
      const layer = layers[li];
      // Nothing from here back can still ring. `reach`, not `end`: with several voices a short note can follow a
      // longer one that is still held.
      if (layer.reach <= onset + EPS) break;
      if (layer.end <= onset + EPS) { q = bestPrev[li * P + q]; continue; }
      const shape = layer.plan.shapes[bestShape[li * P + q]];
      const durs = events[layer.event].durations ?? [];
      for (let j = 0; j < layer.plan.kept.length; j++) {
        if (layer.onset + (durs[layer.notes[layer.plan.kept[j]].orig] ?? 0) > onset + EPS) mask |= 1 << shape.str[j];
      }
      q = bestPrev[li * P + q];
    }
    return mask;
  };

  const finishSegment = () => {
    if (!layers.length) return;
    let q = argminPosition(layers.length - 1);
    for (let li = layers.length - 1; li >= 0 && q >= 0; li--) {
      const layer = layers[li];
      const shape = layer.plan.shapes[bestShape[li * P + q]];
      const out = results[layer.event];
      for (let j = 0; j < layer.plan.kept.length; j++) {
        const note = layer.notes[layer.plan.kept[j]];
        const r: FretPos & { shifted?: number } = { string: shape.str[j] + 1, fret: shape.fret[j] };
        if (note.shifted) r.shifted = note.shifted;
        out[note.orig] = r;
      }
      q = bestPrev[li * P + q];
    }
    layers = [];
  };

  for (let ei = 0; ei < events.length; ei++) {
    const notes = prepared[ei];
    if (!notes) continue;
    const event = events[ei];
    const onset = Number.isFinite(event.onset) ? event.onset : prevOnset;
    const gap = Math.max(0, onset - prevEnd);
    if (gap >= SEGMENT_GAP) finishSegment();

    const eventPlan = plan(notes, ringingMask(onset));
    if (!eventPlan.shapes.length) continue; // nothing placeable: every note stays unplayable

    const li = layers.length;
    const base = li * P, prevBase = base - P;
    // Arrival cost per position from the collapsed previous layer: min over p of best[p] + transition(p, q). The
    // transition is affine in |p - q| (for p != q), so a left and a right sweep give it in O(positions).
    if (li > 0) {
      const relief = 1 + GAP_RELIEF * gap;
      const fixed = SHIFT_FIXED / relief, step = SHIFT_DIST / relief;
      // Left sweep: best over p < q of best[p] + step * (q - p).
      let run = Infinity, runFrom = -1;
      for (let q = 1; q < P; q++) {
        arrival[q] = run; arrivalFrom[q] = runFrom;
        const c = bestCost[prevBase + q];
        run += step;
        if (c + step < run) { run = c + step; runFrom = q; }
      }
      // Right sweep: best over p > q, then add the fixed shift cost and compare with staying put.
      run = Infinity; runFrom = -1;
      for (let q = P - 1; q >= 1; q--) {
        let moved = arrival[q], movedFrom = arrivalFrom[q];
        if (run < moved) { moved = run; movedFrom = runFrom; }
        const stay = bestCost[prevBase + q];
        run += step;
        if (stay + step < run) { run = stay + step; runFrom = q; }
        moved += fixed;
        if (stay <= moved) { arrival[q] = stay; arrivalFrom[q] = stay < Infinity ? q : -1; }
        else { arrival[q] = moved; arrivalFrom[q] = movedFrom; }
      }
    }
    bestCost.fill(Infinity, base, base + P);
    bestShape.fill(-1, base, base + P);
    bestPrev.fill(-1, base, base + P);
    const shapes = eventPlan.shapes;
    for (let si = 0; si < shapes.length; si++) {
      const shape = shapes[si];
      const lo = shape.open ? 1 : shape.posLo, hi = shape.open ? positions : shape.posHi;
      for (let q = lo; q <= hi; q++) {
        let c = shape.cost + W_HEIGHT * q, from = -1;
        if (li > 0) {
          if (shape.open) { c += bestCost[prevBase + q]; from = q; } // INHERIT: keep the hand where it was, free
          else { c += arrival[q]; from = arrivalFrom[q]; }
        }
        if (c < bestCost[base + q]) { bestCost[base + q] = c; bestShape[base + q] = si; bestPrev[base + q] = from; }
      }
    }
    const durs = event.durations ?? [];
    let maxDur = 0;
    for (const note of notes) maxDur = Math.max(maxDur, durs[note.orig] ?? 0);
    layers.push({ event: ei, plan: eventPlan, notes, onset, end: onset + maxDur, reach: Math.max(onset + maxDur, layers.at(-1)?.reach ?? -Infinity) });
    prevOnset = onset;
    prevEnd = onset + maxDur;
  }
  finishSegment();
  return results;
}

// --- Notes to events ---------------------------------------------------------------------------------------------------

/** One written note of a staff (any voice or layer): onset and duration in quarter notes, sounding MIDI pitch. */
export interface FretNote { onset: number; duration: number; pitch: number | null; tieStart?: boolean; tieStop?: boolean; fixed?: FretFixed }
/** Per written note: its fingering (a tie continuation gets the fingering of the note it continues). */
export interface FretNoteResult { result?: FretResult; continuation: boolean }

const ONSET_EPS = 1e-6;

/**
 * Finger the notes of one staff, every voice together. Shared by the reader (mei-tab.ts) and the bake
 * (scripts/tab-bake.mjs) so both give the same fingerings for the same notes.
 * - Notes starting together are one event, whatever their voice: they sound at once, so they need different strings.
 * - A unison (the same pitch starting together in two voices) is one string: one solver note, ringing as long as the
 *   longest of them (ties included); every written note of it gets that fingering.
 * - A tie continuation (`tieStop` with a tie open on its pitch) is not fingered again: it extends the note it continues
 *   and takes its fingering. With nothing open (a chunk starting mid-tie) it is fingered as a note.
 * - Notes without a pitch get no result. The input order only breaks ties between equal onsets.
 */
export function assignNoteFrets(notes: FretNote[], options: FretOptions = {}): FretNoteResult[] {
  const out: FretNoteResult[] = notes.map(() => ({ continuation: false }));
  const order = notes.map((_, index) => index)
    .filter(index => { const note = notes[index]; return note.pitch !== null && Number.isFinite(note.pitch) && Number.isFinite(note.onset); })
    .sort((a, b) => notes[a].onset - notes[b].onset || a - b);
  /** The solver note (event, position) of each written note; continuations point at the note they continue. */
  const slotOf = new Map<number, [number, number]>();
  /** Open ties by pitch: the slot of the note they continue. */
  const open = new Map<number, [number, number]>();
  const events: FretEvent[] = [];
  /** Latest end (onset + duration) of each solver note, per event. */
  const ends: number[][] = [];
  const end = (note: FretNote) => note.onset + (Number.isFinite(note.duration) ? Math.max(0, note.duration) : 0);
  for (let k = 0; k < order.length;) {
    const onset = notes[order[k]].onset;
    let stop = k;
    while (stop < order.length && Math.abs(notes[order[stop]].onset - onset) < ONSET_EPS) stop++;
    const group = order.slice(k, stop);
    k = stop;
    // Continuations, against the ties open before this onset.
    const continued: number[] = [];
    for (const index of group) {
      const note = notes[index];
      const slot = note.tieStop ? open.get(note.pitch!) : undefined;
      if (!slot) continue;
      slotOf.set(index, slot);
      out[index].continuation = true;
      continued.push(index);
      ends[slot[0]][slot[1]] = Math.max(ends[slot[0]][slot[1]], end(note));
    }
    for (const index of continued) if (!notes[index].tieStart) open.delete(notes[index].pitch!);
    for (const index of continued) if (notes[index].tieStart) open.set(notes[index].pitch!, slotOf.get(index)!);
    // New notes: one event, a unison is one solver note.
    let event: FretEvent | undefined;
    const byPitch = new Map<number, number>();
    for (const index of group) {
      if (out[index].continuation) continue;
      const note = notes[index], pitch = note.pitch!;
      if (!event) { event = { onset, durations: [], pitches: [], fixed: [] }; events.push(event); ends.push([]); }
      const e = events.length - 1;
      let position = byPitch.get(pitch);
      if (position === undefined) {
        position = event.pitches.length;
        byPitch.set(pitch, position);
        event.pitches.push(pitch);
        event.fixed!.push(note.fixed);
        ends[e].push(end(note));
      } else {
        ends[e][position] = Math.max(ends[e][position], end(note));
        if (!event.fixed![position]) event.fixed![position] = note.fixed;
      }
      slotOf.set(index, [e, position]);
      if (note.tieStart) open.set(pitch, [e, position]);
    }
  }
  events.forEach((event, e) => { event.durations = ends[e].map(at => at - event.onset); });
  const results = assignFrets(events, options);
  for (const [index, [e, position]] of slotOf) out[index].result = results[e][position];
  return out;
}
