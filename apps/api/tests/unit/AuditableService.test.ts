/**
 * @file AuditableService.test.ts
 * @description Unit tests for the AuditableService base class after the prisma→DI
 *              migration. It must persist audit entries through the injected
 *              AuditLogRepository port (never a Prisma singleton), fold
 *              category/severity into details, record success/failure via
 *              executeWithAudit, delegate reads to the port, isolate write
 *              failures from the caller, and — via logSystemAction — write system
 *              actions with NO userId so the nullable AuditLog.userId FK is
 *              honoured (a sentinel "system" string would violate the FK and the
 *              write would be silently dropped).
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect, vi } from "vitest";

import { InMemoryAuditLogRepository } from "./helpers/InMemoryAuditLogRepository.js";
import {
  AuditableService,
  type AccountActionOptions,
  type ResourceActionOptions,
  type UserActionOptions,
  type AuditLogEntry,
} from "../../src/services/AuditableService.js";
import type { AuditLogRepository } from "@core/domain/repositories/AuditLogRepository.js";

/**
 * Concrete subclass that surfaces the protected audit helpers for testing.
 */
class TestAuditableService extends AuditableService {
  constructor(auditLog: AuditLogRepository) {
    super("TestAuditableService", auditLog);
  }
  logUser(userId: string, options: UserActionOptions): Promise<void> {
    return this.logUserAction(userId, options);
  }
  logAccount(userId: string, options: AccountActionOptions): Promise<void> {
    return this.logAccountAction(userId, options);
  }
  logResource(userId: string, options: ResourceActionOptions): Promise<void> {
    return this.logResourceAction(userId, options);
  }
  logSystem(options: AccountActionOptions): Promise<void> {
    return this.logSystemAction(options);
  }
  writeRaw(entry: AuditLogEntry): Promise<void> {
    return this.writeAuditLog(entry);
  }
  runWithAudit<T>(
    context: { operation: string; userId?: string; accountId?: string },
    auditOptions: {
      action: string;
      category: AuditLogEntry["category"];
      resourceType?: string;
      resourceId?: string;
      severity?: AuditLogEntry["severity"];
    },
    operation: () => Promise<T>
  ): Promise<T> {
    return this.executeWithAudit(context, auditOptions, operation);
  }
  readByUser(userId: string): Promise<unknown[]> {
    return this.getUserAuditLogs(userId);
  }
  readByResource(resource: string, resourceId: string): Promise<unknown[]> {
    return this.getResourceAuditLogs(resource, resourceId);
  }
}

