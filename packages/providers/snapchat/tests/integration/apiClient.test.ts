/**
 * @file apiClient.test.ts
 * @description Integration tests for SnapchatApiClient.
 * Requires: real Snapchat OAuth credentials + organization ID
 *
 * Kept out of the unit scope because all methods wrap fetch() + circuit breaker
 * plumbing: these tests verify real API behaviour and need live credentials.
 *
 * Run: SNAPCHAT_CLIENT_ID=... SNAPCHAT_ACCESS_TOKEN=... pnpm exec vitest run tests/integration/
 * @layer infrastructure
 */

import { describe, it } from "vitest";

describe.todo("SnapchatApiClient — integration", () => {
  // Requires: SNAPCHAT_CLIENT_ID, SNAPCHAT_CLIENT_SECRET, SNAPCHAT_ACCESS_TOKEN,
  //           SNAPCHAT_REFRESH_TOKEN, SNAPCHAT_ORGANIZATION_ID env vars

  it.todo("validateCredentials fetches organizations successfully");
  it.todo("uploadMedia uploads an image and returns media ID");
  it.todo("uploadMedia uploads a video and returns media ID");
  it.todo("createStory creates a creative referencing uploaded media");
  it.todo("getStoryAnalytics returns metrics for a creative");
  it.todo("refreshAccessToken returns new tokens");
  it.todo("returns error for invalid access token");
  it.todo("handles rate limiting with circuit breaker fallback");
  it.todo("fallback returns EMPTY_ANALYTICS when analytics endpoint fails");
});
