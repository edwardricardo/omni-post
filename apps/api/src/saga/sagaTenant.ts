/**
 * @file sagaTenant.ts
 * @description The saga engine's tenant module: it owns BOTH isolation layers
 *              for every detached engine operation, so no call site has to
 *              remember either one.
 *
 *              The engine runs with no HTTP request to inherit a scope from, so
 *              it resolves the owning account from the saga itself and declares
 *              it explicitly. EVERY primitive here binds BOTH layers: the
 *              AsyncLocalStorage context the Prisma guard reads AND the
 *              transaction-local `app.account_id` the row-level policies read.
 *              That includes the tenant-unknown READS — `withSagaSystemRead`
 *              opens its own transaction and binds the system scope first,
 *              because a single statement outside a transaction binds no setting
 *              at all, and under a role that does not bypass row-level security
 *              such a read returns ZERO rows with no error: a silently empty
 *              recovery scan.
 *
 *              Two failure modes are closed by construction rather than by
 *              convention:
 *
 *                - a Prisma call is LAZY, so a wrap that hands the unawaited
 *                  promise back releases its scope before the query runs; every
 *                  primitive here awaits inside its own callback, so no call
 *                  site can reintroduce the shape;
 *                - the transaction-local setting must be the first statement of
 *                  the transaction, before any query the policy should govern.
 *
 *              Account resolution is COLUMN-AUTHORITATIVE: the persisted
 *              `accountId` wins, the context is the fallback, and a disagreement
 *              between them fails closed rather than picking a side. A saga whose
 *              account cannot be resolved is never run unscoped — callers get a
 *              discriminated outcome they must consume, and the timeout checker
 *              terminalizes the row through the single system-scoped write below.
 * @layer infrastructure
 */
import { randomUUID } from "node:crypto";
import { SYSTEM_TENANT_SCOPE, setTenantGuc } from "@infra/prisma/extensions/tenantGuc.js";
import type { SagaContext, SagaInstance } from "@shared/types/saga.js";
import { SAGA_EVENTS } from "@shared/types/saga.js";
import { createEventStoreEvent } from "@shared/types/events.js";
import { withSystemContext, withTenantContext } from "../security/tenantContext.js";
import { logger } from "../lib/logger.js";
import { recordSagaFailed, recordSagaRecoveryFailure } from "../metrics/sagaRecoveryMetrics.js";
import type {
  SagaEngineClient,
  SagaManagerConfig,
  SagaTransactionClient,
} from "./sagaManagerTypes.js";

/**
 * The only system-context reason the saga engine may use. Every cross-tenant
 * read the engine performs (boot load, retry scan, by-id load) and its single
 * cross-tenant write declare this one reason, so the boundary is grep-able as a
 * single constant rather than a family of ad-hoc strings.
 */
export const SAGA_SYSTEM_REASON = "system:saga-recovery" as const;

/** Why per-saga work could not run under the saga's own tenant. */
export type SagaTenantSkipReason = "unresolvable-account" | "tenant-mismatch";

/** Where a resolved account came from, kept for logs and tests. */
type SagaTenantSource = "column" | "context" | "metadata";

/** Outcome of resolving which account owns a saga. */
export type SagaTenantResolution =
  | { readonly kind: "resolved"; readonly accountId: string; readonly source: SagaTenantSource }
  | { readonly kind: "unresolvable-account" }
  | {
      readonly kind: "tenant-mismatch";
      readonly columnAccountId: string;
      readonly contextAccountId: string;
    };

/**
 * Outcome of tenant-scoped saga work. Discriminated on purpose: a caller cannot
 * mistake "skipped because the tenant is unknown" for "ran and returned
 * nothing", which is how a skip used to reach an API client as a success.
 */
export type SagaWorkOutcome<T> =
  | { readonly ran: true; readonly value: T }
  | { readonly ran: false; readonly reason: SagaTenantSkipReason };

/** Counter surface the resolution increments; the engine's metrics satisfy it. */
export interface SagaTenantMetrics {
  rehydrationFailures: number;
  tenantMismatches: number;
}

