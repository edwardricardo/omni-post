/**
 * @file sagaTenant.test.ts
 * @description Unit coverage for the saga tenant module — the single place the
 *              engine's two isolation layers are declared. Three contracts are
 *              pinned here: the column-authoritative account resolution that
 *              decides which tenant owns a detached saga (and fails closed when
 *              the column and the context disagree), the discriminated outcome
 *              every caller must consume, and the context primitives that bind
 *              the AsyncLocalStorage scope AND the transaction-local RLS setting
 *              so neither layer can be forgotten at a call site.
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
import { getSystemContext, getTenantContext } from "../../../src/security/tenantContext.js";
import {
  SAGA_SYSTEM_REASON,
  failSagaAsSystem,
  newSagaRecoveryCorrelationId,
  resolveSagaAccountId,
  resolveSagaTenant,
  runAsSagaTenant,
  runSagaTenantTransaction,
  withSagaSystemRead,
  type SagaSystemTerminationConfig,
  type SagaTenantMetrics,
} from "../../../src/saga/sagaTenant.js";
import type { EventStoreEvent } from "@shared/types/events.js";
import type { SagaEngineClient } from "../../../src/saga/sagaManagerTypes.js";

const ACCOUNT_ID = "acc-11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT_ID = "acc-22222222-2222-4222-8222-222222222222";
const CUSTOMER_USER_ID = "cus-33333333-3333-4333-8333-333333333333";
const SYSTEM_SCOPE = "__system__";

const errorSpy = logger.error as unknown as Mock;

const makeMetrics = (): SagaTenantMetrics => ({ rehydrationFailures: 0, tenantMismatches: 0 });

const makeContext = (overrides: Partial<SagaContext> = {}): SagaContext => ({
  sagaId: "post-publishing-saga-0001",
  correlationId: "corr-post-publishing-saga-0001",
  userId: CUSTOMER_USER_ID,
  metadata: {},
  stepData: {},
  events: [],
  ...overrides,
});

const makeInstance = (
  context: SagaContext,
  overrides: Partial<SagaInstance> = {}
): SagaInstance => ({
  id: context.sagaId,
  definitionId: "post-publishing-saga",
  status: "RUNNING",
  currentStep: 1,
  context,
  stepResults: [],
  compensationResults: [],
  startedAt: new Date("2026-01-01T00:00:00.000Z"),
  retryCount: 0,
  ...overrides,
});

/** Records the ordered effects a transaction body produced against the client. */
interface TransactionSpy {
  prisma: SagaEngineClient;
  effects: string[];
  /** Durable events appended inside the transaction, in order. */
  events: EventStoreEvent[];
  /** Sagas whose semantic locks were released. */
  releasedSagaIds: string[];
  /** The collaborator bundle the terminal system write receives. */
  config: SagaSystemTerminationConfig;
}

function createTransactionSpy(): TransactionSpy {
  const effects: string[] = [];
  const events: EventStoreEvent[] = [];
  const releasedSagaIds: string[] = [];
  const tx = {
    $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]): Promise<number> => {
      effects.push(`guc:${String(values[0])}`);
      return 1;
    },
    sagaInstance: {
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        effects.push(`update:${args.where.id}:${String(args.data.status)}`);
        return args;
      },
    },
  };
  const prisma = {
    $transaction: async <T>(fn: (client: typeof tx) => Promise<T>): Promise<T> => {
      effects.push("tx:open");
      const result = await fn(tx);
      effects.push("tx:commit");
      return result;
    },
  } as unknown as SagaEngineClient;

  const config = {
    prisma,
    eventService: {
      appendEventInTx: async (_tx: unknown, event: EventStoreEvent): Promise<void> => {
        effects.push(`event:${event.type}`);
        events.push(event);
      },
    },
    lockStore: {
      releaseAllForSaga: async (sagaId: string) => {
        releasedSagaIds.push(sagaId);
        return { ok: true as const, value: undefined };
      },
    },
  } as unknown as SagaSystemTerminationConfig;

  return { prisma, effects, events, releasedSagaIds, config };
}

