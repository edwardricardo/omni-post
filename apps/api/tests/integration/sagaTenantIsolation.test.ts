/**
 * @file sagaTenantIsolation.test.ts
 * @description MERGE-BLOCKING two-tenant isolation proof for the saga engine,
 *   run against a REAL Postgres and a REAL Redis with the engine wired exactly
 *   as production wires it: a base client extended with `tenantGuardExtension`
 *   over the real AsyncLocalStorage provider, handed to a `SagaManagerLifecycle`
 *   + `SagaExecutionEngine` pair (the composition `SagaManagerImpl` performs).
 *
 *   The engine runs detached from any HTTP request, so its isolation rests on
 *   two mechanisms this suite exercises separately:
 *
 *     - REHYDRATION — per-saga work binds the saga's OWN account, so the guard
 *       validates every write instead of skipping it. Proven by starting a saga
 *       under a customer's context, by a detached retry resume that records the
 *       tenant its step observed, and by a persist that disagrees with the bound
 *       account and is rejected inside the engine's own transaction.
 *     - DECLARED SYSTEM CONTEXT — the tenant-unknown scans (boot load, retry
 *       recovery) read across accounts under one fixed reason, scoped to the
 *       query. Proven by observing the reason and the returned ids at the client
 *       boundary, and by removing the declared context from the guard's view and
 *       asserting the loop counts and logs the failure instead of reporting an
 *       empty successful scan.
 *
 *   Two residuals are PINNED here rather than hidden, so a later change cannot
 *   widen them silently:
 *
 *     - the engine's by-id load runs under the declared system context (the read
 *       exists to discover which tenant owns the id), so a manager-level read is
 *       NOT guard-scoped; the customer route's ownership check is its control.
 *       The guard-scoped proof therefore goes through the guarded client
 *       directly, and the Redis fast path is emptied first so it cannot satisfy
 *       the assertion by returning a cached row.
 *     - the Redis hot cache is guard-blind by construction; the suite asserts
 *       the cached value exists, deletes it, and only then reads.
 *
 *   Requires Postgres + Redis up (`pnpm db:up`).
 *
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import pino from "pino";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import {
  tenantGuardExtension,
  TenantContextMismatchError,
  TenantContextMissingError,
} from "@infra/prisma/extensions/tenantGuard.js";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import {
  createSagaContext,
  defineSaga,
  type PivotStep,
  type SagaContext,
  type SagaDefinition,
  type SagaInstance,
  type SagaStepResult,
} from "@shared/types/saga.js";
import {
  getSystemContext,
  getTenantContext,
  withTenantContext,
} from "../../src/security/tenantContext.js";
import { SagaManagerLifecycle } from "../../src/saga/SagaManagerLifecycle.js";
import { SagaExecutionEngine } from "../../src/saga/SagaManagerExecution.js";
import type { SagaExecutionEnginePort } from "../../src/saga/sagaManagerTypes.js";
import { SAGA_SYSTEM_REASON } from "../../src/saga/sagaTenant.js";
import { EventService } from "../../src/events/EventService.js";
import { logger } from "../../src/lib/logger.js";
import { ok, type Result } from "@shared/types";
import type { SemanticLockError, SemanticLockPort } from "@ports/core";

const TAG = `saga-iso-${Date.now()}`;
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const PROBE_DEFINITION_ID = `${TAG}-probe-saga`;
const RETRY_RECOVERY_TASK_ID = "saga-retry-recovery";

/**
 * The persisted stream key for a saga's durable events. The event store applies
 * its own `stream:` prefix on top of `<aggregateType>:<aggregateId>`, so the
 * unprefixed form matches no row at all — a query written without it reads as
 * "no events" whether or not any were appended.
 */
function sagaStreamId(sagaId: string): string {
  return `stream:Saga:${sagaId}`;
}

/** One `sagaInstance.findMany` seen at the client boundary. */
interface ScanObservation {
  /** Declared system reason active when the scan ran, if any. */
  reason: string | undefined;
  /** Whether a tenant scope was bound — a scan must need none. */
  tenantBound: boolean;
  ids: string[];
}

/** Tenant scope a probe step observed while the engine executed it. */
interface StepObservation {
  sagaId: string;
  boundAccountId: string | undefined;
}

interface Tenant {
  accountId: string;
  customerUserId: string;
  /** Terminal row used for the cross-tenant read/mutation proofs. */
  isolationSagaId: string;
  /** Non-terminal row with no pending retry — boot-load population. */
  bootSagaId: string;
  /** Non-terminal row with an elapsed retry — retry-checker population. */
  retrySagaId: string;
}

/** Records the tenant scope the engine bound before running the step. */
const stepObservations: StepObservation[] = [];

/**
 * Semantic-lock backend that records releases. A saga driven to a terminal
 * state must give its locks back; a lock left held by a dead saga blocks a
 * legitimate one on the same aggregate until the TTL expires.
 */
class RecordingLockStore implements SemanticLockPort {
  readonly releasedSagaIds: string[] = [];

  async acquire(): Promise<Result<boolean, SemanticLockError>> {
    return ok(true);
  }

  async release(): Promise<Result<void, SemanticLockError>> {
    return ok(undefined);
  }

  async releaseAllForSaga(sagaId: string): Promise<Result<void, SemanticLockError>> {
    this.releasedSagaIds.push(sagaId);
    return ok(undefined);
  }
}

const probeStep: PivotStep = {
  id: "tenant-probe",
  name: "Tenant Probe",
  class: "pivot",
  async execute(context: SagaContext): Promise<SagaStepResult> {
    stepObservations.push({
      sagaId: context.sagaId,
      boundAccountId: getTenantContext()?.accountId,
    });
    return { success: true, data: { observed: true } };
  },
};

