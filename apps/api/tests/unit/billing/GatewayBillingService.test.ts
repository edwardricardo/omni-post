/**
 * @file GatewayBillingService.test.ts
 * @description Unit tests for gateway billing service — switch lifecycle,
 *   checkout sessions, billing portal, idempotency, and query methods.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { GatewayBillingService } from "../../../src/billing/GatewayBillingService.js";
import type { PrismaClient } from "@infra/prisma";
import type { GatewayAdapterRegistryPort } from "../../../src/infrastructure/billing/GatewayAdapterRegistry.js";
import type { GatewaySwitchJobService } from "../../../src/billing/GatewaySwitchJobService.js";
import type { EmailPort } from "@core/domain/repositories/EmailPort.js";

// ── Mock Factories ──────────────────────────────────────────────────────────

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
      count: vi.fn(),
      findMany: vi.fn(),
    },
    billingEvent: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    providerBundle: {
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (ops: unknown[]) => {
      const results = [];
      for (const op of ops) {
        results.push(await (op as Promise<unknown>));
      }
      return results;
    }),
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

function makeMockSwitchJobService() {
  return {
    startCheckoutWindow: vi.fn().mockResolvedValue(undefined),
    cancelJobs: vi.fn().mockResolvedValue(undefined),
    rescheduleJobs: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockEmailPort() {
  return {
    send: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  };
}

function makeAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: "account-001",
    name: "Test Account",
    email: "test@example.com",
    gatewayProvider: "STRIPE",
    gatewayCustomerId: "cus_existing",
    pendingGatewaySwitch: false,
    pendingGatewayProvider: null,
    gatewaySwitchAt: null,
    ...overrides,
  };
}

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-001",
    accountId: "account-001",
    status: "ACTIVE",
    gatewaySubscriptionId: "ext_sub_001",
    externalSubscriptionId: null,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  };
}

function makeSwitchEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "switch-001",
    accountId: "account-001",
    fromGateway: "STRIPE",
    toGateway: "PADDLE",
    status: "SCHEDULED",
    scheduledFor: new Date("2026-06-01T00:00:00Z"),
    extendedUntil: null,
    extendedBy: null,
    completedAt: null,
    cancelledAt: null,
    suspendedAt: null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    ...overrides,
  };
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe("GatewayBillingService", () => {
  let service: GatewayBillingService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;
  let mockRegistry: ReturnType<typeof makeMockRegistry>;
  let mockSwitchJobService: ReturnType<typeof makeMockSwitchJobService>;
  let mockEmailPort: ReturnType<typeof makeMockEmailPort>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = makeMockPrisma();
    mockRegistry = makeMockRegistry();
    mockSwitchJobService = makeMockSwitchJobService();
    mockEmailPort = makeMockEmailPort();
    service = new GatewayBillingService(
      mockPrisma as unknown as PrismaClient,
      mockRegistry as unknown as GatewayAdapterRegistryPort,
      mockSwitchJobService as unknown as GatewaySwitchJobService,
      mockEmailPort as unknown as EmailPort
    );
  });

  // ── initiateGatewaySwitch ───────────────────────────────────────────────

  describe("initiateGatewaySwitch", () => {
    it("returns ACCOUNT_NOT_FOUND when account is null", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(null);

      const result = await service.initiateGatewaySwitch("account-001", "paddle");

      assert.ok(!result.ok);
      assert.equal(result.error, "ACCOUNT_NOT_FOUND");
    });

    it("returns SAME_GATEWAY when account.gatewayProvider matches target", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(makeAccount({ gatewayProvider: "STRIPE" }));

      const result = await service.initiateGatewaySwitch("account-001", "stripe");

      assert.ok(!result.ok);
      assert.equal(result.error, "SAME_GATEWAY");
    });

    it("returns SWITCH_ALREADY_PENDING when pendingGatewaySwitch is true", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(makeAccount({ pendingGatewaySwitch: true }));

      const result = await service.initiateGatewaySwitch("account-001", "paddle");

      assert.ok(!result.ok);
      assert.equal(result.error, "SWITCH_ALREADY_PENDING");
    });

    it("returns NO_ACTIVE_SUBSCRIPTION when no active/trialing subscription", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(makeAccount());
      mockPrisma.accountSubscription.findFirst.mockResolvedValue(null);

      const result = await service.initiateGatewaySwitch("account-001", "paddle");

      assert.ok(!result.ok);
      assert.equal(result.error, "NO_ACTIVE_SUBSCRIPTION");
    });

    it("calls getSubscriptionDetails on registry adapter", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(makeAccount());
      mockPrisma.accountSubscription.findFirst.mockResolvedValue(makeSubscription());
      mockPrisma.$transaction.mockResolvedValue([{ id: "switch-new", accountId: "account-001" }]);

      await service.initiateGatewaySwitch("account-001", "paddle");

      const adapter = mockRegistry._adapter;
      expect(adapter.getSubscriptionDetails).toHaveBeenCalledWith({
        externalSubscriptionId: "ext_sub_001",
      });
    });

    it("calls cancelAtPeriodEnd on adapter with subscription ID", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(makeAccount());
      mockPrisma.accountSubscription.findFirst.mockResolvedValue(makeSubscription());
      mockPrisma.$transaction.mockResolvedValue([{ id: "switch-new", accountId: "account-001" }]);

      await service.initiateGatewaySwitch("account-001", "paddle");

      const adapter = mockRegistry._adapter;
      expect(adapter.cancelAtPeriodEnd).toHaveBeenCalledWith({
        externalSubscriptionId: "ext_sub_001",
      });
    });

    it("creates GatewaySwitchEvent via $transaction", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(makeAccount());
      mockPrisma.accountSubscription.findFirst.mockResolvedValue(makeSubscription());
      mockPrisma.$transaction.mockResolvedValue([{ id: "switch-new", accountId: "account-001" }]);

      await service.initiateGatewaySwitch("account-001", "paddle");

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      const txArgs = mockPrisma.$transaction.mock.calls[0][0];
      assert.ok(Array.isArray(txArgs), "$transaction should receive an array");
      assert.equal(txArgs.length, 4); // create switch, update account, update sub, audit log
    });

    it("returns switchEventId and scheduledFor", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(makeAccount());
      mockPrisma.accountSubscription.findFirst.mockResolvedValue(makeSubscription());
      mockPrisma.$transaction.mockResolvedValue([{ id: "switch-new", accountId: "account-001" }]);

      const result = await service.initiateGatewaySwitch("account-001", "paddle");

      assert.ok(result.ok, "should succeed");
      assert.equal(result.value.switchEventId, "switch-new");
      assert.ok(result.value.scheduledFor instanceof Date);
      assert.equal(result.value.fromGateway, "STRIPE");
      assert.equal(result.value.toGateway, "PADDLE");
    });

    it("returns DATABASE_ERROR when prisma throws", async () => {
      mockPrisma.account.findUnique.mockRejectedValue(new Error("Connection lost"));

      const result = await service.initiateGatewaySwitch("account-001", "paddle");

      assert.ok(!result.ok);
      assert.equal(result.error, "DATABASE_ERROR");
    });

    it("works without externalSubscriptionId (uses currentPeriodEnd from DB)", async () => {
      const periodEnd = new Date("2026-07-15T00:00:00Z");
      mockPrisma.account.findUnique.mockResolvedValue(makeAccount());
      mockPrisma.accountSubscription.findFirst.mockResolvedValue(
        makeSubscription({
          gatewaySubscriptionId: null,
          externalSubscriptionId: null,
          currentPeriodEnd: periodEnd,
        })
      );
      mockPrisma.$transaction.mockResolvedValue([
        { id: "switch-no-ext", accountId: "account-001" },
      ]);

      const result = await service.initiateGatewaySwitch("account-001", "paddle");

      assert.ok(result.ok, "should succeed without external subscription ID");
      assert.equal(result.value.scheduledFor.toISOString(), periodEnd.toISOString());
      // Should NOT call getSubscriptionDetails or cancelAtPeriodEnd
      const adapter = mockRegistry._adapter;
      expect(adapter.getSubscriptionDetails).not.toHaveBeenCalled();
      expect(adapter.cancelAtPeriodEnd).not.toHaveBeenCalled();
    });
  });

  // ── cancelPendingSwitch ─────────────────────────────────────────────────

  describe("cancelPendingSwitch", () => {
    it("returns ACCOUNT_NOT_FOUND when account null", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(null);

      const result = await service.cancelPendingSwitch("account-001");

      assert.ok(!result.ok);
      assert.equal(result.error, "ACCOUNT_NOT_FOUND");
    });

    it("returns SWITCH_NOT_FOUND when no pending switch", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(makeAccount({ pendingGatewaySwitch: false }));

      const result = await service.cancelPendingSwitch("account-001");

      assert.ok(!result.ok);
      assert.equal(result.error, "SWITCH_NOT_FOUND");
    });

    it("calls reactivateSubscription on adapter", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(makeAccount({ pendingGatewaySwitch: true }));
      mockPrisma.gatewaySwitchEvent.findFirst.mockResolvedValue(makeSwitchEvent());
      mockPrisma.accountSubscription.findFirst.mockResolvedValue(makeSubscription());
      mockPrisma.$transaction.mockResolvedValue([]);

      await service.cancelPendingSwitch("account-001");

      const adapter = mockRegistry._adapter;
      expect(adapter.reactivateSubscription).toHaveBeenCalledWith({
        externalSubscriptionId: "ext_sub_001",
      });
    });

    it("calls switchJobService.cancelJobs", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(makeAccount({ pendingGatewaySwitch: true }));
      mockPrisma.gatewaySwitchEvent.findFirst.mockResolvedValue(makeSwitchEvent());
      mockPrisma.accountSubscription.findFirst.mockResolvedValue(makeSubscription());
      mockPrisma.$transaction.mockResolvedValue([]);

      await service.cancelPendingSwitch("account-001");

      expect(mockSwitchJobService.cancelJobs).toHaveBeenCalledWith("account-001");
    });

    it("clears pending fields on account", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(makeAccount({ pendingGatewaySwitch: true }));
      mockPrisma.gatewaySwitchEvent.findFirst.mockResolvedValue(makeSwitchEvent());
      mockPrisma.accountSubscription.findFirst.mockResolvedValue(makeSubscription());
      mockPrisma.$transaction.mockResolvedValue([]);

      const result = await service.cancelPendingSwitch("account-001");

      assert.ok(result.ok, "should succeed");
      assert.deepEqual(result.value, { cancelled: true });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ── handleSubscriptionCanceled ──────────────────────────────────────────

  describe("handleSubscriptionCanceled", () => {
    it("returns ACCOUNT_NOT_FOUND when account null", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(null);

      const result = await service.handleSubscriptionCanceled("account-001");

      assert.ok(!result.ok);
      assert.equal(result.error, "ACCOUNT_NOT_FOUND");
    });

    it("returns ok when no pending switch (normal cancellation)", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(
        makeAccount({ pendingGatewaySwitch: false, pendingGatewayProvider: null })
      );

      const result = await service.handleSubscriptionCanceled("account-001");

      assert.ok(result.ok, "should return ok for normal cancellation");
      // Should not query for switch events
      expect(mockPrisma.gatewaySwitchEvent.findFirst).not.toHaveBeenCalled();
    });

    it("transitions switch to PENDING_CHECKOUT when pendingGatewaySwitch=true", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(
        makeAccount({ pendingGatewaySwitch: true, pendingGatewayProvider: "PADDLE" })
      );
      mockPrisma.gatewaySwitchEvent.findFirst.mockResolvedValue(makeSwitchEvent());
      mockPrisma.accountSubscription.findFirst.mockResolvedValue(makeSubscription());
      mockPrisma.$transaction.mockResolvedValue([]);

      const result = await service.handleSubscriptionCanceled("account-001");

      assert.ok(result.ok, "should succeed");
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("calls switchJobService.startCheckoutWindow", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(
        makeAccount({ pendingGatewaySwitch: true, pendingGatewayProvider: "PADDLE" })
      );
      mockPrisma.gatewaySwitchEvent.findFirst.mockResolvedValue(makeSwitchEvent());
      mockPrisma.accountSubscription.findFirst.mockResolvedValue(makeSubscription());
      mockPrisma.$transaction.mockResolvedValue([]);

      await service.handleSubscriptionCanceled("account-001");

      expect(mockSwitchJobService.startCheckoutWindow).toHaveBeenCalledWith(
        "account-001",
        "switch-001"
      );
    });

    it("sends email notification", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(
        makeAccount({ pendingGatewaySwitch: true, pendingGatewayProvider: "PADDLE" })
      );
      mockPrisma.gatewaySwitchEvent.findFirst.mockResolvedValue(makeSwitchEvent());
      mockPrisma.accountSubscription.findFirst.mockResolvedValue(makeSubscription());
      mockPrisma.$transaction.mockResolvedValue([]);

      await service.handleSubscriptionCanceled("account-001");

      expect(mockEmailPort.send).toHaveBeenCalledTimes(1);
      const emailCall = mockEmailPort.send.mock.calls[0][0];
      assert.deepEqual(emailCall.to, ["test@example.com"]);
      assert.ok(emailCall.subject.includes("gateway switch"));
    });

    it("marks subscription as CANCELED", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(
        makeAccount({ pendingGatewaySwitch: true, pendingGatewayProvider: "PADDLE" })
      );
      mockPrisma.gatewaySwitchEvent.findFirst.mockResolvedValue(makeSwitchEvent());
      mockPrisma.accountSubscription.findFirst.mockResolvedValue(makeSubscription());
      mockPrisma.$transaction.mockResolvedValue([]);

      await service.handleSubscriptionCanceled("account-001");

      // $transaction receives array with switch update + subscription update
      const txArgs = mockPrisma.$transaction.mock.calls[0][0];
      assert.ok(Array.isArray(txArgs));
      assert.equal(txArgs.length, 2); // switch event update + subscription update
    });

    it("returns ok(undefined) when switchEvent not found", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(
        makeAccount({ pendingGatewaySwitch: true, pendingGatewayProvider: "PADDLE" })
      );
      mockPrisma.gatewaySwitchEvent.findFirst.mockResolvedValue(null);

      const result = await service.handleSubscriptionCanceled("account-001");

      assert.ok(result.ok, "should return ok when no switch event found");
      // Should not start checkout window
      expect(mockSwitchJobService.startCheckoutWindow).not.toHaveBeenCalled();
    });
  });

  // ── handleCheckoutCompleted ─────────────────────────────────────────────

  describe("handleCheckoutCompleted", () => {
    it("returns ACCOUNT_NOT_FOUND when account null", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(null);

      const result = await service.handleCheckoutCompleted("account-001", "cus_new", "sub_new");

      assert.ok(!result.ok);
      assert.equal(result.error, "ACCOUNT_NOT_FOUND");
    });

    it("returns ok when no pending switch event", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(makeAccount());
      mockPrisma.gatewaySwitchEvent.findFirst.mockResolvedValue(null);

      const result = await service.handleCheckoutCompleted("account-001", "cus_new", "sub_new");

      assert.ok(result.ok, "should return ok for normal checkout");
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("updates switch to COMPLETED", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(makeAccount());
      mockPrisma.gatewaySwitchEvent.findFirst.mockResolvedValue(
        makeSwitchEvent({ status: "PENDING_CHECKOUT" })
      );
      mockPrisma.$transaction.mockResolvedValue([]);

      const result = await service.handleCheckoutCompleted("account-001", "cus_new", "sub_new");

      assert.ok(result.ok, "should succeed");
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      const txArgs = mockPrisma.$transaction.mock.calls[0][0];
      assert.ok(Array.isArray(txArgs));
      // account update, subscription updateMany, switch update, audit log
      assert.equal(txArgs.length, 4);
    });

    it("calls switchJobService.cancelJobs", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(makeAccount());
      mockPrisma.gatewaySwitchEvent.findFirst.mockResolvedValue(
        makeSwitchEvent({ status: "PENDING_CHECKOUT" })
      );
      mockPrisma.$transaction.mockResolvedValue([]);

      await service.handleCheckoutCompleted("account-001", "cus_new", "sub_new");

      expect(mockSwitchJobService.cancelJobs).toHaveBeenCalledWith("account-001");
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
      mockPrisma.gatewaySwitchEvent.findFirst.mockResolvedValue(null);

      const result = await service.extendSwitchDeadline("account-001", 24, "admin-001");

      assert.ok(!result.ok);
      assert.equal(result.error, "SWITCH_NOT_FOUND");
    });

    it("calculates new deadline from extendedUntil if set", async () => {
      const extendedUntil = new Date("2026-06-02T12:00:00Z");
      mockPrisma.gatewaySwitchEvent.findFirst.mockResolvedValue(
        makeSwitchEvent({
          status: "PENDING_CHECKOUT",
          extendedUntil,
        })
      );

      const result = await service.extendSwitchDeadline("account-001", 24, "admin-001");

      assert.ok(result.ok, "should succeed");
      const expectedDeadline = new Date(extendedUntil.getTime() + 24 * 60 * 60 * 1000);
      assert.equal(result.value.newDeadline.toISOString(), expectedDeadline.toISOString());
    });

    it("calculates new deadline from scheduledFor if not extended", async () => {
      const scheduledFor = new Date("2026-06-01T00:00:00Z");
      mockPrisma.gatewaySwitchEvent.findFirst.mockResolvedValue(
        makeSwitchEvent({
          status: "PENDING_CHECKOUT",
          extendedUntil: null,
          scheduledFor,
        })
      );

      const result = await service.extendSwitchDeadline("account-001", 48, "admin-001");

      assert.ok(result.ok, "should succeed");
      const expectedDeadline = new Date(scheduledFor.getTime() + 48 * 60 * 60 * 1000);
      assert.equal(result.value.newDeadline.toISOString(), expectedDeadline.toISOString());
    });

    it("calls switchJobService.rescheduleJobs", async () => {
      const scheduledFor = new Date("2026-06-01T00:00:00Z");
      mockPrisma.gatewaySwitchEvent.findFirst.mockResolvedValue(
        makeSwitchEvent({
          status: "PENDING_CHECKOUT",
          extendedUntil: null,
          scheduledFor,
        })
      );

      await service.extendSwitchDeadline("account-001", 12, "admin-001");

      const expectedDeadline = new Date(scheduledFor.getTime() + 12 * 60 * 60 * 1000);
      expect(mockSwitchJobService.rescheduleJobs).toHaveBeenCalledWith(
        "account-001",
        expectedDeadline
      );
    });

    it("updates gatewaySwitchEvent with new deadline", async () => {
      mockPrisma.gatewaySwitchEvent.findFirst.mockResolvedValue(
        makeSwitchEvent({
          status: "PENDING_CHECKOUT",
          extendedUntil: null,
        })
      );

      const result = await service.extendSwitchDeadline("account-001", 24, "admin-001");

      assert.ok(result.ok, "should succeed");
      assert.equal(result.value.extendedBy, "admin-001");
      expect(mockPrisma.gatewaySwitchEvent.update).toHaveBeenCalledWith({
        where: { id: "switch-001" },
        data: {
          extendedUntil: result.value.newDeadline,
          extendedBy: "admin-001",
        },
      });
    });
  });

  // ── createCheckoutSession ───────────────────────────────────────────────

  describe("createCheckoutSession", () => {
    it("returns ACCOUNT_NOT_FOUND when account null", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(null);

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
      mockPrisma.account.findUnique.mockResolvedValue(makeAccount({ gatewayCustomerId: null }));

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
      // Account should be updated with new customer ID
      expect(mockPrisma.account.update).toHaveBeenCalledWith({
        where: { id: "account-001" },
        data: {
          gatewayCustomerId: "cus_test",
          gatewayProvider: "STRIPE",
        },
      });
    });

    it("returns checkout URL from adapter", async () => {
      mockPrisma.account.findUnique.mockResolvedValue(makeAccount());

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
