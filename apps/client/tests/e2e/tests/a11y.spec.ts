/**
 * @file a11y.spec.ts
 * @description Smoke E2E que valida WCAG 2.0 + 2.1 Level AA en páginas
 *              públicas del cliente (login). Espera al client dev server en
 *              PLAYWRIGHT_BASE_URL (default http://localhost:3200). Usa el
 *              helper canónico `expectPageToBeAccessible` de `../utils/a11y`
 *              (mirror del admin). Canon:
 *              `axe-core-playwright-a11y-testing-for-e2e-suites`.
 * @layer infrastructure
 */
import { test } from "@playwright/test";
import { expectPageToBeAccessible } from "../utils/a11y.js";

test.describe("Client a11y smoke", () => {
  test("login page has no critical/serious WCAG 2 AA violations", async ({ page }) => {
    await page.goto("/login");
    await expectPageToBeAccessible(page);
  });
});
