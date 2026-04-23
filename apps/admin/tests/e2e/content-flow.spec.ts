/**
 * Content Flow E2E Tests
 *
 * Validates business flows in the admin interface:
 * - Posts page rendering and navigation
 * - New post editor rendering
 * - Content page navigation
 * - No critical JavaScript errors across pages
 *
 * These tests complement the smoke tests by focusing on content workflows.
 *
 * @file content-flow.spec.ts
 * @description Tests for Content Flow — Post Creation & Navigation
 * @layer infrastructure
 */
import { test, expect } from "@playwright/test";
import { TEST_CREDENTIALS, loginAs, clearAuth } from "./helpers";

test.describe("Content Flow — Post Creation & Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await loginAs(page, TEST_CREDENTIALS.VALID.email, TEST_CREDENTIALS.VALID.password);
  });

  // ─── Posts Page ────────────────────────────────────────────────────────────

  test("Posts page renders heading and action button", async ({ page }) => {
    await page.goto("/posts");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Posts", level: 1 })).toBeVisible();

    // "Create New Post" or "New Post" button should be present
    const createButton = page
      .getByRole("link", { name: /new post|create/i })
      .or(page.getByRole("button", { name: /new post|create/i }));
    await expect(createButton.first()).toBeVisible();
  });

  // ─── Navigate to New Post ─────────────────────────────────────────────────

  test("Navigate to new post editor from posts list", async ({ page }) => {
    await page.goto("/posts");
    await page.waitForLoadState("networkidle");

    // Click the create/new post button/link
    const createButton = page
      .getByRole("link", { name: /new post|create/i })
      .or(page.getByRole("button", { name: /new post|create/i }));
    await createButton.first().click();

    // Should navigate to /posts/new
    await page.waitForURL(/\/posts\/new/, { timeout: 10000 });
    expect(page.url()).toContain("/posts/new");
  });

  // ─── New Post Editor ──────────────────────────────────────────────────────

  test("New post editor page renders input elements", async ({ page }) => {
    await page.goto("/posts/new");
    await page.waitForLoadState("networkidle");

    // The editor should have some form of text input area
    // (textarea, contenteditable, or input)
    const textInput = page.locator("textarea, [contenteditable='true'], input[type='text']");
    const count = await textInput.count();
    expect(count).toBeGreaterThan(0);
  });

  // ─── Content Page ─────────────────────────────────────────────────────────

  test("Content page renders without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/content");
    await page.waitForLoadState("networkidle");

    // Page should load (not redirect to error page)
    expect(page.url()).not.toContain("/error");

    // Filter out network errors (API might not be running)
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes("fetch") &&
        !e.includes("NetworkError") &&
        !e.includes("ECONNREFUSED") &&
        !e.includes("Failed to fetch")
    );
    expect(criticalErrors).toHaveLength(0);
  });

  // ─── Cross-page Navigation ────────────────────────────────────────────────

  test("Navigate between posts, content, and scheduling without JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    // Posts
    await page.goto("/posts");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Posts", level: 1 })).toBeVisible();

    // Content
    await page.goto("/content");
    await page.waitForLoadState("networkidle");

    // Scheduling
    await page.goto("/scheduling");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Content Calendar", level: 1 })).toBeVisible();

    // Back to posts
    await page.goto("/posts");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Posts", level: 1 })).toBeVisible();

    // No critical JS errors across all navigations
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes("fetch") &&
        !e.includes("NetworkError") &&
        !e.includes("ECONNREFUSED") &&
        !e.includes("Failed to fetch")
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
