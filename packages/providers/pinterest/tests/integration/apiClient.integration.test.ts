/**
 * @file apiClient.integration.test.ts
 * @description Integration tests for PinterestApiClient.
 * Requires: real Pinterest OAuth credentials
 *
 * Excluded from Stryker unit mutation scope because all methods wrap
 * fetch() + circuit breaker plumbing. These tests verify real API behavior.
 *
 * Run: PINTEREST_ACCESS_TOKEN=... pnpm exec vitest run tests/integration/
 * @layer infrastructure
 */

import { describe, it } from "vitest";

describe.todo("PinterestApiClient — integration", () => {
  // Requires: PINTEREST_ACCESS_TOKEN env var

  it.todo("createPin creates a pin with image and returns pin ID");
  it.todo("createPin creates a pin with video and returns pin ID");
  it.todo("getPin retrieves pin details by ID");
  it.todo("getPinAnalytics returns impression/save/click metrics");
  it.todo("getUserAccount returns authenticated user info");
  it.todo("getBoards returns list of user boards");
  it.todo("createBoard creates a new board");
  it.todo("createBoardSection creates a section within a board");
  it.todo("returns error for invalid access token");
  it.todo("handles rate limiting (100 calls/s/user)");
  it.todo("circuit breaker opens after repeated failures");
});
