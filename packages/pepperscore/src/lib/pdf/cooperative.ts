/**
 * PDF composition needs a DOM (svg2pdf measures and styles real elements), so it runs on the main thread.
 * To keep the page responsive it works in slices of about SLICE_MS and yields to the event loop between them;
 * every yield is also a cancellation point.
 */
export const SLICE_MS = 25;

/**
 * Let input, timers, playback and painting run: a plain macrotask. `scheduler.yield` is not used because its
 * continuation is queued ahead of other pending tasks, so timers (the reader's playback clock) can starve.
 */
export function yieldToMain(): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve));
}

/** Throws when aborted; yields when the current slice has used its budget. Call it often: it is cheap. */
export type Tick = () => Promise<void>;
export function sliceTicker(signal: AbortSignal, budget = SLICE_MS): Tick {
  let start = performance.now();
  return async () => {
    signal.throwIfAborted();
    if (performance.now() - start < budget) return;
    await yieldToMain();
    signal.throwIfAborted();
    start = performance.now();
  };
}

/** Steps written as generators (`yield` marks a safe pause) run to completion, or are driven slice by slice. */
export function runSteps(steps: Generator<void>): void { while (!steps.next().done); }
export async function driveSteps(steps: Generator<void>, tick: Tick): Promise<void> {
  for (let step = steps.next(); !step.done; step = steps.next()) await tick();
}

/** Where an export is: engraving runs in a worker; annotating and composing run in slices on the page. */
export type ExportProgress = { phase: 'engraving' | 'annotating' | 'composing'; page: number; pages: number };
