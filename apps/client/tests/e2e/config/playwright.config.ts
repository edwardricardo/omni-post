/**
 * @file playwright.config.ts
 * @description Tests for playwright config
 * @layer infrastructure
 */
import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Comprehensive Playwright configuration for E2E testing
 * Features:
 * - Multi-browser testing (Chromium, Firefox, WebKit)
 * - Mobile device emulation
 * - Visual regression testing
 * - Accessibility testing
 * - CI/CD optimization
 */

const isCI = process.env.CI === "true";
const baseURL = process.env.BASE_URL || "http://localhost:3200";

export default defineConfig({
  // Test directory configuration
  testDir: path.join(__dirname, "../tests"),

  // Global test settings
  timeout: 30 * 1000, // 30 seconds per test
  expect: {
    timeout: 10 * 1000, // 10 seconds for assertions
    toHaveScreenshot: {
      threshold: 0.3, // 30% difference threshold for visual regression
      mode: "binary",
    },
    toMatchSnapshot: {
      threshold: 0.3,
    },
  },

  // Test execution settings
  fullyParallel: true,
  forbidOnly: isCI, // Fail CI if test.only() is used
  retries: isCI ? 2 : 0, // Retry failed tests in CI
  workers: isCI ? 1 : undefined, // Limit workers in CI for stability

  // Reporter configuration
  reporter: [
    ["html", { outputFolder: "test-results/html-report" }],
    ["json", { outputFile: "test-results/results.json" }],
    ["junit", { outputFile: "test-results/junit.xml" }],
    ["line"], // Console output
    isCI && ["github"], // GitHub Actions annotations
  ].filter(Boolean),

  // Global test configuration
  use: {
    baseURL,

    // Tracing and debugging
    trace: isCI ? "retain-on-failure" : "on-first-retry",
    screenshot: isCI ? "only-on-failure" : "on",
    video: isCI ? "retain-on-failure" : "off",

    // Browser context settings
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,

    // Test identification
    testIdAttribute: "data-testid",

    // Performance settings
    actionTimeout: 10 * 1000,
    navigationTimeout: 30 * 1000,
  },

  // Project configurations for different browsers and scenarios
  projects: [
    // Desktop browsers
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Enable experimental features for better testing
        launchOptions: {
          args: [
            "--disable-features=VizDisplayCompositor",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
          ],
        },
      },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },

    // Mobile browsers
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 12"] },
    },

    // Tablet testing
    {
      name: "tablet",
      use: { ...devices["iPad Pro"] },
    },

    // Accessibility testing project
    {
      name: "accessibility",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/*.accessibility.spec.ts",
    },

    // Visual regression testing
    {
      name: "visual-regression",
      use: {
        ...devices["Desktop Chrome"],
        // Consistent screenshots across environments
        deviceScaleFactor: 1,
        hasTouch: false,
      },
      testMatch: "**/*.visual.spec.ts",
    },

    // Performance testing
    {
      name: "performance",
      use: {
        ...devices["Desktop Chrome"],
        // Enable performance metrics collection
        launchOptions: {
          args: ["--enable-precise-memory-info"],
        },
      },
      testMatch: "**/*.performance.spec.ts",
    },
  ],

  // Global setup and teardown
  globalSetup: path.join(__dirname, "global-setup.ts"),
  globalTeardown: path.join(__dirname, "global-teardown.ts"),

  // Web server configuration for local development
  webServer: !isCI
    ? {
        command: "pnpm dev",
        port: 3200,
        timeout: 120 * 1000, // 2 minutes to start
        reuseExistingServer: !isCI,
        cwd: path.join(__dirname, "../../../"),
      }
    : undefined,

  // Output directories
  outputDir: "test-results/artifacts",

  // Metadata for reporting
  metadata: {
    testFramework: "Playwright",
    testType: "E2E",
    project: "omni-post",
    environment: process.env.NODE_ENV || "test",
  },
});
