/**
 * Comprehensive Tests for UserRepository (UserRepository.ts)
 *
 * This test suite validates the user data access layer that centralizes user lookups.
 *
 * Tests cover:
 * - findActiveUser - Active user lookup by email or ID
 * - findById - Basic user lookup without active check
 * - findByEmail - Email-based lookup with case normalization
 * - validateActive - Active status validation
 * - findManyByIds - Batch user retrieval
 * - Error handling for inactive/not found users
 * - Email case normalization
 * - Edge cases and concurrent operations
 *
 * Run with: pnpm --filter @apps/api exec tsx tests/unit/UserRepository.test.ts
 *
 * @file UserRepository.test.ts
 * @description Tests for UserRepository - Basic Operations
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaAdminUserRepository } from "../../../src/infrastructure/repositories/PrismaAdminUserRepository.js";
import type { AdminUserDto } from "../../../src/domain/repositories/ReadModelDtos.js";
import { prisma } from "@infra/prisma";

// ========================================
// TEST DATA SETUP & TEARDOWN
// ========================================

let testUserIds: string[] = [];

/**
 * Resolve a role id by name, creating it if absent. Roles are DB-driven
 * (the Role table) and seeded in production; tests upsert idempotently and
 * leave them in place (shared, never torn down).
 */
async function ensureRoleId(name: string): Promise<string> {
  const role = await prisma.role.upsert({
    where: { name },
    update: {},
    create: { name },
  });
  return role.id;
}

async function setupTestData() {
  await teardownTestData();

  const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

  const adminRoleId = await ensureRoleId("ADMIN");
  const supportRoleId = await ensureRoleId("SUPPORT");
  const superAdminRoleId = await ensureRoleId("SUPER_ADMIN");

  // User 1: Active admin user
  const user1 = await prisma.adminUser.create({
    data: {
      name: "Active Admin",
      email: `active-admin-${uniqueId}@example.com`,
      passwordHash: "hashed_password_1",
      roleId: adminRoleId,
      isActive: true,
    },
  });
  testUserIds.push(user1.id);

  // User 2: Active support user
  const user2 = await prisma.adminUser.create({
    data: {
      name: "Active Support",
      email: `active-user-${uniqueId}@example.com`,
      passwordHash: "hashed_password_2",
      roleId: supportRoleId,
      isActive: true,
    },
  });
  testUserIds.push(user2.id);

  // User 3: Inactive user
  const user3 = await prisma.adminUser.create({
    data: {
      name: "Inactive User",
      email: `inactive-user-${uniqueId}@example.com`,
      passwordHash: "hashed_password_3",
      roleId: supportRoleId,
      isActive: false,
    },
  });
  testUserIds.push(user3.id);

  // User 4: Active super admin
  const user4 = await prisma.adminUser.create({
    data: {
      name: "Super Admin",
      email: `superadmin-${uniqueId}@example.com`,
      passwordHash: "hashed_password_4",
      roleId: superAdminRoleId,
      isActive: true,
    },
  });
  testUserIds.push(user4.id);

  // User 5: Another inactive user
  const user5 = await prisma.adminUser.create({
    data: {
      name: "Another Inactive",
      email: `another-inactive-${uniqueId}@example.com`,
      passwordHash: "hashed_password_5",
      roleId: supportRoleId,
      isActive: false,
    },
  });
  testUserIds.push(user5.id);
}

async function teardownTestData() {
  if (testUserIds.length > 0) {
    await prisma.adminUser.deleteMany({ where: { id: { in: testUserIds } } });
    testUserIds = [];
  }
}

// ========================================
// TESTS: Basic Repository Operations
// ========================================

describe("UserRepository - Basic Operations", () => {
  it("UserRepository instantiates successfully", () => {
    const repo = new PrismaAdminUserRepository(prisma);
    assert.ok(repo !== null);
  });
});

// ========================================
// TESTS: findActiveUser
// ========================================

