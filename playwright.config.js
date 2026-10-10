import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Use a preinstalled Chromium if one is configured (e.g. in CI images without browser downloads)
const executablePath = process.env.PW_CHROMIUM || (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:8098',
    viewport: { width: 390, height: 844 },
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: [
    {
      command: 'node e2e/fake-translate.js',
      url: 'http://127.0.0.1:8099/',
      reuseExistingServer: false,
      env: { PORT: '8099' },
    },
    {
      command: 'node --disable-warning=ExperimentalWarning server/index.js',
      url: 'http://localhost:8098/healthz',
      reuseExistingServer: false,
      env: {
        PORT: '8098',
        DATA_DIR: ':memory:',
        LOOKUP_LIMIT: '1000',
        CREATE_LIMIT: '1000',
        TRANSLATE_PROVIDER: 'libretranslate',
        TRANSLATE_URL: 'http://127.0.0.1:8099',
      },
    },
  ],
});
