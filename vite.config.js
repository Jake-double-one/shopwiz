import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  plugins: [svelte()],
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2020', assetsInlineLimit: 0 },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
});