describe("AuditableService", () => {
  let repo: InMemoryAuditLogRepository;
  let service: TestAuditableService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new InMemoryAuditLogRepository();
    service = new TestAuditableService(repo);
  });

  describe("logUserAction", () => {
    it("persists the entry through the port with category/severity folded into details", async () => {
      await service.logUser("user-1", {
        action: "USER_LOGIN",
        category: "AUTHENTICATION",
        severity: "INFO",
        details: { method: "password" },
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
      });

      expect(repo.rows).toHaveLength(1);
      const row = repo.rows[0]!;
      expect(row.action).toBe("USER_LOGIN");
      expect(row.userId).toBe("user-1");
      expect(row.ipAddress).toBe("192.168.1.1");
      expect(row.userAgent).toBe("Mozilla/5.0");
      expect(row.success).toBe(true);
      const details = row.details as Record<string, unknown>;
      expect(details.category).toBe("AUTHENTICATION");
      expect(details.severity).toBe("INFO");
      expect(details.method).toBe("password");
    });

    it("omits optional fields when undefined and includes them when provided", async () => {
      await service.logUser("user-1", { action: "NO_OPTIONAL", category: "AUTHENTICATION" });
      await service.logUser("user-1", {
        action: "WITH_OPTIONAL",
        category: "AUTHENTICATION",
        ipAddress: "10.0.0.1",
        userAgent: "TestAgent/1.0",
      });

      const without = repo.rows.find((r) => r.action === "NO_OPTIONAL")!;
      expect(without.ipAddress).toBe(null);
      expect(without.userAgent).toBe(null);
      const withOpt = repo.rows.find((r) => r.action === "WITH_OPTIONAL")!;
      expect(withOpt.ipAddress).toBe("10.0.0.1");
      expect(withOpt.userAgent).toBe("TestAgent/1.0");
    });

    it("preserves complex nested details verbatim", async () => {
      await service.logUser("user-1", {
        action: "COMPLEX",
        category: "AUTHENTICATION",
        details: { nested: { field: "value", array: [1, 2, 3] }, boolean: true, number: 42 },
      });

      const details = repo.rows[0]!.details as Record<string, unknown>;
      const nested = details.nested as Record<string, unknown>;
      expect(nested.field).toBe("value");
      expect(nested.array).toStrictEqual([1, 2, 3]);
      expect(details.boolean).toBe(true);
      expect(details.number).toBe(42);
    });
  });

  describe("logAccountAction", () => {
    it("records the acting user for an account-level action", async () => {
      await service.logAccount("admin-1", {
        accountId: "acc-1",
        action: "SUBSCRIPTION_UPGRADE",
        category: "ACCOUNT",
        severity: "HIGH",
        details: { from: "BASIC", to: "PRO" },
      });

      const row = repo.rows[0]!;
      expect(row.userId).toBe("admin-1");
      expect(row.action).toBe("SUBSCRIPTION_UPGRADE");
      const details = row.details as Record<string, unknown>;
      expect(details.category).toBe("ACCOUNT");
      expect(details.from).toBe("BASIC");
    });
  });

  describe("logResourceAction", () => {
    it("maps resourceType to the resource column with resourceId", async () => {
      await service.logResource("user-1", {
        accountId: "acc-1",
        action: "RESOURCE_CREATE",
        category: "DATA",
        resourceType: "Post",
        resourceId: "post-1",
        severity: "LOW",
        details: { title: "Test Post" },
      });

      const row = repo.rows[0]!;
      expect(row.resource).toBe("Post");
      expect(row.resourceId).toBe("post-1");
      expect((row.details as Record<string, unknown>).title).toBe("Test Post");
    });
  });

  describe("logSystemAction (FK fix)", () => {
    it("writes a system action with a null userId instead of a sentinel string", async () => {
      await service.logSystem({
        accountId: "acc-1",
        action: "AUTO_RENEWAL",
        category: "BILLING",
        severity: "MEDIUM",
        details: { amount: 199 },
      });

      expect(repo.rows).toHaveLength(1);
      const row = repo.rows[0]!;
      // The whole point: no "system" string that would violate the AdminUser FK.
      expect(row.userId).toBe(null);
      expect(row.action).toBe("AUTO_RENEWAL");
      const details = row.details as Record<string, unknown>;
      expect(details.category).toBe("BILLING");
      expect(details.amount).toBe(199);
    });
  });

  describe("executeWithAudit", () => {
    it("returns the operation result and logs a success entry with operation metadata", async () => {
      const result = await service.runWithAudit(
        { operation: "testOperation", userId: "user-1", accountId: "acc-1" },
        { action: "DATA_CREATE", category: "DATA", resourceType: "Post", resourceId: "post-1" },
        async () => ({ ok: true })
      );

      expect(result).toStrictEqual({ ok: true });
      const row = repo.rows.find((r) => r.action === "DATA_CREATE")!;
      expect(row).toBeTruthy();
      expect(row.resource).toBe("Post");
      expect(row.resourceId).toBe("post-1");
      const details = row.details as Record<string, unknown>;
      expect(details.operation).toBe("testOperation");
      expect(details.success).toBe(true);
      expect(typeof details.durationMs).toBe("number");
    });

    it("rethrows on failure and logs a HIGH-severity failure entry", async () => {
      await expect(
        service.runWithAudit(
          { operation: "failOperation", userId: "user-1" },
          { action: "DATA_UPDATE", category: "DATA", resourceType: "Post", resourceId: "post-2" },
          async () => {
            throw new Error("Test error");
          }
        )
      ).rejects.toThrow("Test error");

      const row = repo.rows.find((r) => r.action === "DATA_UPDATE")!;
      expect(row).toBeTruthy();
      const details = row.details as Record<string, unknown>;
      expect(details.operation).toBe("failOperation");
      expect(details.success).toBe(false);
      expect(details.error).toBe("Test error");
      expect(details.severity).toBe("HIGH");
    });
  });

  describe("read delegation", () => {
    it("delegates getUserAuditLogs to the port's findByUser", async () => {
      await service.logUser("user-1", { action: "A", category: "DATA" });
      await service.logUser("user-2", { action: "B", category: "DATA" });

      const rows = (await service.readByUser("user-1")) as Array<{ userId: string | null }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.userId).toBe("user-1");
    });

    it("delegates getResourceAuditLogs to the port's findByResource", async () => {
      await service.logResource("user-1", {
        accountId: "acc-1",
        action: "RESOURCE_UPDATE",
        category: "DATA",
        resourceType: "Channel",
        resourceId: "ch-1",
      });

      const rows = (await service.readByResource("Channel", "ch-1")) as unknown[];
      expect(rows).toHaveLength(1);
    });
  });

  describe("failure isolation", () => {
    it("does not throw when the audit write fails (audit must not break the caller)", async () => {
      const create = vi.fn(async () => {
        throw new Error("db down");
      });
      const failing: AuditLogRepository = {
        create,
        findByUser: async () => [],
        findByResource: async () => [],
        anonymizeUser: async () => 0,
      };
      const svc = new TestAuditableService(failing);

      await expect(
        svc.logUser("user-1", { action: "USER_LOGIN", category: "AUTHENTICATION" })
      ).resolves.toBeUndefined();
      // The write was attempted (and swallowed), so the caller is shielded.
      expect(create).toHaveBeenCalledTimes(1);
    });
  });
});
