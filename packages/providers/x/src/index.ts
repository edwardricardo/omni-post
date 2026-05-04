/**
 * @file index.ts
 * @description X/Twitter provider package barrel export. Composition root constructs
 *   the adapter via `createXAdapter({ logger })`.
 * @layer infrastructure
 */

export { XAdapter, createXAdapter, type XAdapterDeps, type XApiClientFactory } from "./XAdapter.js";

export { XApiClient } from "./apiClient.js";
export type {
  XCredentials,
  XTweetResponse,
  XUploadResponse,
  XUserResponse,
  XAnalyticsResponse,
  XSearchReplyResult,
  XSearchRepliesResponse,
  XPollOptions,
} from "./apiClient.js";
