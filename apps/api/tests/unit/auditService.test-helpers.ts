/**
 * @file auditService.test-helpers.ts
 * @description Shared constants for audit service unit tests.
 *              Provides test user IDs and data used across all audit test files.
 *              No database dependency — all data is in-memory.
 * @layer infrastructure
 */

/** Test user 1 — ADMIN role */
export const TEST_USER_1_ID = "audit-test-user-001";

/** Test user 2 — SUPPORT role */
export const TEST_USER_2_ID = "audit-test-user-002";

export const TEST_USER_1 = {
  id: TEST_USER_1_ID,
  email: "audit-test-user@example.com",
  name: "Audit Test User",
  role: "ADMIN" as const,
};

export const TEST_USER_2 = {
  id: TEST_USER_2_ID,
  email: "audit-test-user2@example.com",
  name: "Audit Test User 2",
  role: "SUPPORT" as const,
};
