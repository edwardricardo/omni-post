/**
 * @file ProviderBundleReader.ts
 * @description Read-only port over the `ProviderBundle` catalog. Used by
 *   `GatewayBillingService.getAvailablePlans` to expose the public plans
 *   list. Writes (admin pricing config) live on a separate port owned by
 *   the admin pricing surface.
 *
 *   Port-level error type is a string union (canon for @core/domain
 *   repository ports).
 * @layer domain
 */

import { type Result } from "@shared/types";

export type ProviderBundleReadError = "DATABASE_ERROR";

/**
 * Public plan DTO returned by `listActive`. Mirrors the columns selected
 * by the existing client `getAvailablePlans` query. `pricePerAccountMonth`
 * is exposed as `number` (the adapter converts Prisma's `Decimal`).
 */
export interface ProviderBundleSummary {
  id: string;
  name: string;
  slug: string;
  description: string;
  providers: readonly string[];
  pricePerAccountMonth: number;
  sortOrder: number;
}

export interface ProviderBundleReader {
  /**
   * Return all active bundles ordered by `sortOrder` ascending.
   */
  listActive(): Promise<Result<ProviderBundleSummary[], ProviderBundleReadError>>;
}
