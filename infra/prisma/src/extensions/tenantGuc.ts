/**
 * @file tenantGuc.ts
 * @description Binds the PostgreSQL RLS session GUC (`app.account_id`) inside an
 *              existing transaction so the `tenant_isolation` policies evaluate
 *              against the caller's tenant. Workers use this on their raw-client
 *              transactions: explicit `accountId` predicates are today's active
 *              enforcement (the connection role bypasses RLS), and this binding
 *              future-proofs the same code paths for a hardened NOBYPASSRLS role
 *              without a second migration of call sites. Mirrors the
 *              `set_config` seam PrismaUnitOfWork owns for API transactions.
 * @layer infrastructure
 */

/**
 * Minimal structural surface this helper needs from a transaction client.
 * Structural on purpose: consumers hold transaction clients from different
 * Prisma type instantiations (the app's client vs this package's generated
 * client), and the nominal `Prisma.TransactionClient` from one does not
 * unify with the other. `$executeRaw` is the only member used.
 */
interface GucTransactionClient {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

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
