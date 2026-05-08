/**
 * @file a11y.spec.ts
 * @description Smoke E2E que valida WCAG 2 AA en páginas públicas del admin (login). Espera al admin dev server en PLAYWRIGHT_BASE_URL (default http://localhost:3100). Usa el helper canónico `expectPageToBeAccessible` de `./utils/a11y`.
 * @layer infrastructure
 */
import { test } from "@playwright/test";
import { expectPageToBeAccessible } from "./utils/a11y.js";

test.describe("Admin a11y smoke", () => {
  test("login page has no critical/serious WCAG 2 AA violations", async ({ page }) => {
    await page.goto("/login");
    await expectPageToBeAccessible(page, {
      tags: ["wcag2a", "wcag2aa"],
      includedImpacts: ["serious", "critical"],
    });
  });
});
