/**
 * Where each part's sound comes from (docs/specs/pepperscore-embeddable-component.md, "Sound resolution"):
 * 1. the first `soundSources` entry that claims it, 2. the pack's FluidR3 sound if pack.json lists it,
 * 3. TimGM6mb.sf2 (always present). Drums use Perfect Drums note files unless a source claims them.
 * Pure: no fetching and no runtime imports (validation/sounds.mjs runs it in Node).
 */
export type SoundSource =
  | { id: string; kind: 'sf2'; url: string; programs?: number[]; drums?: boolean; preset?: string }
  | { id: string; kind: 'sample-pack'; url: string /* may contain {name} */; programs?: number[] }
  | { id: string; kind: 'note-files'; manifest: string; programs?: number[]; drums?: boolean };

/** A part's sound: the drum kit, or a GM program (1-128) and its FluidR3 name. */
export type SoundRequest = { drums: true } | { drums: false; program: number; name: string };

export type SoundPlan =
  | { kind: 'sf2'; sourceId: string; url: string; drums: boolean; program?: number; preset?: string }
  | { kind: 'sample-pack'; sourceId: string; url: string; name: string }
  | { kind: 'note-files'; sourceId: string; manifest: string; drums: boolean };

export const BUILTIN_FLUIDR3 = 'builtin:fluidr3';
export const BUILTIN_DRUMS = 'builtin:perfect-drums';
export const BUILTIN_SF2 = 'builtin:timgm6mb';

export type PlanContext = { sources?: readonly SoundSource[]; fluidr3: ReadonlySet<string>; base: string; page: string };

const claims = (source: SoundSource, request: SoundRequest) =>
  request.drums ? source.kind !== 'sample-pack' && source.drums === true : !!source.programs?.includes(request.program);

/** The built-in GM soundfont; it also plays drum notes a note-file kit lacks. */
export const fallbackSf2Url = (base: string) => new URL('soundfonts/TimGM6mb.sf2', base).href;

export function planSound(request: SoundRequest, { sources = [], fluidr3, base, page }: PlanContext): SoundPlan {
  const source = sources.find(item => claims(item, request));
  if (source?.kind === 'sf2') return { kind: 'sf2', sourceId: source.id, url: new URL(source.url, page).href, drums: request.drums, ...(request.drums ? {} : { program: request.program }), ...(source.preset ? { preset: source.preset } : {}) };
  if (source?.kind === 'sample-pack' && !request.drums) return { kind: 'sample-pack', sourceId: source.id, url: new URL(source.url.replaceAll('{name}', encodeURIComponent(request.name)), page).href, name: request.name };
  if (source?.kind === 'note-files') return { kind: 'note-files', sourceId: source.id, manifest: new URL(source.manifest, page).href, drums: request.drums };
  if (request.drums) return { kind: 'note-files', sourceId: BUILTIN_DRUMS, manifest: new URL('soundfonts/perfect-drums/manifest.json', base).href, drums: true };
  if (fluidr3.has(request.name)) return { kind: 'sample-pack', sourceId: BUILTIN_FLUIDR3, url: new URL(`soundfonts/fluidr3/${request.name}.json`, base).href, name: request.name };
  return { kind: 'sf2', sourceId: BUILTIN_SF2, url: fallbackSf2Url(base), drums: false, program: request.program };
}

/** Players are shared by parts with the same key (sample packs route each note to its part's gain; see Reader audioKey). */
export const planKey = (plan: SoundPlan): string =>
  plan.kind === 'sample-pack' ? `sample-pack:${plan.url}`
    : plan.kind === 'sf2' ? `sf2:${plan.url}#${plan.drums ? 'drums' : plan.program}:${plan.preset ?? ''}`
      : `note-files:${plan.manifest}`;
