/**
 * @file sagaTenant.test.ts
 * @description Unit coverage for the saga tenant helpers: the account-resolution
 *              matrix that decides what every persisted `SagaInstance.accountId`
 *              carries, and the fail-loud tenant rehydration wrapper that scopes
 *              detached engine work (boot re-warm, timeout checker, resumed
 *              executions) to the saga's own account.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { SagaContext, SagaInstance } from "@shared/types/saga.js";

vi.mock("../../../src/lib/logger.js", () => {
  const makeLogger = (): Record<string, unknown> => {
    const instance: Record<string, unknown> = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    };
    instance.child = (): Record<string, unknown> => instance;
    return instance;
  };
  const logger = makeLogger();
  return { logger, createLogger: () => logger };
});

import { logger } from "../../../src/lib/logger.js";
import { getTenantContext } from "../../../src/security/tenantContext.js";
import {
  SAGA_SYSTEM_REASON,
  resolveSagaAccountId,
  runAsSagaTenant,
} from "../../../src/saga/sagaTenant.js";

const ACCOUNT_ID = "acc-11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT_ID = "acc-22222222-2222-4222-8222-222222222222";
const CUSTOMER_USER_ID = "cus-33333333-3333-4333-8333-333333333333";

const errorSpy = logger.error as unknown as Mock;

const makeContext = (overrides: Partial<SagaContext> = {}): SagaContext => ({
  sagaId: "post-publishing-saga-0001",
  correlationId: "corr-post-publishing-saga-0001",
  userId: CUSTOMER_USER_ID,
  metadata: {},
  stepData: {},
  events: [],
  ...overrides,
});

const makeInstance = (context: SagaContext): SagaInstance => ({
  id: context.sagaId,
  definitionId: "post-publishing-saga",
  status: "RUNNING",
  currentStep: 1,
  context,
  stepResults: [],
  compensationResults: [],
  startedAt: new Date("2026-01-01T00:00:00.000Z"),
  retryCount: 0,
});

describe("saga tenant helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("SAGA_SYSTEM_REASON", () => {
    // Triangulation skipped: structural constant with exactly one possible value.
    it("is the single saga reason from the fixed system-context set", () => {
      expect(SAGA_SYSTEM_REASON).toBe("system:saga-recovery");
    });
  });

  describe("resolveSagaAccountId", () => {
    it("returns the first-class accountId when the context carries one", () => {
      const context = makeContext({
        accountId: ACCOUNT_ID,
        metadata: { accountId: OTHER_ACCOUNT_ID },
      });

      expect(resolveSagaAccountId(context)).toBe(ACCOUNT_ID);
    });

    it("falls back to a valid-string metadata accountId when the field is absent", () => {
      const context = makeContext({ metadata: { accountId: OTHER_ACCOUNT_ID } });

      expect(resolveSagaAccountId(context)).toBe(OTHER_ACCOUNT_ID);
    });

    it("falls back to metadata when the first-class field is an empty string", () => {
      const context = makeContext({
        accountId: "",
        metadata: { accountId: OTHER_ACCOUNT_ID },
      });

      expect(resolveSagaAccountId(context)).toBe(OTHER_ACCOUNT_ID);
    });

    it("returns null when neither source carries an account, never the userId", () => {
      const context = makeContext({ userId: CUSTOMER_USER_ID, metadata: {} });

      expect(resolveSagaAccountId(context)).toBeNull();
    });

    it("returns null when the metadata accountId is not a string", () => {
      const context = makeContext({ metadata: { accountId: 42 } });

      expect(resolveSagaAccountId(context)).toBeNull();
    });

    it("returns null when both sources are empty strings", () => {
      const context = makeContext({ accountId: "", metadata: { accountId: "" } });

      expect(resolveSagaAccountId(context)).toBeNull();
    });
  });

  describe("runAsSagaTenant", () => {
    it("runs the callback bound to the saga's own account and returns its value", async () => {
      const metrics = { rehydrationFailures: 0 };
      const observed: Array<string | undefined> = [];
      const work = vi.fn(async () => {
        observed.push(getTenantContext()?.accountId);
        return "persisted";
      });

      const result = await runAsSagaTenant(
        makeInstance(makeContext({ accountId: ACCOUNT_ID })),
        work,
        metrics
      );

      expect(result).toBe("persisted");
      expect(observed).toEqual([ACCOUNT_ID]);
      expect(metrics.rehydrationFailures).toBe(0);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("rehydrates from the metadata fallback when the first-class field is absent", async () => {
      const metrics = { rehydrationFailures: 0 };
      const observed: Array<string | undefined> = [];
      const work = vi.fn(async () => {
        observed.push(getTenantContext()?.accountId);
        return "persisted";
      });

      const result = await runAsSagaTenant(
        makeInstance(makeContext({ metadata: { accountId: OTHER_ACCOUNT_ID } })),
        work,
        metrics
      );

      expect(result).toBe("persisted");
      expect(observed).toEqual([OTHER_ACCOUNT_ID]);
      expect(metrics.rehydrationFailures).toBe(0);
    });

    it("scopes the binding to the callback and leaves no context bound afterwards", async () => {
      const metrics = { rehydrationFailures: 0 };

      await runAsSagaTenant(
        makeInstance(makeContext({ accountId: ACCOUNT_ID })),
        async () => "persisted",
        metrics
      );

      expect(getTenantContext()).toBeUndefined();
    });

    it("skips the callback, logs at ERROR and counts the failure when no account resolves", async () => {
      const metrics = { rehydrationFailures: 0 };
      const work = vi.fn(async () => "persisted");

      const result = await runAsSagaTenant(
        makeInstance(makeContext({ userId: CUSTOMER_USER_ID, metadata: {} })),
        work,
        metrics
      );

      expect(result).toBeUndefined();
      expect(work).not.toHaveBeenCalled();
      expect(metrics.rehydrationFailures).toBe(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it("never falls back to a system-context bypass on a rehydration miss", async () => {
      const metrics = { rehydrationFailures: 0 };
      const observed: Array<string | undefined> = [];
      const work = vi.fn(async () => {
        observed.push(getTenantContext()?.accountId);
        return "persisted";
      });

      await runAsSagaTenant(
        makeInstance(makeContext({ userId: CUSTOMER_USER_ID, metadata: {} })),
        work,
        metrics
      );

      expect(observed).toEqual([]);
      expect(getTenantContext()).toBeUndefined();
    });
  });
});
