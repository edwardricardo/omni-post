/**
 * @file index.ts
 * @description LinkedIn provider package barrel export. Composition root constructs
 *   the adapter via `createLinkedInAdapter({ logger })`.
 * @layer infrastructure
 */

export {
  LinkedInAdapter,
  createLinkedInAdapter,
  type LinkedInAdapterDeps,
  type LinkedInApiClientFactory,
} from "./LinkedInAdapter.js";
export { LinkedInApiClient } from "./apiClient.js";
export type {
  LinkedInCredentials,
  LinkedInPostPayload,
  LinkedInPostResponse,
  LinkedInProfileResponse,
  LinkedInImageUploadResponse,
  LinkedInVideoUploadResponse,
  LinkedInDocumentUploadResponse,
  LinkedInCommentResponse,
  LinkedInCommentsPage,
  LinkedInAnalyticsResponse,
  LinkedInMediaContent,
  LinkedInPollContent,
  LinkedInPollDuration,
  LinkedInPollOption,
  LinkedInDocumentContent,
  LinkedInPollPostContent,
} from "./types.js";
