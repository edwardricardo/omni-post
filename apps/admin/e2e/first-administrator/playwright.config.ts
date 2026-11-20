/**
 * @file playwright.config.ts
 * @description Playwright configuration of the first administrator's journey: the spec beside it,
 *              in one Chromium browser, against an administration portal and an API that are
 *              already running on a database that holds no administrator yet. The spec spends a
 *              single-use password, so it is never retried, and it types passwords into the
 *              browser, so the run keeps no trace, no screenshot and no video, reports through
 *              `list` and `github` only, which print no fill step, and writes no snapshot of the
 *              page of a failed test. Two runs are not guarded: one that overrides this
 *              configuration on the command line, with `--trace on` or `--reporter html` for
 *              example, and one under Playwright's debug log (`DEBUG=pw:api` or `DEBUG=pw:*`),
 *              which writes each fill with its value to stderr.
 * @layer infrastructure
 */
import { defineConfig, devices } from "@playwright/test";

// The error context of a failed test would carry an aria snapshot of the page, and an aria
// snapshot holds the value of every input, a password field's included. The workers read this
// variable; set here, it reaches every worker of every run of this config.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

export default defineConfig({
  // Only the Playwright suffix: the default also matches `*.test.*`, the vitest suffix.
  testMatch: "**/*.spec.ts",

  // Measured on a local `next dev`: the two pages the journey compiles on their first hit answered
  // in 0.9 s and 1.2 s, and the whole test took 6 s. The bounds leave a CI runner a margin of more
  // than twenty times; the test's covers the command's own limit of 120 s and the browser steps.
  timeout: 180_000,
  expect: { timeout: 30_000 },

  workers: 1,
  // Fitness #32 scans only `*.test.ts(x)`, so on CI this is what refuses a committed `.only`.
  forbidOnly: !!process.env.CI,
  // A retry would sign in again with a password the first attempt may already have spent.
  retries: 0,

  // The title of a fill step carries the value it typed. `list` prints only `test.step` steps,
  // even under PLAYWRIGHT_LIST_PRINT_STEPS, and `github` only failures; `html`, `json` and `blob`
  // would record the fill.
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3100",
    // A trace records every typed value. A screenshot or a video masks a password field, but a
    // run that uploads nothing has no use for either.
    trace: "off",
    screenshot: "off",
    video: "off",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
