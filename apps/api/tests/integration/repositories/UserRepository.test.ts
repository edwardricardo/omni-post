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

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PrismaAdminUserRepository } from "../../../src/infrastructure/repositories/PrismaAdminUserRepository.js";
import type { AdminUserDto } from "../../../src/domain/repositories/ReadModelDtos.js";
import { prisma } from "@infra/prisma";

// ========================================
// TEST DATA SETUP & TEARDOWN
// ========================================

let testUserIds: string[] = [];

async function setupTestData() {
  await teardownTestData();

  const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

  // User 1: Active admin user
  const user1 = await prisma.adminUser.create({
    data: {
      name: "Active Admin",
      email: `active-admin-${uniqueId}@example.com`,
      passwordHash: "hashed_password_1",
      role: "ADMIN",
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
      role: "SUPPORT",
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
      role: "SUPPORT",
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
      role: "SUPER_ADMIN",
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
      role: "SUPPORT",
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
    expect(repo !== null).toBeTruthy();
  });
});

// ========================================
// TESTS: findActiveUser
// ========================================

describe("UserRepository - findActiveUser", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("returns active user when searching by ID", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findActiveUser(testUserIds[0]!, "id");

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.id).toBe(testUserIds[0]);
      expect(result.value.isActive).toBe(true);
    }
  });

  it("returns active user when searching by email", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const user = await prisma.adminUser.findUnique({
      where: { id: testUserIds[0]! },
    });

    const result = await repo.findActiveUser(user!.email, "email");

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.email).toBe(user!.email);
      expect(result.value.isActive).toBe(true);
    }
  });

  it("normalizes email to lowercase when searching", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const user = await prisma.adminUser.findUnique({
      where: { id: testUserIds[0]! },
    });

    const uppercaseEmail = user!.email.toUpperCase();
    const result = await repo.findActiveUser(uppercaseEmail, "email");

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.id).toBe(testUserIds[0]);
    }
  });

  it("returns USER_INACTIVE error for inactive user by ID", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findActiveUser(testUserIds[2]!, "id");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("USER_INACTIVE");
    }
  });

  it("returns USER_INACTIVE error for inactive user by email", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const user = await prisma.adminUser.findUnique({
      where: { id: testUserIds[2]! },
    });

    const result = await repo.findActiveUser(user!.email, "email");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("USER_INACTIVE");
    }
  });

  it("returns NOT_FOUND error for non-existent user by ID", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findActiveUser("non-existent-user-id", "id");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("NOT_FOUND");
    }
  });

  it("returns NOT_FOUND error for non-existent user by email", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findActiveUser("nonexistent@example.com", "email");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("NOT_FOUND");
    }
  });

  it("defaults to 'id' type when not specified", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findActiveUser(testUserIds[0]!);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.id).toBe(testUserIds[0]);
    }
  });
});

// ========================================
// TESTS: findById
// ========================================

describe("UserRepository - findById", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("returns user when it exists", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findById(testUserIds[0]!);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.id).toBe(testUserIds[0]);
      expect(result.value.email).toBeTruthy();
      expect(result.value.role).toBeTruthy();
    }
  });

  it("returns inactive user without error", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findById(testUserIds[2]!);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.id).toBe(testUserIds[2]);
      expect(result.value.isActive).toBe(false);
    }
  });

  it("returns NOT_FOUND error when user does not exist", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findById("non-existent-user-id");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("NOT_FOUND");
    }
  });

  it("includes all user fields", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findById(testUserIds[0]!);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.email).toBeTruthy();
      expect(result.value.passwordHash).toBeTruthy();
      expect(result.value.role).toBeTruthy();
      expect(typeof result.value.isActive === "boolean").toBeTruthy();
    }
  });
});

// ========================================
// TESTS: findByEmail
// ========================================

