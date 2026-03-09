import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { AuditService, AuditActions, AuditResources } from "../../src/audit/auditService";
import {
  setupAuditTestUsers,
  teardownAuditTestData,
  testUserId,
} from "./auditService.test-helpers.js";

describe("AuditService - log() - Create Audit Logs", { concurrency: 1 }, () => {
  const auditService = new AuditService();

  before(async () => {
    await setupAuditTestUsers();
  });

  after(async () => {
    // Only clean up audit logs with the "TEST_" prefix created by this file.
    // The prefix also matches TEST_FILTER_ from the query test, but the query
    // test cleans its own data independently.
    await teardownAuditTestData("TEST_");
  });

  describe("Conditional Property Spreading - exactOptionalPropertyTypes", () => {
    it("should create minimal log with only required fields", async () => {
      const result = await auditService.log({
        action: "TEST_MINIMAL_ACTION",
      });

      assert.ok(result.ok, "Should successfully create minimal log");
      assert.strictEqual(result.value.action, "TEST_MINIMAL_ACTION");
      assert.strictEqual(result.value.userId, null);
      assert.strictEqual(result.value.resource, null);
      assert.strictEqual(result.value.resourceId, null);
      assert.strictEqual(result.value.details, null);
      assert.strictEqual(result.value.ipAddress, null);
      assert.strictEqual(result.value.userAgent, null);
      assert.strictEqual(result.value.success, true);
      assert.strictEqual(result.value.error, null);
    });

    it("should handle all optional fields when provided", async () => {
      const result = await auditService.log({
        userId: testUserId,
        action: AuditActions.USER_UPDATED,
        resource: AuditResources.USER,
        resourceId: testUserId,
        details: { field: "email", oldValue: "old@example.com", newValue: "new@example.com" },
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
        success: true,
      });

      assert.ok(result.ok);
      assert.strictEqual(result.value.userId, testUserId);
      assert.strictEqual(result.value.action, AuditActions.USER_UPDATED);
      assert.strictEqual(result.value.resource, AuditResources.USER);
      assert.strictEqual(result.value.resourceId, testUserId);
      assert.deepStrictEqual(result.value.details, {
        field: "email",
        oldValue: "old@example.com",
        newValue: "new@example.com",
      });
      assert.strictEqual(result.value.ipAddress, "192.168.1.1");
      assert.strictEqual(result.value.userAgent, "Mozilla/5.0");
      assert.strictEqual(result.value.success, true);
    });

    it("should handle error field when success=false", async () => {
      const result = await auditService.log({
        userId: testUserId,
        action: AuditActions.LOGIN_FAILED,
        success: false,
        error: "Invalid password",
      });

      assert.ok(result.ok);
      assert.strictEqual(result.value.success, false);
      assert.strictEqual(result.value.error, "Invalid password");
    });

    it("should default success to true when not specified", async () => {
      const result = await auditService.log({
        action: "TEST_DEFAULT_SUCCESS",
      });

      assert.ok(result.ok);
      assert.strictEqual(result.value.success, true);
    });

    it("should explicitly set success to false when provided", async () => {
      const result = await auditService.log({
        action: "TEST_EXPLICIT_FAILURE",
        success: false,
      });

      assert.ok(result.ok);
      assert.strictEqual(result.value.success, false);
    });
  });

  describe("User Association", () => {
    it("should include user details when userId is provided", async () => {
      const result = await auditService.log({
        userId: testUserId,
        action: AuditActions.POST_CREATED,
        resource: AuditResources.POST,
        resourceId: "post-123",
      });

      assert.ok(result.ok);
      assert.ok(result.value.user);
      assert.strictEqual(result.value.user.id, testUserId);
      assert.strictEqual(result.value.user.email, "audit-test-user@example.com");
      assert.strictEqual(result.value.user.name, "Audit Test User");
      assert.strictEqual(result.value.user.role, "ADMIN");
    });

    it("should handle logs without user association", async () => {
      const result = await auditService.log({
        action: AuditActions.SYSTEM_CONFIG_CHANGED,
        resource: AuditResources.SYSTEM,
      });

      assert.ok(result.ok);
      assert.strictEqual(result.value.userId, null);
      assert.strictEqual(result.value.user, null);
    });
  });

  describe("Complex Details Objects", () => {
    it("should preserve nested objects in details", async () => {
      const details = {
        changes: {
          profile: {
            name: { old: "Old Name", new: "New Name" },
            avatar: { old: null, new: "https://example.com/avatar.jpg" },
          },
          settings: {
            notifications: { old: false, new: true },
          },
        },
        timestamp: new Date().toISOString(),
      };

      const result = await auditService.log({
        userId: testUserId,
        action: "TEST_NESTED_DETAILS",
        details,
      });

      assert.ok(result.ok);
      assert.deepStrictEqual(result.value.details, details);
    });

    it("should handle arrays in details", async () => {
      const details = {
        permissions: ["read", "write", "delete"],
        removedRoles: ["moderator", "admin"],
      };

      const result = await auditService.log({
        action: "TEST_ARRAY_DETAILS",
        details,
      });

      assert.ok(result.ok);
      assert.deepStrictEqual(result.value.details, details);
    });
  });

  describe("AuditActions Constants", () => {
    it("should have all expected action constants", () => {
      assert.strictEqual(AuditActions.LOGIN, "LOGIN");
      assert.strictEqual(AuditActions.LOGOUT, "LOGOUT");
      assert.strictEqual(AuditActions.USER_CREATED, "USER_CREATED");
      assert.strictEqual(AuditActions.PERMISSION_DENIED, "PERMISSION_DENIED");
      assert.strictEqual(AuditActions.POST_PUBLISHED, "POST_PUBLISHED");
    });
  });

  describe("AuditResources Constants", () => {
    it("should have all expected resource constants", () => {
      assert.strictEqual(AuditResources.USER, "AdminUser");
      assert.strictEqual(AuditResources.ACCOUNT, "Account");
      assert.strictEqual(AuditResources.POST, "Post");
      assert.strictEqual(AuditResources.SYSTEM, "System");
    });
  });
});