const probeDefinition: SagaDefinition = defineSaga({
  id: PROBE_DEFINITION_ID,
  name: "Tenant Isolation Probe Saga",
  version: "1.0.0",
  preCommit: [],
  pivot: probeStep,
  postCommit: [],
});

/** Parses one pino line, returning null when the chunk is not JSON. */
function safeParseLogLine(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Runs `action` with the shared logger's destination swapped for a recorder.
 * The engine logs through a module-scoped pino instance, so intercepting its
 * stream is the only way to assert what an operator would actually see.
 */
async function captureLogs(action: () => Promise<void>): Promise<Record<string, unknown>[]> {
  const streamSymbol = pino.symbols.streamSym;
  const holder = logger as unknown as Record<symbol, unknown>;
  const original = holder[streamSymbol];
  const lines: Record<string, unknown>[] = [];

  holder[streamSymbol] = {
    write(chunk: string): void {
      for (const raw of chunk.split("\n")) {
        if (raw.trim().length === 0) continue;
        const parsed = safeParseLogLine(raw);
        if (parsed !== null) {
          lines.push(parsed);
        }
      }
    },
  };

  try {
    await action();
  } finally {
    holder[streamSymbol] = original;
  }

  return lines;
}

/**
 * Wraps a client so every `sagaInstance.findMany` records the context it ran
 * under. The scans are the only engine reads that legitimately span tenants,
 * so observing them at the client boundary is what proves the declaration.
 *
 * The probe follows the client INTO an interactive transaction, because the
 * engine's system reads run inside one: binding the transaction-local scope is
 * the only way the row-level policies see a scope at all, so a probe that only
 * watched the outer client would observe nothing.
 */
function withScanProbe(client: PrismaClient, sink: ScanObservation[]): PrismaClient {
  const bindIfCallable = (value: unknown, owner: object): unknown =>
    typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(owner) : value;

  const probeModel = (model: object): object =>
    new Proxy(model, {
      get(modelTarget, modelProperty) {
        const modelValue = Reflect.get(modelTarget, modelProperty) as unknown;
        if (modelProperty !== "findMany") {
          return bindIfCallable(modelValue, modelTarget);
        }

        const findMany = modelValue as (args?: unknown) => Promise<{ id: string }[]>;
        return async (args?: unknown): Promise<{ id: string }[]> => {
          const reason = getSystemContext()?.reason;
          const tenantBound = getTenantContext() !== undefined;
          const rows = await findMany.call(modelTarget, args);
          sink.push({ reason, tenantBound, ids: rows.map((row) => row.id) });
          return rows;
        };
      },
    });

  const probeClient = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(inner, property) {
        const value = Reflect.get(inner, property) as unknown;
        if (property === "sagaInstance") {
          return probeModel(value as object);
        }
        if (property === "$transaction") {
          const original = value as (arg: unknown, options?: unknown) => unknown;
          return (arg: unknown, options?: unknown): unknown => {
            if (typeof arg !== "function") {
              return original.call(inner, arg, options);
            }
            const body = arg as (tx: object) => unknown;
            return original.call(inner, (tx: object) => body(probeClient(tx)), options);
          };
        }
        return bindIfCallable(value, inner);
      },
    }) as T;

  return probeClient(client as unknown as object) as unknown as PrismaClient;
}

