import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import soundPack from './sounds.mjs';

export default defineConfig({ integrations: [react(), soundPack()], devToolbar: { enabled: false }, vite: { optimizeDeps: { include: ['abcjs'] } } });
