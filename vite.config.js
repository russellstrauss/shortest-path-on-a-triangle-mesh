import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    open: true
  },
  preview: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1000
  }
});

