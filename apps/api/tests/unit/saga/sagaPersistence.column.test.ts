/**
 * @file sagaPersistence.column.test.ts
 * @description Pins the value the saga engine writes into `SagaInstance.accountId`
 *              on both write paths, the conditional update and the create of a new
 *              row: the account that owns the saga, never the customer user id —
 *              and pins that there is NO write at all when no account resolves,
 *              because the engine has no account-less persistence shape left to
 *              fall back to. Also pins that the update is a compare-and-swap that
 *              never replaces a terminal row, and the shape the tenant guard
 *              produces for both writes so the persisted row is scoped as well as
 *              truthful.
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  tenantGuardCheck,
  TenantContextMismatchError,
  type TenantContextProvider,
} from "@infra/prisma/extensions/tenantGuard.js";
import type { SagaContext, SagaInstance } from "@shared/types/saga.js";
import { createEventStoreEvent } from "@shared/types/events.js";
import type { SagaManagerConfig } from "../../../src/saga/sagaManagerTypes.js";
import type { SagaManagerLifecycle } from "../../../src/saga/SagaManagerLifecycle.js";
import { SagaExecutionEngine } from "../../../src/saga/SagaManagerExecution.js";

const SAGA_ID = "post-publishing-saga-0002";
const ACCOUNT_ID = "acc-11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT_ID = "acc-22222222-2222-4222-8222-222222222222";
const CUSTOMER_USER_ID = "cus-33333333-3333-4333-8333-333333333333";
const ENDINGS = ["COMPLETED", "FAILED", "COMPENSATED"];

interface WriteArgs {
  where?: Record<string, unknown>;
  data: Record<string, unknown>;
}

/** What the row the spy stands in for holds before the write. */
type RowState = { kind: "absent" } | { kind: "present"; status: string };

interface PrismaSpy {
  prisma: unknown;
  updates: WriteArgs[];
  creates: WriteArgs[];
  effects: string[];
}

/**
 * Records every write the persistence transaction issues, plus the ordered effects on
 * the transaction client — the transaction-local tenant scope has to be bound BEFORE
 * the row is written, so the order is part of the contract, not an implementation
 * detail. The update matches the row only when its status is outside the `notIn` the
 * engine names, as Postgres evaluates the filter.
 */
