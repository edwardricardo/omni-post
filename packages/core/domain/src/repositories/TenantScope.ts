/**
 * @file TenantScope.ts
 * @description The tenant a collection query runs inside. Carried as an explicit,
 *              non-nullable value so that an unscoped read of a tenant-owned
 *              collection is not something a caller can write.
 * @layer domain
 */

/**
 * The tenant a query is scoped to.
 *
 * A collection query over tenant-owned rows takes this as its FIRST REQUIRED
 * parameter. Positional and required is the whole mechanism: there is no
 * overload without it, no optional variant, and `exactOptionalPropertyTypes`
 * forbids smuggling `undefined` through it — so "read every tenant's posts" is
 * not a call that compiles, rather than a call that is discouraged.
 *
 * The adapter puts `accountId` into the query's `where`; the tenant guard then
 * validates that value against the bound context and throws on a mismatch; row
 * security re-checks it in the engine. This type is the first of those three
 * layers and the only one that acts before the program runs.
 *
 * ## Where non-emptiness is enforced, and why not here
 *
 * The design calls for a value object validated non-empty. It is an interface
 * instead, and the reason is worth stating rather than leaving as a silent
 * downgrade. A constructor that rejects an empty id has to signal the rejection:
 * a `throw` is forbidden in this layer (fallible operations return `Result`),
 * and a `Result`-returning factory would have no caller — every scope in this
 * slice is derived from an already-bound `TenantContext` or from an explicit
 * `withSystemContext(reason)`, never from a raw string off a request. An export
 * nothing calls is dead weight that reads as a guarantee.
 *
 * So the non-empty guarantee lives where the value ENTERS the process — the
 * authenticated context binding — and the layer below re-checks it anyway: an
 * empty `accountId` reaching a `where` disagrees with the bound context, and the
 * tenant guard raises `TenantContextMismatchError` on exactly that. The claim
 * this type makes is the one it can keep: a tenant is always PRESENT.
 */
export interface TenantScope {
  readonly accountId: string;
}