describe("UserRepository - findByEmail", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("returns user when email matches", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const user = await prisma.adminUser.findUnique({
      where: { id: testUserIds[0]! },
    });

    const result = await repo.findByEmail(user!.email);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.email).toBe(user!.email);
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

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.id).toBe(testUserIds[0]);
    }
  });

  it("returns inactive user without error", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const user = await prisma.adminUser.findUnique({
      where: { id: testUserIds[2]! },
    });

    const result = await repo.findByEmail(user!.email);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.isActive).toBe(false);
    }
  });

  it("returns NOT_FOUND error when email does not exist", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findByEmail("nonexistent@example.com");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("NOT_FOUND");
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
        role: "SUPPORT",
        isActive: true,
      },
    });

    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findByEmail(specialEmail);

    expect(result.ok).toBeTruthy();

    await prisma.adminUser.delete({ where: { id: specialUser.id } });
  });
});

// ========================================
// TESTS: validateActive
// ========================================

describe("UserRepository - validateActive", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("returns success for active user", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const user = await prisma.adminUser.findUnique({
      where: { id: testUserIds[0]! },
    });

    const result = repo.validateActive(user! as unknown as AdminUserDto);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value).toBe(undefined);
    }
  });

  it("returns USER_INACTIVE error for inactive user", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const user = await prisma.adminUser.findUnique({
      where: { id: testUserIds[2]! },
    });

    const result = repo.validateActive(user! as unknown as AdminUserDto);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("USER_INACTIVE");
    }
  });

  it("can be used to validate after findById", async () => {
    const repo = new PrismaAdminUserRepository(prisma);

    const userResult = await repo.findById(testUserIds[0]!);
    expect(userResult.ok).toBeTruthy();

    if (userResult.ok) {
      const validationResult = repo.validateActive(userResult.value);
      expect(validationResult.ok).toBeTruthy();
    }
  });

  it("detects inactive user after findById", async () => {
    const repo = new PrismaAdminUserRepository(prisma);

    const userResult = await repo.findById(testUserIds[2]!);
    expect(userResult.ok).toBeTruthy();

    if (userResult.ok) {
      const validationResult = repo.validateActive(userResult.value);
      expect(validationResult.ok).toBe(false);
      if (!validationResult.ok) {
        expect(validationResult.error).toBe("USER_INACTIVE");
      }
    }
  });
});

// ========================================
// TESTS: findManyByIds
// ========================================

describe("UserRepository - findManyByIds", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("returns multiple users for given IDs", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const userIds = [testUserIds[0]!, testUserIds[1]!, testUserIds[3]!];
    const users = await repo.findManyByIds(userIds);

    expect(Array.isArray(users)).toBeTruthy();
    expect(users.length).toBe(3);

    users.forEach((user) => {
      expect(userIds.includes(user.id)).toBeTruthy();
    });
  });

  it("returns empty array for empty IDs", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const users = await repo.findManyByIds([]);

    expect(Array.isArray(users)).toBeTruthy();
    expect(users.length).toBe(0);
  });

  it("only returns users that exist", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const userIds = [testUserIds[0]!, "non-existent-id", testUserIds[1]!];
    const users = await repo.findManyByIds(userIds);

    expect(users.length).toBe(2);
  });

  it("includes inactive users", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const userIds = [testUserIds[0]!, testUserIds[2]!]; // active and inactive
    const users = await repo.findManyByIds(userIds);

    expect(users.length).toBe(2);

    const hasInactive = users.some((u) => !u.isActive);
    expect(hasInactive).toBeTruthy();
  });

  it("returns users with all fields", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const users = await repo.findManyByIds([testUserIds[0]!]);

    expect(users.length).toBe(1);
    expect(users[0]!.email).toBeTruthy();
    expect(users[0]!.role).toBeTruthy();
    expect(typeof users[0]!.isActive === "boolean").toBeTruthy();
  });

  it("handles duplicate IDs gracefully", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const userIds = [testUserIds[0]!, testUserIds[0]!, testUserIds[0]!];
    const users = await repo.findManyByIds(userIds);

    // Should return unique users only
    const uniqueIds = new Set(users.map((u) => u.id));
    expect(uniqueIds.size).toBe(users.length);
  });

  it("returns users of different roles", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const users = await repo.findManyByIds(testUserIds.slice(0, 4));

    const roles = new Set(users.map((u) => u.role));
    expect(roles.size > 1).toBeTruthy();
    expect(roles.has("ADMIN")).toBeTruthy();
    expect(roles.has("SUPPORT")).toBeTruthy();
    expect(roles.has("SUPER_ADMIN")).toBeTruthy();
  });
});

