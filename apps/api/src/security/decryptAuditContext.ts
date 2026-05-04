/**
 * @file decryptAuditContext.ts
 * @description AsyncLocalStorage holder for request-scoped audit context that
 *   accompanies every credential decrypt operation. The Fastify `onRequest`
 *   hook populates this from `req` (ipAddress, userAgent, correlationId from
 *   `req.id`); auth middleware later sets `userId` once authentication
 *   resolves. EncryptionService reads it at decrypt time to enrich the
 *   AuditLog row.
 *
 *   The holder is a MUTABLE object reference so fields can be filled in
 *   after onRequest fires (e.g. userId from auth middleware running later
 *   in the lifecycle). AsyncLocalStorage stores the same reference across
 *   the entire request scope, so any hook that calls
 *   `setAuthenticatedUserId(userId)` updates the value seen by downstream
 *   audit emissions.
 *
 *   Workers / cron / tests: no Fastify request → ALS unset → audit event is
 *   emitted with null fields, which is the honest representation
 *   ("system-initiated decrypt").
 *
 * @layer infrastructure
 */
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped audit context populated by the Fastify onRequest hook.
 * Fields are mutable because they're filled in across multiple lifecycle
 * stages (onRequest → auth middleware → ... → handler).
 */
export interface RequestAuditContext {
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
}

const storage = new AsyncLocalStorage<RequestAuditContext>();

/**
 * @function withRequestAuditContext
 * @description Runs `fn` with the given audit context bound to the async
 *   locals. Use this from the Fastify `onRequest` hook so every async
 *   operation triggered by the request inherits the context.
 * @param context - The audit context to bind for the duration of `fn`.
 * @param fn - The function to run within the context.
 */
export function withRequestAuditContext<T>(context: RequestAuditContext, fn: () => T): T {
  return storage.run(context, fn);
}

/**
 * @function getRequestAuditContext
 * @description Retrieves the current request's audit context, if any.
 *   Returns `undefined` when called outside any active request (workers,
 *   cron jobs, tests). Callers must handle the undefined case gracefully —
 *   audit events emitted without context still log fieldName/recordId/action,
 *   just with null userId/ipAddress.
 */
export function getRequestAuditContext(): RequestAuditContext | undefined {
  return storage.getStore();
}

/**
 * @function setAuthenticatedUserId
 * @description Mutates the current request's audit context to attach the
 *   authenticated user id. Called from the auth middleware after the JWT
 *   has been verified. Does nothing if called outside a request scope.
 */
export function setAuthenticatedUserId(userId: string): void {
  const ctx = storage.getStore();
  if (ctx) {
    ctx.userId = userId;
  }
}
