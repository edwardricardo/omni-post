/**
 * @file a11y.spec.ts
 * @description E2E smoke test validating WCAG 2 AA on the admin public pages (login). Expects the admin dev server on PLAYWRIGHT_BASE_URL (default http://localhost:3100). Uses the canonical `expectPageToBeAccessible` helper from `./utils/a11y`.
 * @layer infrastructure
 */
import { test } from "@playwright/test";
import { expectPageToBeAccessible } from "./utils/a11y";

test.describe("Admin a11y smoke", () => {
  test("login page has no critical/serious WCAG 2 AA violations", async ({ page }) => {
    await page.goto("/login");
    await expectPageToBeAccessible(page, {
      tags: ["wcag2a", "wcag2aa"],
      includedImpacts: ["serious", "critical"],
    });
  });
});
