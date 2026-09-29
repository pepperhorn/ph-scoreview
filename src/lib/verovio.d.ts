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
    resetXmlIdSeed(seed: number): void;
  }
}
