/**
 * Test Utilities
 *
 * Shared utilities for integration and unit tests
 *
 * @file testUtils.ts
 * @description Tests for test utils
 * @layer infrastructure
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

/**
 * Check if API server is running and available
 * @returns Promise<boolean> - true if API is available
 */
export async function checkApiAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Skip test if API is not available (for integration tests)
 * Usage in test: await skipIfApiUnavailable(t);
 */
export async function skipIfApiUnavailable(t: any): Promise<void> {
  const available = await checkApiAvailable();
  if (!available) {
    t.skip("API not available - skipping integration test");
  }
}

/**
 * Get base URL for API tests
 */
export function getBaseUrl(): string {
  return BASE_URL;
}
