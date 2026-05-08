/**
 * @file index.ts
 * @description TikTok provider package barrel export. Composition root constructs
 *   the adapter via `createTikTokAdapter({ logger, ... })`.
 * @layer infrastructure
 */

export {
  TikTokAdapter,
  createTikTokAdapter,
  type TikTokAdapterDeps,
  type TikTokApiClientFactory,
  type ResearchClientFactory,
  type MarketingClientFactory,
  type TikTokProviderCredentials,
} from "./TikTokAdapter.js";
export { TikTokApiClient } from "./apiClient.js";
export type { TikTokCredentials } from "./apiClient.js";
