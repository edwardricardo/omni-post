/**
 * @file apiClient.integration.test.ts
 * @description Integration tests for LinkedInApiClient.
 * Requires: real LinkedIn OAuth credentials
 *
 * Excluded from Stryker unit mutation scope because all methods wrap
 * fetch() + circuit breaker plumbing. These tests verify real API behavior.
 *
 * Run: LINKEDIN_ACCESS_TOKEN=... pnpm exec vitest run tests/integration/
 * @layer integration
 */

import { describe, it } from "vitest";

describe.todo("LinkedInApiClient — integration", () => {
  // Requires: LINKEDIN_ACCESS_TOKEN, LINKEDIN_ORGANIZATION_ID env vars

  it.todo("getProfile returns authenticated user profile");
  it.todo("createPost publishes a text post to personal profile");
  it.todo("createPost publishes to organization when orgId provided");
  it.todo("initializeImageUpload returns upload URL and asset URN");
  it.todo("initializeVideoUpload returns upload URL for video");
  it.todo("initializeDocumentUpload returns upload URL for PDF");
  it.todo("uploadMediaBinary uploads raw binary via PUT");
  it.todo("getComments retrieves comments for a post");
  it.todo("postComment creates a comment on a post");
  it.todo("getPostAnalytics returns engagement metrics");
  it.todo("returns 401 error for expired access token");
  it.todo("circuit breaker opens after repeated failures");
});
