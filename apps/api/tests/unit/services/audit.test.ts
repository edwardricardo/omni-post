/**
 * @file audit.test.ts
 * @description Unit tests for `emitAudit` (`services/audit.ts`) — the free-function
 *              composition helper replacing `AuditableService.log*Action` for
 *              services that no longer extend the class hierarchy. Covers actor
 *              discriminator derivation, including the derivation-wins rule: a
 *              present actor FK always determines `actorType`, and an explicit
 *              `actorType` is honored only when neither FK is set.
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { InMemoryAuditLogRepository } from "../helpers/InMemoryAuditLogRepository.js";

// The dual-FK guard warns through the module logger; capture it so the caller
// bug is asserted as diagnosable rather than silent.
const loggerMock = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../../../src/lib/logger.js", () => {
  const instance = { ...loggerMock, trace: vi.fn(), fatal: vi.fn(), child: () => instance };
  return { logger: instance, authLogger: instance, createLogger: () => instance };
});

const { emitAudit } = await import("../../../src/services/audit.js");

describe("emitAudit — actorType derivation", () => {
  let repo: InMemoryAuditLogRepository;

  beforeEach(() => {
    repo = new InMemoryAuditLogRepository();
  });

  it("derives actorType ADMIN when userId is present and actorType is absent", async () => {
    await emitAudit(repo, { action: "ADMIN_ACTION", category: "USER", userId: "admin-1" });
    const row = repo.rows[0]!;
    expect(row.actorType).toBe("ADMIN");
    expect(row.userId).toBe("admin-1");
  });

  it("derives actorType CUSTOMER when customerUserId is present and actorType is absent", async () => {
    await emitAudit(repo, {
      action: "CUSTOMER_ACTION",
      category: "USER",
      customerUserId: "cust-1",
    });
    const row = repo.rows[0]!;
    expect(row.actorType).toBe("CUSTOMER");
    expect(row.customerUserId).toBe("cust-1");
    expect(row.userId).toBe(null);
  });

  it("derives actorType SYSTEM when no actor FK and no actorType are present", async () => {
    await emitAudit(repo, { action: "SYSTEM_ACTION", category: "SYSTEM" });
    const row = repo.rows[0]!;
    expect(row.actorType).toBe("SYSTEM");
  });

  it("derivation-wins: an actor FK overrides a conflicting explicit actorType (ADMIN)", async () => {
    // A caller passing actorType:'SYSTEM' alongside a set userId must NOT
    // produce a mislabeled SYSTEM row — the FK wins, making the invalid
    // combination structurally impossible rather than merely detectable by
    // the reconciliation query later (post-verify remediation S1, closed at
    // every create path).
    await emitAudit(repo, {
      action: "OVERRIDE_ADMIN",
      category: "USER",
      userId: "admin-1",
      actorType: "SYSTEM",
    });
    const row = repo.rows[0]!;
    expect(row.actorType).toBe("ADMIN");
    expect(row.userId).toBe("admin-1");
  });

  it("derivation-wins: an actor FK overrides a conflicting explicit actorType (CUSTOMER)", async () => {
    await emitAudit(repo, {
      action: "OVERRIDE_CUSTOMER",
      category: "USER",
      customerUserId: "cust-1",
      actorType: "SYSTEM",
    });
    const row = repo.rows[0]!;
    expect(row.actorType).toBe("CUSTOMER");
    expect(row.customerUserId).toBe("cust-1");
  });

  it("honors an explicit actorType only when neither FK is present", async () => {
    await emitAudit(repo, {
      action: "EXPLICIT_SYSTEM_NO_FK",
      category: "SYSTEM",
      actorType: "SYSTEM",
    });
    const row = repo.rows[0]!;
    expect(row.actorType).toBe("SYSTEM");
    expect(row.userId).toBe(null);
    expect(row.customerUserId).toBe(null);
  });

  it("keeps only the ADMIN userId, drops customerUserId, and warns when both actor FKs are supplied", async () => {
    // A caller bug that forwards both FKs must NOT hit the DB exclusive-arc
    // CHECK and lose the row to the non-rethrowing catch — the row persists as
    // an ADMIN entry (userId wins) and the drop is logged so the bug surfaces.
    await emitAudit(repo, {
      action: "ADMIN_OVER_CUSTOMER",
      category: "SECURITY",
      userId: "admin-dual",
      customerUserId: "cust-dual",
    });

    expect(repo.rows).toHaveLength(1);
    const row = repo.rows[0]!;
    expect(row.actorType).toBe("ADMIN");
    expect(row.userId).toBe("admin-dual");
    expect(row.customerUserId).toBe(null);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "admin-dual", customerUserId: "cust-dual" }),
      expect.stringContaining("customerUserId")
    );
  });

  it("swallows a persistence error without throwing (audit failures must not break the caller)", async () => {
    const failing = {
      create: async () => {
        throw new Error("db down");
      },
      findByUser: async () => [],
      findByResource: async () => [],
      findByAccount: async () => [],
      anonymizeUser: async () => 0,
      anonymizeCustomerUser: async () => 0,
    };
    await expect(
      emitAudit(failing, { action: "WILL_FAIL", category: "SYSTEM" })
    ).resolves.toBeUndefined();
  });
});