/** A non-empty string, or null when the value is absent, blank, or not a string. */
function asAccountId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * @function newSagaRecoveryCorrelationId
 * @description Mints the identifier that joins one recovery pass across its logs
 *   — one per boot pass and one per scheduled tick. Single definition so the
 *   prefix operators grep for cannot drift between loops.
 * @returns A correlation id of the form `saga-recovery-<uuid>`.
 */
export function newSagaRecoveryCorrelationId(): string {
  return `saga-recovery-${randomUUID()}`;
}

/**
 * @function resolveContextAccountId
 * @description Resolves the account a saga context claims: the first-class
 *   `accountId`, else a valid-string `metadata.accountId` (sagas started before
 *   the field existed carry it there). `userId` is never a fallback — it
 *   identifies the actor, not the tenant.
 * @param context - The saga context to read.
 * @returns The claimed account id, or `null` when the context carries none.
 */
export function resolveContextAccountId(context: SagaContext): string | null {
  return asAccountId(context.accountId) ?? asAccountId(context.metadata.accountId);
}

/**
 * @function resolveSagaTenant
 * @description Resolves the account that owns a saga, with the persisted column
 *   as the authority and the context as fallback AND cross-check. When both
 *   carry a value and they disagree, resolution FAILS CLOSED: that is the
 *   signature of a row written by code that put the acting user in the tenant
 *   column, and picking either side would either run work under the wrong tenant
 *   or drive an unbounded write-conflict loop.
 * @param instance - The saga whose owning account is being resolved.
 * @returns A resolved account with its source, or the reason it failed closed.
 */
export function resolveSagaTenant(instance: SagaInstance): SagaTenantResolution {
  const fromColumn = asAccountId(instance.accountId);
  const fromField = asAccountId(instance.context.accountId);
  const fromMetadata = asAccountId(instance.context.metadata.accountId);
  const fromContext = fromField ?? fromMetadata;

  if (fromColumn !== null && fromContext !== null && fromColumn !== fromContext) {
    return {
      kind: "tenant-mismatch",
      columnAccountId: fromColumn,
      contextAccountId: fromContext,
    };
  }

  if (fromColumn !== null) {
    return { kind: "resolved", accountId: fromColumn, source: "column" };
  }
  if (fromField !== null) {
    return { kind: "resolved", accountId: fromField, source: "context" };
  }
  if (fromMetadata !== null) {
    return { kind: "resolved", accountId: fromMetadata, source: "metadata" };
  }

  return { kind: "unresolvable-account" };
}

/**
 * @function resolveSagaAccountId
 * @description The persistable form of {@link resolveSagaTenant}: the owning
 *   account, or `null` when it is unresolvable OR contradicted. A contradicted
 *   row yields `null` so no value is ever guessed onto a write.
 * @param instance - The saga whose owning account is being resolved.
 * @returns The owning account id, or `null`.
 */
export function resolveSagaAccountId(instance: SagaInstance): string | null {
  const resolution = resolveSagaTenant(instance);
  return resolution.kind === "resolved" ? resolution.accountId : null;
}

/**
 * @function withSagaSystemRead
 * @description Runs a tenant-UNKNOWN read with BOTH isolation layers bound to
 *   the system scope, and hands the callback the transaction client the read
 *   must use. The transaction is not incidental: a bare statement binds no
 *   transaction-local setting, so under a role that does not bypass row-level
 *   security the read matches nothing and the caller sees an empty result rather
 *   than an error. The callback is awaited INSIDE the boundary, so a lazy Prisma
 *   promise cannot escape it and run undeclared.
 *
 *   Scope this to the query expression only: the boundary must never span a saga
 *   dispatch, because AsyncLocalStorage propagates through `setImmediate` and the
 *   system context has no exit primitive.
 * @param prisma - The engine's Prisma client.
 * @param fn - The read to run inside the declared boundary.
 * @returns Whatever the read resolves to.
 */
