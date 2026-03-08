// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for E2E testing of the admin authentication system
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  // Look for test files in the tests/e2e directory
  testDir: "./tests/e2e",

  // Maximum time one test can run for
  timeout: 60 * 1000,

  // Run tests in files in parallel
  fullyParallel: false,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only to handle flaky tests
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests to avoid race conditions with test admin account
  // This ensures account lockout doesn't affect other tests
  workers: 1,

  // Reporter to use
  reporter: [
    ["html", { outputFolder: "playwright-report" }],
    ["list"],
    ...(process.env.CI ? [["github"] as const] : []),
  ],

  // Shared settings for all projects
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3100",

    // Collect trace when retrying the failed test
    trace: "on-first-retry",

    // Screenshot on failure
    screenshot: "only-on-failure",

    // Video on first retry
    video: "retain-on-failure",

    // Maximum time each action such as `click()` can take
    actionTimeout: 10 * 1000,

    // Emulate viewport
    viewport: { width: 1280, height: 720 },

    // Ignore HTTPS errors
    ignoreHTTPSErrors: true,
  },

  // Configure projects for major browsers
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },

    // Optional: Enable these for cross-browser testing
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    // Mobile viewports
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },
  ],

  // Run your local dev server before starting the tests
  // Uncomment if you want Playwright to start the server automatically
  // webServer: {
  //   command: 'pnpm dev',
  //   url: 'http://localhost:3100',
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 120 * 1000,
  // },

  // Global setup/teardown
  // globalSetup: require.resolve('./tests/e2e/global-setup.ts'),
  // globalTeardown: require.resolve('./tests/e2e/global-teardown.ts'),
});
