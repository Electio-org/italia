import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium'
  },
  webServer: {
    command: 'python -m http.server 5173 --bind 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120_000
  }
});
