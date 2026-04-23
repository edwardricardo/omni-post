/**
 * @file global-teardown.ts
 * @description Tests for global teardown
 * @layer infrastructure
 */
import { FullConfig } from "@playwright/test";

/**
 * Global teardown for Playwright tests
 * Cleans up test data and environment
 */

async function globalTeardown(_config: FullConfig) {
  console.log("🧹 Starting E2E test environment cleanup...");

  try {
    // Clean up test data
    await cleanupTestData();

    // Clean up uploaded test files
    await cleanupTestFiles();

    console.log("✅ E2E test environment cleanup complete");
  } catch (error) {
    console.error("❌ Failed to cleanup E2E test environment:", error);
    // Don't throw to avoid failing the test run
  }
}

/**
 * Clean up test data from database
 */
async function cleanupTestData() {
  console.log("🗑️ Cleaning up test data...");

  try {
    const response = await fetch(
      `${process.env.API_BASE_URL || "http://localhost:3000"}/api/test/cleanup`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          environment: "e2e-test",
          preserveUsers: false, // Clean up test users too
        }),
      }
    );

    if (response.ok) {
      console.log("✅ Test data cleaned up successfully");
    } else {
      console.warn("⚠️ Failed to clean up test data");
    }
  } catch (error) {
    console.warn("⚠️ Could not connect to API for cleanup:", error.message);
  }
}

/**
 * Clean up uploaded test files
 */
async function cleanupTestFiles() {
  console.log("📁 Cleaning up test files...");

  try {
    // Clean up any test media files uploaded during tests
    const response = await fetch(
      `${process.env.API_BASE_URL || "http://localhost:3000"}/api/test/files/cleanup`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          environment: "e2e-test",
          olderThan: new Date(Date.now() - 24 * 60 * 60 * 1000), // Older than 24 hours
        }),
      }
    );

    if (response.ok) {
      console.log("✅ Test files cleaned up successfully");
    } else {
      console.warn("⚠️ Failed to clean up test files");
    }
  } catch (error) {
    console.warn("⚠️ Could not connect to API for file cleanup:", error.message);
  }
}

export default globalTeardown;