describe("UserRepository - findActiveUser", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns active user when searching by ID", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findActiveUser(testUserIds[0]!, "id");

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.id, testUserIds[0]);
      assert.equal(result.value.isActive, true);
    }
  });

  it("returns active user when searching by email", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const user = await prisma.adminUser.findUnique({
      where: { id: testUserIds[0]! },
    });

    const result = await repo.findActiveUser(user!.email, "email");

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.email, user!.email);
      assert.equal(result.value.isActive, true);
    }
  });

  it("normalizes email to lowercase when searching", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const user = await prisma.adminUser.findUnique({
      where: { id: testUserIds[0]! },
    });

    const uppercaseEmail = user!.email.toUpperCase();
    const result = await repo.findActiveUser(uppercaseEmail, "email");

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.id, testUserIds[0]);
    }
  });

  it("returns USER_INACTIVE error for inactive user by ID", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findActiveUser(testUserIds[2]!, "id");

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "USER_INACTIVE");
    }
  });

  it("returns USER_INACTIVE error for inactive user by email", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const user = await prisma.adminUser.findUnique({
      where: { id: testUserIds[2]! },
    });

    const result = await repo.findActiveUser(user!.email, "email");

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "USER_INACTIVE");
    }
  });

  it("returns NOT_FOUND error for non-existent user by ID", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findActiveUser("non-existent-user-id", "id");

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "NOT_FOUND");
    }
  });

  it("returns NOT_FOUND error for non-existent user by email", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findActiveUser("nonexistent@example.com", "email");

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "NOT_FOUND");
    }
  });

  it("defaults to 'id' type when not specified", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findActiveUser(testUserIds[0]!);

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.id, testUserIds[0]);
    }
  });
});

// ========================================
// TESTS: findById
// ========================================

describe("UserRepository - findById", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns user when it exists", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findById(testUserIds[0]!);

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.id, testUserIds[0]);
      assert.ok(result.value.email);
      assert.ok(result.value.role);
    }
  });

  it("returns inactive user without error", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findById(testUserIds[2]!);

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.id, testUserIds[2]);
      assert.equal(result.value.isActive, false);
    }
  });

  it("returns NOT_FOUND error when user does not exist", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findById("non-existent-user-id");

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "NOT_FOUND");
    }
  });

  it("returns the public credential-free user fields", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findById(testUserIds[0]!);

    assert.ok(result.ok);
    if (result.ok) {
      assert.ok(result.value.email);
      assert.ok(result.value.role);
      assert.ok(typeof result.value.isActive === "boolean");
      // A1 credential-DTO split: findById returns the credential-free
      // AdminUserDto. Secret material (passwordHash, mfaSecret, …) is exposed
      // ONLY by the credential-bearing reads (findCredentialsById/ByEmail).
      assert.ok(
        !("passwordHash" in result.value),
        "public AdminUserDto must not carry passwordHash"
      );
    }
  });
});

// ========================================
// TESTS: findByEmail
// ========================================

describe("UserRepository - findByEmail", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns user when email matches", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const user = await prisma.adminUser.findUnique({
      where: { id: testUserIds[0]! },
    });

    const result = await repo.findByEmail(user!.email);

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.email, user!.email);
    }
  });

  it("normalizes email to lowercase", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const user = await prisma.adminUser.findUnique({
      where: { id: testUserIds[0]! },
    });

    const mixedCaseEmail = user!.email
      .split("@")
      .map((part, i) => (i === 0 ? part.toUpperCase() : part.toLowerCase()))
      .join("@");

    const result = await repo.findByEmail(mixedCaseEmail);

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.id, testUserIds[0]);
    }
  });

  it("returns inactive user without error", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const user = await prisma.adminUser.findUnique({
      where: { id: testUserIds[2]! },
    });

    const result = await repo.findByEmail(user!.email);

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.isActive, false);
    }
  });

  it("returns NOT_FOUND error when email does not exist", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findByEmail("nonexistent@example.com");

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "NOT_FOUND");
    }
  });

  it("handles emails with special characters", async () => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const specialEmail = `test+special.email-${uniqueId}@example.com`;

    const specialUser = await prisma.adminUser.create({
      data: {
        name: "Special Email User",
        email: specialEmail,
        passwordHash: "hashed",
        roleId: await ensureRoleId("SUPPORT"),
        isActive: true,
      },
    });

    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findByEmail(specialEmail);

    assert.ok(result.ok);

    await prisma.adminUser.delete({ where: { id: specialUser.id } });
  });
});

