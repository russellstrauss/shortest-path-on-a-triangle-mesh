import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    open: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1000
  }
});

