// UPDATE_GOLDEN=1 rewrites the compiler's golden MusicXML fixtures (toMatchFileSnapshot).
export default { test: { globals: true, environment: 'node', include: ['src/**/*.test.ts'], update: Boolean(process.env.UPDATE_GOLDEN) } };
