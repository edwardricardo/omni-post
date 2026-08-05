/**
 * @file sagaPersistence.column.test.ts
 * @description Pins the value the saga engine writes into `SagaInstance.accountId`
 *              on both upsert branches: the account that owns the saga, never the
 *              customer user id, and the key omitted entirely when no account can
 *              be resolved. Also pins the shape the tenant guard produces for that
 *              upsert so the persisted row is scoped as well as truthful.
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  tenantGuardCheck,
  TenantContextMismatchError,
  type TenantContextProvider,
} from "@infra/prisma/extensions/tenantGuard.js";
import type { SagaContext, SagaInstance } from "@shared/types/saga.js";
import type { SagaManagerConfig } from "../../../src/saga/sagaManagerTypes.js";
import type { SagaManagerLifecycle } from "../../../src/saga/SagaManagerLifecycle.js";
import { SagaExecutionEngine } from "../../../src/saga/SagaManagerExecution.js";

const SAGA_ID = "post-publishing-saga-0002";
const ACCOUNT_ID = "acc-11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT_ID = "acc-22222222-2222-4222-8222-222222222222";
const CUSTOMER_USER_ID = "cus-33333333-3333-4333-8333-333333333333";

interface UpsertArgs {
  where: Record<string, unknown>;
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

/**
 * Records every `sagaInstance.upsert` issued inside the persistence transaction,
 * plus the ordered effects on the transaction client — the transaction-local
 * tenant scope has to be bound BEFORE the row is written, so the order is part
 * of the contract, not an implementation detail.
 */
function createPrismaSpy(): { prisma: unknown; upserts: UpsertArgs[]; effects: string[] } {
  const upserts: UpsertArgs[] = [];
  const effects: string[] = [];
  const tx = {
    $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]): Promise<number> => {
      effects.push(`guc:${String(values[0])}`);
      return 1;
    },
    sagaInstance: {
      upsert: async (args: UpsertArgs): Promise<Record<string, unknown>> => {
        upserts.push(args);
        effects.push(`upsert:${String(args.where.id)}`);
        return { id: args.where.id };
      },
    },
  };
  const prisma = {
    $transaction: async <T>(fn: (client: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  };
  return { prisma, upserts, effects };
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
  let upserts: UpsertArgs[];
  let effects: string[];
  let engine: SagaExecutionEngine;

  beforeEach(() => {
    const spy = createPrismaSpy();
    upserts = spy.upserts;
    effects = spy.effects;
    const config = {
      prisma: spy.prisma,
      redis: { setex: async (): Promise<string> => "OK" },
    } as unknown as SagaManagerConfig;
    engine = new SagaExecutionEngine(config, {
      metrics: { instanceLoadFailures: 0 },
    } as unknown as SagaManagerLifecycle);
  });

  it("writes the owning account on both upsert branches, never the customer user id", async () => {
    await engine.persistSagaInstance(makeInstance(makeContext({ accountId: ACCOUNT_ID })));

    expect(upserts).toHaveLength(1);
    const call = upserts[0] as UpsertArgs;
    expect(call.create.accountId).toBe(ACCOUNT_ID);
    expect(call.update.accountId).toBe(ACCOUNT_ID);
    expect(call.create.accountId).not.toBe(CUSTOMER_USER_ID);
    expect(call.update.accountId).not.toBe(CUSTOMER_USER_ID);
  });

  it("writes the metadata account when the context has no first-class field", async () => {
    await engine.persistSagaInstance(
      makeInstance(makeContext({ metadata: { accountId: OTHER_ACCOUNT_ID } }))
    );

    expect(upserts).toHaveLength(1);
    const call = upserts[0] as UpsertArgs;
    expect(call.create.accountId).toBe(OTHER_ACCOUNT_ID);
    expect(call.update.accountId).toBe(OTHER_ACCOUNT_ID);
  });

  it("omits the key on both branches when no account can be resolved", async () => {
    await engine.persistSagaInstance(
      makeInstance(makeContext({ userId: CUSTOMER_USER_ID, metadata: {} }))
    );

    expect(upserts).toHaveLength(1);
    const call = upserts[0] as UpsertArgs;
    expect("accountId" in call.create).toBe(false);
    expect("accountId" in call.update).toBe(false);
  });

  it("keeps the saga id as the upsert selector so the guard can scope it", async () => {
    await engine.persistSagaInstance(makeInstance(makeContext({ accountId: ACCOUNT_ID })));

    const call = upserts[0] as UpsertArgs;
    expect(call.where).toEqual({ id: SAGA_ID });
  });

  it("writes the persisted column when the context carries no account at all", async () => {
    // The row a data repair fixed through the CustomerUser join: the true
    // account exists ONLY in the column, so an engine that reads the context
    // alone can never scope it again.
    const instance = makeInstance(makeContext({ userId: CUSTOMER_USER_ID, metadata: {} }));
    instance.accountId = ACCOUNT_ID;

    await engine.persistSagaInstance(instance);

    const call = upserts[0] as UpsertArgs;
    expect(call.create.accountId).toBe(ACCOUNT_ID);
    expect(call.update.accountId).toBe(ACCOUNT_ID);
    expect(effects).toEqual([`guc:${ACCOUNT_ID}`, `upsert:${SAGA_ID}`]);
  });

  it("binds the transaction-local tenant scope BEFORE writing the row", async () => {
    await engine.persistSagaInstance(makeInstance(makeContext({ accountId: ACCOUNT_ID })));

    expect(effects).toEqual([`guc:${ACCOUNT_ID}`, `upsert:${SAGA_ID}`]);
  });

  it("writes no row when the persisted account contradicts the saga context", async () => {
    const instance = makeInstance(makeContext({ accountId: OTHER_ACCOUNT_ID }));
    // The straggler shape: the column holds the acting user id while the
    // context names the real account.
    instance.accountId = CUSTOMER_USER_ID;

    await expect(engine.persistSagaInstance(instance)).rejects.toThrowError(/contradicts/);

    expect(upserts).toHaveLength(0);
    expect(effects).toEqual([]);
  });
});

describe("tenant guard shape for the saga instance upsert", () => {
  it("scopes the selector and the created row to the bound account", async () => {
    const args: Record<string, unknown> = {
      where: { id: SAGA_ID },
      create: { id: SAGA_ID, definitionId: "post-publishing-saga" },
      update: { definitionId: "post-publishing-saga" },
    };

    const guarded = (await tenantGuardCheck(
      {
        model: "SagaInstance",
        operation: "upsert",
        args,
        query: async (received: unknown) => received,
      },
      makeProvider(ACCOUNT_ID)
    )) as UpsertArgs;

    expect(guarded.where).toEqual({ id: SAGA_ID, accountId: ACCOUNT_ID });
    expect(guarded.create.accountId).toBe(ACCOUNT_ID);
  });

  it("rejects a created row carrying an account other than the bound one", async () => {
    const args: Record<string, unknown> = {
      where: { id: SAGA_ID },
      create: { id: SAGA_ID, accountId: OTHER_ACCOUNT_ID },
      update: {},
    };

    await expect(
      tenantGuardCheck(
        {
          model: "SagaInstance",
          operation: "upsert",
          args,
          query: async (received: unknown) => received,
        },
        makeProvider(ACCOUNT_ID)
      )
    ).rejects.toBeInstanceOf(TenantContextMismatchError);
  });
});
