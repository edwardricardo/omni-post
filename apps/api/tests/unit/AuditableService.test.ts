/**
 * @file AuditableService.test.ts
 * @description Unit tests for the AuditableService base class after the audit
 *              actor polymorphism change. The write seam is now a first-class
 *              `AuditActor` discriminated union: wrappers are actor-first, and
 *              `writeAuditLog` maps the union to port fields in ONE switch
 *              (ADMIN→userId, CUSTOMER→customerUserId + accountId, SYSTEM→neither;
 *              always actorType). It must persist audit entries through the
 *              injected AuditLogRepository port (never a Prisma singleton), fold
 *              category/severity into details, record success/failure via
 *              executeWithAudit, delegate reads to the port, isolate write
 *              failures from the caller, and keep the admin write byte-identical
 *              to the pre-change behavior (plus the additive actorType).
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect, vi } from "vitest";

import { InMemoryAuditLogRepository } from "./helpers/InMemoryAuditLogRepository.js";
import {
  AuditableService,
  auditActor,
  type AuditActor,
  type AccountActionOptions,
  type ResourceActionOptions,
  type UserActionOptions,
  type AuditLogEntry,
} from "../../src/services/AuditableService.js";
import type {
  AuditLogRepository,
  AuditLogCreateInput,
} from "@core/domain/repositories/AuditLogRepository.js";

/**
 * Concrete subclass that surfaces the protected audit helpers for testing.
 */
