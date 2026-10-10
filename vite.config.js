import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { execSync } from 'node:child_process';

// Build info for the help dialog. CI passes it in; local builds fall back to git.
const git = (cmd) => {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
};
process.env.VITE_APP_VERSION ||= 'dev';
process.env.VITE_GIT_SHA ||= git('rev-parse HEAD');
process.env.VITE_BUILD_TIME ||= new Date().toISOString();
process.env.VITE_REPO_URL ||= 'https://github.com/Jake-double-one/shopwiz';

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
