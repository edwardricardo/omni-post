/**
 * @file billingWebhookIdempotency.test.ts
 * @description Unit tests for GatewayBillingService webhook helper methods:
 *   resolveAccountIdByCustomer, checkBillingEventIdempotency,
 *   markBillingEventProcessed, markBillingEventError. Post-S3.4c the
 *   service is framework-free; tests mock the 9 ports + UoW.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { GatewayBillingService } from "@core/application/billing/GatewayBillingService.js";
import type { AccountBillingRepository } from "@core/domain/repositories/AccountBillingRepository.js";
import type { AccountSubscriptionBillingRepository } from "@core/domain/repositories/AccountSubscriptionBillingRepository.js";
import type { GatewaySwitchEventRepository } from "@core/domain/repositories/GatewaySwitchEventRepository.js";
import type { BillingEventRepository } from "@core/domain/repositories/BillingEventRepository.js";
import type { InvoiceRepository } from "@core/domain/repositories/InvoiceRepository.js";
import type { ProviderBundleReader } from "@core/domain/repositories/ProviderBundleReader.js";
import type { GatewaySwitchJobPort } from "@core/domain/repositories/GatewaySwitchJobPort.js";
import type { AuditEmitterPort } from "@core/domain/repositories/AuditEmitterPort.js";
import type { EmailPort } from "@core/domain/repositories/EmailPort.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { GatewayAdapterRegistryPort } from "@core/domain/repositories/GatewayAdapterRegistryPort.js";

// ─── Mock Factories ─────────────────────────────────────────────────────────

function makeAccountRepo(): AccountBillingRepository {
  return {
    findById: vi.fn().mockResolvedValue({ ok: true, value: null }),
    findByGatewayCustomerId: vi.fn().mockResolvedValue({ ok: true, value: null }),
    updateBillingFields: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  };
}

function makeSubscriptionRepo(): AccountSubscriptionBillingRepository {
  return {
    findActiveOrTrialingByAccount: vi.fn().mockResolvedValue({ ok: true, value: null }),
    findLatestByAccount: vi.fn().mockResolvedValue({ ok: true, value: null }),
    findByAccountAndStatus: vi.fn().mockResolvedValue({ ok: true, value: null }),
    update: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    updateAllForAccount: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  };
}

function makeSwitchEventRepo(): GatewaySwitchEventRepository {
  return {
    create: vi.fn().mockResolvedValue({ ok: true, value: { id: "switch-new" } }),
    findById: vi.fn().mockResolvedValue({ ok: true, value: null }),
    findLatestByAccountAndStatus: vi.fn().mockResolvedValue({ ok: true, value: null }),
    update: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    listWithAccount: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        events: [],
        counts: { total: 0, scheduled: 0, pendingCheckout: 0, suspended: 0, completed30d: 0 },
      },
    }),
    findByIdWithAccount: vi.fn().mockResolvedValue({ ok: true, value: null }),
  };
}

function makeBillingEventRepo(): BillingEventRepository {
  return {
    findByGatewayEventId: vi.fn().mockResolvedValue({ ok: true, value: null }),
    upsertNew: vi.fn().mockResolvedValue({ ok: true, value: { id: "be-new" } }),
    markProcessed: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    markError: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  };
}

function makeInvoiceRepo(): InvoiceRepository {
  return {
    upsertByGatewayInvoiceId: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  };
}

function makeBundleReader(): ProviderBundleReader {
  return {
    listActive: vi.fn().mockResolvedValue({ ok: true, value: [] }),
  };
}

function makeSwitchJobs(): GatewaySwitchJobPort {
  return {
    startCheckoutWindow: vi.fn().mockResolvedValue(undefined),
    cancelJobs: vi.fn().mockResolvedValue(undefined),
    rescheduleJobs: vi.fn().mockResolvedValue(undefined),
  };
}

function makeAuditEmitter(): AuditEmitterPort {
  return { emit: vi.fn().mockResolvedValue(undefined) };
}

function makeEmailPort(): EmailPort {
  return {
    send: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  } as unknown as EmailPort;
}

function makeUnitOfWork(): UnitOfWork {
  return {
    executeInTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  };
}

function makeMockRegistry(): GatewayAdapterRegistryPort {
  return {
    getAdapter: vi.fn().mockReturnValue({}),
  } as unknown as GatewayAdapterRegistryPort;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("GatewayBillingService — webhook helpers", () => {
  let service: GatewayBillingService;
  let accountRepo: AccountBillingRepository;
  let billingEventRepo: BillingEventRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    accountRepo = makeAccountRepo();
    billingEventRepo = makeBillingEventRepo();
    service = new GatewayBillingService(
      accountRepo,
      makeSubscriptionRepo(),
      makeSwitchEventRepo(),
      billingEventRepo,
      makeInvoiceRepo(),
      makeBundleReader(),
      makeMockRegistry(),
      makeSwitchJobs(),
      makeEmailPort(),
      makeAuditEmitter(),
      makeUnitOfWork()
    );
  });

  // ─── resolveAccountIdByCustomer ─────────────────────────────────────────

  describe("resolveAccountIdByCustomer", () => {
    it("returns accountId when account found", async () => {
      (accountRepo.findByGatewayCustomerId as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: { id: "acc-123" },
      });

      const result = await service.resolveAccountIdByCustomer("cus_test", "stripe");

      assert.equal(result, "acc-123");
      expect(accountRepo.findByGatewayCustomerId).toHaveBeenCalledWith("STRIPE", "cus_test");
    });

    it("returns null when no account found", async () => {
      (accountRepo.findByGatewayCustomerId as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: null,
      });

      const result = await service.resolveAccountIdByCustomer("cus_missing", "paddle");

      assert.equal(result, null);
    });

    it("returns null when gatewayCustomerId is empty", async () => {
      const result = await service.resolveAccountIdByCustomer("", "stripe");
      assert.equal(result, null);
      expect(accountRepo.findByGatewayCustomerId).not.toHaveBeenCalled();
    });
  });

  // ─── checkBillingEventIdempotency ───────────────────────────────────────

  describe("checkBillingEventIdempotency", () => {
    it("returns skip=true when event already processed", async () => {
      (billingEventRepo.findByGatewayEventId as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: { id: "be-1", processed: true },
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
      (billingEventRepo.findByGatewayEventId as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: null,
      });
      (billingEventRepo.upsertNew as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: { id: "be-new" },
      });

      const result = await service.checkBillingEventIdempotency(
        "evt_456",
        "stripe",
        "customer.subscription.deleted",
        "subscription.canceled",
        { customer: "cus_test" }
      );

      assert.equal(result.skip, false);
      assert.equal(result.recordId, "be-new");
      expect(billingEventRepo.upsertNew).toHaveBeenCalled();
    });

    it("returns skip=false for unprocessed existing record", async () => {
      (billingEventRepo.findByGatewayEventId as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: { id: "be-retry", processed: false },
      });
      (billingEventRepo.upsertNew as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: { id: "be-retry" },
      });

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
    it("delegates to billingEventRepo.markProcessed", async () => {
      await service.markBillingEventProcessed("be-1");

      expect(billingEventRepo.markProcessed).toHaveBeenCalledWith("be-1");
    });
  });

  // ─── markBillingEventError ──────────────────────────────────────────────

  describe("markBillingEventError", () => {
    it("delegates to billingEventRepo.markError with the error string", async () => {
      await service.markBillingEventError("be-1", "ACCOUNT_NOT_FOUND");

      expect(billingEventRepo.markError).toHaveBeenCalledWith("be-1", "ACCOUNT_NOT_FOUND");
    });
  });
});
