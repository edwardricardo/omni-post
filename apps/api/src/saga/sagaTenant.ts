/**
 * @file sagaTenant.ts
 * @description Tenant helpers for the saga engine. The engine runs detached from
 *              any HTTP request, so it cannot inherit a request's tenant scope:
 *              it resolves the owning account from the saga's own context and
 *              rehydrates it around every piece of per-saga work (step loop,
 *              persistence, compensation, timeout failure). A saga whose account
 *              cannot be resolved is skipped loudly rather than run unscoped.
 * @layer infrastructure
 */
import type { SagaContext, SagaInstance } from "@shared/types/saga.js";
import { withTenantContext } from "../security/tenantContext.js";
import { logger } from "../lib/logger.js";

/**
 * The only system-context reason the saga engine may use. Every cross-tenant
 * read the engine performs (boot load, retry scan, by-id load) declares this
 * single reason so the audit trail carries one recognisable boundary.
 */
export const SAGA_SYSTEM_REASON = "system:saga-recovery" as const;

/** Counter surface the rehydration increments when no account can be resolved. */
export interface SagaRehydrationMetrics {
  rehydrationFailures: number;
}

/**
 * @function resolveSagaAccountId
 * @description Resolves the account that owns a saga: the first-class
 *   `context.accountId`, else a valid-string `context.metadata.accountId`
 *   (sagas started before the field existed carry it there), else nothing.
 *   `userId` is never a fallback — it identifies the actor, not the tenant.
 * @param context - The saga context to resolve the owning account from.
 * @returns The owning account id, or `null` when neither source carries one.
 */
export function resolveSagaAccountId(context: SagaContext): string | null {
  if (typeof context.accountId === "string" && context.accountId.length > 0) {
    return context.accountId;
  }

  const fromMetadata = context.metadata.accountId;
  if (typeof fromMetadata === "string" && fromMetadata.length > 0) {
    return fromMetadata;
  }

  return null;
}

/**
 * @function runAsSagaTenant
 * @description Runs `fn` with the saga's own account bound as tenant context, so
 *   every guarded read and write it performs stays scoped to that tenant. When
 *   no account can be resolved the callback is skipped, the failure is logged at
 *   ERROR and counted: running the work unscoped, or under a system-context
 *   bypass, would silently cross tenants.
 * @param instance - The saga whose account scopes the work.
 * @param fn - The work to run inside the rehydrated tenant context.
 * @param metrics - Optional counter surface incremented on a resolution miss.
 * @returns The callback's value, or `undefined` when the account is unresolvable.
 */
export async function runAsSagaTenant<T>(
  instance: SagaInstance,
  fn: () => Promise<T>,
  metrics?: SagaRehydrationMetrics
): Promise<T | undefined> {
  const accountId = resolveSagaAccountId(instance.context);

  if (accountId === null) {
    if (metrics) {
      metrics.rehydrationFailures++;
    }
    logger.error(
      {
        sagaId: instance.id,
        definitionId: instance.definitionId,
        status: instance.status,
        reason: "unresolvable-account",
      },
      "Skipped saga work: the saga carries no resolvable owning account"
    );
    return undefined;
  }

  return await withTenantContext({ accountId }, fn);
}
