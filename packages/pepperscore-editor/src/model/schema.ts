import { z } from 'zod';
import { DURATION_BASES } from './durations';
import { INSTRUMENT_IDS, LEVELS } from './instruments';
import type { InstrumentClef, SpelledPitch } from 'pepperscore/instruments';

const CLEFS = ['treble', 'bass', 'alto', 'tenor', 'percussion', 'treble8vb'] as const;
const ARTICULATIONS = ['staccato', 'tenuto', 'accent', 'marcato', 'staccatissimo', 'fermata'] as const;
const DYNAMICS = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'sfz', 'fp'] as const;

export type Clef = typeof CLEFS[number];
export type Articulation = typeof ARTICULATIONS[number];
export type Dynamic = typeof DYNAMICS[number];
export type Jump = { type: 'dc' | 'ds'; target: 'fine' | 'coda' | 'end' };

export const TimeSchema = z.object({ count: z.number().int().min(1).max(32), unit: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.literal(16)]) });
export const KeySchema = z.object({ fifths: z.number().int().min(-7).max(7), mode: z.enum(['major', 'minor']).optional() });
export const GlobalMeasureSchema = z.object({
  id: z.string(), time: TimeSchema.optional(), key: KeySchema.optional(),
  tempo: z.object({ bpm: z.number().positive(), unit: z.enum(DURATION_BASES), text: z.string().optional() }).optional(),
  barline: z.enum(['regular', 'double', 'final', 'dashed', 'invisible']).optional(),
  repeatStart: z.boolean().optional(), repeatEnd: z.object({ times: z.number().int().min(2).max(16).optional() }).optional(),
  ending: z.object({ numbers: z.array(z.number().int().min(1)).min(1), open: z.boolean().optional() }).optional(),
  segno: z.boolean().optional(), coda: z.boolean().optional(), fine: z.boolean().optional(), toCoda: z.boolean().optional(),
  jump: z.object({ type: z.enum(['dc', 'ds']), target: z.enum(['fine', 'coda', 'end']) }).optional(),
  rehearsal: z.string().optional(),
});
export const PitchSchema = z.object({ step: z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G']), octave: z.number().int().min(0).max(9), alter: z.number().int().min(-2).max(2) });
export const NoteSchema = z.object({ id: z.string(), pitch: PitchSchema, tie: z.object({ target: z.string() }).optional(), accidental: z.enum(['auto', 'show', 'hide', 'cautionary']).optional() });
export const DurationSchema = z.object({ base: z.enum(DURATION_BASES), dots: z.union([z.literal(0), z.literal(1), z.literal(2)]) });
export const EventSchema = z.object({
  id: z.string(), type: z.literal('event'), duration: DurationSchema, rest: z.literal(true).optional(), fullMeasure: z.literal(true).optional(),
  notes: z.array(NoteSchema).optional(), grace: z.object({ slash: z.boolean() }).optional(), stem: z.enum(['up', 'down']).optional(),
  articulations: z.array(z.enum(ARTICULATIONS)).optional(),
  slurs: z.array(z.object({ id: z.string(), target: z.string(), side: z.enum(['up', 'down']).optional() })).optional(),
});
/**
 * `outer` is the written group (MusicXML actual-notes, e.g. 3 eighths) and
 * `inner` the span it occupies (normal-notes, e.g. 2 eighths); member ticks
 * are scaled by inner/outer.
 */
export const TupletSchema = z.object({ id: z.string(), type: z.literal('tuplet'), outer: z.object({ multiple: z.number().int().min(1), base: z.enum(DURATION_BASES) }), inner: z.object({ multiple: z.number().int().min(1), base: z.enum(DURATION_BASES) }), content: z.array(EventSchema), bracket: z.boolean().optional() });
export const SequenceSchema = z.object({ id: z.string(), voice: z.number().int().min(1).max(4), staff: z.number().int().min(1).max(2), content: z.array(z.union([EventSchema, TupletSchema])) });
export const BeamSchema = z.object({ id: z.string(), events: z.array(z.string()).min(2) });
export const AnchorSchema = z.object({ measureId: z.string(), tick: z.number().int().min(0), staff: z.number().int().min(1), eventId: z.string().optional() });
export const OffsetSchema = z.object({ x: z.number(), y: z.number() });
export const DirectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dynamic'), id: z.string(), anchor: AnchorSchema, placement: z.enum(['above', 'below']).optional(), offset: OffsetSchema.optional(), value: z.enum(DYNAMICS) }),
  z.object({ kind: z.literal('wedge'), id: z.string(), anchor: AnchorSchema, placement: z.enum(['above', 'below']).optional(), offset: OffsetSchema.optional(), shape: z.enum(['cresc', 'dim']), endTick: z.number().int().min(0), endMeasureId: z.string().optional() }),
  z.object({ kind: z.literal('text'), id: z.string(), anchor: AnchorSchema, placement: z.enum(['above', 'below']).optional(), offset: OffsetSchema.optional(), text: z.string(), style: z.enum(['plain', 'expression', 'tempo']).optional() }),
]);
export const PartMeasureSchema = z.object({ id: z.string(), clefs: z.array(z.object({ staff: z.number().int().min(1), clef: z.enum(CLEFS), tick: z.number().int().min(0).optional() })).optional(), sequences: z.array(SequenceSchema), beams: z.array(BeamSchema), directions: z.array(DirectionSchema) });
/** `clefs` is the initial clef per staff (index 0 = staff 1); `PartMeasure.clefs` are changes. */
export const PartSchema = z.object({ id: z.string(), name: z.string(), abbreviation: z.string().optional(), instrument: z.object({ gmProgram: z.number().int().min(1).max(128), midiChannel: z.number().int().optional() }), staves: z.union([z.literal(1), z.literal(2)]), clefs: z.array(z.enum(CLEFS)), transposition: z.object({ semitones: z.number().int(), diatonic: z.number().int() }).optional(), measures: z.array(PartMeasureSchema) });
export const StyleSheetSchema = z.object({ musicFont: z.enum(['Bravura', 'Petaluma']).optional(), staffSize: z.number().positive().optional() });
/**
 * Shows a layout part for another instrument: a linked, view-time transform of the same music. `interval`
 * is a free transposition on top of the instrument's; `rangeOverrides` maps an event id to the octave shift
 * the user chose, which survives automatic range fitting.
 */
