/**
 * @file global-setup.ts
 * @description Test setup for global setup
 * @layer infrastructure
 */
import { chromium, FullConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Global setup for Playwright tests
 * Handles authentication, database seeding, and environment preparation
 */

async function globalSetup(config: FullConfig) {
  console.log("🚀 Starting E2E test environment setup...");

  const { baseURL } = config.projects[0].use;

  // Create a browser instance for setup operations
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Wait for the application to be ready
    console.log("⏳ Waiting for application to be ready...");
    await page.goto(baseURL || "http://localhost:3200");
    await page.waitForLoadState("networkidle");

    // Setup test authentication tokens
    await setupAuthentication(page);

    // Seed test data if needed
    await seedTestData();

    console.log("✅ E2E test environment setup complete");
  } catch (error) {
    console.error("❌ Failed to setup E2E test environment:", error);
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

/**
 * Setup authentication for tests
 * Creates test user accounts and stores authentication tokens
 */
async function setupAuthentication(page: any) {
  console.log("🔐 Setting up test authentication...");

  // Create test user credentials
  const testUsers = [
    {
      email: "e2e-test-user@example.com",
      password: "Test123!@#",
      role: "user",
      storageFile: "test-user-auth.json",
    },
    {
      email: "e2e-admin-user@example.com",
      password: "Admin123!@#",
      role: "admin",
      storageFile: "test-admin-auth.json",
    },
  ];

  for (const user of testUsers) {
    try {
      // Navigate to login page
      await page.goto("/login");

      // Check if user exists by attempting login
      await page.fill('[data-testid="email-input"]', user.email);
      await page.fill('[data-testid="password-input"]', user.password);
      await page.click('[data-testid="login-button"]');

      // Wait for either dashboard (success) or error message
      await Promise.race([
        page.waitForURL("/dashboard", { timeout: 5000 }),
        page.waitForSelector('[data-testid="error-message"]', { timeout: 5000 }),
      ]);

      if (page.url().includes("/dashboard")) {
        // Login successful - save authentication state
        await page.context().storageState({
          path: path.join(__dirname, "../fixtures", user.storageFile),
        });
        console.log(`✅ Authentication saved for ${user.email}`);
      } else {
        // Login failed - user might not exist, attempt registration
        console.log(`ℹ️ User ${user.email} not found, skipping auth setup`);
      }

      // Logout for next user
      if (page.url().includes("/dashboard")) {
        await page.click('[data-testid="user-menu-trigger"]');
        await page.click('[data-testid="logout-button"]');
        await page.waitForURL("/login");
      }
    } catch (error) {
      console.warn(`⚠️ Could not setup auth for ${user.email}:`, error.message);
    }
  }
}

/**
 * Seed test data for E2E tests
 */
async function seedTestData() {
  console.log("🌱 Seeding test data...");

  try {
    // Call the API to seed test data
    const response = await fetch(
      `${process.env.API_BASE_URL || "http://localhost:3000"}/api/test/seed`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          environment: "e2e-test",
          users: 2,
          projects: 3,
          posts: 10,
          channels: 5,
        }),
      }
    );

    if (response.ok) {
      console.log("✅ Test data seeded successfully");
    } else {
      console.warn("⚠️ Failed to seed test data, tests will create their own data");
    }
  } catch (error) {
    console.warn("⚠️ Could not connect to API for seeding:", error.message);
  }
}

export default globalSetup;
