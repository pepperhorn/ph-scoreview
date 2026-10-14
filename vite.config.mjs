// The validation suites that serve the library sources run a plain Vite dev server at the repo root (validation/document.mjs,
// performance.mjs, …). On the sources, the Verovio files and notices pepperscore loads at runtime come from this plugin.
import runtimeFilesDev from './packages/pepperscore/scripts/dev-runtime-files.mjs';

export default { plugins: [runtimeFilesDev()] };