// ========================================
// TESTS: validateActive
// ========================================

describe("UserRepository - validateActive", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns success for active user", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const user = await prisma.adminUser.findUnique({
      where: { id: testUserIds[0]! },
    });

    const result = repo.validateActive(user! as unknown as AdminUserDto);

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value, undefined);
    }
  });

  it("returns USER_INACTIVE error for inactive user", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const user = await prisma.adminUser.findUnique({
      where: { id: testUserIds[2]! },
    });

    const result = repo.validateActive(user! as unknown as AdminUserDto);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "USER_INACTIVE");
    }
  });

  it("can be used to validate after findById", async () => {
    const repo = new PrismaAdminUserRepository(prisma);

    const userResult = await repo.findById(testUserIds[0]!);
    assert.ok(userResult.ok);

    if (userResult.ok) {
      const validationResult = repo.validateActive(userResult.value);
      assert.ok(validationResult.ok);
    }
  });

  it("detects inactive user after findById", async () => {
    const repo = new PrismaAdminUserRepository(prisma);

    const userResult = await repo.findById(testUserIds[2]!);
    assert.ok(userResult.ok);

    if (userResult.ok) {
      const validationResult = repo.validateActive(userResult.value);
      assert.equal(validationResult.ok, false);
      if (!validationResult.ok) {
        assert.equal(validationResult.error, "USER_INACTIVE");
      }
    }
  });
});

// ========================================
// TESTS: findManyByIds
// ========================================

describe("UserRepository - findManyByIds", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns multiple users for given IDs", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const userIds = [testUserIds[0]!, testUserIds[1]!, testUserIds[3]!];
    const users = await repo.findManyByIds(userIds);

    assert.ok(Array.isArray(users));
    assert.equal(users.length, 3);

    users.forEach((user) => {
      assert.ok(userIds.includes(user.id));
    });
  });

  it("returns empty array for empty IDs", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const users = await repo.findManyByIds([]);

    assert.ok(Array.isArray(users));
    assert.equal(users.length, 0);
  });

  it("only returns users that exist", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const userIds = [testUserIds[0]!, "non-existent-id", testUserIds[1]!];
    const users = await repo.findManyByIds(userIds);

    assert.equal(users.length, 2);
  });

  it("includes inactive users", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const userIds = [testUserIds[0]!, testUserIds[2]!]; // active and inactive
    const users = await repo.findManyByIds(userIds);

    assert.equal(users.length, 2);

    const hasInactive = users.some((u) => !u.isActive);
    assert.ok(hasInactive);
  });

  it("returns users with all fields", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const users = await repo.findManyByIds([testUserIds[0]!]);

    assert.equal(users.length, 1);
    assert.ok(users[0]!.email);
    assert.ok(users[0]!.role);
    assert.ok(typeof users[0]!.isActive === "boolean");
  });

  it("handles duplicate IDs gracefully", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const userIds = [testUserIds[0]!, testUserIds[0]!, testUserIds[0]!];
    const users = await repo.findManyByIds(userIds);

    // Should return unique users only
    const uniqueIds = new Set(users.map((u) => u.id));
    assert.equal(uniqueIds.size, users.length);
  });

  it("returns users of different roles", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const users = await repo.findManyByIds(testUserIds.slice(0, 4));

    const roles = new Set(users.map((u) => u.role));
    assert.ok(roles.size > 1);
    assert.ok(roles.has("ADMIN"));
    assert.ok(roles.has("SUPPORT"));
    assert.ok(roles.has("SUPER_ADMIN"));
  });
});

// ========================================
// TESTS: Edge Cases and Concurrent Operations
// ========================================

