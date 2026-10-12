/** A host-owned clock that drives the playhead (the `clock` prop). Types only: no runtime imports. */
export type ClockEvent = { type: 'play' | 'pause' | 'seek' | 'rate'; time: number };
export type ExternalClock = {
  /** Current time in seconds from the start of the score (score beat 0, the pickup's first beat when there is one). May be negative during a count-in. */
  now(): number;
  /** Whether the clock is running; the playhead updates every animation frame while it is. */
  readonly playing: boolean;
  /** Called on play, pause, seek and rate changes; returns an unsubscribe function. */
  subscribe(listener: (event: ClockEvent) => void): () => void;
};
