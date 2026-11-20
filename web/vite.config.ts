import { defineConfig } from 'vitest/config';
import { runtimeData } from './scripts/runtime-data.ts';
import { seo } from './scripts/seo/plugin.ts';

export default defineConfig({
  base: './',
  // Pre-rendered pages, metadata and service files for search engines and AI assistants.
  plugins: [runtimeData(), seo()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 700,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
