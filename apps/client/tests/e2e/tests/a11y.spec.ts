/**
 * @file a11y.spec.ts
 * @description E2E smoke test validating WCAG 2.0 + 2.1 Level AA on the client
 *              public pages (login). Expects the client dev server on
 *              PLAYWRIGHT_BASE_URL (default http://localhost:3200). Uses the
 *              canonical `expectPageToBeAccessible` helper from `../utils/a11y`
 *              (mirror of the admin one). Canon:
 *              `axe-core-playwright-a11y-testing-for-e2e-suites`.
 * @layer infrastructure
 */
import { test } from "@playwright/test";
import { expectPageToBeAccessible } from "../utils/a11y";

test.describe("Client a11y smoke", () => {
  test("login page has no critical/serious WCAG 2 AA violations", async ({ page }) => {
    await page.goto("/login");
    await expectPageToBeAccessible(page);
  });
});
