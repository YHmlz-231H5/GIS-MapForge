import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for app-map-downloader Electron e2e tests.
 *
 * Boots Electron headlessly, captures all DevTools console output,
 * asserts known warnings are suppressed.
 *
 * Run: `npx playwright test` from this directory.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Electron can't run multiple instances in sandbox
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results.json' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
  },
  timeout: 60_000,
  expect: { timeout: 10_000 },
  projects: [
    {
      name: 'electron-sandbox',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