class TestAuditableService extends AuditableService {
  constructor(auditLog: AuditLogRepository) {
    super("TestAuditableService", auditLog);
  }
  logUser(actor: AuditActor, options: UserActionOptions): Promise<void> {
    return this.logUserAction(actor, options);
  }
  logAccount(actor: AuditActor, options: AccountActionOptions): Promise<void> {
    return this.logAccountAction(actor, options);
  }
  logResource(actor: AuditActor, options: ResourceActionOptions): Promise<void> {
    return this.logResourceAction(actor, options);
  }
  logSecurity(
    actor: AuditActor,
    accountId: string,
    options: Omit<UserActionOptions, "category">
  ): Promise<void> {
    return this.logSecurityEvent(actor, accountId, options);
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
  readByAccount(accountId: string): Promise<unknown[]> {
    return this.getAccountAuditLogs(accountId);
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
      await service.logUser(auditActor.admin("user-1"), {
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
      expect(row.actorType).toBe("ADMIN");
      expect(row.ipAddress).toBe("192.168.1.1");
      expect(row.userAgent).toBe("Mozilla/5.0");
      expect(row.success).toBe(true);
      const details = row.details as Record<string, unknown>;
      expect(details.category).toBe("AUTHENTICATION");
      expect(details.severity).toBe("INFO");
      expect(details.method).toBe("password");
    });

    it("omits optional fields when undefined and includes them when provided", async () => {
      await service.logUser(auditActor.admin("user-1"), {
        action: "NO_OPTIONAL",
        category: "AUTHENTICATION",
      });
      await service.logUser(auditActor.admin("user-1"), {
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
      await service.logUser(auditActor.admin("user-1"), {
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
      await service.logAccount(auditActor.admin("admin-1"), {
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

    it("persists accountId on the row for searchability", async () => {
      await service.logAccount(auditActor.admin("admin-1"), {
        accountId: "acc-1",
        action: "SUBSCRIPTION_UPGRADE",
        category: "ACCOUNT",
        details: {},
      });
      const row = repo.rows[0]!;
      expect(row.accountId).toBe("acc-1");
    });
  });

  describe("logResourceAction", () => {
    it("maps resourceType to the resource column with resourceId", async () => {
      await service.logResource(auditActor.admin("user-1"), {
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
    it("writes a system action with null actor FKs and actorType SYSTEM", async () => {
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
      expect(row.customerUserId).toBe(null);
      expect(row.actorType).toBe("SYSTEM");
      expect(row.action).toBe("AUTO_RENEWAL");
      const details = row.details as Record<string, unknown>;
      expect(details.category).toBe("BILLING");
      expect(details.amount).toBe(199);
    });

    it("persists accountId on system action rows", async () => {
      await service.logSystem({
        accountId: "acc-7",
        action: "DATA_RETENTION_SWEEP",
        category: "SYSTEM",
        details: {},
      });
      const row = repo.rows[0]!;
      expect(row.userId).toBe(null);
      expect(row.accountId).toBe("acc-7");
    });
  });

  describe("actor discriminated union mapping", () => {
    it("ADMIN actor → userId set, customerUserId null, actorType ADMIN", async () => {
      await service.logUser(auditActor.admin("admin-9"), {
        action: "ADMIN_ACTION",
        category: "SECURITY",
      });
      const row = repo.rows[0]!;
      expect(row.userId).toBe("admin-9");
      expect(row.customerUserId).toBe(null);
      expect(row.actorType).toBe("ADMIN");
    });

    it("CUSTOMER actor → customerUserId set, userId null, actorType CUSTOMER, accountId carried", async () => {
      await service.logSecurity(auditActor.customer("cust-9", "acc-9"), "acc-9", {
        action: "CUSTOMER_MFA_ENABLED",
        severity: "HIGH",
        details: { method: "totp" },
      });
      const row = repo.rows[0]!;
      expect(row.customerUserId).toBe("cust-9");
      expect(row.userId).toBe(null);
      expect(row.actorType).toBe("CUSTOMER");
      expect(row.accountId).toBe("acc-9");
    });

    it("CUSTOMER actor without an explicit entry accountId falls back to the actor's accountId", async () => {
      await service.logUser(auditActor.customer("cust-3", "acc-fallback"), {
        action: "CUSTOMER_PROFILE_UPDATE",
        category: "ACCOUNT",
      });
      const row = repo.rows[0]!;
      expect(row.customerUserId).toBe("cust-3");
      expect(row.accountId).toBe("acc-fallback");
      expect(row.actorType).toBe("CUSTOMER");
    });

    it("CUSTOMER actor with a differing entry accountId → the entry accountId wins", async () => {
      // The entry-level accountId (the resource being acted on) takes precedence
      // over the actor's home account, so an admin-over-customer-style flow files
      // the row under the account it touched, not the actor's own account.
      await service.logSecurity(auditActor.customer("cust-1", "acc-actor"), "acc-entry", {
        action: "CUSTOMER_MFA_ENABLED",
        severity: "HIGH",
        details: { method: "totp" },
      });
      const row = repo.rows[0]!;
      expect(row.customerUserId).toBe("cust-1");
      expect(row.actorType).toBe("CUSTOMER");
      expect(row.accountId).toBe("acc-entry");
    });

    it("SYSTEM actor → both FKs null, actorType SYSTEM", async () => {
      await service.writeRaw({
        action: "SYSTEM_TICK",
        category: "SYSTEM",
        severity: "LOW",
        actor: auditActor.system(),
      });
      const row = repo.rows[0]!;
      expect(row.userId).toBe(null);
      expect(row.customerUserId).toBe(null);
      expect(row.actorType).toBe("SYSTEM");
    });

    it("admin write produces a create-input byte-identical to pre-change plus additive actorType", async () => {
      const captured: AuditLogCreateInput[] = [];
      const capturingRepo: AuditLogRepository = {
        create: async (input) => {
          captured.push(input);
        },
        findByUser: async () => [],
        findByResource: async () => [],
        findByAccount: async () => [],
        anonymizeUser: async () => 0,
        anonymizeCustomerUser: async () => 0,
      };
      const svc = new TestAuditableService(capturingRepo);

      await svc.logUser(auditActor.admin("admin-1"), {
        action: "USER_LOGIN",
        category: "AUTHENTICATION",
        severity: "INFO",
      });

      expect(captured).toHaveLength(1);
      const input = captured[0]!;
      // Additive: the only new field vs pre-change is actorType.
      expect(input.actorType).toBe("ADMIN");
      // Pre-change fields, unchanged.
      expect(input.action).toBe("USER_LOGIN");
      expect(input.userId).toBe("admin-1");
      expect(input.success).toBe(true);
      expect(input.details).toStrictEqual({ category: "AUTHENTICATION", severity: "INFO" });
      // No customer FK leaks onto an admin write.
      expect("customerUserId" in input).toBe(false);
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
      expect(row.userId).toBe("user-1");
      expect(row.actorType).toBe("ADMIN");
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
      await service.logUser(auditActor.admin("user-1"), { action: "A", category: "DATA" });
      await service.logUser(auditActor.admin("user-2"), { action: "B", category: "DATA" });

      const rows = (await service.readByUser("user-1")) as Array<{ userId: string | null }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.userId).toBe("user-1");
    });

    it("delegates getAccountAuditLogs to the port's findByAccount (customer-scoped query)", async () => {
      await service.logAccount(auditActor.admin("user-1"), {
        accountId: "acc-A",
        action: "ACCOUNT_UPDATE",
        category: "ACCOUNT",
        details: {},
      });
      await service.logAccount(auditActor.admin("user-2"), {
        accountId: "acc-B",
        action: "ACCOUNT_UPDATE",
        category: "ACCOUNT",
        details: {},
      });

      const rowsA = (await service.readByAccount("acc-A")) as Array<{ accountId: string | null }>;
      expect(rowsA).toHaveLength(1);
      expect(rowsA[0]!.accountId).toBe("acc-A");
    });

    it("delegates getResourceAuditLogs to the port's findByResource", async () => {
      await service.logResource(auditActor.admin("user-1"), {
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
        findByAccount: async () => [],
        anonymizeUser: async () => 0,
        anonymizeCustomerUser: async () => 0,
      };
      const svc = new TestAuditableService(failing);

      await expect(
        svc.logUser(auditActor.admin("user-1"), {
          action: "USER_LOGIN",
          category: "AUTHENTICATION",
        })
      ).resolves.toBeUndefined();
      // The write was attempted (and swallowed), so the caller is shielded.
      expect(create).toHaveBeenCalledTimes(1);
    });
  });
});