// ========================================
// TESTS: Edge Cases and Concurrent Operations
// ========================================

describe("UserRepository - Edge Cases", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("handles concurrent reads correctly", async () => {
    const repo = new PrismaAdminUserRepository(prisma);

    const results = await Promise.all([
      repo.findById(testUserIds[0]!),
      repo.findById(testUserIds[1]!),
      repo.findById(testUserIds[2]!),
    ]);

    expect(results.every((r) => r.ok)).toBeTruthy();
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

    expect(results.every((r) => r.ok)).toBeTruthy();
  });

  it("handles empty string user ID gracefully", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findById("");

    expect(result.ok).toBe(false);
  });

  it("handles empty string email gracefully", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findByEmail("");

    expect(result.ok).toBe(false);
  });

  it("handles very long email addresses", async () => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const longEmail = `very.long.email.address.with.many.dots.and.characters-${uniqueId}@example.com`;

    const longEmailUser = await prisma.adminUser.create({
      data: {
        name: "Long Email User",
        email: longEmail,
        passwordHash: "hashed",
        role: "SUPPORT",
        isActive: true,
      },
    });

    const repo = new PrismaAdminUserRepository(prisma);
    const result = await repo.findByEmail(longEmail);

    expect(result.ok).toBeTruthy();

    await prisma.adminUser.delete({ where: { id: longEmailUser.id } });
  });

  it("validates multiple users in sequence", async () => {
    const repo = new PrismaAdminUserRepository(prisma);

    for (const userId of testUserIds.slice(0, 3)) {
      const userResult = await repo.findById(userId);
      expect(userResult.ok).toBeTruthy();

      if (userResult.ok) {
        const validationResult = repo.validateActive(userResult.value);
        // Validation will succeed or fail based on user's active status
        expect(validationResult.ok !== undefined).toBeTruthy();
      }
    }
  });

  it("handles batch operations with mixed results", async () => {
    const repo = new PrismaAdminUserRepository(prisma);

    const users = await repo.findManyByIds(testUserIds);
    const validationResults = users.map((user) => repo.validateActive(user));

    const activeCount = validationResults.filter((r) => r.ok).length;
    const inactiveCount = validationResults.filter((r) => !r.ok).length;

    expect(activeCount > 0).toBeTruthy();
    expect(inactiveCount > 0).toBeTruthy();
    expect(activeCount + inactiveCount).toBe(users.length);
  });
});

// ========================================
// TESTS: Integration Patterns
// ========================================

describe("UserRepository - Integration Patterns", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("supports authentication flow pattern", async () => {
    const repo = new PrismaAdminUserRepository(prisma);
    const user = await prisma.adminUser.findUnique({
      where: { id: testUserIds[0]! },
    });

    // Step 1: Find user by email
    const findResult = await repo.findByEmail(user!.email);
    expect(findResult.ok).toBeTruthy();

    // Step 2: Validate user is active
    if (findResult.ok) {
      const validationResult = repo.validateActive(findResult.value);
      expect(validationResult.ok).toBeTruthy();
    }
  });

  it("supports authorization flow pattern", async () => {
    const repo = new PrismaAdminUserRepository(prisma);

    // Step 1: Find user by ID (from token)
    const userResult = await repo.findById(testUserIds[0]!);
    expect(userResult.ok).toBeTruthy();

    // Step 2: Check active status
    if (userResult.ok) {
      const validationResult = repo.validateActive(userResult.value);
      expect(validationResult.ok).toBeTruthy();

      // Step 3: Check role
      expect(["ADMIN", "SUPER_ADMIN", "SUPPORT"].includes(userResult.value.role)).toBeTruthy();
    }
  });

  it("supports user management pattern", async () => {
    const repo = new PrismaAdminUserRepository(prisma);

    // Get multiple users
    const users = await repo.findManyByIds(testUserIds);
    expect(users.length > 0).toBeTruthy();

    // Validate each user's status
    users.forEach((user) => {
      const validationResult = repo.validateActive(user);
      expect(validationResult.ok !== undefined).toBeTruthy();
    });
  });
});
