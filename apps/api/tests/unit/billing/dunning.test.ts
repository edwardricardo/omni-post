/**
 * @file dunning.test.ts
 * @description Unit tests for dunning (payment failed/succeeded) and
 *   cancellation email. Post-S3.4c the service is framework-free; tests
 *   mock the 9 ports + UoW.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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

// ─── Mock Factories ─────────────────────────────────────────────────────────

const TEST_ACCOUNT = {
  id: "acc-1",
  name: "Test Co",
  email: "test@co.com",
  gatewayProvider: "STRIPE" as const,
  gatewayCustomerId: "cus_123",
  pendingGatewaySwitch: false,
  pendingGatewayProvider: null,
  gatewaySwitchAt: null,
  status: "ACTIVE",
};

const TEST_SUBSCRIPTION = {
  id: "sub-1",
  accountId: "acc-1",
  status: "ACTIVE" as const,
  gatewayProvider: "STRIPE" as const,
  gatewaySubscriptionId: null,
  externalSubscriptionId: null,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: new Date("2026-05-01"),
  bundleId: "bundle-1",
};

function makeAccountRepo(
  overrides: { account?: typeof TEST_ACCOUNT | null } = {}
): AccountBillingRepository {
  const account = overrides.account === undefined ? TEST_ACCOUNT : overrides.account;
  return {
    findById: vi.fn().mockResolvedValue({ ok: true, value: account }),
    findByGatewayCustomerId: vi.fn().mockResolvedValue({ ok: true, value: account }),
    updateBillingFields: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  };
}

function makeSubscriptionRepo(
  overrides: {
    sub?: typeof TEST_SUBSCRIPTION | null;
    pastDueSub?: typeof TEST_SUBSCRIPTION | null;
  } = {}
): AccountSubscriptionBillingRepository {
  return {
    findActiveOrTrialingByAccount: vi.fn().mockResolvedValue({
      ok: true,
      value: overrides.sub === undefined ? TEST_SUBSCRIPTION : overrides.sub,
    }),
    findLatestByAccount: vi.fn().mockResolvedValue({
      ok: true,
      value: overrides.sub === undefined ? TEST_SUBSCRIPTION : overrides.sub,
    }),
    findByAccountAndStatus: vi.fn().mockResolvedValue({
      ok: true,
      value: overrides.pastDueSub ?? null,
    }),
    update: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    updateAllForAccount: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  };
}

function makeSwitchEventRepo(
  overrides: { event?: { id: string; status: string } | null } = {}
): GatewaySwitchEventRepository {
  const event = overrides.event;
  return {
    create: vi.fn().mockResolvedValue({ ok: true, value: { id: "switch-new" } }),
    findById: vi.fn().mockResolvedValue({ ok: true, value: null }),
    findLatestByAccountAndStatus: vi.fn().mockResolvedValue({
      ok: true,
      value: event
        ? {
            id: event.id,
            accountId: "acc-1",
            fromGateway: "STRIPE",
            toGateway: "PADDLE",
            status: event.status,
            scheduledFor: new Date(),
            extendedUntil: null,
            extendedBy: null,
            completedAt: null,
            cancelledAt: null,
            suspendedAt: null,
            reminderSentAt: null,
            createdAt: new Date(),
          }
        : null,
    }),
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
  return { listActive: vi.fn().mockResolvedValue({ ok: true, value: [] }) };
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
  return { getAdapter: vi.fn().mockReturnValue({}) } as unknown as GatewayAdapterRegistryPort;
}

interface ServiceBag {
  service: GatewayBillingService;
  accountRepo: AccountBillingRepository;
  subscriptionRepo: AccountSubscriptionBillingRepository;
  switchEventRepo: GatewaySwitchEventRepository;
  invoiceRepo: InvoiceRepository;
  switchJobs: GatewaySwitchJobPort;
  emailPort: EmailPort;
}

function buildService(
  overrides: {
    account?: typeof TEST_ACCOUNT | null;
    sub?: typeof TEST_SUBSCRIPTION | null;
    pastDueSub?: typeof TEST_SUBSCRIPTION | null;
    event?: { id: string; status: string } | null;
  } = {}
): ServiceBag {
  const accountRepo = makeAccountRepo({
    ...("account" in overrides && { account: overrides.account }),
  });
  const subscriptionRepo = makeSubscriptionRepo({
    ...("sub" in overrides && { sub: overrides.sub }),
    ...("pastDueSub" in overrides && { pastDueSub: overrides.pastDueSub }),
  });
  const switchEventRepo = makeSwitchEventRepo({
    ...("event" in overrides && { event: overrides.event }),
  });
  const invoiceRepo = makeInvoiceRepo();
  const switchJobs = makeSwitchJobs();
  const emailPort = makeEmailPort();
  const service = new GatewayBillingService(
    accountRepo,
    subscriptionRepo,
    switchEventRepo,
    makeBillingEventRepo(),
    invoiceRepo,
    makeBundleReader(),
    makeMockRegistry(),
    switchJobs,
    emailPort,
    makeAuditEmitter(),
    makeUnitOfWork()
  );
  return {
    service,
    accountRepo,
    subscriptionRepo,
    switchEventRepo,
    invoiceRepo,
    switchJobs,
    emailPort,
  };
}

const makeEventData = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "inv_test_123",
  attempt_count: 1,
  amount_due: 2900,
  currency: "usd",
  period_start: Math.floor(Date.now() / 1000),
  period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
  subscription_id: "sub_abc",
  ...overrides,
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("handlePaymentFailed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transitions subscription to PAST_DUE on first attempt", async () => {
    const bag = buildService();
    const result = await bag.service.handlePaymentFailed(makeEventData(), "cus_123");

    expect(result.ok).toBe(true);
    expect(bag.subscriptionRepo.update).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ status: "PAST_DUE" })
    );
  });

  it("creates Invoice record with PAYMENT_FAILED status", async () => {
    const bag = buildService();
    await bag.service.handlePaymentFailed(makeEventData(), "cus_123");

    expect(bag.invoiceRepo.upsertByGatewayInvoiceId).toHaveBeenCalledWith(
      "inv_test_123",
      expect.objectContaining({ status: "PAYMENT_FAILED", attemptCount: 1 }),
      expect.objectContaining({ status: "PAYMENT_FAILED" })
    );
  });

  it("sends dunning email with correct attempt count", async () => {
    const bag = buildService();
    await bag.service.handlePaymentFailed(makeEventData({ attempt_count: 2 }), "cus_123");

    expect(bag.emailPort.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["test@co.com"],
        subject: expect.stringContaining("Payment failed"),
      })
    );
  });

  it("cancels subscription after 3 failed attempts", async () => {
    const bag = buildService();
    const result = await bag.service.handlePaymentFailed(
      makeEventData({ attempt_count: 3 }),
      "cus_123"
    );

    expect(result.ok).toBe(true);
    expect(bag.subscriptionRepo.update).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ status: "CANCELED" })
    );
  });

  it("sends final notice email on 3rd attempt", async () => {
    const bag = buildService();
    await bag.service.handlePaymentFailed(makeEventData({ attempt_count: 3 }), "cus_123");

    expect(bag.emailPort.send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining("suspended"),
      })
    );
  });

  it("is idempotent — same gatewayInvoiceId processed twice", async () => {
    const bag = buildService();
    await bag.service.handlePaymentFailed(makeEventData(), "cus_123");
    await bag.service.handlePaymentFailed(makeEventData(), "cus_123");

    expect(bag.invoiceRepo.upsertByGatewayInvoiceId).toHaveBeenCalledTimes(2);
    const calls = (bag.invoiceRepo.upsertByGatewayInvoiceId as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe(calls[1][0]);
  });

  it("returns ACCOUNT_NOT_FOUND when customer does not exist", async () => {
    const bag = buildService({ account: null });
    const result = await bag.service.handlePaymentFailed(makeEventData(), "unknown");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("ACCOUNT_NOT_FOUND");
  });
});

describe("handlePaymentSucceeded", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates Invoice record with PAID status", async () => {
    const bag = buildService({ sub: null });
    await bag.service.handlePaymentSucceeded(makeEventData({ amount_paid: 2900 }), "cus_123");

    expect(bag.invoiceRepo.upsertByGatewayInvoiceId).toHaveBeenCalledWith(
      "inv_test_123",
      expect.objectContaining({ status: "PAID" }),
      expect.objectContaining({ status: "PAID" })
    );
  });

  it("recovers PAST_DUE subscription to ACTIVE", async () => {
    const pastDueSub = { ...TEST_SUBSCRIPTION, status: "PAST_DUE" as const };
    const bag = buildService({ pastDueSub });
    await bag.service.handlePaymentSucceeded(makeEventData(), "cus_123");

    expect(bag.subscriptionRepo.update).toHaveBeenCalledWith(
      pastDueSub.id,
      expect.objectContaining({ status: "ACTIVE" })
    );
  });
});

describe("handleSubscriptionCanceled — email", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends cancellation email for regular cancellation", async () => {
    const bag = buildService();
    await bag.service.handleSubscriptionCanceled("acc-1");

    expect(bag.emailPort.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["test@co.com"],
        subject: expect.stringContaining("cancelled"),
      })
    );
  });

  it("does NOT send cancellation email for gateway-switch cancellation", async () => {
    const switchAccount = {
      ...TEST_ACCOUNT,
      pendingGatewaySwitch: true,
      pendingGatewayProvider: "PADDLE" as const,
    };
    const bag = buildService({
      account: switchAccount,
      event: { id: "sw-1", status: "SCHEDULED" },
    });

    await bag.service.handleSubscriptionCanceled("acc-1");

    // The email sent is the gateway-switch email, not the regular cancellation email.
    const sendCalls = (bag.emailPort.send as ReturnType<typeof vi.fn>).mock.calls;
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0][0].subject).toContain("gateway switch");
  });
});
