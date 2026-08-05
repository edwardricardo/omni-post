/**
 * @file tenantContext.ts
 * @description AsyncLocalStorage holder for request-scoped tenant context.
 *   The Fastify customer auth middleware sets this after the JWT is verified;
 *   the Prisma tenant guard extension reads it on every query to enforce
 *   tenant isolation on the 51 tenant-scoped Prisma models.
 *
 *   Mirror of `decryptAuditContext.ts` — same ALS pattern, separate store.
 *   Independent of the UnitOfWork transaction ALS in
 *   `apps/api/src/infrastructure/unitofwork/PrismaUnitOfWork.ts`.
 *
 *   ## Three contexts model
 *
 *   - **TenantContext**: customer-side, set by `customerAuthMiddleware` after
 *     decoding the customer JWT. Carries `accountId`. The Prisma guard
 *     enforces `where.accountId = ctx.accountId` on tenant-scoped tables.
 *   - **SystemContext**: explicit bypass for legitimate cross-tenant
 *     operations (admin impersonation, scheduled retention sweeps, migration
 *     scripts). Carries a `reason: string` naming the boundary. The Prisma
 *     guard skips enforcement for queries running under this context; it emits
 *     NO audit event, so the reason's value is that every bypass is declared at
 *     a single grep-able constant rather than that it is recorded at runtime.
 *   - **No context**: any tenant-scoped query throws `TenantContextMissingError`.
 *     Fail-loud is canonical. Global tables (denylist) bypass the guard
 *     regardless.
 *
 * @layer infrastructure
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { TenantContextMissingError } from "@infra/prisma/extensions/tenantGuard.js";

/** Customer-side tenant context bound by the auth middleware. */
export interface TenantContext {
  /** Account that owns the current request's data scope. */
  accountId: string;
}

/** Explicit bypass for cross-tenant operations (admin / system / migrations). */
export interface SystemContext {
  /**
   * Free-text reason logged on every cross-tenant query for audit purposes.
   * Examples: `"admin-impersonation:userId=admin1"`,
   * `"system:data-retention-sweep"`, `"system:billing-event-fanout"`.
   */
  reason: string;
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();
const systemStorage = new AsyncLocalStorage<SystemContext>();

// ─── Tenant context ─────────────────────────────────────────────────────────

/**
 * @function withTenantContext
 * @description Runs `fn` with the given tenant context bound. Use this from
 *   the Fastify customer auth middleware so every async operation triggered
 *   by the authenticated request inherits the `accountId` scope.
 * @param context - The tenant context to bind for the duration of `fn`.
 * @param fn - The async function to run within the context.
 */
export function withTenantContext<T>(context: TenantContext, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run(context, fn);
}

/**
 * @function enterTenantContext
 * @description Binds the tenant context for the current async execution AND
 *   all downstream async operations (`AsyncLocalStorage.enterWith` semantics).
 *   Use this from a Fastify preHandler that authenticates a request: every
 *   subsequent handler, hook, and async operation inherits the context until
 *   the request finishes.
 *
 *   Implementation note: `enterWith` is irreversible within the current
 *   async frame — once entered, the context persists for the rest of the
 *   chain. That's exactly what we want for HTTP requests (one tenant per
 *   request, set once at auth time).
 *
 *   For wrappable async chains (workers, jobs, tests) prefer
 *   `withTenantContext()` — it scopes the binding to a single function.
 *
 * @param context - The tenant context to bind.
 */
export function enterTenantContext(context: TenantContext): void {
  tenantStorage.enterWith(context);
}

/**
 * @function getTenantContext
 * @description Returns the current tenant context, or `undefined` when called
 *   outside any active customer request. Callers expecting a context should
 *   prefer `requireTenantContext()` for fail-loud semantics.
 */
export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

/**
 * @function requireTenantContext
 * @description Returns the current tenant context. Throws
 *   `TenantContextMissingError` when none is bound. Use this at code paths
 *   that MUST have a tenant scope (the Prisma guard does this internally).
 */
export function requireTenantContext(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new TenantContextMissingError();
  }
  return ctx;
}

// ─── System context (bypass) ────────────────────────────────────────────────

/**
 * @function withSystemContext
 * @description Runs `fn` under an explicit "cross-tenant operation"
 *   marker. The Prisma tenant guard skips enforcement for queries running
 *   inside this scope. The `reason` is a declaration, not a runtime audit
 *   record — the guard emits no event for it.
 *
 *   Legitimate uses:
 *   - Admin impersonation flows (`reason: "admin-impersonation:..."`)
 *   - Scheduled background jobs that operate across all tenants
 *     (`reason: "system:data-retention"`, `"system:billing-fanout"`)
 *   - Migration scripts / seed scripts
 *
 *   Do NOT use to "fix" a TenantContextMissingError in product code paths
 *   — that's a sign the customer auth middleware did not bind context, or
 *   the request is reaching code it shouldn't. Investigate root cause.
 *
 * @param reason - Human-readable reason logged on each guarded query.
 * @param fn - The async function to run with the bypass active.
 */
export function withSystemContext<T>(reason: string, fn: () => Promise<T>): Promise<T> {
  return systemStorage.run({ reason }, fn);
}

/**
 * @function getSystemContext
 * @description Returns the active system context if `fn` is running inside
 *   `withSystemContext()`. The Prisma guard uses this to decide whether to
 *   bypass tenant enforcement.
 */
export function getSystemContext(): SystemContext | undefined {
  return systemStorage.getStore();
}

// ─── Errors ─────────────────────────────────────────────────────────────────

// Error classes live in `@infra/prisma/extensions/tenantGuard.ts` so the
// Prisma extension can throw them without an apps/api dep cycle. We
// re-export here so apps/api consumers have a single import path.
export {
  TenantContextMissingError,
  TenantContextMismatchError,
} from "@infra/prisma/extensions/tenantGuard.js";
