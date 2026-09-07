/**
 * @file tenantGuc.ts
 * @description Binds the PostgreSQL RLS session GUC (`app.account_id`) inside a
 *              transaction so the `tenant_isolation` policies evaluate against
 *              the caller's tenant, and owns the ONE seam every non-unit-of-work
 *              transaction goes through.
 *
 *              Three pieces, one responsibility:
 *
 *              - `setTenantGuc(tx, accountId)` — binds the GUC on a transaction
 *                the caller already holds. Workers use it on their raw-client
 *                transactions.
 *              - `runWithBoundGuc(scope, fn)` / `isGucBound()` — the marker whose
 *                meaning is "the ambient transaction OWNS GUC adjudication; do not
 *                wrap". Per-operation binding otherwise opens a transaction of its
 *                own, and transactions are connection-scoped: an operation fired
 *                from inside another transaction would check out a SECOND pooled
 *                connection and commit on it, through its caller's rollback. That
 *                escape is measured, not theoretical.
 *              - `withGucBoundTransaction(client, scope, fn)` — opens the
 *                transaction, binds the GUC when a scope exists, and holds the
 *                marker in EVERY branch. A transaction that binds nothing still
 *                owns its connection, so its inner operations would still escape.
 * @layer infrastructure
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { TenantContextProvider } from "./tenantGuard.js";

/**
 * Minimal structural surface this helper needs from a transaction client.
 * Structural on purpose: consumers hold transaction clients from different
 * Prisma type instantiations (the app's client vs this package's generated
 * client), and the nominal `Prisma.TransactionClient` from one does not
 * unify with the other. `$executeRaw` is the only member used.
 */
