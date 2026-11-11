import { fileURLToPath } from 'node:url';

// UPDATE_GOLDEN=1 rewrites the compiler's golden MusicXML fixtures (toMatchFileSnapshot).
export default {
  resolve: { alias: { 'pepperscore/instruments': fileURLToPath(new URL('../pepperscore/src/instruments.ts', import.meta.url)) } },
  test: { globals: true, environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.mjs'], update: Boolean(process.env.UPDATE_GOLDEN) },
};
