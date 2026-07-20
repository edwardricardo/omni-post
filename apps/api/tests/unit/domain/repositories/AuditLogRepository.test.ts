/**
 * @file AuditLogRepository.test.ts
 * @description Contract tests for the audit-log port. Exercises an in-memory
 *              reference implementation against the semantics every adapter must
 *              honour: create, user/resource lookup (newest-first, action filter,
 *              pagination), and compliance-preserving user anonymization.
 * @layer infrastructure
 */
import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { InMemoryAuditLogRepository } from "../../helpers/InMemoryAuditLogRepository.js";
import {
  AUDIT_ACTOR_TYPE,
  deriveActorType,
  normalizeAuditActorInput,
} from "@core/domain/repositories/AuditLogRepository.js";
import type { AuditLogCreateInput } from "@core/domain/repositories/AuditLogRepository.js";

const entry = (overrides?: Partial<AuditLogCreateInput>): AuditLogCreateInput => ({
  action: "USER_LOGIN",
  actorType: AUDIT_ACTOR_TYPE.SYSTEM,
  details: { category: "AUTHENTICATION" },
  success: true,
  ...overrides,
});

describe("AuditLogRepository contract", () => {
  let repo: InMemoryAuditLogRepository;
  beforeEach(() => {
    repo = new InMemoryAuditLogRepository();
  });

  it("returns the entry from findByUser after create", async () => {
    await repo.create(entry({ userId: "u-1" }));
    const rows = await repo.findByUser("u-1");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]?.action, "USER_LOGIN");
    assert.strictEqual(rows[0]?.success, true);
  });

  it("omits userId/resource when not provided (stored as null)", async () => {
    await repo.create(entry());
    const all = repo.rows;
    assert.strictEqual(all[0]?.userId, null);
    assert.strictEqual(all[0]?.resource, null);
  });

  it("filters findByUser by action", async () => {
    await repo.create(entry({ userId: "u-1", action: "USER_LOGIN" }));
    await repo.create(entry({ userId: "u-1", action: "MFA_ENABLED" }));
    const rows = await repo.findByUser("u-1", { action: "MFA_ENABLED" });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]?.action, "MFA_ENABLED");
  });

  it("returns newest first and respects limit/offset", async () => {
    await repo.create(entry({ userId: "u-1", action: "A" }));
    await repo.create(entry({ userId: "u-1", action: "B" }));
    await repo.create(entry({ userId: "u-1", action: "C" }));
    const page = await repo.findByUser("u-1", { limit: 1, offset: 1 });
    assert.strictEqual(page.length, 1);
    assert.strictEqual(page[0]?.action, "B");
  });

  it("scopes findByResource to resource + resourceId", async () => {
    await repo.create(entry({ resource: "Account", resourceId: "a-1" }));
    await repo.create(entry({ resource: "Account", resourceId: "a-2" }));
    const rows = await repo.findByResource("Account", "a-1");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]?.resourceId, "a-1");
  });

  it("scopes findByAccount to accountId (customer search)", async () => {
    await repo.create(entry({ accountId: "acc-A", action: "ACCOUNT_UPDATE" }));
    await repo.create(entry({ accountId: "acc-B", action: "ACCOUNT_UPDATE" }));
    await repo.create(entry({ accountId: "acc-A", action: "SUBSCRIPTION_UPGRADE" }));
    const rowsA = await repo.findByAccount("acc-A");
    const rowsB = await repo.findByAccount("acc-B");
    assert.strictEqual(rowsA.length, 2);
    assert.strictEqual(rowsB.length, 1);
    assert.strictEqual(rowsA[0]?.action, "SUBSCRIPTION_UPGRADE"); // newest first
    assert.strictEqual(rowsB[0]?.action, "ACCOUNT_UPDATE");
  });

  it("findByAccount excludes rows without accountId (system-level entries)", async () => {
    await repo.create(entry({ userId: "u-1" })); // no accountId
    await repo.create(entry({ accountId: "acc-A", userId: "u-1" }));
    const rows = await repo.findByAccount("acc-A");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]?.accountId, "acc-A");
  });

  it("findByAccount respects action filter + pagination", async () => {
    await repo.create(entry({ accountId: "acc-A", action: "X" }));
    await repo.create(entry({ accountId: "acc-A", action: "Y" }));
    await repo.create(entry({ accountId: "acc-A", action: "X" }));
    const xs = await repo.findByAccount("acc-A", { action: "X" });
    assert.strictEqual(xs.length, 2);
    const page = await repo.findByAccount("acc-A", { limit: 1, offset: 1 });
    assert.strictEqual(page.length, 1);
    assert.strictEqual(page[0]?.action, "Y"); // 2nd-newest (X, Y, X reversed → X, Y, X)
  });

  it("anonymizeUser nulls userId, preserves the rows, and returns the count", async () => {
    await repo.create(entry({ userId: "u-1" }));
    await repo.create(entry({ userId: "u-1" }));
    await repo.create(entry({ userId: "u-2" }));
    const count = await repo.anonymizeUser("u-1");
    assert.strictEqual(count, 2);
    assert.strictEqual((await repo.findByUser("u-1")).length, 0);
    assert.strictEqual(repo.rows.length, 3);
    assert.strictEqual((await repo.findByUser("u-2")).length, 1);
  });

  describe("polymorphic actor", () => {
    it("exposes exactly the SYSTEM/ADMIN/CUSTOMER discriminator values", () => {
      assert.deepStrictEqual(Object.values(AUDIT_ACTOR_TYPE).sort(), [
        "ADMIN",
        "CUSTOMER",
        "SYSTEM",
      ]);
    });

    it("stores a customer actor with customerUserId and actorType CUSTOMER, null userId", async () => {
      await repo.create(
        entry({
          actorType: AUDIT_ACTOR_TYPE.CUSTOMER,
          customerUserId: "cust-1",
          accountId: "acc-A",
          action: "CUSTOMER_MFA_ENABLED",
        })
      );
      const row = repo.rows[0];
      assert.strictEqual(row?.actorType, "CUSTOMER");
      assert.strictEqual(row?.customerUserId, "cust-1");
      assert.strictEqual(row?.userId, null);
    });

    it("stores an admin actor with actorType ADMIN and null customerUserId", async () => {
      await repo.create(
        entry({ actorType: AUDIT_ACTOR_TYPE.ADMIN, userId: "admin-1", action: "ADMIN_LOGIN" })
      );
      const row = repo.rows[0];
      assert.strictEqual(row?.actorType, "ADMIN");
      assert.strictEqual(row?.userId, "admin-1");
      assert.strictEqual(row?.customerUserId, null);
    });

    it("anonymizeCustomerUser nulls customerUserId, keeps actorType CUSTOMER, and returns the count", async () => {
      await repo.create(
        entry({ actorType: AUDIT_ACTOR_TYPE.CUSTOMER, customerUserId: "cust-1", action: "A" })
      );
      await repo.create(
        entry({ actorType: AUDIT_ACTOR_TYPE.CUSTOMER, customerUserId: "cust-1", action: "B" })
      );
      await repo.create(
        entry({ actorType: AUDIT_ACTOR_TYPE.CUSTOMER, customerUserId: "cust-2", action: "C" })
      );
      const count = await repo.anonymizeCustomerUser("cust-1");
      assert.strictEqual(count, 2);
      assert.strictEqual(repo.rows.length, 3);
      const anonymized = repo.rows.filter((r) => r.action === "A" || r.action === "B");
      for (const row of anonymized) {
        assert.strictEqual(row.customerUserId, null);
        assert.strictEqual(row.actorType, "CUSTOMER");
      }
      const untouched = repo.rows.find((r) => r.action === "C");
      assert.strictEqual(untouched?.customerUserId, "cust-2");
    });

    it("anonymizeCustomerUser does not touch admin (userId) rows", async () => {
      await repo.create(entry({ actorType: AUDIT_ACTOR_TYPE.ADMIN, userId: "admin-1" }));
      const count = await repo.anonymizeCustomerUser("admin-1");
      assert.strictEqual(count, 0);
      assert.strictEqual(repo.rows[0]?.userId, "admin-1");
    });

    it("anonymizeUser nulls userId but keeps actorType ADMIN (attribution survives DSAR)", async () => {
      await repo.create(entry({ actorType: AUDIT_ACTOR_TYPE.ADMIN, userId: "admin-1" }));
      const count = await repo.anonymizeUser("admin-1");
      assert.strictEqual(count, 1);
      assert.strictEqual(repo.rows[0]?.userId, null);
      assert.strictEqual(repo.rows[0]?.actorType, "ADMIN");
    });

    it("create rejects a dual-FK row, mimicking the DB exclusive-arc CHECK", async () => {
      // The in-memory helper stands in for the DB CHECK so a dual-FK escape
      // that bypasses normalization fails loudly in unit tests instead of
      // silently persisting an invalid row.
      await assert.rejects(
        repo.create(entry({ userId: "admin-1", customerUserId: "cust-1" })),
        /AuditLog_actor_exclusive_arc_check/
      );
    });
  });

  describe("deriveActorType — canonical FK-wins derivation (single-sourced for direct writers)", () => {
    it("derives ADMIN when userId is present and actorType is absent", () => {
      assert.strictEqual(deriveActorType({ userId: "admin-1" }), "ADMIN");
    });

    it("derives CUSTOMER when customerUserId is present and actorType is absent", () => {
      assert.strictEqual(deriveActorType({ customerUserId: "cust-1" }), "CUSTOMER");
    });

    it("derives SYSTEM when neither FK nor actorType is present", () => {
      assert.strictEqual(deriveActorType({}), "SYSTEM");
    });

    it("derivation-wins: userId overrides a conflicting explicit actorType", () => {
      assert.strictEqual(
        deriveActorType({ userId: "admin-1", actorType: AUDIT_ACTOR_TYPE.SYSTEM }),
        "ADMIN"
      );
    });

    it("derivation-wins: customerUserId overrides a conflicting explicit actorType", () => {
      assert.strictEqual(
        deriveActorType({ customerUserId: "cust-1", actorType: AUDIT_ACTOR_TYPE.SYSTEM }),
        "CUSTOMER"
      );
    });

    it("honors an explicit actorType only when neither FK is present", () => {
      assert.strictEqual(deriveActorType({ actorType: AUDIT_ACTOR_TYPE.SYSTEM }), "SYSTEM");
    });
  });

  describe("normalizeAuditActorInput — single-source dual-FK normalization for direct writers", () => {
    it("drops customerUserId and flags droppedFk when both FKs are set (userId wins → ADMIN)", () => {
      const result = normalizeAuditActorInput({ userId: "admin-1", customerUserId: "cust-1" });
      assert.strictEqual(result.actorType, "ADMIN");
      assert.strictEqual(result.userId, "admin-1");
      assert.strictEqual(result.customerUserId, undefined);
      assert.strictEqual(result.droppedFk, "customerUserId");
    });

    it("passes a lone userId through as ADMIN with no droppedFk", () => {
      const result = normalizeAuditActorInput({ userId: "admin-1" });
      assert.strictEqual(result.actorType, "ADMIN");
      assert.strictEqual(result.userId, "admin-1");
      assert.strictEqual(result.customerUserId, undefined);
      assert.strictEqual(result.droppedFk, undefined);
    });

    it("passes a lone customerUserId through as CUSTOMER with no droppedFk", () => {
      const result = normalizeAuditActorInput({ customerUserId: "cust-1" });
      assert.strictEqual(result.actorType, "CUSTOMER");
      assert.strictEqual(result.customerUserId, "cust-1");
      assert.strictEqual(result.userId, undefined);
      assert.strictEqual(result.droppedFk, undefined);
    });

    it("returns SYSTEM with no FKs when neither FK nor actorType is present", () => {
      const result = normalizeAuditActorInput({});
      assert.strictEqual(result.actorType, "SYSTEM");
      assert.strictEqual(result.userId, undefined);
      assert.strictEqual(result.customerUserId, undefined);
      assert.strictEqual(result.droppedFk, undefined);
    });

    it("honors an explicit actorType when no FK contradicts it", () => {
      const result = normalizeAuditActorInput({ actorType: AUDIT_ACTOR_TYPE.SYSTEM });
      assert.strictEqual(result.actorType, "SYSTEM");
      assert.strictEqual(result.userId, undefined);
      assert.strictEqual(result.customerUserId, undefined);
      assert.strictEqual(result.droppedFk, undefined);
    });
  });
});
