/**
 * @file index.ts
 * @description Pinterest provider package barrel export. Composition root constructs
 *   the adapter via `createPinterestAdapter({ logger })`.
 * @layer infrastructure
 */

export {
  PinterestAdapter,
  createPinterestAdapter,
  type PinterestAdapterDeps,
  type PinterestApiClientFactory,
} from "./PinterestAdapter.js";
export { PinterestApiClient } from "./apiClient.js";
export type {
  PinterestCredentials,
  PinterestPinResponse,
  PinterestUserResponse,
  PinterestBoardResponse,
  PinterestBoardsListResponse,
  PinterestPinAnalyticsResponse,
  PinterestBoardSectionResponse,
  PinterestApiError,
} from "./apiClient.js";
