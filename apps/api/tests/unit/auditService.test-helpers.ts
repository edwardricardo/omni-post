import { prisma } from "@infra/prisma";

export let testUserId: string;
export let testUser2Id: string;

/**
 * Create (or reuse) the two shared admin users used by all audit test files.
 * Uses upsert to avoid unique constraint conflicts when multiple
 * audit test files run concurrently.
 */
export async function setupAuditTestUsers(): Promise<void> {
  const user1 = await prisma.adminUser.upsert({
    where: { email: "audit-test-user@example.com" },
    update: {},
    create: {
      email: "audit-test-user@example.com",
      name: "Audit Test User",
      passwordHash: "hashed_password",
      role: "ADMIN",
    },
  });
  testUserId = user1.id;

  const user2 = await prisma.adminUser.upsert({
    where: { email: "audit-test-user2@example.com" },
    update: {},
    create: {
      email: "audit-test-user2@example.com",
      name: "Audit Test User 2",
      passwordHash: "hashed_password",
      role: "SUPPORT",
    },
  });
  testUser2Id = user2.id;
}

/**
 * Clean up audit logs created by a specific test file, identified by action prefix.
 * Each audit test file uses a distinct prefix (e.g. "TEST_", "TEST_FILTER_", "STATS_")
 * so concurrent teardowns do not interfere with each other.
 *
 * Does NOT delete the shared admin users or disconnect Prisma -- those are
 * shared resources that may still be in use by other concurrent test files.
 */
export async function teardownAuditTestData(actionPrefix: string): Promise<void> {
  try {
    await prisma.auditLog.deleteMany({
      where: {
        action: { startsWith: actionPrefix },
      },
    });
  } catch (err) {
    console.warn("Teardown warning:", err);
  }
}

/**
 * @deprecated Use teardownAuditTestData(actionPrefix) instead.
 * Kept for backward compatibility -- cleans all audit test data and users.
 * Only call this when you are certain no other audit test file is running.
 */
export async function teardownAuditTestUsers(): Promise<void> {
  try {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          ...(testUserId ? [{ userId: testUserId }] : []),
          ...(testUser2Id ? [{ userId: testUser2Id }] : []),
          { action: { startsWith: "TEST_" } },
          { action: { startsWith: "STATS_" } },
          { resource: "TEST_RESOURCE" },
        ],
      },
    });
    await prisma.adminUser.deleteMany({
      where: {
        email: {
          in: ["audit-test-user@example.com", "audit-test-user2@example.com"],
        },
      },
    });
  } catch (err) {
    console.warn("Teardown warning:", err);
  }
}
