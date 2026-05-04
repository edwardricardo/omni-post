/**
 * @file index.ts
 * @description Snapchat provider package barrel export. Composition root constructs
 *   the adapter via `createSnapchatAdapter({ logger })`.
 * @layer infrastructure
 */

export {
  SnapchatAdapter,
  createSnapchatAdapter,
  type SnapchatAdapterDeps,
  type SnapchatApiClientFactory,
} from "./SnapchatAdapter.js";
export { SnapchatApiClient } from "./apiClient.js";
export type {
  SnapchatCredentials,
  SnapchatOrganization,
  SnapchatOrganizationsResponse,
  SnapchatMediaUploadResponse,
  SnapchatStoryResponse,
  SnapchatStoryAnalytics,
  SnapchatTokenRefreshResponse,
} from "./types.js";
