/**
 * @file index.ts
 * @description YouTube provider package barrel export. Composition root constructs
 *   the adapter via `createYouTubeAdapter({ logger })`.
 * @layer infrastructure
 */

export {
  YouTubeAdapter,
  createYouTubeAdapter,
  type YouTubeAdapterDeps,
  type YouTubeApiClientFactory,
  type YouTubeProviderCredentials,
} from "./YouTubeAdapter.js";
export { YouTubeApiClient } from "./apiClient.js";
export type { YouTubeCredentials } from "./apiClient.js";