export async function withSagaSystemRead<T>(
  prisma: SagaEngineClient,
  fn: (tx: SagaTransactionClient) => Promise<T>
): Promise<T> {
  return await runSagaSystemTransaction(prisma, fn);
}

/**
 * @function runSagaTenantTransaction
 * @description Opens a transaction scoped to one account on BOTH layers: the
 *   caller has already bound the AsyncLocalStorage context (see
 *   {@link runAsSagaTenant} or the request), and this binds the
 *   transaction-local `app.account_id` as the transaction's FIRST statement so
 *   the row-level policies evaluate against the same account.
 * @param prisma - The engine's Prisma client.
 * @param accountId - The owning account to bind.
 * @param fn - The transaction body.
 * @returns Whatever the body resolves to.
 */
export async function runSagaTenantTransaction<T>(
  prisma: SagaEngineClient,
  accountId: string,
  fn: (tx: SagaTransactionClient) => Promise<T>
): Promise<T> {
  return await prisma.$transaction(async (tx) => {
    await setTenantGuc(tx, accountId);
    return await fn(tx);
  });
}

/**
 * Opens a transaction under the declared saga system boundary on BOTH layers:
 * the system AsyncLocalStorage context for the Prisma guard and the system
 * sentinel scope for the row-level policies.
 *
 * Deliberately NOT exported. A general-purpose cross-tenant transaction is the
 * reuse hazard this module exists to remove: exported, it is the cheapest way
 * for any future engine write to opt out of tenant scoping. The two things the
 * engine legitimately needs across tenants are exposed instead as narrow,
 * named surfaces — {@link withSagaSystemRead} for tenant-unknown reads and
 * {@link failSagaAsSystem} for the one terminal write.
 */
async function runSagaSystemTransaction<T>(
  prisma: SagaEngineClient,
  fn: (tx: SagaTransactionClient) => Promise<T>
): Promise<T> {
  return await withSystemContext(
    SAGA_SYSTEM_REASON,
    async () =>
      await prisma.$transaction(async (tx) => {
        await setTenantGuc(tx, SYSTEM_TENANT_SCOPE);
        return await fn(tx);
      })
  );
}

/**
 * @function runAsSagaTenant
 * @description Runs `fn` with the saga's own account bound as tenant context, so
 *   every guarded read and write it performs stays scoped to that tenant. When
 *   the account cannot be resolved — absent, or contradicted between the column
 *   and the context — the callback is SKIPPED, the failure is logged at ERROR,
 *   counted in process and on the scrape endpoint, and reported to the caller.
 *   Running the work unscoped, or under a system-context bypass, would silently
 *   cross tenants.
 * @param instance - The saga whose account scopes the work.
 * @param fn - The work to run inside the rehydrated tenant context.
 * @param metrics - Optional counter surface incremented on a resolution miss.
 * @returns `{ ran: true, value }`, or `{ ran: false, reason }` — callers MUST
 *   consume the outcome; treating a skip as a success is a tenant defect.
 */
export async function runAsSagaTenant<T>(
  instance: SagaInstance,
  fn: () => Promise<T>,
  metrics?: SagaTenantMetrics
): Promise<SagaWorkOutcome<T>> {
  const resolution = resolveSagaTenant(instance);

  if (resolution.kind === "tenant-mismatch") {
    if (metrics) {
      metrics.tenantMismatches++;
    }
    recordSagaRecoveryFailure("mismatch");
    logger.error(
      {
        sagaId: instance.id,
        definitionId: instance.definitionId,
        status: instance.status,
        reason: "tenant-mismatch",
        columnAccountId: resolution.columnAccountId,
        contextAccountId: resolution.contextAccountId,
      },
      "Skipped saga work: the persisted account contradicts the saga context"
    );
    return { ran: false, reason: "tenant-mismatch" };
  }

  if (resolution.kind === "unresolvable-account") {
    if (metrics) {
      metrics.rehydrationFailures++;
    }
    recordSagaRecoveryFailure("rehydration");
    logger.error(
      {
        sagaId: instance.id,
        definitionId: instance.definitionId,
        status: instance.status,
        reason: "unresolvable-account",
      },
      "Skipped saga work: the saga carries no resolvable owning account"
    );
    return { ran: false, reason: "unresolvable-account" };
  }

  const value = await withTenantContext({ accountId: resolution.accountId }, fn);
  return { ran: true, value };
}

