/**
 * @file billingWebhookIdempotency.test.ts
 * @description Unit tests for GatewayBillingService webhook helper methods:
 *   resolveAccountIdByCustomer, checkBillingEventIdempotency,
 *   markBillingEventProcessed, markBillingEventError.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { GatewayBillingService } from "../../../src/billing/GatewayBillingService.js";
import type { PrismaClient } from "@infra/prisma";

// ─── Mock Factories ─────────────────────────────────────────────────────────

function makeMockPrisma() {
  return {
    account: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    accountSubscription: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    gatewaySwitchEvent: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    billingEvent: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    providerBundle: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
}

function makeMockRegistry() {
  return {
    getAdapter: vi.fn().mockReturnValue({
      provider: "stripe" as const,
      cancelAtPeriodEnd: vi.fn(),
      reactivateSubscription: vi.fn(),
      getSubscriptionDetails: vi.fn(),
      createCustomer: vi.fn(),
      createCheckoutSession: vi.fn(),
      createBillingPortalSession: vi.fn(),
      createSubscription: vi.fn(),
      updateSubscription: vi.fn(),
      cancelSubscription: vi.fn(),
      parseWebhookEvent: vi.fn(),
      mapEventType: vi.fn(),
    }),
  };
}

function makeMockSwitchJobService() {
  return {
    startCheckoutWindow: vi.fn(),
    cancelJobs: vi.fn(),
    rescheduleJobs: vi.fn(),
    close: vi.fn(),
  };
}

function makeMockEmailPort() {
  return {
    send: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("GatewayBillingService — webhook helpers", () => {
  let service: GatewayBillingService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = makeMockPrisma();
    service = new GatewayBillingService(
      mockPrisma as unknown as PrismaClient,
      makeMockRegistry() as unknown as Parameters<
        typeof GatewayBillingService.prototype.constructor
      >[1],
      makeMockSwitchJobService() as unknown as Parameters<
        typeof GatewayBillingService.prototype.constructor
      >[2],
      makeMockEmailPort() as unknown as Parameters<
        typeof GatewayBillingService.prototype.constructor
      >[3]
    );
  });

  // ─── resolveAccountIdByCustomer ─────────────────────────────────────────

  describe("resolveAccountIdByCustomer", () => {
    it("returns accountId when account found", async () => {
      mockPrisma.account.findFirst.mockResolvedValue({ id: "acc-123" });

      const result = await service.resolveAccountIdByCustomer("cus_test", "stripe");

      assert.equal(result, "acc-123");
      expect(mockPrisma.account.findFirst).toHaveBeenCalledWith({
        where: { gatewayCustomerId: "cus_test", gatewayProvider: "STRIPE" },
        select: { id: true },
      });
    });

    it("returns null when no account found", async () => {
      mockPrisma.account.findFirst.mockResolvedValue(null);

      const result = await service.resolveAccountIdByCustomer("cus_missing", "paddle");

      assert.equal(result, null);
    });

    it("returns null when gatewayCustomerId is empty", async () => {
      const result = await service.resolveAccountIdByCustomer("", "stripe");
      assert.equal(result, null);
      expect(mockPrisma.account.findFirst).not.toHaveBeenCalled();
    });
  });

  // ─── checkBillingEventIdempotency ───────────────────────────────────────

  describe("checkBillingEventIdempotency", () => {
    it("returns skip=true when event already processed", async () => {
      mockPrisma.billingEvent.findUnique.mockResolvedValue({
        id: "be-1",
        processed: true,
      });

      const result = await service.checkBillingEventIdempotency(
        "evt_123",
        "stripe",
        "customer.subscription.deleted",
        "subscription.canceled",
        {}
      );

      assert.equal(result.skip, true);
      assert.equal(result.recordId, "be-1");
    });

    it("returns skip=false and creates record on first processing", async () => {
      mockPrisma.billingEvent.findUnique.mockResolvedValue(null);
      mockPrisma.billingEvent.upsert.mockResolvedValue({ id: "be-new" });

      const result = await service.checkBillingEventIdempotency(
        "evt_456",
        "stripe",
        "customer.subscription.deleted",
        "subscription.canceled",
        { customer: "cus_test" }
      );

      assert.equal(result.skip, false);
      assert.equal(result.recordId, "be-new");
      expect(mockPrisma.billingEvent.upsert).toHaveBeenCalled();
    });

    it("returns skip=false for unprocessed existing record", async () => {
      mockPrisma.billingEvent.findUnique.mockResolvedValue({
        id: "be-retry",
        processed: false,
      });
      mockPrisma.billingEvent.upsert.mockResolvedValue({ id: "be-retry" });

      const result = await service.checkBillingEventIdempotency(
        "evt_789",
        "paddle",
        "subscription.canceled",
        "subscription.canceled",
        {}
      );

      assert.equal(result.skip, false);
    });
  });

  // ─── markBillingEventProcessed ──────────────────────────────────────────

  describe("markBillingEventProcessed", () => {
    it("sets processed=true and processedAt", async () => {
      mockPrisma.billingEvent.update.mockResolvedValue({});

      await service.markBillingEventProcessed("be-1");

      expect(mockPrisma.billingEvent.update).toHaveBeenCalledWith({
        where: { id: "be-1" },
        data: { processed: true, processedAt: expect.any(Date) },
      });
    });
  });

  // ─── markBillingEventError ──────────────────────────────────────────────

  describe("markBillingEventError", () => {
    it("records error string on the billing event", async () => {
      mockPrisma.billingEvent.update.mockResolvedValue({});

      await service.markBillingEventError("be-1", "ACCOUNT_NOT_FOUND");

      expect(mockPrisma.billingEvent.update).toHaveBeenCalledWith({
        where: { id: "be-1" },
        data: { error: "ACCOUNT_NOT_FOUND" },
      });
    });
  });
});
