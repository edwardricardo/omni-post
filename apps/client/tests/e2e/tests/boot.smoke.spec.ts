/**
 * @file boot.smoke.spec.ts
 * @description Client portal boot smoke — confirms the Next.js app starts,
 *              renders the login page, and enforces auth redirects on
 *              protected routes. Complements the deeper auth.spec /
 *              publishing.spec / a11y.spec suites with a 60-second
 *              "is the app even running" gate.
 *
 *              Tier 11 of the Smoke E2E plan. The deep client flows
 *              (compose, scheduling, channels, approvals, AI) are
 *              already covered by the existing publishing.spec /
 *              auth.spec — this file fills the contract gap of
 *              "production-ready smoke" that a CI pipeline can use as
 *              the first signal a client deploy succeeded.
 *
 * @layer infrastructure
 */

import { test, expect } from "@playwright/test";

test.describe("Tier 11 — Client boot smoke", () => {
  test("login page renders with the email + password form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('input[name="email"], input[type="email"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('input[name="password"], input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test("dashboard redirects unauthenticated requests to /login", async ({ page }) => {
    const response = await page.goto("/dashboard");
    // Either: server-side 307/302 redirect, or client-side soft nav landing
    // on /login. Both are valid implementations of the auth gate; the smoke
    // confirms the page does NOT render dashboard content for an
    // unauthenticated visitor.
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/login/);
    // Sanity-check we did receive an HTTP response from the server (not a
    // hard failure / network error).
    expect(response).not.toBeNull();
  });

  test("submitting invalid credentials surfaces an error", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"], input[type="email"]', "no-such@test.local");
    await page.fill('input[name="password"], input[type="password"]', "WrongPassword1!");
    await page.click('button[type="submit"]');
    // Expect either an inline error message OR the URL to stay on /login
    // (auth failed → no redirect). Both signal "credentials rejected".
    await page.waitForTimeout(2_000);
    const stillOnLogin = page.url().includes("/login");
    const errorVisible = await page
      .locator('[role="alert"], [data-testid="error-message"], .error, .text-destructive')
      .first()
      .isVisible()
      .catch(() => false);
    expect(
      stillOnLogin || errorVisible,
      "expected to stay on /login OR see an inline error after invalid creds"
    ).toBe(true);
  });
});
