import { defineConfig } from 'vite';

// Relative base so the built game works from any sub-path (GitHub Pages, artifact hosting, file servers).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  server: { host: true },
});
