declare module 'verovio/wasm' {
  const createVerovioModule: () => Promise<unknown>;
  export default createVerovioModule;
}

declare module 'verovio/esm' {
  export class VerovioToolkit {
    constructor(module: unknown);
    destroy(): void;
    setOptions(options: Record<string, unknown>): void;
    loadData(data: string): number;
    getMEI(options?: Record<string, unknown>): string;
    getPageCount(): number;
    renderToSVG(page?: number): string;
    renderToTimemap(options?: Record<string, unknown>): unknown;
    resetOptions(): void;
    /** Re-cast and re-lay out the loaded document with the current options (`resetCache` defaults to true). */
    redoLayout(options?: { resetCache?: boolean }): void;
    /** The buffered log since the last call (with `enableLogToBuffer`); reading clears it. */
    getLog(): string;
  }
  export function enableLogToBuffer(value: number, module: unknown): void;
}
