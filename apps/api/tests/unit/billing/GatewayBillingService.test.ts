/**
 * @file GatewayBillingService.test.ts
 * @description Unit tests for gateway billing service — switch lifecycle,
 *   checkout sessions, billing portal, idempotency, and query methods.
 *   After S3.4c the service is framework-free; tests mock the 9 ports + UoW.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { GatewayBillingService } from "@core/billing/GatewayBillingService.js";
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
import type { GatewayAdapterRegistryPort } from "@ports/core";

// ── Mock Factories ──────────────────────────────────────────────────────────

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
  return {
    emit: vi.fn().mockResolvedValue(undefined),
  };
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

function makeMockRegistry(overrides: Record<string, unknown> = {}) {
  const adapter = {
    provider: "stripe" as const,
    cancelAtPeriodEnd: vi.fn().mockResolvedValue(undefined),
    reactivateSubscription: vi.fn().mockResolvedValue(undefined),
    getSubscriptionDetails: vi.fn().mockResolvedValue({
      currentPeriodEnd: new Date("2026-06-01T00:00:00Z"),
      status: "active",
      cancelAtPeriodEnd: false,
    }),
    createCustomer: vi.fn().mockResolvedValue({ externalCustomerId: "cus_test" }),
    createCheckoutSession: vi.fn().mockResolvedValue({ url: "https://checkout.test" }),
    createBillingPortalSession: vi.fn().mockResolvedValue({ url: "https://portal.test" }),
    createSubscription: vi.fn(),
    updateSubscription: vi.fn(),
    cancelSubscription: vi.fn(),
    parseWebhookEvent: vi.fn(),
    mapEventType: vi.fn(),
    ...overrides,
  };
  return { getAdapter: vi.fn().mockReturnValue(adapter), _adapter: adapter };
}

function makeAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: "account-001",
    name: "Test Account",
    email: "test@example.com",
    gatewayProvider: "STRIPE" as const,
    gatewayCustomerId: "cus_existing",
    pendingGatewaySwitch: false,
    pendingGatewayProvider: null,
    gatewaySwitchAt: null,
    status: "ACTIVE",
    ...overrides,
  };
}

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-001",
    accountId: "account-001",
    status: "ACTIVE" as const,
    gatewayProvider: "STRIPE" as const,
    gatewaySubscriptionId: "ext_sub_001",
    externalSubscriptionId: null,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date("2026-06-01T00:00:00Z"),
    bundleId: "bundle-1",
    ...overrides,
  };
}

function makeSwitchEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "switch-001",
    accountId: "account-001",
    fromGateway: "STRIPE" as const,
    toGateway: "PADDLE" as const,
    status: "SCHEDULED" as const,
    scheduledFor: new Date("2026-06-01T00:00:00Z"),
    extendedUntil: null,
    extendedBy: null,
    completedAt: null,
    cancelledAt: null,
    suspendedAt: null,
    reminderSentAt: null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    ...overrides,
  };
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe("GatewayBillingService", () => {
  let service: GatewayBillingService;
  let accountRepo: AccountBillingRepository;
  let subscriptionRepo: AccountSubscriptionBillingRepository;
  let switchEventRepo: GatewaySwitchEventRepository;
  let billingEventRepo: BillingEventRepository;
  let invoiceRepo: InvoiceRepository;
  let bundleReader: ProviderBundleReader;
  let switchJobs: GatewaySwitchJobPort;
  let auditEmitter: AuditEmitterPort;
  let emailPort: EmailPort;
  let unitOfWork: UnitOfWork;
  let mockRegistry: ReturnType<typeof makeMockRegistry>;

  beforeEach(() => {
    vi.clearAllMocks();
    accountRepo = makeAccountRepo();
    subscriptionRepo = makeSubscriptionRepo();
    switchEventRepo = makeSwitchEventRepo();
    billingEventRepo = makeBillingEventRepo();
    invoiceRepo = makeInvoiceRepo();
    bundleReader = makeBundleReader();
    switchJobs = makeSwitchJobs();
    auditEmitter = makeAuditEmitter();
    emailPort = makeEmailPort();
    unitOfWork = makeUnitOfWork();
    mockRegistry = makeMockRegistry();
    service = new GatewayBillingService(
      accountRepo,
      subscriptionRepo,
      switchEventRepo,
      billingEventRepo,
      invoiceRepo,
      bundleReader,
      mockRegistry as unknown as GatewayAdapterRegistryPort,
      switchJobs,
      emailPort,
      auditEmitter,
      unitOfWork
    );
  });

  // ── initiateGatewaySwitch ───────────────────────────────────────────────

  describe("initiateGatewaySwitch", () => {
    it("returns ACCOUNT_NOT_FOUND when account is null", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: null,
      });

      const result = await service.initiateGatewaySwitch("account-001", "paddle");

      assert.ok(!result.ok);
      assert.equal(result.error, "ACCOUNT_NOT_FOUND");
    });

    it("returns SAME_GATEWAY when account.gatewayProvider matches target", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount({ gatewayProvider: "STRIPE" }),
      });

      const result = await service.initiateGatewaySwitch("account-001", "stripe");

      assert.ok(!result.ok);
      assert.equal(result.error, "SAME_GATEWAY");
    });

    it("returns SWITCH_ALREADY_PENDING when pendingGatewaySwitch is true", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount({ pendingGatewaySwitch: true }),
      });

      const result = await service.initiateGatewaySwitch("account-001", "paddle");

      assert.ok(!result.ok);
      assert.equal(result.error, "SWITCH_ALREADY_PENDING");
    });

    it("returns NO_ACTIVE_SUBSCRIPTION when no active/trialing subscription", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount(),
      });
      (
        subscriptionRepo.findActiveOrTrialingByAccount as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ ok: true, value: null });

      const result = await service.initiateGatewaySwitch("account-001", "paddle");

      assert.ok(!result.ok);
      assert.equal(result.error, "NO_ACTIVE_SUBSCRIPTION");
    });

    it("calls getSubscriptionDetails on registry adapter", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount(),
      });
      (
        subscriptionRepo.findActiveOrTrialingByAccount as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ ok: true, value: makeSubscription() });

      await service.initiateGatewaySwitch("account-001", "paddle");

      const adapter = mockRegistry._adapter;
      expect(adapter.getSubscriptionDetails).toHaveBeenCalledWith({
        externalSubscriptionId: "ext_sub_001",
      });
    });

    it("calls cancelAtPeriodEnd on adapter with subscription ID", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount(),
      });
      (
        subscriptionRepo.findActiveOrTrialingByAccount as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ ok: true, value: makeSubscription() });

      await service.initiateGatewaySwitch("account-001", "paddle");

      const adapter = mockRegistry._adapter;
      expect(adapter.cancelAtPeriodEnd).toHaveBeenCalledWith({
        externalSubscriptionId: "ext_sub_001",
      });
    });

    it("persists switch event + account + subscription inside UoW transaction", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount(),
      });
      (
        subscriptionRepo.findActiveOrTrialingByAccount as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ ok: true, value: makeSubscription() });

      await service.initiateGatewaySwitch("account-001", "paddle");

      expect(unitOfWork.executeInTransaction).toHaveBeenCalledTimes(1);
      expect(switchEventRepo.create).toHaveBeenCalledTimes(1);
      expect(accountRepo.updateBillingFields).toHaveBeenCalledWith(
        "account-001",
        expect.objectContaining({
          pendingGatewaySwitch: true,
          pendingGatewayProvider: "PADDLE",
        })
      );
      expect(subscriptionRepo.update).toHaveBeenCalledWith("sub-001", { cancelAtPeriodEnd: true });
    });

    it("emits audit event after successful initiation", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount(),
      });
      (
        subscriptionRepo.findActiveOrTrialingByAccount as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ ok: true, value: makeSubscription() });

      await service.initiateGatewaySwitch("account-001", "paddle", "user-99");

      expect(auditEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "GATEWAY_SWITCH_INITIATED",
          category: "BILLING",
          resourceType: "account",
          resourceId: "account-001",
          userId: "user-99",
        })
      );
    });

    it("returns switchEventId and scheduledFor", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount(),
      });
      (
        subscriptionRepo.findActiveOrTrialingByAccount as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ ok: true, value: makeSubscription() });
      (switchEventRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: { id: "switch-new" },
      });

      const result = await service.initiateGatewaySwitch("account-001", "paddle");

      assert.ok(result.ok, "should succeed");
      assert.equal(result.value.switchEventId, "switch-new");
      assert.ok(result.value.scheduledFor instanceof Date);
      assert.equal(result.value.fromGateway, "STRIPE");
      assert.equal(result.value.toGateway, "PADDLE");
    });

    it("returns DATABASE_ERROR when account read throws", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Connection lost")
      );

      const result = await service.initiateGatewaySwitch("account-001", "paddle");

      assert.ok(!result.ok);
      assert.equal(result.error, "DATABASE_ERROR");
    });

    it("works without externalSubscriptionId (uses currentPeriodEnd from DB)", async () => {
      const periodEnd = new Date("2026-07-15T00:00:00Z");
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount(),
      });
      (
        subscriptionRepo.findActiveOrTrialingByAccount as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ok: true,
        value: makeSubscription({
          gatewaySubscriptionId: null,
          externalSubscriptionId: null,
          currentPeriodEnd: periodEnd,
        }),
      });

      const result = await service.initiateGatewaySwitch("account-001", "paddle");

      assert.ok(result.ok, "should succeed without external subscription ID");
      assert.equal(result.value.scheduledFor.toISOString(), periodEnd.toISOString());
      const adapter = mockRegistry._adapter;
      expect(adapter.getSubscriptionDetails).not.toHaveBeenCalled();
      expect(adapter.cancelAtPeriodEnd).not.toHaveBeenCalled();
    });
  });

  // ── cancelPendingSwitch ─────────────────────────────────────────────────

  describe("cancelPendingSwitch", () => {
    it("returns ACCOUNT_NOT_FOUND when account null", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: null,
      });

      const result = await service.cancelPendingSwitch("account-001");

      assert.ok(!result.ok);
      assert.equal(result.error, "ACCOUNT_NOT_FOUND");
    });

    it("returns SWITCH_NOT_FOUND when no pending switch on account", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount({ pendingGatewaySwitch: false }),
      });

      const result = await service.cancelPendingSwitch("account-001");

      assert.ok(!result.ok);
      assert.equal(result.error, "SWITCH_NOT_FOUND");
    });

    it("calls reactivateSubscription on adapter", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount({ pendingGatewaySwitch: true }),
      });
      (switchEventRepo.findLatestByAccountAndStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeSwitchEvent(),
      });
      (
        subscriptionRepo.findActiveOrTrialingByAccount as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ ok: true, value: makeSubscription() });

      await service.cancelPendingSwitch("account-001");

      const adapter = mockRegistry._adapter;
      expect(adapter.reactivateSubscription).toHaveBeenCalledWith({
        externalSubscriptionId: "ext_sub_001",
      });
    });

    it("calls switchJobs.cancelJobs", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount({ pendingGatewaySwitch: true }),
      });
      (switchEventRepo.findLatestByAccountAndStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeSwitchEvent(),
      });
      (
        subscriptionRepo.findActiveOrTrialingByAccount as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ ok: true, value: makeSubscription() });

      await service.cancelPendingSwitch("account-001");

      expect(switchJobs.cancelJobs).toHaveBeenCalledWith("account-001");
    });

    it("clears pending fields on account inside UoW", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount({ pendingGatewaySwitch: true }),
      });
      (switchEventRepo.findLatestByAccountAndStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeSwitchEvent(),
      });
      (
        subscriptionRepo.findActiveOrTrialingByAccount as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ ok: true, value: makeSubscription() });

      const result = await service.cancelPendingSwitch("account-001");

      assert.ok(result.ok, "should succeed");
      assert.deepEqual(result.value, { cancelled: true });
      expect(unitOfWork.executeInTransaction).toHaveBeenCalledTimes(1);
      expect(accountRepo.updateBillingFields).toHaveBeenCalledWith(
        "account-001",
        expect.objectContaining({
          pendingGatewaySwitch: false,
          pendingGatewayProvider: null,
        })
      );
      expect(switchEventRepo.update).toHaveBeenCalledWith(
        "switch-001",
        expect.objectContaining({ status: "CANCELLED" })
      );
    });
  });

  // ── handleSubscriptionCanceled ──────────────────────────────────────────

  describe("handleSubscriptionCanceled", () => {
    it("returns ACCOUNT_NOT_FOUND when account null", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: null,
      });

      const result = await service.handleSubscriptionCanceled("account-001");

      assert.ok(!result.ok);
      assert.equal(result.error, "ACCOUNT_NOT_FOUND");
    });

    it("returns ok when no pending switch (normal cancellation)", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount({ pendingGatewaySwitch: false, pendingGatewayProvider: null }),
      });

      const result = await service.handleSubscriptionCanceled("account-001");

      assert.ok(result.ok, "should return ok for normal cancellation");
      expect(switchEventRepo.findLatestByAccountAndStatus).not.toHaveBeenCalled();
    });

    it("transitions switch to PENDING_CHECKOUT via UoW when pendingGatewaySwitch=true", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount({ pendingGatewaySwitch: true, pendingGatewayProvider: "PADDLE" }),
      });
      (switchEventRepo.findLatestByAccountAndStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeSwitchEvent(),
      });
      (subscriptionRepo.findLatestByAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeSubscription(),
      });

      const result = await service.handleSubscriptionCanceled("account-001");

      assert.ok(result.ok, "should succeed");
      expect(unitOfWork.executeInTransaction).toHaveBeenCalledTimes(1);
      expect(switchEventRepo.update).toHaveBeenCalledWith(
        "switch-001",
        expect.objectContaining({ status: "PENDING_CHECKOUT" })
      );
      expect(subscriptionRepo.update).toHaveBeenCalledWith(
        "sub-001",
        expect.objectContaining({ status: "CANCELED" })
      );
    });

    it("calls switchJobs.startCheckoutWindow", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount({ pendingGatewaySwitch: true, pendingGatewayProvider: "PADDLE" }),
      });
      (switchEventRepo.findLatestByAccountAndStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeSwitchEvent(),
      });
      (subscriptionRepo.findLatestByAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeSubscription(),
      });

      await service.handleSubscriptionCanceled("account-001");

      expect(switchJobs.startCheckoutWindow).toHaveBeenCalledWith("account-001", "switch-001");
    });

    it("sends email notification", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount({ pendingGatewaySwitch: true, pendingGatewayProvider: "PADDLE" }),
      });
      (switchEventRepo.findLatestByAccountAndStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeSwitchEvent(),
      });
      (subscriptionRepo.findLatestByAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeSubscription(),
      });

      await service.handleSubscriptionCanceled("account-001");

      expect(emailPort.send).toHaveBeenCalledTimes(1);
      const emailCall = (emailPort.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      assert.deepEqual(emailCall.to, ["test@example.com"]);
      assert.ok(String(emailCall.subject).includes("gateway switch"));
    });

    it("returns ok(undefined) when switchEvent not found", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount({ pendingGatewaySwitch: true, pendingGatewayProvider: "PADDLE" }),
      });
      (switchEventRepo.findLatestByAccountAndStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: null,
      });

      const result = await service.handleSubscriptionCanceled("account-001");

      assert.ok(result.ok, "should return ok when no switch event found");
      expect(switchJobs.startCheckoutWindow).not.toHaveBeenCalled();
    });
  });

  // ── handleCheckoutCompleted ─────────────────────────────────────────────

  describe("handleCheckoutCompleted", () => {
    it("returns ACCOUNT_NOT_FOUND when account null", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: null,
      });

      const result = await service.handleCheckoutCompleted("account-001", "cus_new", "sub_new");

      assert.ok(!result.ok);
      assert.equal(result.error, "ACCOUNT_NOT_FOUND");
    });

    it("returns ok when no pending switch event", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount(),
      });
      (switchEventRepo.findLatestByAccountAndStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: null,
      });

      const result = await service.handleCheckoutCompleted("account-001", "cus_new", "sub_new");

      assert.ok(result.ok, "should return ok for normal checkout");
      expect(unitOfWork.executeInTransaction).not.toHaveBeenCalled();
    });

    it("updates account + subscriptions + switch to COMPLETED via UoW", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount(),
      });
      (switchEventRepo.findLatestByAccountAndStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeSwitchEvent({ status: "PENDING_CHECKOUT" }),
      });

      const result = await service.handleCheckoutCompleted("account-001", "cus_new", "sub_new");

      assert.ok(result.ok, "should succeed");
      expect(unitOfWork.executeInTransaction).toHaveBeenCalledTimes(1);
      expect(accountRepo.updateBillingFields).toHaveBeenCalledWith(
        "account-001",
        expect.objectContaining({
          gatewayProvider: "PADDLE",
          gatewayCustomerId: "cus_new",
          pendingGatewaySwitch: false,
        })
      );
      expect(subscriptionRepo.updateAllForAccount).toHaveBeenCalledWith(
        "account-001",
        expect.objectContaining({
          gatewayProvider: "PADDLE",
          gatewaySubscriptionId: "sub_new",
          status: "ACTIVE",
        })
      );
      expect(switchEventRepo.update).toHaveBeenCalledWith(
        "switch-001",
        expect.objectContaining({ status: "COMPLETED" })
      );
      expect(auditEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "GATEWAY_SWITCH_COMPLETED" })
      );
    });

    it("calls switchJobs.cancelJobs", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount(),
      });
      (switchEventRepo.findLatestByAccountAndStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeSwitchEvent({ status: "PENDING_CHECKOUT" }),
      });

      await service.handleCheckoutCompleted("account-001", "cus_new", "sub_new");

      expect(switchJobs.cancelJobs).toHaveBeenCalledWith("account-001");
    });
  });

  // ── extendSwitchDeadline ────────────────────────────────────────────────

  describe("extendSwitchDeadline", () => {
    it("returns MAX_EXTENSION_EXCEEDED when extraHours > 72", async () => {
      const result = await service.extendSwitchDeadline("account-001", 73, "admin-001");

      assert.ok(!result.ok);
      assert.equal(result.error, "MAX_EXTENSION_EXCEEDED");
    });

    it("returns SWITCH_NOT_FOUND when no PENDING_CHECKOUT event", async () => {
      (switchEventRepo.findLatestByAccountAndStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: null,
      });

      const result = await service.extendSwitchDeadline("account-001", 24, "admin-001");

      assert.ok(!result.ok);
      assert.equal(result.error, "SWITCH_NOT_FOUND");
    });

    it("calculates new deadline from extendedUntil if set", async () => {
      const extendedUntil = new Date("2026-06-02T12:00:00Z");
      (switchEventRepo.findLatestByAccountAndStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeSwitchEvent({ status: "PENDING_CHECKOUT", extendedUntil }),
      });

      const result = await service.extendSwitchDeadline("account-001", 24, "admin-001");

      assert.ok(result.ok, "should succeed");
      const expectedDeadline = new Date(extendedUntil.getTime() + 24 * 60 * 60 * 1000);
      assert.equal(result.value.newDeadline.toISOString(), expectedDeadline.toISOString());
    });

    it("calculates new deadline from scheduledFor if not extended", async () => {
      const scheduledFor = new Date("2026-06-01T00:00:00Z");
      (switchEventRepo.findLatestByAccountAndStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeSwitchEvent({
          status: "PENDING_CHECKOUT",
          extendedUntil: null,
          scheduledFor,
        }),
      });

      const result = await service.extendSwitchDeadline("account-001", 48, "admin-001");

      assert.ok(result.ok, "should succeed");
      const expectedDeadline = new Date(scheduledFor.getTime() + 48 * 60 * 60 * 1000);
      assert.equal(result.value.newDeadline.toISOString(), expectedDeadline.toISOString());
    });

    it("calls switchJobs.rescheduleJobs", async () => {
      const scheduledFor = new Date("2026-06-01T00:00:00Z");
      (switchEventRepo.findLatestByAccountAndStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeSwitchEvent({
          status: "PENDING_CHECKOUT",
          extendedUntil: null,
          scheduledFor,
        }),
      });

      await service.extendSwitchDeadline("account-001", 12, "admin-001");

      const expectedDeadline = new Date(scheduledFor.getTime() + 12 * 60 * 60 * 1000);
      expect(switchJobs.rescheduleJobs).toHaveBeenCalledWith("account-001", expectedDeadline);
    });

    it("updates switch event with new deadline", async () => {
      (switchEventRepo.findLatestByAccountAndStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeSwitchEvent({ status: "PENDING_CHECKOUT", extendedUntil: null }),
      });

      const result = await service.extendSwitchDeadline("account-001", 24, "admin-001");

      assert.ok(result.ok, "should succeed");
      assert.equal(result.value.extendedBy, "admin-001");
      expect(switchEventRepo.update).toHaveBeenCalledWith("switch-001", {
        extendedUntil: result.value.newDeadline,
        extendedBy: "admin-001",
      });
    });
  });

  // ── createCheckoutSession ───────────────────────────────────────────────

  describe("createCheckoutSession", () => {
    it("returns ACCOUNT_NOT_FOUND when account null", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: null,
      });

      const result = await service.createCheckoutSession(
        "account-001",
        "stripe",
        "https://success.test",
        "https://cancel.test"
      );

      assert.ok(!result.ok);
      assert.equal(result.error, "ACCOUNT_NOT_FOUND");
    });

    it("creates customer when gatewayCustomerId missing", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount({ gatewayCustomerId: null }),
      });

      const result = await service.createCheckoutSession(
        "account-001",
        "stripe",
        "https://success.test",
        "https://cancel.test"
      );

      assert.ok(result.ok, "should succeed");
      const adapter = mockRegistry._adapter;
      expect(adapter.createCustomer).toHaveBeenCalledWith({
        email: "test@example.com",
        name: "Test Account",
        metadata: { accountId: "account-001" },
      });
      expect(accountRepo.updateBillingFields).toHaveBeenCalledWith("account-001", {
        gatewayCustomerId: "cus_test",
        gatewayProvider: "STRIPE",
      });
    });

    it("returns checkout URL from adapter", async () => {
      (accountRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeAccount(),
      });

      const result = await service.createCheckoutSession(
        "account-001",
        "stripe",
        "https://success.test",
        "https://cancel.test"
      );

      assert.ok(result.ok, "should succeed");
      assert.equal(result.value.url, "https://checkout.test");
      const adapter = mockRegistry._adapter;
      expect(adapter.createCheckoutSession).toHaveBeenCalledWith({
        externalCustomerId: "cus_existing",
        successUrl: "https://success.test",
        cancelUrl: "https://cancel.test",
        metadata: { accountId: "account-001" },
      });
    });
  });
});