describe("Saga engine — two-tenant isolation (MERGE-BLOCKING)", { concurrency: 1 }, () => {
  let base: PrismaClient;
  let guarded: PrismaClient;
  let blinded: PrismaClient;
  let redis: Redis;
  let eventService: EventService;

  /** Request-shaped manager: starts sagas, persists, never runs a loop. */
  let requestEngine: SagaExecutionEngine;
  let requestLifecycle: SagaManagerLifecycle;

  /** Recovery-shaped manager: boots and ticks with no tenant bound. */
  let recoveryLifecycle: SagaManagerLifecycle;
  let recoveryScheduler: NoopBackgroundTaskScheduler;
  const recoveryScans: ScanObservation[] = [];

  /** Same shape as the recovery manager, but the guard sees no declared context. */
  let blindedLifecycle: SagaManagerLifecycle;
  let blindedScheduler: NoopBackgroundTaskScheduler;

  /** Timeout-checker manager: everything it holds is already overdue. */
  let timeoutLifecycle: SagaManagerLifecycle;
  let timeoutEngine: SagaExecutionEngine;
  let timeoutScheduler: NoopBackgroundTaskScheduler;
  const timeoutLockStore = new RecordingLockStore();

  let tenantA: Tenant;
  let tenantB: Tenant;

  function buildInstance(params: {
    id: string;
    accountId: string;
    userId: string;
    status: SagaInstance["status"];
    nextRetryAt?: Date;
    /** Overrides the tenant column only, to model a row written by old code. */
    columnAccountId?: string;
  }): SagaInstance {
    return {
      id: params.id,
      definitionId: PROBE_DEFINITION_ID,
      status: params.status,
      currentStep: 0,
      accountId: params.columnAccountId ?? params.accountId,
      context: createSagaContext({
        sagaId: params.id,
        correlationId: `corr-${params.id}`,
        accountId: params.accountId,
        userId: params.userId,
        metadata: { accountId: params.accountId },
      }),
      stepResults: [],
      compensationResults: [],
      startedAt: new Date(),
      retryCount: 0,
      ...(params.nextRetryAt !== undefined && { nextRetryAt: params.nextRetryAt }),
    };
  }

  async function seedTenant(name: string): Promise<Tenant> {
    const account = await base.account.create({
      data: {
        name: `${TAG}-${name}`,
        email: `${TAG}-${name}-${randomUUID()}@test.local`,
        slug: `${TAG}-${name}-${randomUUID()}`,
      },
    });
    const customerUser = await base.customerUser.create({
      data: {
        accountId: account.id,
        email: `${TAG}-${name}-user-${randomUUID()}@test.local`,
        passwordHash: "ignored-for-test",
        firstName: "Saga",
        lastName: `Tenant${name}`,
      },
    });

    const tenant: Tenant = {
      accountId: account.id,
      customerUserId: customerUser.id,
      isolationSagaId: `${TAG}-${name}-isolation-${randomUUID()}`,
      bootSagaId: `${TAG}-${name}-boot-${randomUUID()}`,
      retrySagaId: `${TAG}-${name}-retry-${randomUUID()}`,
    };

    // Written through the ENGINE under the tenant's own rehydrated scope, so
    // every seeded row also proves the guarded write path for that account.
    const elapsedRetry = new Date(Date.now() - 60_000);
    await withTenantContext({ accountId: account.id }, async () => {
      await requestEngine.persistSagaInstance(
        buildInstance({
          id: tenant.isolationSagaId,
          accountId: account.id,
          userId: customerUser.id,
          status: "COMPLETED",
        })
      );
      await requestEngine.persistSagaInstance(
        buildInstance({
          id: tenant.bootSagaId,
          accountId: account.id,
          userId: customerUser.id,
          status: "RUNNING",
        })
      );
      await requestEngine.persistSagaInstance(
        buildInstance({
          id: tenant.retrySagaId,
          accountId: account.id,
          userId: customerUser.id,
          status: "RUNNING",
          nextRetryAt: elapsedRetry,
        })
      );
    });

    return tenant;
  }

  function allSagaIds(): string[] {
    return [tenantA, tenantB].flatMap((tenant) => [
      tenant.isolationSagaId,
      tenant.bootSagaId,
      tenant.retrySagaId,
    ]);
  }

  async function waitFor(
    predicate: () => Promise<boolean>,
    description: string,
    timeoutMs = 20_000
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await predicate()) return;
      if (Date.now() > deadline) {
        assert.fail(`timed out after ${timeoutMs}ms waiting for: ${description}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  before(async () => {
    base = createTestPrismaClient();
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });

    guarded = base.$extends(
      tenantGuardExtension({ getTenantContext, getSystemContext })
    ) as unknown as PrismaClient;

    // Same guard, but the declared system context is invisible to it — the
    // harness's way of removing a background loop's declared context.
    blinded = base.$extends(
      tenantGuardExtension({ getTenantContext, getSystemContext: () => undefined })
    ) as unknown as PrismaClient;

    const probedGuarded = withScanProbe(guarded, recoveryScans);

    eventService = new EventService({
      prisma: guarded,
      redis,
      scheduler: new NoopBackgroundTaskScheduler(),
    });
    await eventService.initialize();

    const buildManager = (
      prisma: PrismaClient,
      scheduler: NoopBackgroundTaskScheduler,
      overrides: { defaultTimeout?: number; lockStore?: SemanticLockPort } = {}
    ): { lifecycle: SagaManagerLifecycle; execution: SagaExecutionEngine } => {
      const config = { prisma, redis, eventService, scheduler, enableMetrics: true, ...overrides };
      const lifecycle = new SagaManagerLifecycle(config);
      const execution = new SagaExecutionEngine(config, lifecycle);
      lifecycle.executionEngine = execution;
      lifecycle.registerSaga(probeDefinition);
      return { lifecycle, execution };
    };

    const request = buildManager(guarded, new NoopBackgroundTaskScheduler());
    requestLifecycle = request.lifecycle;
    requestEngine = request.execution;

    recoveryScheduler = new NoopBackgroundTaskScheduler();
    recoveryLifecycle = buildManager(probedGuarded, recoveryScheduler).lifecycle;

    blindedScheduler = new NoopBackgroundTaskScheduler();
    blindedLifecycle = buildManager(blinded, blindedScheduler).lifecycle;

    timeoutScheduler = new NoopBackgroundTaskScheduler();
    // Every saga this manager holds is overdue the moment it is registered, so
    // one triggered tick exercises the checker's whole decision.
    const timeoutManager = buildManager(guarded, timeoutScheduler, {
      defaultTimeout: 1,
      lockStore: timeoutLockStore,
    });
    timeoutLifecycle = timeoutManager.lifecycle;
    timeoutEngine = timeoutManager.execution;

    // Registers the timeout task WITHOUT booting: `initialize()` would load
    // every non-terminal saga in the shared database into a manager whose
    // sagas are all overdue by construction.
    (timeoutLifecycle as unknown as { startTimeoutChecker(): void }).startTimeoutChecker();

    tenantA = await seedTenant("A");
    tenantB = await seedTenant("B");
  });

  after(async () => {
    const sagaIds = allSagaIds();
    const accountIds = [tenantA?.accountId, tenantB?.accountId].filter(
      (id): id is string => typeof id === "string"
    );

    await base.sagaInstance
      .deleteMany({ where: { OR: [{ id: { in: sagaIds } }, { accountId: { in: accountIds } }] } })
      .catch(() => undefined);
    await base.storedEvent
      .deleteMany({ where: { streamId: { in: sagaIds.map(sagaStreamId) } } })
      .catch(() => undefined);
    await base.customerUser
      .deleteMany({ where: { accountId: { in: accountIds } } })
      .catch(() => undefined);
    await base.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => undefined);

    if (sagaIds.length > 0) {
      await redis.del(...sagaIds.map((id) => `saga:${id}`)).catch(() => undefined);
    }
    await redis.quit();
    await base.$disconnect();
  });

  describe("the fixture premise", () => {
    it("gives each tenant a user id that is not its account id", () => {
      assert.notStrictEqual(
        tenantA.customerUserId,
        tenantA.accountId,
        "the auth boundary derives the user from `sub` and the tenant from `accountId`; equal values would let every proof below pass by coincidence"
      );
      assert.notStrictEqual(tenantB.customerUserId, tenantB.accountId);
      assert.notStrictEqual(
        tenantA.accountId,
        tenantB.accountId,
        "the two tenants must be distinct accounts"
      );
    });
  });

  describe("a saga started inside a customer request", () => {
    it("persists the owning account, never the acting user, and raises no mismatch", async () => {
      const failuresBefore = requestLifecycle.metrics.rehydrationFailures;

      const started = await withTenantContext({ accountId: tenantA.accountId }, () =>
        requestLifecycle.startSaga(PROBE_DEFINITION_ID, {
          userId: tenantA.customerUserId,
          accountId: tenantA.accountId,
          metadata: { accountId: tenantA.accountId },
        })
      );

      await waitFor(async () => {
        const row = await base.sagaInstance.findUnique({ where: { id: started.id } });
        return row?.status === "COMPLETED";
      }, `started saga ${started.id} reaching COMPLETED`);

      const row = await base.sagaInstance.findUniqueOrThrow({ where: { id: started.id } });
      assert.strictEqual(
        row.accountId,
        tenantA.accountId,
        "the persisted tenant column carries the owning account"
      );
      assert.notStrictEqual(
        row.accountId,
        tenantA.customerUserId,
        "the acting user id must never reach the tenant column"
      );
      assert.strictEqual(
        requestLifecycle.metrics.rehydrationFailures,
        failuresBefore,
        "a saga started with a resolvable account never falls into the fail-loud path"
      );

      const observed = stepObservations.find((entry) => entry.sagaId === started.id);
      assert.ok(observed, "the probe step must have executed");
      assert.strictEqual(
        observed.boundAccountId,
        tenantA.accountId,
        "the step ran scoped to the saga's own account"
      );

      await base.sagaInstance.deleteMany({ where: { id: started.id } });
      await base.storedEvent.deleteMany({ where: { streamId: sagaStreamId(started.id) } });
      await redis.del(`saga:${started.id}`);
    });
  });

  describe("cross-tenant access through the guarded client", () => {
    it("hides the other tenant's saga from a by-id read once the Redis fast path is empty", async () => {
      const cacheKey = `saga:${tenantB.isolationSagaId}`;

      await waitFor(
        async () => (await redis.get(cacheKey)) !== null,
        `Redis hot cache to hold ${cacheKey}`
      );

      // The fast path returns before any guarded read, so the proof would be
      // vacuous while the cached copy exists.
      await redis.del(cacheKey);
      assert.strictEqual(
        await redis.get(cacheKey),
        null,
        "the cached copy must be gone before the guarded read is exercised"
      );

      // Every query below is awaited INSIDE its context callback: a Prisma call
      // is lazy, so returning it unawaited would run it after the scope closed.
      const readByForeignTenant = await withTenantContext(
        { accountId: tenantA.accountId },
        async () =>
          await guarded.sagaInstance.findUnique({ where: { id: tenantB.isolationSagaId } })
      );

      assert.strictEqual(
        readByForeignTenant,
        null,
        "the guard scopes the read to A, so B's saga resolves to nothing — a NOT_FOUND, never a 403 and never an error"
      );

      const ownRead = await withTenantContext(
        { accountId: tenantB.accountId },
        async () =>
          await guarded.sagaInstance.findUnique({ where: { id: tenantB.isolationSagaId } })
      );
      assert.strictEqual(
        ownRead?.id,
        tenantB.isolationSagaId,
        "the owning tenant still reads its own saga, so the null above is scoping and not absence"
      );
    });

    it("returns none of the other tenant's sagas when listing", async () => {
      const listed = await withTenantContext(
        { accountId: tenantA.accountId },
        async () =>
          await guarded.sagaInstance.findMany({
            where: { definitionId: PROBE_DEFINITION_ID },
            select: { id: true, accountId: true },
          })
      );

      assert.ok(listed.length > 0, "A must see its own sagas");
      assert.ok(
        listed.some((row) => row.id === tenantA.isolationSagaId),
        "A's own saga is present, so the list is not empty by accident"
      );
      assert.ok(
        listed.every((row) => row.accountId === tenantA.accountId),
        "every listed row belongs to A"
      );
      for (const foreignId of [tenantB.isolationSagaId, tenantB.bootSagaId, tenantB.retrySagaId]) {
        assert.ok(
          !listed.some((row) => row.id === foreignId),
          `B's saga ${foreignId} must not appear in A's listing`
        );
      }
    });

    it("refuses to mutate the other tenant's saga and leaves the row untouched", async () => {
      // A scoped bulk update simply matches nothing — the clearest proof that
      // the guard narrowed the target rather than failing for another reason.
      const bulk = await withTenantContext(
        { accountId: tenantA.accountId },
        async () =>
          await guarded.sagaInstance.updateMany({
            where: { id: tenantB.isolationSagaId },
            data: { status: "FAILED" },
          })
      );
      assert.strictEqual(bulk.count, 0, "a foreign update must match zero rows");

      await assert.rejects(
        () =>
          withTenantContext(
            { accountId: tenantA.accountId },
            async () =>
              await guarded.sagaInstance.update({
                where: { id: tenantB.isolationSagaId },
                data: { status: "FAILED" },
              })
          ),
        (error: unknown) => {
          assert.ok(
            !(error instanceof TenantContextMissingError),
            "the rejection must come from tenant SCOPING, not from an undeclared context"
          );
          return true;
        }
      );

      const victim = await base.sagaInstance.findUniqueOrThrow({
        where: { id: tenantB.isolationSagaId },
      });
      assert.strictEqual(victim.status, "COMPLETED", "B's saga keeps its status");
      assert.strictEqual(victim.accountId, tenantB.accountId, "B's saga keeps its tenant");
    });

    it("pins the residual: the engine's by-id load is system-scoped, so the route ownership check is the control", async () => {
      await redis.del(`saga:${tenantB.isolationSagaId}`);

      const loaded = await withTenantContext({ accountId: tenantA.accountId }, () =>
        requestEngine.loadSagaInstance(tenantB.isolationSagaId)
      );

      // Documented, accepted residual: the load exists to discover which tenant
      // owns an id, so it declares the system reason and the guard does not
      // scope it. The customer route answers 404 on the ownership check instead.
      assert.ok(
        loaded,
        "the engine load is deliberately not guard-scoped — recorded so it cannot widen unnoticed"
      );
      assert.notStrictEqual(
        loaded.context.userId,
        tenantA.customerUserId,
        "the route's ownership check compares the saga's userId against the caller and answers NOT_FOUND here"
      );
    });
  });

  describe("a persist that disagrees with the bound tenant", () => {
    it("is rejected inside the engine transaction, writes no row, and is visible in the logs", async () => {
      const foreignSagaId = `${TAG}-mismatch-${randomUUID()}`;
      const ownedByB = buildInstance({
        id: foreignSagaId,
        accountId: tenantB.accountId,
        userId: tenantB.customerUserId,
        status: "RUNNING",
      });

      let raised: unknown;
      const lines = await captureLogs(async () => {
        await withTenantContext({ accountId: tenantA.accountId }, async () => {
          try {
            await requestEngine.persistSagaInstance(ownedByB);
          } catch (error) {
            raised = error;
          }
        });
      });

      assert.ok(
        raised instanceof TenantContextMismatchError,
        `a saga carrying account B must be rejected under A's scope, got: ${String(raised)}`
      );

      const written = await base.sagaInstance.findUnique({ where: { id: foreignSagaId } });
      assert.strictEqual(written, null, "the rejected persist must leave no row behind");

      const persistFailure = lines.find(
        (line) => line.sagaId === foreignSagaId && line.level === "error"
      );
      assert.ok(persistFailure, "the rejection must be logged at ERROR, never swallowed");
      assert.strictEqual(
        persistFailure.msg,
        "Failed to persist saga to PostgreSQL",
        "the log names the failing operation"
      );
    });
  });

  describe("the background scans with no tenant bound", () => {
    it("loads both tenants' sagas at boot under the declared system reason", async () => {
      const before = recoveryScans.length;
      const failuresBefore = recoveryLifecycle.metrics.bootLoadFailures;

      assert.strictEqual(
        getTenantContext(),
        undefined,
        "the boot path must be exercised with no tenant bound at all"
      );
      await recoveryLifecycle.initialize();

      const bootScans = recoveryScans.slice(before);
      assert.strictEqual(bootScans.length, 1, "boot performs exactly one instance scan");

      const scan = bootScans[0];
      assert.strictEqual(
        scan?.reason,
        SAGA_SYSTEM_REASON,
        "the scan declares the single saga system reason"
      );
      assert.strictEqual(scan?.tenantBound, false, "the scan runs without any tenant scope");
      for (const expectedId of [
        tenantA.bootSagaId,
        tenantA.retrySagaId,
        tenantB.bootSagaId,
        tenantB.retrySagaId,
      ]) {
        assert.ok(
          scan?.ids.includes(expectedId),
          `the boot scan must observe ${expectedId} across both accounts`
        );
      }
      assert.strictEqual(
        recoveryLifecycle.metrics.bootLoadFailures,
        failuresBefore,
        "a declared scan raises no TenantContextMissingError"
      );

      // Each loaded row is re-warmed under its OWN rehydrated tenant; the cache
      // entry reappearing is that write completing through the guard.
      await waitFor(
        async () => (await redis.get(`saga:${tenantB.bootSagaId}`)) !== null,
        "the boot re-warm to persist B's saga under B's rehydrated scope"
      );
    });

    it("sees both tenants' due retries in one tick and resumes each under its own tenant", async () => {
      const before = recoveryScans.length;
      const failuresBefore = recoveryLifecycle.metrics.recoveryScanFailures;

      await recoveryScheduler.triggerTask(RETRY_RECOVERY_TASK_ID);

      const tickScans = recoveryScans.slice(before);
      assert.strictEqual(tickScans.length, 1, "one tick performs exactly one due-set scan");

      const scan = tickScans[0];
      assert.strictEqual(scan?.reason, SAGA_SYSTEM_REASON, "the tick declares the same reason");
      assert.strictEqual(scan?.tenantBound, false, "the tick runs without any tenant scope");
      assert.ok(
        scan?.ids.includes(tenantA.retrySagaId) && scan.ids.includes(tenantB.retrySagaId),
        "one tick observes the due retries of BOTH accounts"
      );
      assert.strictEqual(
        recoveryLifecycle.metrics.recoveryScanFailures,
        failuresBefore,
        "a declared scan raises no TenantContextMissingError"
      );

      await waitFor(async () => {
        const rows = await base.sagaInstance.findMany({
          where: { id: { in: [tenantA.retrySagaId, tenantB.retrySagaId] } },
          select: { id: true, status: true },
        });
        return rows.length === 2 && rows.every((row) => row.status === "COMPLETED");
      }, "both resumed sagas reaching COMPLETED");

      for (const tenant of [tenantA, tenantB]) {
        const observed = stepObservations.find((entry) => entry.sagaId === tenant.retrySagaId);
        assert.ok(observed, `the resumed step must have executed for ${tenant.retrySagaId}`);
        assert.strictEqual(
          observed.boundAccountId,
          tenant.accountId,
          "a detached resume runs under the saga's own rehydrated tenant, not the other account and not unscoped"
        );

        const row = await base.sagaInstance.findUniqueOrThrow({
          where: { id: tenant.retrySagaId },
        });
        assert.strictEqual(
          row.accountId,
          tenant.accountId,
          "the resumed persist keeps the saga on its owning account"
        );
      }
    });
  });

  describe("starting a saga the engine could never scope", () => {
    /** Ids of every probe saga currently committed, for an exact no-write proof. */
    async function probeSagaIds(): Promise<string[]> {
      const rows = await base.sagaInstance.findMany({
        where: { definitionId: PROBE_DEFINITION_ID },
        select: { id: true },
      });
      return rows.map((row) => row.id).sort();
    }

    it("refuses a start with no owning account and leaves no row behind", async () => {
      const before = await probeSagaIds();

      await assert.rejects(
        () =>
          withTenantContext({ accountId: tenantA.accountId }, () =>
            requestLifecycle.startSaga(PROBE_DEFINITION_ID, {
              userId: tenantA.customerUserId,
            })
          ),
        (error: unknown) => {
          const status = (error as { statusCode?: number }).statusCode;
          assert.strictEqual(status, 400, "an unscopable start is a client error, not a 500");
          assert.match(String((error as Error).message), /owning account/);
          return true;
        }
      );

      assert.deepStrictEqual(
        await probeSagaIds(),
        before,
        "a rejected start must not leave an orphan row the engine can never scope"
      );
    });

    it("refuses a start whose two account copies disagree", async () => {
      const before = await probeSagaIds();

      await assert.rejects(
        () =>
          withTenantContext({ accountId: tenantA.accountId }, () =>
            requestLifecycle.startSaga(PROBE_DEFINITION_ID, {
              userId: tenantA.customerUserId,
              accountId: tenantA.accountId,
              // The pivot step reads the metadata copy while the engine scopes
              // on the field: a divergence publishes under one account and
              // persists under another.
              metadata: { accountId: tenantB.accountId },
            })
          ),
        (error: unknown) => {
          assert.strictEqual((error as { statusCode?: number }).statusCode, 400);
          assert.match(String((error as Error).message), /two different owning accounts/);
          return true;
        }
      );

      assert.deepStrictEqual(await probeSagaIds(), before);
    });
  });

  describe("the timeout checker meeting a saga it cannot scope", () => {
    /** Commits a row directly, bypassing the engine, to model history. */
    async function seedRawSaga(params: {
      id: string;
      columnAccountId: string | null;
      contextAccountId: string | null;
      userId: string;
    }): Promise<void> {
      await base.sagaInstance.create({
        data: {
          id: params.id,
          definitionId: PROBE_DEFINITION_ID,
          status: "RUNNING",
          currentStep: 0,
          accountId: params.columnAccountId,
          context: {
            sagaId: params.id,
            correlationId: `corr-${params.id}`,
            userId: params.userId,
            ...(params.contextAccountId !== null && { accountId: params.contextAccountId }),
            metadata: {
              ...(params.contextAccountId !== null && { accountId: params.contextAccountId }),
            },
            stepData: {},
            events: [],
          },
          stepResults: [],
          compensationResults: [],
          retryCount: 0,
          startedAt: new Date(Date.now() - 60_000),
        },
      });
    }

    /** Loads the row exactly as the engine would and hands it to the checker. */
    async function trackForTimeout(sagaId: string): Promise<SagaInstance> {
      await redis.del(`saga:${sagaId}`);
      const loaded = await timeoutEngine.loadSagaInstance(sagaId);
      assert.ok(loaded, `the engine must be able to load ${sagaId}`);
      timeoutLifecycle.activeInstances.set(sagaId, loaded);
      return loaded;
    }

    it("terminalizes the cutover straggler whose column holds the acting user id", async () => {
      const stragglerId = `${TAG}-straggler-${randomUUID()}`;
      // Exactly what the pre-change engine wrote: the ACTING USER in the tenant
      // column while the context named the real account.
      await seedRawSaga({
        id: stragglerId,
        columnAccountId: tenantA.customerUserId,
        contextAccountId: tenantA.accountId,
        userId: tenantA.customerUserId,
      });

      const loaded = await trackForTimeout(stragglerId);
      assert.strictEqual(
        loaded.accountId,
        tenantA.customerUserId,
        "the load carries the persisted column — dropping it is what made the contradiction invisible"
      );

      const mismatchesBefore = timeoutLifecycle.metrics.tenantMismatches;
      const failedBefore = timeoutLifecycle.metrics.sagasFailed;

      const lines = await captureLogs(async () => {
        await timeoutScheduler.triggerTask("saga-timeout-checker");
      });

      assert.strictEqual(
        timeoutLifecycle.metrics.tenantMismatches,
        mismatchesBefore + 1,
        "the contradiction is counted, not silently skipped"
      );
      assert.strictEqual(timeoutLifecycle.metrics.sagasFailed, failedBefore + 1);

      const mismatchLog = lines.find(
        (line) => line.sagaId === stragglerId && line.reason === "tenant-mismatch"
      );
      assert.ok(mismatchLog, "the contradiction must be logged");
      assert.strictEqual(mismatchLog.level, "error");

      const row = await base.sagaInstance.findUniqueOrThrow({ where: { id: stragglerId } });
      assert.strictEqual(row.status, "FAILED", "an unscopable saga reaches a terminal state");
      assert.strictEqual(
        row.accountId,
        tenantA.customerUserId,
        "terminalization does not guess a tenant onto the row"
      );
      assert.ok(
        !timeoutLifecycle.activeInstances.has(stragglerId),
        "the terminalized saga stops being tracked"
      );

      // The anomalous transition is exactly the one whose audit trail must not
      // have a hole: the event commits with the row, not after it.
      const failedEvents = await base.storedEvent.findMany({
        where: { streamId: sagaStreamId(stragglerId), eventType: "saga.failed" },
      });
      assert.strictEqual(
        failedEvents.length,
        1,
        "the terminal transition appends exactly one SAGA_FAILED event"
      );
      assert.match(
        String(failedEvents[0]?.eventData),
        /tenant-mismatch/,
        "the durable event names why the saga could not be scoped"
      );
      assert.ok(
        timeoutLockStore.releasedSagaIds.includes(stragglerId),
        "the terminalized saga gives its semantic locks back instead of holding them until TTL"
      );

      // The whole point of terminalizing: a second tick has nothing left to do.
      // Before this, every tick logged and counted the same row again forever.
      await timeoutScheduler.triggerTask("saga-timeout-checker");
      assert.strictEqual(timeoutLifecycle.metrics.tenantMismatches, mismatchesBefore + 1);

      await base.storedEvent.deleteMany({ where: { streamId: sagaStreamId(stragglerId) } });
      await base.sagaInstance.deleteMany({ where: { id: stragglerId } });
      await redis.del(`saga:${stragglerId}`);
    });

    it("terminalizes a saga that carries no account on any source", async () => {
      const orphanId = `${TAG}-orphan-${randomUUID()}`;
      await seedRawSaga({
        id: orphanId,
        columnAccountId: null,
        contextAccountId: null,
        userId: tenantA.customerUserId,
      });

      await trackForTimeout(orphanId);
      const rehydrationBefore = timeoutLifecycle.metrics.rehydrationFailures;

      await timeoutScheduler.triggerTask("saga-timeout-checker");

      assert.strictEqual(
        timeoutLifecycle.metrics.rehydrationFailures,
        rehydrationBefore + 1,
        "the unresolvable saga is counted"
      );
      const row = await base.sagaInstance.findUniqueOrThrow({ where: { id: orphanId } });
      assert.strictEqual(row.status, "FAILED");
      assert.strictEqual(row.accountId, null, "the sentinel stays the sentinel");

      const failedEvents = await base.storedEvent.findMany({
        where: { streamId: sagaStreamId(orphanId), eventType: "saga.failed" },
      });
      assert.strictEqual(failedEvents.length, 1, "the terminal transition is audited durably");
      assert.ok(
        timeoutLockStore.releasedSagaIds.includes(orphanId),
        "the terminalized saga gives its semantic locks back"
      );

      await base.storedEvent.deleteMany({ where: { streamId: sagaStreamId(orphanId) } });
      await base.sagaInstance.deleteMany({ where: { id: orphanId } });
      await redis.del(`saga:${orphanId}`);
    });

    it("refreshes instead of terminalizing when a repair made the saga resolvable", async () => {
      // The documented remedy for this row class is re-running the idempotent
      // backfill, which happens UNDERNEATH a live process. Deciding on the
      // in-memory copy would kill a saga that had just been made resumable.
      const repairedId = `${TAG}-repaired-${randomUUID()}`;
      await seedRawSaga({
        id: repairedId,
        columnAccountId: null,
        contextAccountId: null,
        userId: tenantA.customerUserId,
      });

      await trackForTimeout(repairedId);

      // The repair lands between the load and the tick, exactly as an operator
      // re-running the backfill would leave it.
      await base.sagaInstance.update({
        where: { id: repairedId },
        data: { accountId: tenantA.accountId },
      });

      const failedBefore = timeoutLifecycle.metrics.sagasFailed;
      await timeoutScheduler.triggerTask("saga-timeout-checker");

      const row = await base.sagaInstance.findUniqueOrThrow({ where: { id: repairedId } });
      assert.notStrictEqual(
        row.status,
        "FAILED",
        "a saga that became resolvable must not be terminalized on the stale copy"
      );
      assert.strictEqual(
        timeoutLifecycle.metrics.sagasFailed,
        failedBefore,
        "no terminal failure is recorded for a repaired saga"
      );
      const tracked = timeoutLifecycle.activeInstances.get(repairedId);
      assert.strictEqual(
        tracked?.accountId,
        tenantA.accountId,
        "the in-memory copy is refreshed from the repaired row"
      );

      timeoutLifecycle.activeInstances.delete(repairedId);
      await base.storedEvent.deleteMany({ where: { streamId: sagaStreamId(repairedId) } });
      await base.sagaInstance.deleteMany({ where: { id: repairedId } });
      await redis.del(`saga:${repairedId}`);
    });

    it("keeps checking the remaining sagas after one of them throws", async () => {
      const poisonId = `${TAG}-poison-${randomUUID()}`;
      const survivorId = `${TAG}-survivor-${randomUUID()}`;
      for (const id of [poisonId, survivorId]) {
        await seedRawSaga({
          id,
          columnAccountId: tenantA.accountId,
          contextAccountId: tenantA.accountId,
          userId: tenantA.customerUserId,
        });
      }

      // Insertion order matters: the poisoned saga is checked FIRST, so the
      // survivor proves the pass continued past the throw instead of ending.
      await trackForTimeout(poisonId);
      await trackForTimeout(survivorId);

      const realEngine = timeoutLifecycle.executionEngine;
      const poisonedEngine: SagaExecutionEnginePort = {
        executeSagaAsync: (id) => realEngine.executeSagaAsync(id),
        compensateSagaAsync: (id) => realEngine.compensateSagaAsync(id),
        persistSagaInstance: (instance, events) => realEngine.persistSagaInstance(instance, events),
        loadSagaInstance: (id) => realEngine.loadSagaInstance(id),
        failSaga: async (instance, error, reason) => {
          if (instance.id === poisonId) {
            throw new Error("poisoned saga: the checker must survive this");
          }
          return await realEngine.failSaga(instance, error, reason);
        },
      };
      timeoutLifecycle.executionEngine = poisonedEngine;

      const failuresBefore = timeoutLifecycle.metrics.timeoutCheckFailures;
      const lines = await captureLogs(async () => {
        await timeoutScheduler.triggerTask("saga-timeout-checker");
      });
      timeoutLifecycle.executionEngine = realEngine;

      assert.strictEqual(
        timeoutLifecycle.metrics.timeoutCheckFailures,
        failuresBefore + 1,
        "the throwing iteration is counted, not swallowed"
      );
      const failure = lines.find(
        (line) => line.loop === "timeout-checker" && line.sagaId === poisonId
      );
      assert.ok(failure, "the failing iteration must be logged");
      assert.strictEqual(failure.level, "error");

      const rows = await base.sagaInstance.findMany({
        where: { id: { in: [poisonId, survivorId] } },
        select: { id: true, status: true },
      });
      const byId = new Map(rows.map((row) => [row.id, row.status]));
      assert.strictEqual(byId.get(poisonId), "RUNNING", "the poisoned saga was not advanced");
      assert.strictEqual(
        byId.get(survivorId),
        "FAILED",
        "the saga AFTER the throw was still checked — one bad row must not end the pass"
      );

      timeoutLifecycle.activeInstances.delete(poisonId);
      timeoutLifecycle.activeInstances.delete(survivorId);
      await base.sagaInstance.deleteMany({ where: { id: { in: [poisonId, survivorId] } } });
      await base.storedEvent.deleteMany({
        where: { streamId: { in: [poisonId, survivorId].map(sagaStreamId) } },
      });
      await redis.del(`saga:${poisonId}`, `saga:${survivorId}`);
    });
  });

  describe("shutting down while a saga cannot be handed off", () => {
    it("reports the failure and still finishes the drain", async () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      const config = { prisma: guarded, redis, eventService, scheduler, enableMetrics: true };
      const lifecycle = new SagaManagerLifecycle(config);
      const engine = new SagaExecutionEngine(config, lifecycle);
      lifecycle.registerSaga(probeDefinition);
      lifecycle.executionEngine = {
        executeSagaAsync: (id) => engine.executeSagaAsync(id),
        compensateSagaAsync: (id) => engine.compensateSagaAsync(id),
        persistSagaInstance: async () => {
          throw new Error("durable store unreachable during shutdown");
        },
        loadSagaInstance: (id) => engine.loadSagaInstance(id),
        failSaga: (instance, error, reason) => engine.failSaga(instance, error, reason),
      } satisfies SagaExecutionEnginePort;

      const stuckId = `${TAG}-shutdown-${randomUUID()}`;
      lifecycle.activeInstances.set(
        stuckId,
        buildInstance({
          id: stuckId,
          accountId: tenantA.accountId,
          userId: tenantA.customerUserId,
          status: "RUNNING",
        })
      );

      const lines = await captureLogs(async () => {
        // A drain that rejects here used to abort the whole teardown, leaving
        // the process holding its port and its pool until it was killed.
        await lifecycle.shutdown();
      });

      const failure = lines.find((line) => line.sagaId === stuckId && line.level === "error");
      assert.ok(failure, "the failed handoff must surface at ERROR");
      assert.strictEqual(lifecycle.activeInstances.size, 0, "the drain still completed");
    });
  });

  describe("a background loop whose declared context is removed", () => {
    it("counts and logs the boot-load failure instead of booting as if nothing was in flight", async () => {
      const failuresBefore = blindedLifecycle.metrics.bootLoadFailures;

      const lines = await captureLogs(async () => {
        await blindedLifecycle.initialize();
      });

      assert.strictEqual(
        blindedLifecycle.metrics.bootLoadFailures,
        failuresBefore + 1,
        "the failure is counted, so an operator can tell a broken load from an empty one"
      );

      const failure = lines.find((line) => line.loop === "boot-load");
      assert.ok(failure, "the boot load failure must be logged");
      assert.strictEqual(failure.level, "error", "a swallowed scan failure must surface at ERROR");
      assert.strictEqual(
        failure.errorType,
        "TenantContextMissingError",
        "the log names the error type"
      );
      assert.match(
        String(failure.correlationId),
        /^saga-recovery-/,
        "the log carries the pass correlation id"
      );
    });

    it("counts and logs a failing retry tick instead of reporting an empty successful scan", async () => {
      const failuresBefore = blindedLifecycle.metrics.recoveryScanFailures;

      const lines = await captureLogs(async () => {
        await blindedScheduler.triggerTask(RETRY_RECOVERY_TASK_ID);
      });

      assert.strictEqual(
        blindedLifecycle.metrics.recoveryScanFailures,
        failuresBefore + 1,
        "the tick increments the failure counter — an empty successful scan increments nothing"
      );

      const failure = lines.find((line) => line.loop === "retry-recovery-scan");
      assert.ok(failure, "the failing tick must be logged");
      assert.strictEqual(failure.level, "error", "a failing tick must surface at ERROR");
      assert.strictEqual(
        failure.errorType,
        "TenantContextMissingError",
        "the log names the error type"
      );
      assert.match(
        String(failure.correlationId),
        /^saga-recovery-/,
        "the log carries the tick correlation id"
      );
    });
  });
});