describe("saga tenant module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("SAGA_SYSTEM_REASON", () => {
    // Triangulation skipped: structural constant with exactly one possible value.
    it("is the single saga reason from the fixed system-context set", () => {
      expect(SAGA_SYSTEM_REASON).toBe("system:saga-recovery");
    });
  });

  describe("newSagaRecoveryCorrelationId", () => {
    it("derives one prefixed identifier per call so two passes never share one", () => {
      const first = newSagaRecoveryCorrelationId();
      const second = newSagaRecoveryCorrelationId();

      expect(first).toMatch(/^saga-recovery-[0-9a-f-]{36}$/);
      expect(second).not.toBe(first);
    });
  });

  describe("resolveSagaTenant — the persisted column is authoritative", () => {
    it("resolves from the column even when the context carries nothing", () => {
      const instance = makeInstance(makeContext(), { accountId: ACCOUNT_ID });

      expect(resolveSagaTenant(instance)).toEqual({
        kind: "resolved",
        accountId: ACCOUNT_ID,
        source: "column",
      });
    });

    it("prefers the column over an agreeing context so one source stays canonical", () => {
      const instance = makeInstance(makeContext({ accountId: ACCOUNT_ID }), {
        accountId: ACCOUNT_ID,
      });

      expect(resolveSagaTenant(instance)).toEqual({
        kind: "resolved",
        accountId: ACCOUNT_ID,
        source: "column",
      });
    });

    it("falls back to the context when the row carries no column value", () => {
      const instance = makeInstance(makeContext({ accountId: OTHER_ACCOUNT_ID }));

      expect(resolveSagaTenant(instance)).toEqual({
        kind: "resolved",
        accountId: OTHER_ACCOUNT_ID,
        source: "context",
      });
    });

    it("falls back to metadata for sagas started before the field existed", () => {
      const instance = makeInstance(makeContext({ metadata: { accountId: OTHER_ACCOUNT_ID } }));

      expect(resolveSagaTenant(instance)).toEqual({
        kind: "resolved",
        accountId: OTHER_ACCOUNT_ID,
        source: "metadata",
      });
    });

    it("fails closed when the column and the context name different accounts", () => {
      const instance = makeInstance(makeContext({ accountId: OTHER_ACCOUNT_ID }), {
        accountId: ACCOUNT_ID,
      });

      expect(resolveSagaTenant(instance)).toEqual({
        kind: "tenant-mismatch",
        columnAccountId: ACCOUNT_ID,
        contextAccountId: OTHER_ACCOUNT_ID,
      });
    });

    it("fails closed on the cutover straggler whose column holds the acting user id", () => {
      // Old code wrote `context.userId` into the tenant column while metadata
      // held the true account. Detecting it at RESOLUTION time is what keeps a
      // straggler from colliding on the primary key at write time.
      const instance = makeInstance(makeContext({ metadata: { accountId: ACCOUNT_ID } }), {
        accountId: CUSTOMER_USER_ID,
      });

      expect(resolveSagaTenant(instance)).toEqual({
        kind: "tenant-mismatch",
        columnAccountId: CUSTOMER_USER_ID,
        contextAccountId: ACCOUNT_ID,
      });
    });

    it("reports unresolvable when no source carries an account, never the userId", () => {
      const instance = makeInstance(makeContext({ userId: CUSTOMER_USER_ID, metadata: {} }));

      expect(resolveSagaTenant(instance)).toEqual({ kind: "unresolvable-account" });
    });

    it("treats empty strings on every source as no value at all", () => {
      const instance = makeInstance(makeContext({ accountId: "", metadata: { accountId: "" } }), {
        accountId: "",
      });

      expect(resolveSagaTenant(instance)).toEqual({ kind: "unresolvable-account" });
    });

    it("ignores a non-string metadata account rather than coercing it", () => {
      const instance = makeInstance(makeContext({ metadata: { accountId: 42 } }));

      expect(resolveSagaTenant(instance)).toEqual({ kind: "unresolvable-account" });
    });
  });

  describe("resolveSagaAccountId", () => {
    it("returns the resolved account for a persistable row", () => {
      const instance = makeInstance(makeContext({ accountId: OTHER_ACCOUNT_ID }));

      expect(resolveSagaAccountId(instance)).toBe(OTHER_ACCOUNT_ID);
    });

    it("returns null for a mismatched row so no value is guessed onto the write", () => {
      const instance = makeInstance(makeContext({ accountId: OTHER_ACCOUNT_ID }), {
        accountId: ACCOUNT_ID,
      });

      expect(resolveSagaAccountId(instance)).toBeNull();
    });
  });

  describe("runAsSagaTenant", () => {
    it("runs the callback bound to the saga's own account and returns a ran outcome", async () => {
      const metrics = makeMetrics();
      const observed: Array<string | undefined> = [];
      const work = vi.fn(async () => {
        observed.push(getTenantContext()?.accountId);
        return "persisted";
      });

      const outcome = await runAsSagaTenant(
        makeInstance(makeContext(), { accountId: ACCOUNT_ID }),
        work,
        metrics
      );

      expect(outcome).toEqual({ ran: true, value: "persisted" });
      expect(observed).toEqual([ACCOUNT_ID]);
      expect(metrics.rehydrationFailures).toBe(0);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("rehydrates from the metadata fallback when neither column nor field is set", async () => {
      const metrics = makeMetrics();
      const observed: Array<string | undefined> = [];
      const work = vi.fn(async () => {
        observed.push(getTenantContext()?.accountId);
        return "persisted";
      });

      const outcome = await runAsSagaTenant(
        makeInstance(makeContext({ metadata: { accountId: OTHER_ACCOUNT_ID } })),
        work,
        metrics
      );

      expect(outcome).toEqual({ ran: true, value: "persisted" });
      expect(observed).toEqual([OTHER_ACCOUNT_ID]);
    });

    it("scopes the binding to the callback and leaves no context bound afterwards", async () => {
      await runAsSagaTenant(
        makeInstance(makeContext(), { accountId: ACCOUNT_ID }),
        async () => "persisted",
        makeMetrics()
      );

      expect(getTenantContext()).toBeUndefined();
    });

    it("skips the callback and reports unresolvable-account when no account resolves", async () => {
      const metrics = makeMetrics();
      const work = vi.fn(async () => "persisted");

      const outcome = await runAsSagaTenant(makeInstance(makeContext()), work, metrics);

      expect(outcome).toEqual({ ran: false, reason: "unresolvable-account" });
      expect(work).not.toHaveBeenCalled();
      expect(metrics.rehydrationFailures).toBe(1);
      expect(metrics.tenantMismatches).toBe(0);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it("skips the callback and reports tenant-mismatch when the two sources disagree", async () => {
      const metrics = makeMetrics();
      const work = vi.fn(async () => "persisted");

      const outcome = await runAsSagaTenant(
        makeInstance(makeContext({ accountId: OTHER_ACCOUNT_ID }), { accountId: ACCOUNT_ID }),
        work,
        metrics
      );

      expect(outcome).toEqual({ ran: false, reason: "tenant-mismatch" });
      expect(work).not.toHaveBeenCalled();
      expect(metrics.tenantMismatches).toBe(1);
      expect(metrics.rehydrationFailures).toBe(0);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it("never falls back to a system-context bypass on a resolution miss", async () => {
      const observed: Array<string | undefined> = [];
      const work = vi.fn(async () => {
        observed.push(getSystemContext()?.reason);
        return "persisted";
      });

      await runAsSagaTenant(makeInstance(makeContext()), work, makeMetrics());

      expect(observed).toEqual([]);
      expect(getSystemContext()).toBeUndefined();
      expect(getTenantContext()).toBeUndefined();
    });
  });

  describe("withSagaSystemRead", () => {
    it("binds BOTH isolation layers before the read runs", async () => {
      // A single statement outside a transaction binds no transaction-local
      // scope at all, so under a role that does not bypass row-level security
      // the read matches nothing and answers an empty set instead of an error.
      const spy = createTransactionSpy();
      const observed: Array<string | undefined> = [];

      await withSagaSystemRead(spy.prisma, async () => {
        observed.push(getSystemContext()?.reason);
      });

      expect(observed).toEqual([SAGA_SYSTEM_REASON]);
      expect(spy.effects).toEqual(["tx:open", `guc:${SYSTEM_SCOPE}`, "tx:commit"]);
      expect(getSystemContext()).toBeUndefined();
    });

    it("hands the callback the transaction client that carries the bound scope", async () => {
      const spy = createTransactionSpy();

      await withSagaSystemRead(spy.prisma, async (tx) => {
        await tx.sagaInstance.update({ where: { id: "saga-read" }, data: { status: "FAILED" } });
      });

      expect(spy.effects).toEqual([
        "tx:open",
        `guc:${SYSTEM_SCOPE}`,
        "update:saga-read:FAILED",
        "tx:commit",
      ]);
    });

    it("awaits a lazily-executed query INSIDE the declared scope", async () => {
      // A Prisma call returns a lazy promise that only reaches the database when
      // awaited. A wrap that hands the unawaited promise back releases its scope
      // first, so the query runs undeclared. This thenable reproduces that shape:
      // it reports the context active at await time, and the primitive — not the
      // call site — is what awaits it.
      const spy = createTransactionSpy();
      const lazyQuery: PromiseLike<string | undefined> = {
        then(onFulfilled) {
          const reason = getSystemContext()?.reason;
          return Promise.resolve(onFulfilled ? onFulfilled(reason) : reason) as never;
        },
      };

      const observed = await withSagaSystemRead(
        spy.prisma,
        () => lazyQuery as Promise<string | undefined>
      );

      expect(observed).toBe(SAGA_SYSTEM_REASON);
    });
  });

  describe("runSagaTenantTransaction", () => {
    it("binds the saga's own account as the transaction-local scope first", async () => {
      const spy = createTransactionSpy();

      await runSagaTenantTransaction(spy.prisma, ACCOUNT_ID, async (tx) => {
        await tx.sagaInstance.update({ where: { id: "saga-1" }, data: { status: "RUNNING" } });
      });

      expect(spy.effects).toEqual([
        "tx:open",
        `guc:${ACCOUNT_ID}`,
        "update:saga-1:RUNNING",
        "tx:commit",
      ]);
    });

    it("binds a different account for a different saga rather than a fixed value", async () => {
      const spy = createTransactionSpy();

      await runSagaTenantTransaction(spy.prisma, OTHER_ACCOUNT_ID, async () => undefined);

      expect(spy.effects).toEqual(["tx:open", `guc:${OTHER_ACCOUNT_ID}`, "tx:commit"]);
    });
  });

  describe("failSagaAsSystem — the one cross-tenant write", () => {
    it("commits the terminal row and its audit event in ONE system-scoped transaction", async () => {
      // The anomalous transition is exactly the one whose durable trail must not
      // have a hole, and an event appended after the commit can be lost on a
      // crash between the two.
      const spy = createTransactionSpy();
      const instance = makeInstance(makeContext(), { id: "saga-orphan", status: "RUNNING" });

      await failSagaAsSystem(spy.config, instance, "unresolvable-account");

      expect(spy.effects).toEqual([
        "tx:open",
        `guc:${SYSTEM_SCOPE}`,
        "update:saga-orphan:FAILED",
        "event:saga.failed",
        "tx:commit",
      ]);
      expect(instance.status).toBe("FAILED");
      expect(instance.error).toContain("unresolvable-account");
      expect(instance.completedAt).toBeInstanceOf(Date);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it("names the saga, the definition and the skip reason on the audit event", async () => {
      const spy = createTransactionSpy();
      const instance = makeInstance(makeContext(), { id: "saga-orphan", status: "RUNNING" });

      await failSagaAsSystem(spy.config, instance, "unresolvable-account");

      const [event] = spy.events;
      expect(event?.aggregateId).toBe("saga-orphan");
      expect(event?.aggregateType).toBe("Saga");
      expect(event?.data).toMatchObject({
        sagaId: "saga-orphan",
        definitionId: "post-publishing-saga",
        status: "FAILED",
        reason: "unresolvable-account",
      });
    });

    it("releases the saga's semantic locks so a legitimate saga is not blocked until TTL", async () => {
      const spy = createTransactionSpy();
      const instance = makeInstance(makeContext(), { id: "saga-locked", status: "RUNNING" });

      await failSagaAsSystem(spy.config, instance, "tenant-mismatch");

      expect(spy.releasedSagaIds).toEqual(["saga-locked"]);
    });

    it("records the mismatch reason on the terminal row for the operator", async () => {
      const spy = createTransactionSpy();
      const instance = makeInstance(makeContext(), { id: "saga-mismatch", status: "PENDING" });

      await failSagaAsSystem(spy.config, instance, "tenant-mismatch");

      expect(spy.effects).toContain("update:saga-mismatch:FAILED");
      expect(instance.error).toContain("tenant-mismatch");
      expect(spy.events[0]?.data).toMatchObject({ reason: "tenant-mismatch" });
    });

    it("still terminalizes when no event or lock collaborator is configured", async () => {
      // Schema-only and test wirings omit both; a terminal transition must not
      // depend on optional collaborators being present.
      const spy = createTransactionSpy();
      const instance = makeInstance(makeContext(), { id: "saga-bare", status: "RUNNING" });

      await failSagaAsSystem({ prisma: spy.prisma }, instance, "unresolvable-account");

      expect(spy.effects).toEqual([
        "tx:open",
        `guc:${SYSTEM_SCOPE}`,
        "update:saga-bare:FAILED",
        "tx:commit",
      ]);
      expect(instance.status).toBe("FAILED");
    });
  });
});
