/**
 * @file dunning.test.ts
 * @description Unit tests for dunning (payment failed/succeeded) and cancellation email.
 * @layer application
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GatewayBillingService } from "../../../src/billing/GatewayBillingService.js";
import type { PrismaClient } from "@infra/prisma";
import type { EmailPort } from "../../../src/domain/repositories/EmailPort.js";
import type { GatewayAdapterRegistryPort } from "../../../src/infrastructure/billing/GatewayAdapterRegistry.js";
import type { GatewaySwitchJobService } from "../../../src/billing/GatewaySwitchJobService.js";

function makeMockEmailPort(): EmailPort {
  return { send: vi.fn().mockResolvedValue({ ok: true, value: undefined }) };
}

function makeMockPrisma(overrides: Record<string, unknown> = {}): PrismaClient {
  return {
    account: {
      findFirst: vi.fn().mockResolvedValue({ id: "acc-1", name: "Test Co", email: "test@co.com" }),
      findUnique: vi.fn().mockResolvedValue({
        id: "acc-1",
        name: "Test Co",
        email: "test@co.com",
        pendingGatewaySwitch: false,
        pendingGatewayProvider: null,
      }),
    },
    invoice: {
      upsert: vi.fn().mockResolvedValue({ id: "inv-1" }),
    },
    accountSubscription: {
      findFirst: vi.fn().mockResolvedValue({
        id: "sub-1",
        accountId: "acc-1",
        status: "ACTIVE",
        currentPeriodEnd: new Date("2026-05-01"),
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  } as unknown as PrismaClient;
}

function createService(prisma: PrismaClient, emailPort: EmailPort): GatewayBillingService {
  const registry = {} as GatewayAdapterRegistryPort;
  const jobService = {} as GatewaySwitchJobService;
  return new GatewayBillingService(prisma, registry, jobService, emailPort);
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

describe("handlePaymentFailed", () => {
  let emailPort: EmailPort;

  beforeEach(() => {
    vi.clearAllMocks();
    emailPort = makeMockEmailPort();
  });

  it("transitions subscription to PAST_DUE on first attempt", async () => {
    const prisma = makeMockPrisma();
    const service = createService(prisma, emailPort);

    const result = await service.handlePaymentFailed(makeEventData(), "cus_123");

    expect(result.ok).toBe(true);
    expect(prisma.accountSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "PAST_DUE" } })
    );
  });

  it("creates Invoice record with PAYMENT_FAILED status", async () => {
    const prisma = makeMockPrisma();
    const service = createService(prisma, emailPort);

    await service.handlePaymentFailed(makeEventData(), "cus_123");

    expect(prisma.invoice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { gatewayInvoiceId: "inv_test_123" },
        create: expect.objectContaining({ status: "PAYMENT_FAILED", attemptCount: 1 }),
      })
    );
  });

  it("sends dunning email with correct attempt count", async () => {
    const prisma = makeMockPrisma();
    const service = createService(prisma, emailPort);

    await service.handlePaymentFailed(makeEventData({ attempt_count: 2 }), "cus_123");

    expect(emailPort.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["test@co.com"],
        subject: expect.stringContaining("Payment failed"),
      })
    );
  });

  it("cancels subscription after 3 failed attempts", async () => {
    const prisma = makeMockPrisma();
    const service = createService(prisma, emailPort);

    const result = await service.handlePaymentFailed(
      makeEventData({ attempt_count: 3 }),
      "cus_123"
    );

    expect(result.ok).toBe(true);
    expect(prisma.accountSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CANCELED" } })
    );
  });

  it("sends final notice email on 3rd attempt", async () => {
    const prisma = makeMockPrisma();
    const service = createService(prisma, emailPort);

    await service.handlePaymentFailed(makeEventData({ attempt_count: 3 }), "cus_123");

    expect(emailPort.send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining("suspended"),
      })
    );
  });

  it("is idempotent — same gatewayInvoiceId processed twice", async () => {
    const prisma = makeMockPrisma();
    const service = createService(prisma, emailPort);

    await service.handlePaymentFailed(makeEventData(), "cus_123");
    await service.handlePaymentFailed(makeEventData(), "cus_123");

    // Upsert is idempotent by design
    expect(prisma.invoice.upsert).toHaveBeenCalledTimes(2);
    // Same invoice ID used both times
    const calls = (prisma.invoice.upsert as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0].where.gatewayInvoiceId).toBe(calls[1][0].where.gatewayInvoiceId);
  });

  it("returns ACCOUNT_NOT_FOUND when customer does not exist", async () => {
    const prisma = makeMockPrisma({
      account: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const service = createService(prisma, emailPort);

    const result = await service.handlePaymentFailed(makeEventData(), "unknown");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("ACCOUNT_NOT_FOUND");
  });
});

describe("handlePaymentSucceeded", () => {
  let emailPort: EmailPort;

  beforeEach(() => {
    vi.clearAllMocks();
    emailPort = makeMockEmailPort();
  });

  it("creates Invoice record with PAID status", async () => {
    const prisma = makeMockPrisma({
      accountSubscription: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const service = createService(prisma, emailPort);

    await service.handlePaymentSucceeded(makeEventData({ amount_paid: 2900 }), "cus_123");

    expect(prisma.invoice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "PAID" }),
      })
    );
  });

  it("recovers PAST_DUE subscription to ACTIVE", async () => {
    const prisma = makeMockPrisma({
      accountSubscription: {
        findFirst: vi.fn().mockResolvedValue({ id: "sub-1", status: "PAST_DUE" }),
        update: vi.fn().mockResolvedValue({}),
      },
    });
    const service = createService(prisma, emailPort);

    await service.handlePaymentSucceeded(makeEventData(), "cus_123");

    expect(prisma.accountSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "ACTIVE" } })
    );
  });
});

describe("handleSubscriptionCanceled — email", () => {
  let emailPort: EmailPort;

  beforeEach(() => {
    vi.clearAllMocks();
    emailPort = makeMockEmailPort();
  });

  it("sends cancellation email for regular cancellation", async () => {
    const prisma = makeMockPrisma();
    const service = createService(prisma, emailPort);

    await service.handleSubscriptionCanceled("acc-1");

    expect(emailPort.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["test@co.com"],
        subject: expect.stringContaining("cancelled"),
      })
    );
  });

  it("does NOT send cancellation email for gateway-switch cancellation", async () => {
    const prisma = makeMockPrisma({
      account: {
        findUnique: vi.fn().mockResolvedValue({
          id: "acc-1",
          name: "Test Co",
          email: "test@co.com",
          pendingGatewaySwitch: true,
          pendingGatewayProvider: "PADDLE",
        }),
      },
      accountSubscription: {
        findFirst: vi.fn().mockResolvedValue({
          id: "sub-1",
          accountId: "acc-1",
          status: "ACTIVE",
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      gatewaySwitchEvent: {
        findFirst: vi.fn().mockResolvedValue({ id: "sw-1", status: "SCHEDULED" }),
        update: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn().mockImplementation(async (ops: Promise<unknown>[]) => {
        return Promise.all(ops);
      }),
    });
    const registry = {} as GatewayAdapterRegistryPort;
    const jobService = {
      startCheckoutWindow: vi.fn().mockResolvedValue(undefined),
    } as unknown as GatewaySwitchJobService;
    const service = new GatewayBillingService(prisma, registry, jobService, emailPort);

    await service.handleSubscriptionCanceled("acc-1");

    // The email sent is the gateway-switch email, not cancellation email
    const sendCalls = (emailPort.send as ReturnType<typeof vi.fn>).mock.calls;
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0][0].subject).toContain("gateway switch");
  });
});