function createPrismaSpy(row: RowState = { kind: "present", status: "RUNNING" }): PrismaSpy {
  const updates: WriteArgs[] = [];
  const creates: WriteArgs[] = [];
  const effects: string[] = [];
  const tx = {
    $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]): Promise<number> => {
      effects.push(`guc:${String(values[0])}`);
      return 1;
    },
    sagaInstance: {
      updateMany: async (args: WriteArgs): Promise<{ count: number }> => {
        updates.push(args);
        effects.push(`updateMany:${String(args.where?.id)}`);
        const refused = (args.where?.status as { notIn?: string[] } | undefined)?.notIn ?? [];
        return { count: row.kind === "present" && !refused.includes(row.status) ? 1 : 0 };
      },
      findUnique: async (args: WriteArgs): Promise<{ status: string } | null> => {
        effects.push(`findUnique:${String(args.where?.id)}`);
        return row.kind === "present" ? { status: row.status } : null;
      },
      create: async (args: WriteArgs): Promise<Record<string, unknown>> => {
        creates.push(args);
        effects.push(`create:${String(args.data.id)}`);
        return args.data;
      },
    },
  };
  const prisma = {
    $transaction: async <T>(fn: (client: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  };
  return { prisma, updates, creates, effects };
}

/** An engine over `spy`, with an event service that records what it is asked to append. */
function engineOver(spy: PrismaSpy, appended: string[] = []): SagaExecutionEngine {
  const config = {
    prisma: spy.prisma,
    redis: { setex: async (): Promise<string> => "OK" },
    eventService: {
      appendEventInTx: async (_tx: unknown, event: { type: string }): Promise<void> => {
        appended.push(event.type);
      },
      broadcastEvent: async (): Promise<void> => undefined,
    },
  } as unknown as SagaManagerConfig;
  return new SagaExecutionEngine(config, {
    metrics: { instanceLoadFailures: 0 },
  } as unknown as SagaManagerLifecycle);
}

const makeContext = (overrides: Partial<SagaContext> = {}): SagaContext => ({
  sagaId: SAGA_ID,
  correlationId: `corr-${SAGA_ID}`,
  userId: CUSTOMER_USER_ID,
  metadata: {},
  stepData: {},
  events: [],
  ...overrides,
});

const makeInstance = (context: SagaContext): SagaInstance => ({
  id: SAGA_ID,
  definitionId: "post-publishing-saga",
  status: "RUNNING",
  currentStep: 1,
  context,
  stepResults: [],
  compensationResults: [],
  startedAt: new Date("2026-01-01T00:00:00.000Z"),
  retryCount: 0,
});

const makeProvider = (accountId: string): TenantContextProvider => ({
  getTenantContext: () => ({ accountId }),
  getSystemContext: () => undefined,
});

describe("saga instance persistence — accountId column", () => {
  let spy: PrismaSpy;
  let engine: SagaExecutionEngine;

  beforeEach(() => {
    spy = createPrismaSpy();
    engine = engineOver(spy);
  });

  it("writes the owning account on the update and on the create, never the customer user id", async () => {
    await engine.persistSagaInstance(makeInstance(makeContext({ accountId: ACCOUNT_ID })));
    const absent = createPrismaSpy({ kind: "absent" });
    await engineOver(absent).persistSagaInstance(
      makeInstance(makeContext({ accountId: ACCOUNT_ID }))
    );

    expect(spy.updates).toHaveLength(1);
    expect(spy.creates).toHaveLength(0);
    expect(absent.creates).toHaveLength(1);
    for (const write of [spy.updates[0], absent.creates[0]]) {
      expect(write?.data.accountId).toBe(ACCOUNT_ID);
      expect(write?.data.accountId).not.toBe(CUSTOMER_USER_ID);
    }
  });

  it("writes the metadata account when the context has no first-class field", async () => {
    await engine.persistSagaInstance(
      makeInstance(makeContext({ metadata: { accountId: OTHER_ACCOUNT_ID } }))
    );

    expect(spy.updates).toHaveLength(1);
    expect(spy.updates[0]?.data.accountId).toBe(OTHER_ACCOUNT_ID);
  });

  it("refuses to write at all when no account can be resolved", async () => {
    // There is no account-less write shape left. A transaction opened without a
    // resolved account would bind NEITHER isolation layer — no tenant scope for
    // the Prisma guard, no `app.account_id` for the row-level policies — so the
    // engine refuses instead of persisting a row nothing can address. Every
    // caller reaches this through the tenant rehydration, which returns without
    // running on exactly this resolution, so arriving here is a caller defect
    // and the error says so rather than degrading quietly.
    await expect(
      engine.persistSagaInstance(
        makeInstance(makeContext({ userId: CUSTOMER_USER_ID, metadata: {} }))
      )
    ).rejects.toThrowError(/no resolvable owning account/);

    expect(spy.updates).toHaveLength(0);
    expect(spy.effects).toEqual([]);
  });

  it("classifies the refusal as an engine defect, not a client error", async () => {
    // The two refusals are deliberately different: a contradicted row is real
    // data (conflict), while an unscopable persist is a code path that should be
    // unreachable. Collapsing them would hide a broken caller behind a 409 an
    // operator would read as ordinary tenant noise.
    const rejection = await engine
      .persistSagaInstance(makeInstance(makeContext({ userId: CUSTOMER_USER_ID, metadata: {} })))
      .then(
        () => null,
        (error: unknown) => error as { statusCode?: number; isOperational?: boolean }
      );

    expect(rejection?.statusCode).toBe(500);
    expect(rejection?.isOperational).toBe(false);
  });

  it("selects the row by the saga id and matches it only while it has not ended", async () => {
    await engine.persistSagaInstance(makeInstance(makeContext({ accountId: ACCOUNT_ID })));

    expect(spy.updates[0]?.where).toEqual({ id: SAGA_ID, status: { notIn: ENDINGS } });
  });

  it("writes the persisted column when the context carries no account at all", async () => {
    // The row a data repair fixed through the CustomerUser join: the true
    // account exists ONLY in the column, so an engine that reads the context
    // alone can never scope it again.
    const instance = makeInstance(makeContext({ userId: CUSTOMER_USER_ID, metadata: {} }));
    instance.accountId = ACCOUNT_ID;

    await engine.persistSagaInstance(instance);

    expect(spy.updates[0]?.data.accountId).toBe(ACCOUNT_ID);
    expect(spy.effects).toEqual([`guc:${ACCOUNT_ID}`, `updateMany:${SAGA_ID}`]);
  });

  it("binds the transaction-local tenant scope BEFORE writing the row", async () => {
    await engine.persistSagaInstance(makeInstance(makeContext({ accountId: ACCOUNT_ID })));

    expect(spy.effects).toEqual([`guc:${ACCOUNT_ID}`, `updateMany:${SAGA_ID}`]);
  });

  it("creates the row of a new saga once the update matched nothing and no row exists", async () => {
    const absent = createPrismaSpy({ kind: "absent" });
    await engineOver(absent).persistSagaInstance(
      makeInstance(makeContext({ accountId: ACCOUNT_ID }))
    );

    expect(absent.effects).toEqual([
      `guc:${ACCOUNT_ID}`,
      `updateMany:${SAGA_ID}`,
      `findUnique:${SAGA_ID}`,
      `create:${SAGA_ID}`,
    ]);
    expect(absent.creates[0]?.data).toMatchObject({ id: SAGA_ID, status: "RUNNING" });
  });

  it.each(ENDINGS)(
    "refuses a write over a %s row with a conflict, and appends no event",
    async (ending) => {
      // A stale copy of a saga another advancer ended: the row stands, and the step that
      // tried to write learns it from a conflict it can tell apart from a failed write.
      const ended = createPrismaSpy({ kind: "present", status: ending });
      const appended: string[] = [];
      const event = createEventStoreEvent(
        "saga.step.failed",
        SAGA_ID,
        "Saga",
        {},
        { source: "SagaManager" }
      );

      const rejection = await engineOver(ended, appended)
        .persistSagaInstance(makeInstance(makeContext({ accountId: ACCOUNT_ID })), [event])
        .then(
          () => null,
          (error: unknown) => error as { statusCode?: number; message?: string }
        );

      expect(rejection?.statusCode).toBe(409);
      expect(rejection?.message).toContain(ending);
      expect(ended.creates).toHaveLength(0);
      expect(appended).toEqual([]);
    }
  );

  it("lets the transition that reopens FAILED replace that ending and no other", async () => {
    // The operator door compensates a FAILED saga; COMPLETED and COMPENSATED stay refused.
    await engine.persistSagaInstance(
      makeInstance(makeContext({ accountId: ACCOUNT_ID })),
      [],
      "FAILED"
    );

    expect(spy.updates[0]?.where).toEqual({
      id: SAGA_ID,
      status: { notIn: ["COMPLETED", "COMPENSATED"] },
    });
  });

  it("writes no row when the persisted account contradicts the saga context", async () => {
    const instance = makeInstance(makeContext({ accountId: OTHER_ACCOUNT_ID }));
    // The straggler shape: the column holds the acting user id while the
    // context names the real account.
    instance.accountId = CUSTOMER_USER_ID;

    await expect(engine.persistSagaInstance(instance)).rejects.toThrowError(/contradicts/);

    expect(spy.updates).toHaveLength(0);
    expect(spy.effects).toEqual([]);
  });
});

describe("tenant guard shape for the saga instance writes", () => {
  it("scopes the conditional update's selector to the bound account", async () => {
    const args: Record<string, unknown> = {
      where: { id: SAGA_ID, status: { notIn: ENDINGS } },
      data: { definitionId: "post-publishing-saga" },
    };

    const guarded = (await tenantGuardCheck(
      {
        model: "SagaInstance",
        operation: "updateMany",
        args,
        query: async (received: unknown) => received,
      },
      makeProvider(ACCOUNT_ID)
    )) as WriteArgs;

    expect(guarded.where).toEqual({
      id: SAGA_ID,
      status: { notIn: ENDINGS },
      accountId: ACCOUNT_ID,
    });
  });

  it("rejects a created row carrying an account other than the bound one", async () => {
    const args: Record<string, unknown> = {
      data: { id: SAGA_ID, accountId: OTHER_ACCOUNT_ID },
    };

    await expect(
      tenantGuardCheck(
        {
          model: "SagaInstance",
          operation: "create",
          args,
          query: async (received: unknown) => received,
        },
        makeProvider(ACCOUNT_ID)
      )
    ).rejects.toBeInstanceOf(TenantContextMismatchError);
  });
});
