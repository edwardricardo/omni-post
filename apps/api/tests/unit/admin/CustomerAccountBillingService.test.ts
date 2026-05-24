/**
 * @file customerAccountBillingService.test.ts
 * @description Unit tests for CustomerAccountBillingService with a mocked Prisma
 *              client and the in-memory audit-log fake: account-status update
 *              (with audit), billing breakdown (NOT_FOUND + zero-tier path), and
 *              grandfathering adjustment.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CustomerAccountBillingService } from "../../../src/admin/CustomerAccountBillingService.js";
import { InMemoryAuditLogRepository } from "../helpers/InMemoryAuditLogRepository.js";
import type { PrismaClient } from "@infra/prisma";

interface MockData {
  account?: Record<string, unknown> | null;
  subscription?: Record<string, unknown> | null;
}

function makePrisma(data: MockData) {
  return {
    account: {
      findUnique: vi.fn(async () => data.account ?? null),
      update: vi.fn(async ({ data: d }: { data: Record<string, unknown> }) => ({
        id: "acc-1",
        email: "a@test.com",
        name: "A",
        phone: null,
        isActive: true,
        updatedAt: new Date(0),
        ...d,
      })),
    },
    accountSubscription: {
      findUnique: vi.fn(async () => data.subscription ?? null),
    },
    providerPricingTier: { findMany: vi.fn(async () => []) },
    accountPricingTier: { findMany: vi.fn(async () => []) },
    providerBundle: { findMany: vi.fn(async () => []) },
    subscriptionPriceHistory: {
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
    },
  };
}

describe("CustomerAccountBillingService", () => {
  let auditLog: InMemoryAuditLogRepository;

  beforeEach(() => {
    auditLog = new InMemoryAuditLogRepository();
  });

  describe("updateAccountStatus", () => {
    it("returns NOT_FOUND when the account does not exist", async () => {
      const prisma = makePrisma({ account: null });
      const svc = new CustomerAccountBillingService(prisma as unknown as PrismaClient, auditLog);
      const result = await svc.updateAccountStatus("acc-x", { isActive: false }, "admin-1");
      expect(!result.ok && result.error).toBe("NOT_FOUND");
    });

    it("updates the account and writes an audit entry with the acting admin", async () => {
      const prisma = makePrisma({
        account: { id: "acc-1", isActive: true, name: "Old" },
      });
      const svc = new CustomerAccountBillingService(prisma as unknown as PrismaClient, auditLog);
      const result = await svc.updateAccountStatus("acc-1", { isActive: false }, "admin-1");

      expect(result.ok).toBe(true);
      expect(prisma.account.update).toHaveBeenCalledOnce();
      expect(auditLog.rows).toHaveLength(1);
      expect(auditLog.rows[0]!.action).toBe("ACCOUNT_UPDATE");
      expect(auditLog.rows[0]!.userId).toBe("admin-1");
    });

    it("skips the audit write when no acting admin is provided", async () => {
      const prisma = makePrisma({ account: { id: "acc-1", isActive: true, name: "Old" } });
      const svc = new CustomerAccountBillingService(prisma as unknown as PrismaClient, auditLog);
      await svc.updateAccountStatus("acc-1", { name: "New" });
      expect(auditLog.rows).toHaveLength(0);
    });
  });

  describe("getAccountBilling", () => {
    it("returns NOT_FOUND when the account does not exist", async () => {
      const prisma = makePrisma({ account: null });
      const svc = new CustomerAccountBillingService(prisma as unknown as PrismaClient, auditLog);
      const result = await svc.getAccountBilling("acc-x");
      expect(!result.ok && result.error.code).toBe("NOT_FOUND");
    });

    it("returns a zero-cost 'none' plan when there are no pricing tiers", async () => {
      const prisma = makePrisma({
        account: { id: "acc-1", name: "Acme", isOnTrial: false, trialEndDate: null },
        subscription: null,
      });
      const svc = new CustomerAccountBillingService(prisma as unknown as PrismaClient, auditLog);
      const result = await svc.getAccountBilling("acc-1");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.planType).toBe("none");
        expect(result.value.calculation.totalMonthly).toBe(0);
        expect(result.value.cheaperBundle).toBeNull();
      }
    });
  });

  describe("updateGrandfathering", () => {
    it("returns NOT_FOUND when there is no grandfathered subscription", async () => {
      const prisma = makePrisma({ subscription: null });
      const svc = new CustomerAccountBillingService(prisma as unknown as PrismaClient, auditLog);
      const result = await svc.updateGrandfathering("acc-1", new Date(Date.now() + 86_400_000));
      expect(!result.ok && result.error).toBe("NOT_FOUND");
    });

    it("updates the latest price-history row for a grandfathered subscription", async () => {
      const future = new Date(Date.now() + 86_400_000);
      const prisma = makePrisma({
        subscription: {
          id: "sub-1",
          status: "GRANDFATHERED",
          pricePerMonth: 100,
          history: [{ id: "h-1" }],
        },
      });
      const svc = new CustomerAccountBillingService(prisma as unknown as PrismaClient, auditLog);
      const result = await svc.updateGrandfathering("acc-1", future);

      expect(result.ok).toBe(true);
      expect(prisma.subscriptionPriceHistory.update).toHaveBeenCalledOnce();
      if (result.ok) expect(result.value.effectiveAt).toBe(future.toISOString());
    });
  });
});