/** The collaborators the terminal system write needs; the engine config satisfies it. */
export type SagaSystemTerminationConfig = Pick<
  SagaManagerConfig,
  "prisma" | "eventService" | "lockStore"
>;

/**
 * @function failSagaAsSystem
 * @description Drives a saga whose tenant cannot be resolved to the terminal
 *   FAILED state. This is the engine's ONLY cross-tenant write and exists for
 *   exactly one class of row: one that no tenant scope can address, so no
 *   tenant-scoped statement could ever terminalize it. Without this path such a
 *   row stays non-terminal forever while every timeout tick logs and counts it
 *   again — an infinite RUNNING state the saga canon forbids.
 *
 *   The transition is the ORDINARY terminal transition, not a shortcut: the
 *   `SAGA_FAILED` audit event commits in the SAME transaction as the row (an
 *   anomalous transition is precisely the one whose durable trail must not have
 *   a hole), and the saga's semantic locks are released afterwards so a
 *   legitimate saga is not blocked behind a dead one until the lock TTL expires.
 *
 *   The write stays narrow by construction: three bounded operations — one
 *   `update` by primary key, one event append, one lock release — both layers
 *   bound to the system scope, and NO dispatch inside the boundary.
 * @param config - The engine's client and its durable-event / lock collaborators.
 * @param instance - The saga to terminalize; its in-memory state is updated too.
 * @param reason - Why the tenant could not be resolved.
 */
export async function failSagaAsSystem(
  config: SagaSystemTerminationConfig,
  instance: SagaInstance,
  reason: SagaTenantSkipReason
): Promise<void> {
  const completedAt = new Date();
  const message = `Saga terminalized without a resolvable tenant: ${reason}`;

  instance.status = "FAILED";
  instance.completedAt = completedAt;
  instance.error = message;
  delete instance.nextRetryAt;

  const sagaFailedEvent = createEventStoreEvent(
    SAGA_EVENTS.SAGA_FAILED,
    instance.id,
    "Saga",
    {
      sagaId: instance.id,
      definitionId: instance.definitionId,
      correlationId: instance.context.correlationId,
      status: "FAILED",
      completedAt,
      duration: completedAt.getTime() - instance.startedAt.getTime(),
      stepsCompleted: instance.stepResults.filter((r) => r?.success).length,
      stepsFailed: instance.stepResults.filter((r) => r && !r.success).length,
      error: message,
      reason,
    },
    {
      source: "SagaManager",
      correlationId: instance.context.correlationId,
    }
  );

  await runSagaSystemTransaction(config.prisma, async (tx) => {
    await tx.sagaInstance.update({
      where: { id: instance.id },
      data: {
        status: "FAILED",
        completedAt,
        error: message,
        nextRetryAt: null,
      },
    });
    // eventService is guaranteed present wherever this runs: the only caller is
    // the timeout checker, started by `initialize()`, which requires a full
    // config — the same reachability the ordinary terminal path relies on. It is
    // asserted rather than tested for so the two paths fail identically; making
    // it conditional would let the ANOMALOUS transition skip its audit event
    // silently while the ordinary one throws.
    await config.eventService!.appendEventInTx(tx, sagaFailedEvent);
  });

  if (config.lockStore) {
    const released = await config.lockStore.releaseAllForSaga(instance.id);
    if (!released.ok) {
      logger.warn(
        { sagaId: instance.id, err: released.error },
        "Semantic lock cleanup failed after terminalization; locks will expire via TTL"
      );
    }
  }

  recordSagaFailed(reason);
  logger.error(
    {
      sagaId: instance.id,
      definitionId: instance.definitionId,
      reason,
    },
    "Terminalized a saga whose owning account could not be resolved"
  );
}
