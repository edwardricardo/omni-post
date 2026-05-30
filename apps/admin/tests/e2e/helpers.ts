/**
 * @file helpers.ts
 * @description Shared Playwright E2E helpers for admin auth flows.
 * @layer infrastructure
 */
import { Page } from "@playwright/test";

/**
 * Test admin credentials
 */
export const TEST_CREDENTIALS = {
  VALID: {
    email: "test-admin@omnipost.local",
    password: "Test@Admin123",
  },
  INVALID_EMAIL: {
    email: "invalid@example.com",
    password: "Test@Admin123",
  },
  INVALID_PASSWORD: {
    email: "test-admin@omnipost.local",
    password: "WrongPassword123",
  },
};

/**
 * Reset test admin account to clear any lockout state
 * Uses Prisma directly since backend doesn't have a test reset endpoint
 */
export async function resetTestAdmin(): Promise<void> {
  try {
    // Since we don't have a backend endpoint, we'll use Prisma directly
    // This is acceptable for E2E tests running in a controlled environment
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    await execAsync(`pnpm --filter @infra/prisma exec -- node -e "
      const { prisma } = require('./src/client.ts');
      prisma.adminUser.updateMany({
        where: { email: '${TEST_CREDENTIALS.VALID.email}' },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          lockReason: null
        }
      }).then(() => prisma.\\$disconnect());
    "`);
  } catch (error) {
    console.warn("[resetTestAdmin] Error resetting test admin:", error);
  }
}

/**
 * Wait for authentication cookies to be set
 * Returns true if authenticated, false otherwise
 *
 * Note: The admin-session cookie is httpOnly, so it is NOT visible via
 * document.cookie. We check via Playwright's context().cookies() instead.
 */
export async function waitForAuth(page: Page, timeout = 5000): Promise<boolean> {
  try {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const cookies = await page.context().cookies();
      const hasSessionToken = cookies.some((c) => c.name === "admin-session" && c.value.length > 0);
      if (hasSessionToken) return true;
      await page.waitForTimeout(100);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Verify authentication cookies are set correctly
 * The admin app uses an httpOnly cookie named "admin-session"
 */
export async function verifyAuthCookies(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies();

  const sessionCookie = cookies.find((c) => c.name === "admin-session" && c.value.length > 0);

  return !!sessionCookie;
}

/**
 * Clear all authentication cookies
 * Note: We use httpOnly cookies, so no localStorage/sessionStorage to clear
 */
export async function clearAuth(page: Page): Promise<void> {
  await page.context().clearCookies();
}

/**
 * Helper function to log in as a user
 * Returns true if login was successful
 */
export async function loginAs(
  page: Page,
  email: string,
  password: string,
  rememberMe = false
): Promise<boolean> {
  await page.goto("/auth/login");

  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);

  if (rememberMe) {
    await page.check('input[name="rememberMe"]');
  }

  await page.click('button[type="submit"]');

  // Wait for redirect to dashboard (login success)
  try {
    await page.waitForURL("/", { timeout: 10000 });
    await page.waitForLoadState("networkidle");
    return true;
  } catch {
    // Login failed — still on login page or error shown
    return false;
  }
}

/**
 * Wait for element to be visible and return it
 */
export async function waitForElement(page: Page, selector: string, timeout = 5000) {
  return page.waitForSelector(selector, { state: "visible", timeout });
}

/**
 * Check if an element is visible
 */
export async function isVisible(page: Page, selector: string): Promise<boolean> {
  try {
    const element = await page.$(selector);
    return element ? await element.isVisible() : false;
  } catch {
    return false;
  }
}

/**
 * Wait for navigation with proper timeout handling
 */
export async function waitForNavigation(page: Page, url: string, timeout = 10000): Promise<void> {
  await page.waitForURL(url, { timeout, waitUntil: "networkidle" });
}

/**
 * Get the current user info from the dashboard
 * Returns null if not on dashboard or user info not found
 */
export async function getCurrentUserInfo(page: Page): Promise<{
  name: string;
  role: string;
} | null> {
  try {
    // Wait for the header with user info to be visible
    await page.waitForSelector('header[role="banner"]', { timeout: 5000 });

    // Extract user info from the text content
    const userInfoText = await page.textContent("header span.text-gray-700");

    if (!userInfoText) {
      return null;
    }

    // Parse "Test Admin (SUPER_ADMIN)" format
    const match = userInfoText.match(/^(.+?)\s*\((.+?)\)$/);
    if (!match || !match[1] || !match[2]) {
      return null;
    }

    return {
      name: match[1].trim(),
      role: match[2].trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Take a screenshot for debugging
 */
export async function takeDebugScreenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: `test-results/debug-${name}-${Date.now()}.png`,
    fullPage: true,
  });
}

/**
 * Check if page is showing loading state
 */
export async function isLoading(page: Page): Promise<boolean> {
  try {
    const submitButton = await page.$('button[type="submit"]');
    if (!submitButton) {
      return false;
    }

    const ariaDisabled = await submitButton.getAttribute("disabled");
    const ariaBusy = await submitButton.getAttribute("aria-busy");

    return ariaDisabled === "" || ariaBusy === "true";
  } catch {
    return false;
  }
}
