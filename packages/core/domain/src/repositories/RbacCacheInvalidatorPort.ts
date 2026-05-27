/**
 * @file RbacCacheInvalidatorPort.ts
 * @description Port that lets `RoleManagementService` invalidate the RBAC
 *   permission cache after a role mutation without depending on the
 *   concrete `RbacService`. The adapter (in apps/api) delegates to
 *   `RbacService.invalidateCache(roleName?)`.
 * @layer domain
 */

export interface RbacCacheInvalidatorPort {
  /**
   * Invalidate cached permission lookups for the given role name. The
   * adapter MAY also wipe broader rbac caches depending on its
   * implementation. Fire-and-forget semantics; never throws.
   */
  invalidate(roleName: string): Promise<void>;
}
