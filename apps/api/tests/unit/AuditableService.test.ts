#!/usr/bin/env tsx
/**
 * Unit Tests for AuditableService
 * Testing audit logging functionality with database integration
 *
 * Uses node:test and node:assert for standard Node.js testing
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  AuditableService,
  type UserActionOptions,
  type AccountActionOptions,
  type ResourceActionOptions,
} from "../../src/services/AuditableService.js";
import { prisma } from "@infra/prisma";

// Test implementation of AuditableService
class TestAuditableService extends AuditableService {
  constructor() {
    super("TestAuditableService");
  }

  // Expose protected methods for testing
  public async testLogUserAction(userId: string, options: UserActionOptions) {
    return this.logUserAction(userId, options);
  }

  public async testLogAccountAction(userId: string, options: AccountActionOptions) {
    return this.logAccountAction(userId, options);
  }

  public async testLogResourceAction(userId: string, options: ResourceActionOptions) {
    return this.logResourceAction(userId, options);
  }

  public async testExecuteWithAudit<T>(
    context: { operation: string; userId?: string; accountId?: string },
    auditOptions: {
      action: string;
      category:
        | "AUTHENTICATION"
        | "ACCOUNT"
        | "DATA"
        | "DATA_ACCESS"
        | "SECURITY"
        | "COMPLIANCE"
        | "SYSTEM";
      resourceType?: string;
      resourceId?: string;
      severity?: "LOW" | "INFO" | "MEDIUM" | "HIGH" | "CRITICAL";
    },
    operation: () => Promise<T>
  ) {
    return this.executeWithAudit(context, auditOptions, operation);
  }
}

describe("AuditableService", () => {
  let testUserId: string;
  let testAccountId: string;
  const timestamp = Date.now();

  // Setup test data before all tests
  before(async () => {
    // Create test user with unique email
    const testUser = await prisma.adminUser.create({
      data: {
        email: `auditable-test-${timestamp}@example.com`,
        passwordHash: "test-hash",
        name: "AuditableService Test User",
        emailVerified: true,
      },
    });
    testUserId = testUser.id;

    // Create test account with unique email
    const testAccount = await prisma.account.create({
      data: {
        name: `Test Account ${timestamp}`,
        email: `auditable-account-${timestamp}@example.com`,
        subscription: "BASIC",
      },
    });
    testAccountId = testAccount.id;
  });

  // Cleanup test data after all tests
  after(async () => {
    // Delete all audit logs created during tests
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: testUserId },
          { resourceId: { in: [`post-${timestamp}-123`, `post-${timestamp}-456`] } },
        ],
      },
    });

    // Delete test account
    await prisma.account.delete({
      where: { id: testAccountId },
    });

    // Delete test user
    await prisma.adminUser.delete({
      where: { id: testUserId },
    });
  });

  it("logUserAction - creates audit log with correct data", async () => {
    const service = new TestAuditableService();

    // Execute user action logging
    await service.testLogUserAction(testUserId, {
      action: "USER_LOGIN",
      category: "AUTHENTICATION",
      severity: "INFO",
      details: { method: "password" },
      ipAddress: "192.168.1.1",
      userAgent: "Mozilla/5.0",
    });

    // Verify audit log was created with correct data
    const userActionLog = await prisma.auditLog.findFirst({
      where: {
        userId: testUserId,
        action: "USER_LOGIN",
      },
      orderBy: { createdAt: "desc" },
    });

    assert.ok(userActionLog, "Audit log should be created");
    assert.strictEqual(userActionLog.action, "USER_LOGIN", "Action should match");
    assert.strictEqual(userActionLog.userId, testUserId, "User ID should match");
    assert.strictEqual(userActionLog.ipAddress, "192.168.1.1", "IP address should match");
    assert.strictEqual(userActionLog.userAgent, "Mozilla/5.0", "User agent should match");
    assert.strictEqual(userActionLog.success, true, "Success should be true");

    // Verify details structure (category, severity, and custom fields stored in details)
    assert.ok(userActionLog.details, "Details should exist");
    assert.strictEqual(typeof userActionLog.details, "object", "Details should be object");

    const details = userActionLog.details as Record<string, unknown>;
    assert.strictEqual(details.category, "AUTHENTICATION", "Category should be in details");
    assert.strictEqual(details.severity, "INFO", "Severity should be in details");
    assert.strictEqual(details.method, "password", "Custom method field should be in details");
  });

  it("logAccountAction - creates account-level audit log", async () => {
    const service = new TestAuditableService();

    // Execute account action logging
    await service.testLogAccountAction(testUserId, {
      accountId: testAccountId,
      action: "SUBSCRIPTION_UPGRADE",
      category: "ACCOUNT",
      severity: "HIGH",
      details: { from: "BASIC", to: "PRO" },
    });

    // Verify audit log was created
    const accountActionLog = await prisma.auditLog.findFirst({
      where: {
        userId: testUserId,
        action: "SUBSCRIPTION_UPGRADE",
      },
      orderBy: { createdAt: "desc" },
    });

    assert.ok(accountActionLog, "Account audit log should be created");
    assert.strictEqual(accountActionLog.action, "SUBSCRIPTION_UPGRADE", "Action should match");
    assert.strictEqual(accountActionLog.userId, testUserId, "User ID should match");
    assert.strictEqual(accountActionLog.success, true, "Success should be true");

    // Verify details structure (accountId is stored in details, not as direct field)
    assert.ok(accountActionLog.details, "Details should exist");
    const details = accountActionLog.details as Record<string, unknown>;
    assert.strictEqual(details.category, "ACCOUNT", "Category should be in details");
    assert.strictEqual(details.severity, "HIGH", "Severity should be in details");
    assert.strictEqual(details.from, "BASIC", "From subscription should be in details");
    assert.strictEqual(details.to, "PRO", "To subscription should be in details");
  });

  it("logResourceAction - creates resource-level audit log", async () => {
    const service = new TestAuditableService();
    const resourceId = `resource-${timestamp}-create`;

    // Execute resource action logging
    await service.testLogResourceAction(testUserId, {
      accountId: testAccountId,
      action: "RESOURCE_CREATE",
      category: "DATA",
      resourceType: "Post",
      resourceId,
      severity: "LOW",
      details: { title: "Test Post", status: "DRAFT" },
    });

    // Verify audit log was created
    const resourceLog = await prisma.auditLog.findFirst({
      where: {
        userId: testUserId,
        action: "RESOURCE_CREATE",
        resource: "Post",
        resourceId,
      },
      orderBy: { createdAt: "desc" },
    });

    assert.ok(resourceLog, "Resource audit log should be created");
    assert.strictEqual(resourceLog.action, "RESOURCE_CREATE", "Action should match");
    assert.strictEqual(resourceLog.userId, testUserId, "User ID should match");
    assert.strictEqual(resourceLog.resource, "Post", "Resource type should match");
    assert.strictEqual(resourceLog.resourceId, resourceId, "Resource ID should match");
    assert.strictEqual(resourceLog.success, true, "Success should be true");

    // Verify details
    assert.ok(resourceLog.details, "Details should exist");
    const details = resourceLog.details as Record<string, unknown>;
    assert.strictEqual(details.category, "DATA", "Category should be in details");
    assert.strictEqual(details.severity, "LOW", "Severity should be in details");
    assert.strictEqual(details.title, "Test Post", "Title should be in details");
    assert.strictEqual(details.status, "DRAFT", "Status should be in details");

    // Cleanup this specific resource log
    await prisma.auditLog.deleteMany({
      where: { resourceId },
    });
  });

  it("executeWithAudit - logs successful operation", async () => {
    const service = new TestAuditableService();

    // Execute operation with audit logging
    const result = await service.testExecuteWithAudit(
      {
        operation: "testOperation",
        userId: testUserId,
        accountId: testAccountId,
      },
      {
        action: "DATA_CREATE",
        category: "DATA",
        resourceType: "Post",
        resourceId: `post-${timestamp}-123`,
        severity: "LOW",
      },
      async () => {
        return { success: true, data: "test data" };
      }
    );

    // Verify operation result
    assert.deepStrictEqual(
      result,
      { success: true, data: "test data" },
      "Operation should return correct result"
    );

    // Verify success audit log was created
    const successLog = await prisma.auditLog.findFirst({
      where: {
        userId: testUserId,
        action: "DATA_CREATE",
        resource: "Post",
        resourceId: `post-${timestamp}-123`,
      },
      orderBy: { createdAt: "desc" },
    });

    assert.ok(successLog, "Success audit log should be created");
    assert.strictEqual(successLog.action, "DATA_CREATE", "Action should match");
    assert.strictEqual(successLog.userId, testUserId, "User ID should match");
    assert.strictEqual(successLog.resource, "Post", "Resource type should match");
    assert.strictEqual(successLog.resourceId, `post-${timestamp}-123`, "Resource ID should match");
    assert.strictEqual(successLog.success, true, "Success should be true");

    // Verify details contain operation metadata
    assert.ok(successLog.details, "Details should exist");
    const details = successLog.details as Record<string, unknown>;
    assert.strictEqual(details.operation, "testOperation", "Operation name should be in details");
    assert.strictEqual(details.success, true, "Success flag should be in details");
    assert.ok(typeof details.durationMs === "number", "Duration should be a number");
    assert.ok(details.durationMs >= 0, "Duration should be non-negative");
  });

  it("executeWithAudit - logs failed operation with HIGH severity", async () => {
    const service = new TestAuditableService();

    // Execute failing operation with audit logging
    await assert.rejects(
      async () => {
        await service.testExecuteWithAudit(
          {
            operation: "failOperation",
            userId: testUserId,
            accountId: testAccountId,
          },
          {
            action: "DATA_UPDATE",
            category: "DATA",
            resourceType: "Post",
            resourceId: `post-${timestamp}-456`,
          },
          async () => {
            throw new Error("Test error");
          }
        );
      },
      {
        name: "Error",
        message: "Test error",
      },
      "Operation should throw error"
    );

    // Verify failure audit log was created
    const failureLog = await prisma.auditLog.findFirst({
      where: {
        userId: testUserId,
        action: "DATA_UPDATE",
        resource: "Post",
        resourceId: `post-${timestamp}-456`,
      },
      orderBy: { createdAt: "desc" },
    });

    assert.ok(failureLog, "Failure audit log should be created");
    assert.strictEqual(failureLog.action, "DATA_UPDATE", "Action should match");
    assert.strictEqual(failureLog.userId, testUserId, "User ID should match");
    assert.strictEqual(failureLog.resource, "Post", "Resource type should match");
    assert.strictEqual(failureLog.resourceId, `post-${timestamp}-456`, "Resource ID should match");

    // Note: success field in database might be true by default, but details.success should be false
    assert.ok(failureLog.details, "Details should exist");
    const details = failureLog.details as Record<string, unknown>;
    assert.strictEqual(details.operation, "failOperation", "Operation name should be in details");
    assert.strictEqual(details.success, false, "Success flag should be false in details");
    assert.strictEqual(details.error, "Test error", "Error message should be in details");
    assert.strictEqual(details.severity, "HIGH", "Failed operations should have HIGH severity");
    assert.ok(typeof details.durationMs === "number", "Duration should be a number");
    assert.ok(details.durationMs >= 0, "Duration should be non-negative");
  });

  it("handles NULL vs undefined correctly in optional fields", async () => {
    const service = new TestAuditableService();

    // Test with undefined optional fields (should not be included)
    await service.testLogUserAction(testUserId, {
      action: "USER_ACTION_NO_OPTIONAL",
      category: "AUTHENTICATION",
      // ipAddress and userAgent intentionally omitted
    });

    const logWithoutOptional = await prisma.auditLog.findFirst({
      where: {
        userId: testUserId,
        action: "USER_ACTION_NO_OPTIONAL",
      },
      orderBy: { createdAt: "desc" },
    });

    assert.ok(logWithoutOptional, "Log should be created");
    // Prisma returns null for missing optional fields
    assert.strictEqual(logWithoutOptional.ipAddress, null, "IP address should be null");
    assert.strictEqual(logWithoutOptional.userAgent, null, "User agent should be null");

    // Test with provided optional fields
    await service.testLogUserAction(testUserId, {
      action: "USER_ACTION_WITH_OPTIONAL",
      category: "AUTHENTICATION",
      ipAddress: "10.0.0.1",
      userAgent: "TestAgent/1.0",
    });

    const logWithOptional = await prisma.auditLog.findFirst({
      where: {
        userId: testUserId,
        action: "USER_ACTION_WITH_OPTIONAL",
      },
      orderBy: { createdAt: "desc" },
    });

    assert.ok(logWithOptional, "Log should be created");
    assert.strictEqual(logWithOptional.ipAddress, "10.0.0.1", "IP address should be set");
    assert.strictEqual(logWithOptional.userAgent, "TestAgent/1.0", "User agent should be set");

    // Cleanup
    await prisma.auditLog.deleteMany({
      where: {
        action: { in: ["USER_ACTION_NO_OPTIONAL", "USER_ACTION_WITH_OPTIONAL"] },
      },
    });
  });

  it("stores complex details in JSON field", async () => {
    const service = new TestAuditableService();

    const complexDetails = {
      nested: {
        field: "value",
        array: [1, 2, 3],
      },
      boolean: true,
      number: 42,
      nullValue: null,
    };

    await service.testLogUserAction(testUserId, {
      action: "USER_ACTION_COMPLEX_DETAILS",
      category: "AUTHENTICATION",
      details: complexDetails,
    });

    const logWithComplexDetails = await prisma.auditLog.findFirst({
      where: {
        userId: testUserId,
        action: "USER_ACTION_COMPLEX_DETAILS",
      },
      orderBy: { createdAt: "desc" },
    });

    assert.ok(logWithComplexDetails, "Log should be created");
    assert.ok(logWithComplexDetails.details, "Details should exist");

    const retrievedDetails = logWithComplexDetails.details as Record<string, unknown>;

    // Verify nested structure is preserved (note: category and severity are added)
    assert.ok(retrievedDetails.nested, "Nested field should exist");
    const nested = retrievedDetails.nested as Record<string, unknown>;
    assert.strictEqual(nested.field, "value", "Nested field value should match");
    assert.deepStrictEqual(nested.array, [1, 2, 3], "Nested array should match");
    assert.strictEqual(retrievedDetails.boolean, true, "Boolean should match");
    assert.strictEqual(retrievedDetails.number, 42, "Number should match");
    assert.strictEqual(retrievedDetails.nullValue, null, "Null value should be preserved");

    // Cleanup
    await prisma.auditLog.deleteMany({
      where: { action: "USER_ACTION_COMPLEX_DETAILS" },
    });
  });

  it("handles audit logging failure gracefully without throwing", async () => {
    const service = new TestAuditableService();

    // Test that audit logging failures don't throw and are logged to console
    // This tests the try-catch in writeAuditLog that prevents failures from breaking operations
    // Since there's a foreign key constraint, this will fail but should be caught gracefully

    // The service should not throw even if the audit log creation fails
    await service.testLogUserAction("non-existent-user-id", {
      action: "TEST_GRACEFUL_FAILURE",
      category: "SYSTEM",
    });

    // The operation completes successfully even though the audit log failed
    // This demonstrates that audit failures don't break the main operation flow

    // Since the audit log failed due to FK constraint, it won't be in the database
    const log = await prisma.auditLog.findFirst({
      where: {
        action: "TEST_GRACEFUL_FAILURE",
      },
      orderBy: { createdAt: "desc" },
    });

    // The audit log should NOT exist because the FK constraint failed
    // But the important part is that the operation didn't throw
    assert.strictEqual(log, null, "Audit log should not be created due to FK constraint failure");

    // No cleanup needed since no log was created
  });
});