export interface GucTransactionClient {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/**
 * Transaction bounds forwarded verbatim to the underlying client. Structural for
 * the same reason as {@link GucTransactionClient}: `isolationLevel` is a generated
 * string union per client instantiation, so it is accepted as a `string` here and
 * validated by the caller's own client type at the call site.
 */
export interface GucTransactionOptions {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: string;
}

/**
 * Minimal structural surface for a client that can open an INTERACTIVE
 * transaction. The batch form is deliberately not modelled: batch sites convert
 * to this form, which has the same atomicity without the enlistment ambiguity of
 * an array assembled before the transaction exists.
 */
export interface InteractiveTransactionHost<TTransaction> {
  $transaction<T>(
    fn: (tx: TTransaction) => Promise<T>,
    options?: GucTransactionOptions
  ): Promise<T>;
}

/**
 * What the marker carries. The scope is recorded so a reader can tell a
 * deliberately unbound transaction from a tenant-bound one; `isGucBound()`
 * answers only the question the binding needs, which is whether ANY ambient
 * transaction owns adjudication.
 */
interface BoundGucScope {
  readonly scope: string | undefined;
}

const boundGucStorage = new AsyncLocalStorage<BoundGucScope>();

/**
 * Sentinel scope the `tenant_isolation` policies honour as a full bypass
 * (`current_setting('app.account_id', true) = '__system__'`). Bind it ONLY for
 * flows canonically authorized as cross-tenant — the API mirrors it through
 * `withSystemContext()`; workers bind it directly for the few lookups whose
 * whole purpose is to RESOLVE a tenant and therefore cannot pre-scope to one.
 */
export const SYSTEM_TENANT_SCOPE = "__system__";

/**
 * @function setTenantGuc
 * @description Sets the transaction-local `app.account_id` GUC (third argument
 *              `true` = valid only for the current transaction). Must run as the
 *              first statement of the transaction, before any query the RLS
 *              policy should govern.
 * @param tx - The active transaction client the caller already holds
 * @param accountId - Tenant scope to bind; use `SYSTEM_TENANT_SCOPE` only for
 *                    flows canonically authorized as cross-tenant
 * @returns Promise resolving when the GUC is bound
 */
export async function setTenantGuc(tx: GucTransactionClient, accountId: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.account_id', ${accountId}, true)`;
}

/**
 * @function resolveGucScope
 * @description Maps a context provider to the scope `app.account_id` must carry: the system
 *              sentinel when a SystemContext is active, the tenant's accountId when one is
 *              bound, and `undefined` when neither is — which leaves the statement
 *              deliberately unbound rather than inventing a scope for it. System wins over
 *              tenant, matching what the unit of work binds.
 *
 *              It lives beside {@link SYSTEM_TENANT_SCOPE} rather than in the API because
 *              BOTH consumers need the identical mapping: the per-operation binding extension
 *              (which cannot import from `apps/api` — the guard's provider injection exists
 *              precisely to avoid that cycle) and the API's own `getAmbientGucScope()`. One
 *              function, so the two layers cannot derive different scopes from the same
 *              provider.
 * @param provider - Context provider to read.
 * @returns The scope to bind, or `undefined` when there is none.
 */
export function resolveGucScope(provider: TenantContextProvider): string | undefined {
  if (provider.getSystemContext()) {
    return SYSTEM_TENANT_SCOPE;
  }
  return provider.getTenantContext()?.accountId;
}

/**
 * @function runWithBoundGuc
 * @description Holds the marker for the duration of `fn`. Its meaning is "the
 *              ambient transaction OWNS GUC adjudication; do not wrap" — nothing
 *              more. It is held even when `scope` is `undefined`, because the
 *              hazard the marker closes is CONNECTION ownership, not binding: a
 *              transaction that deliberately binds nothing still owns its
 *              connection, and an operation wrapped inside it would leave that
 *              connection and commit independently of the enclosing rollback.
 * @param scope - Tenant scope bound by the owning transaction, or `undefined`
 *                when it deliberately binds none.
 * @param fn - Callback executed with the marker held.
 * @returns Whatever `fn` returns.
 */
export function runWithBoundGuc<T>(scope: string | undefined, fn: () => T): T {
  return boundGucStorage.run({ scope }, fn);
}

/**
 * @function isGucBound
 * @description Whether an ambient transaction currently owns GUC adjudication.
 *              Callers that would otherwise open a transaction per operation MUST
 *              pass the operation through untouched when this is true.
 * @returns `true` inside a transaction opened through {@link withGucBoundTransaction}
 *          or through a seam that adopted {@link runWithBoundGuc}.
 */
export function isGucBound(): boolean {
  return boundGucStorage.getStore() !== undefined;
}

/**
 * @function getBoundGucScope
 * @description The scope the ambient owning transaction bound, if any. Returns
 *              `undefined` both outside any owning transaction and inside one that
 *              deliberately bound nothing; use {@link isGucBound} to tell those
 *              apart.
 * @returns The bound scope, or `undefined`.
 */
export function getBoundGucScope(): string | undefined {
  return boundGucStorage.getStore()?.scope;
}

/**
 * @function withGucBoundTransaction
 * @description THE seam for every transaction opened outside the unit of work and
 *              the saga. Opens an interactive transaction, binds `app.account_id`
 *              as its first statement when a scope exists, and holds the marker for
 *              the whole callback so per-operation binding passes through instead of
 *              re-wrapping — which is what keeps every inner operation on this
 *              transaction's own connection.
 *
 *              A nested call opens its own transaction, exactly as a nested
 *              `$transaction` does today, and binds that transaction's connection
 *              once. The helper deliberately does NOT reuse an ambient transaction
 *              client: joining it would silently change the atomicity of sites that
 *              commit independently of an enclosing transaction today, which is an
 *              adjudication for the call site, not for this seam.
 * @param client - The client the transaction is opened on.
 * @param scope - Tenant scope to bind, `__system__` for canonically cross-tenant
 *                flows, or `undefined` to open the transaction deliberately unbound.
 * @param fn - Callback receiving the transaction client.
 * @param options - Transaction bounds forwarded verbatim.
 * @returns Whatever `fn` returns, once the transaction commits.
 */
export async function withGucBoundTransaction<TTransaction extends GucTransactionClient, T>(
  client: InteractiveTransactionHost<TTransaction>,
  scope: string | undefined,
  fn: (tx: TTransaction) => Promise<T>,
  options?: GucTransactionOptions
): Promise<T> {
  return runWithBoundGuc(scope, async () =>
    client.$transaction(async (tx) => {
      if (scope !== undefined) {
        await setTenantGuc(tx, scope);
      }
      return fn(tx);
    }, options)
  );
}
