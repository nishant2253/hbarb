import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for TradeAgent frontend e2e tests.
 * https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    // Dark background screenshot for visual comparison
    colorScheme: 'dark',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
    // Mobile
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
  ],

  // Automatically start `npm run dev` if not already running
  webServer: {
    command: 'npm run dev',
    url:     'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