export const SwapSchema = z.object({
  instrument: z.enum(INSTRUMENT_IDS), level: z.enum(LEVELS),
  interval: z.object({ semitones: z.number().int(), diatonic: z.number().int() }).optional(),
  autoRange: z.boolean().default(true),
  rangeOverrides: z.record(z.string(), z.union([z.literal(0), z.literal(12), z.literal(-12)])).default({}),
});
/** A part in a layout, in order; omitted `staves` means all of them. */
export const LayoutPartSchema = z.object({ partId: z.string(), staves: z.array(z.number().int()).optional(), swap: SwapSchema.optional() });
/**
 * A Full score (`score`), Part (`part`) or Custom score (`custom`), after Dorico. `kind` and `transposing`
 * default so phase 1 files load: their layouts were transposing score layouts.
 */
export const LayoutSchema = z.object({
  id: z.string(), name: z.string(), kind: z.enum(['score', 'part', 'custom']).default('score'),
  parts: z.array(LayoutPartSchema), transposing: z.boolean().default(true),
  breaks: z.array(z.object({ measureId: z.string(), type: z.enum(['system', 'page']) })).optional(),
  style: StyleSheetSchema.partial().optional(),
  overrides: z.record(z.string(), z.object({ offset: OffsetSchema.optional(), hidden: z.boolean().optional(), text: z.string().optional(), cue: z.boolean().optional() })),
});
export const MetaSchema = z.object({
  title: z.string().optional(),
  composer: z.string().optional(),
  description: z.string().optional(),
  project: z.string().optional(),
  tags: z.array(z.string()).optional(),
  goal: z.string().optional(),
});

export const DocumentSchema = z.object({ global: z.object({ measures: z.array(GlobalMeasureSchema) }), parts: z.array(PartSchema), layouts: z.array(LayoutSchema).min(1), style: StyleSheetSchema, meta: MetaSchema });

export type Time = z.infer<typeof TimeSchema>;
export type Key = z.infer<typeof KeySchema>;
export type GlobalMeasure = z.infer<typeof GlobalMeasureSchema>;
export type Pitch = z.infer<typeof PitchSchema>;
// The shared instrument model (`pepperscore/instruments`) has no zod types: keep the schema's clef and pitch assignable to it.
type SharedModelCompat = [Clef, Pitch] extends [InstrumentClef, SpelledPitch] ? true : never;
const sharedModelCompat: SharedModelCompat = true;
void sharedModelCompat;
export type Note = z.infer<typeof NoteSchema>;
export type Event = z.infer<typeof EventSchema>;
export type Tuplet = z.infer<typeof TupletSchema>;
export type Sequence = z.infer<typeof SequenceSchema>;
export type Beam = z.infer<typeof BeamSchema>;
export type Anchor = z.infer<typeof AnchorSchema>;
export type Direction = z.infer<typeof DirectionSchema>;
export type PartMeasure = z.infer<typeof PartMeasureSchema>;
export type Part = z.infer<typeof PartSchema>;
export type Swap = z.infer<typeof SwapSchema>;
export type LayoutPart = z.infer<typeof LayoutPartSchema>;
export type Layout = z.infer<typeof LayoutSchema>;
export type StyleSheet = z.infer<typeof StyleSheetSchema>;
export type Document = z.infer<typeof DocumentSchema>;

export const parseDocument = (value: unknown): Document => DocumentSchema.parse(value);
