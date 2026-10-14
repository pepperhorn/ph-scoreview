// The subset of Verovio's untyped ESM API this package uses (tests only for now).
declare module 'verovio/wasm' {
  const createVerovioModule: () => Promise<unknown>;
  export default createVerovioModule;
}

declare module 'verovio/esm' {
  export class VerovioToolkit {
    constructor(module: unknown);
    loadData(data: string): number;
    getPageCount(): number;
    renderToSVG(page?: number): string;
    /** The buffered log since the last call (with `enableLogToBuffer`); reading clears it. */
    getLog(): string;
  }
  export const LOG_WARNING: number;
  export function enableLog(level: number, module: unknown): void;
  export function enableLogToBuffer(value: boolean | number, module: unknown): void;
}
