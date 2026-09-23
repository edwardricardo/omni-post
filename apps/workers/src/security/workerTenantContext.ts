/**
 * @file workerTenantContext.ts
 * @description AsyncLocalStorage holder for job-scoped tenant context in the workers
 *   process, and the ONE provider object the Prisma tenant guard (layer 1) and the RLS
 *   GUC binding (layer 2) both read.
 *
 *   Modelled on `apps/api/src/security/tenantContext.ts`, minus its system half. That
 *   absence is the design, not an omission: a worker has no ambient request and no admin
 *   impersonation, so there is no cross-tenant flow for the guard to bypass for. Keeping
 *   `getSystemContext` a constant also removes a hazard the API carries — `resolveGucScope`
 *   consults the system store FIRST, so a tenant scope opened inside a system one there
 *   binds `__system__`; with no system store to nest inside, a job's scope is the only
 *   scope either layer can resolve.
 * @layer infrastructure
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { TenantContextProvider } from "@infra/prisma/extensions/tenantGuard.js";

/** The account whose data the current job is allowed to touch. */
export interface WorkerTenantContext {
  accountId: string;
}

const workerTenantStorage = new AsyncLocalStorage<WorkerTenantContext>();

/**
 * @function withWorkerTenant
 * @description Runs `fn` with the job's tenant scope bound, so every guarded operation it
 *   issues carries that account through both isolation layers.
 *
 *   `fn` is AWAITED inside the scope rather than merely called, and that is load-bearing: a
 *   Prisma model method returns a LAZY thenable that runs nothing until `then()`, and the
 *   guard and the binding live inside that callback. Handed straight to `run`, a callback
 *   that merely RETURNS the operation gives back the inert object, the store is popped when
 *   `run` returns, and the work then runs with no scope bound — which compiles, reads
 *   correctly, and leaves the statement unscoped. TypeScript cannot reject that shape
 *   (`PrismaPromise<T> extends Promise<T>`), so the await is what closes it.
 * @param accountId - Tenant scope to bind for the duration of `fn`.
 * @param fn - The function to run within the scope.
 * @returns Whatever `fn` resolves to.
 */
export function withWorkerTenant<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
  return workerTenantStorage.run({ accountId }, async () => await fn());
}

/**
 * @function getWorkerTenantContext
 * @description The scope bound by the enclosing {@link withWorkerTenant}, or `undefined`
 *   outside one — in which case the guard refuses any tenant-scoped operation by throwing
 *   `TenantContextMissingError`, which is the loud failure this module exists to produce.
 * @returns The active worker tenant context, or `undefined`.
 */
export function getWorkerTenantContext(): WorkerTenantContext | undefined {
  return workerTenantStorage.getStore();
}

/**
 * The provider both isolation layers read, exported as a value rather than assembled at
 * each call site so "layer 1 and layer 2 read the same context" is a fact about the wiring
 * instead of a convention two object literals happen to share.
 */
export const workerTenantProvider: TenantContextProvider = {
  getTenantContext: getWorkerTenantContext,
  getSystemContext: () => undefined,
};
