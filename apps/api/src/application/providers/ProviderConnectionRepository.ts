/**
 * @file ProviderConnectionRepository.ts
 * @description Application-layer port for the bulk-disable flow used by the
 *              mass-force-reauth feature. Inline interface (single consumer);
 *              promote to packages/ports/core/ if a second consumer appears.
 * @layer application
 */

export interface BulkDisableProviderConnectionsResult {
  count: number;
  connectionIds: string[];
}

export interface ProviderConnectionRepository {
  /**
   * Bulk-set `isActive = false` on every active ProviderConnection row for a
   * given provider (cross-tenant). Returns count + list of affected ids.
   */
  bulkDisableByProvider(provider: string): Promise<BulkDisableProviderConnectionsResult>;
}
