import { defineConfig, devices } from '@playwright/test';

/**
 * Local (default): starts the in-memory backend (`npm --prefix ../backend run dev:memory`, never touches Atlas) and
 * Vite, or reuses them when they are already running.
 *
 * Live site: E2E_BASE_URL=https://your-app.example npm run e2e   (no servers are started)
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(baseURL);

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // The specs share one seeded database; they stay independent through unique data, but run one at a time so the
  // dashboard-count checks are not raced by another worker creating tasks.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: isLocal
    ? [
        {
          command: 'npm --prefix ../backend run dev:memory',
          url: 'http://localhost:4000/api/health',
          env: { THROTTLING_ENABLED: 'false' },
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
          stdout: 'ignore',
          stderr: 'pipe',
        },
        {
          command: 'npm run dev',
          url: 'http://localhost:5173',
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          stdout: 'ignore',
          stderr: 'pipe',
        },
      ]
    : undefined,
});