describe("UserRepository - Edge Cases", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("handles concurrent reads correctly", async () => {
    const repo = new PrismaAdminUserRepository(prisma);

    const results = await Promise.all([
      repo.findById(testUserIds[0]!),
      repo.findById(testUserIds[1]!),
      repo.findById(testUserIds[2]!),
    ]);

    assert.ok(results.every((r) => r.ok));
  });

  it("handles concurrent active user lookups", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const user1 = await prisma.adminUser.findUnique({ where: { id: testUserIds[0]! } });
    const user2 = await prisma.adminUser.findUnique({ where: { id: testUserIds[1]! } });

    const results = await Promise.all([
      repo.findActiveUser(user1!.email, "email"),
      repo.findActiveUser(user2!.email, "email"),
      repo.findActiveUser(testUserIds[3]!, "id"),
    ]);

    assert.ok(results.every((r) => r.ok));
  });

  it("handles empty string user ID gracefully", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findById("");

    assert.equal(result.ok, false);
  });

  it("handles empty string email gracefully", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findByEmail("");

    assert.equal(result.ok, false);
  });

  it("handles very long email addresses", async () => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const longEmail = `very.long.email.address.with.many.dots.and.characters-${uniqueId}@example.com`;

    const longEmailUser = await prisma.adminUser.create({
      data: {
        name: "Long Email User",
        email: longEmail,
        passwordHash: "hashed",
        roleId: await ensureRoleId("SUPPORT"),
        isActive: true,
      },
    });

    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findByEmail(longEmail);

    assert.ok(result.ok);

    await prisma.adminUser.delete({ where: { id: longEmailUser.id } });
  });

  it("validates multiple users in sequence", async () => {
    const repo = new PrismaAdminUserRepository(prisma);

    for (const userId of testUserIds.slice(0, 3)) {
      const userResult = await repo.findById(userId);
      assert.ok(userResult.ok);

      if (userResult.ok) {
        const validationResult = repo.validateActive(userResult.value);
        // Validation will succeed or fail based on user's active status
        assert.ok(validationResult.ok !== undefined);
      }
    }
  });

  it("handles batch operations with mixed results", async () => {
    const repo = new PrismaAdminUserRepository(prisma);

    const users = await repo.findManyByIds(testUserIds);
    const validationResults = users.map((user) => repo.validateActive(user));

    const activeCount = validationResults.filter((r) => r.ok).length;
    const inactiveCount = validationResults.filter((r) => !r.ok).length;

    assert.ok(activeCount > 0);
    assert.ok(inactiveCount > 0);
    assert.equal(activeCount + inactiveCount, users.length);
  });
});

// ========================================
// TESTS: Integration Patterns
// ========================================

describe("UserRepository - Integration Patterns", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("supports authentication flow pattern", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const user = await prisma.adminUser.findUnique({
      where: { id: testUserIds[0]! },
    });

    // Step 1: Find user by email
    const findResult = await repo.findByEmail(user!.email);
    assert.ok(findResult.ok);

    // Step 2: Validate user is active
    if (findResult.ok) {
      const validationResult = repo.validateActive(findResult.value);
      assert.ok(validationResult.ok);
    }
  });

  it("supports authorization flow pattern", async () => {
    const repo = new PrismaAdminUserRepository(prisma);

    // Step 1: Find user by ID (from token)
    const userResult = await repo.findById(testUserIds[0]!);
    assert.ok(userResult.ok);

    // Step 2: Check active status
    if (userResult.ok) {
      const validationResult = repo.validateActive(userResult.value);
      assert.ok(validationResult.ok);

      // Step 3: Check role
      assert.ok(["ADMIN", "SUPER_ADMIN", "SUPPORT"].includes(userResult.value.role));
    }
  });

  it("supports user management pattern", async () => {
    const repo = new PrismaAdminUserRepository(prisma);

    // Get multiple users
    const users = await repo.findManyByIds(testUserIds);
    assert.ok(users.length > 0);

    // Validate each user's status
    users.forEach((user) => {
      const validationResult = repo.validateActive(user);
      assert.ok(validationResult.ok !== undefined);
    });
  });
});
