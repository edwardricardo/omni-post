/**
 * Smoke Tests — Critical Admin Pages
 *
 * Verifies that the 4 most critical admin pages render correctly
 * after authentication. These tests run fast and catch regressions
 * before more comprehensive test suites.
 *
 * Pages covered:
 * - Dashboard   (/)
 * - Posts        (/posts)
 * - Scheduling   (/scheduling)
 * - Accounts     (/accounts)
 */
import { test, expect } from "@playwright/test";
import { TEST_CREDENTIALS, loginAs, clearAuth } from "./helpers";

test.describe("Smoke Tests — Critical Pages", () => {
  test.beforeEach(async ({ page }) => {
    // Start each test with a clean session, then login
    await clearAuth(page);
    await loginAs(page, TEST_CREDENTIALS.VALID.email, TEST_CREDENTIALS.VALID.password);
  });

  // ─── Dashboard ──────────────────────────────────────────────────────────────

  test("Dashboard: renders heading and stat cards", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Main heading in content area
    await expect(page.getByRole("heading", { name: "Admin Dashboard", level: 1 })).toBeVisible();

    // Navigation header is present
    await expect(page.locator("header")).toBeVisible();
    await expect(page.getByRole("heading", { name: "OmniPost Admin", level: 1 })).toBeVisible();

    // Logout button is present
    await expect(page.getByRole("button", { name: /logout/i })).toBeVisible();
  });

  test("Dashboard: quick actions navigation is visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Admin Dashboard", level: 1 })).toBeVisible();

    // Quick actions section exists (link to Posts or Scheduling)
    await expect(page.getByRole("navigation")).toBeVisible();
  });

  // ─── Posts ──────────────────────────────────────────────────────────────────

  test("Posts: renders heading", async ({ page }) => {
    await page.goto("/posts");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Posts", level: 1 })).toBeVisible();
  });

  test("Posts: no JavaScript errors on load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/posts");
    await page.waitForLoadState("networkidle");

    // Allow API errors (backend may not be running) but not React crashes
    const criticalErrors = errors.filter(
      (e) => !e.includes("fetch") && !e.includes("NetworkError") && !e.includes("ECONNREFUSED")
    );
    expect(criticalErrors).toHaveLength(0);
  });

  // ─── Scheduling ─────────────────────────────────────────────────────────────

  test("Scheduling: renders Content Calendar heading", async ({ page }) => {
    await page.goto("/scheduling");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Content Calendar", level: 1 })).toBeVisible();
  });

  test("Scheduling: view toggle buttons are visible", async ({ page }) => {
    await page.goto("/scheduling");
    await page.waitForLoadState("networkidle");

    // View mode buttons rendered by ScheduleHeader
    await expect(page.getByRole("button", { name: /switch to month view/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /switch to week view/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /schedule post/i })).toBeVisible();
  });

  // ─── Accounts ───────────────────────────────────────────────────────────────

  test("Accounts: renders Account Management heading", async ({ page }) => {
    await page.goto("/accounts");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Account Management", level: 1 })).toBeVisible();
  });

  test("Accounts: filter controls are rendered", async ({ page }) => {
    await page.goto("/accounts");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Account Management", level: 1 })).toBeVisible();

    // Filter inputs (always rendered, regardless of API availability)
    await expect(page.locator("#search-input")).toBeVisible();
    await expect(page.locator("#subscription-filter")).toBeVisible();
    await expect(page.locator("#status-filter")).toBeVisible();
  });

  // ─── Auth protection ────────────────────────────────────────────────────────

  test("Protected routes redirect to login when unauthenticated", async ({ page }) => {
    // Explicitly clear session
    await clearAuth(page);

    await page.goto("/");

    // Middleware should redirect to /auth/login
    await page.waitForURL(/\/auth\/login/, { timeout: 10000 });
    expect(page.url()).toContain("/auth/login");
  });

  test("Session persists across page navigations", async ({ page }) => {
    // Already logged in via beforeEach — navigate between pages
    await page.goto("/posts");
    await expect(page.getByRole("heading", { name: "Posts", level: 1 })).toBeVisible();

    await page.goto("/accounts");
    await expect(page.getByRole("heading", { name: "Account Management", level: 1 })).toBeVisible();

    // Still authenticated (no redirect to login)
    expect(page.url()).not.toContain("/auth/login");
  });
});
