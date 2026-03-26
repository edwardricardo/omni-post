/**
 * @file apiClient.integration.test.ts
 * @description Integration tests for TelegramApiClient.
 * Requires: real Telegram Bot Token + test channel
 *
 * Excluded from Stryker unit mutation scope because all methods wrap
 * fetch() + circuit breaker plumbing. These tests verify real API behavior.
 *
 * Run: TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... pnpm exec vitest run tests/integration/
 * @layer integration
 */

import { describe, it, expect } from "vitest";

describe.todo("TelegramApiClient — integration", () => {
  // Requires: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID env vars

  it.todo("sendMessage sends a real message and returns message_id");
  it.todo("sendPhoto uploads a photo and returns message_id");
  it.todo("sendVideo uploads a video and returns message_id");
  it.todo("sendMediaGroup sends 2+ media items and returns array of messages");
  it.todo("sendPoll creates a poll and returns message_id");
  it.todo("validateCredentials returns bot info via getMe");
  it.todo("getChatMember returns member status for the bot");
  it.todo("getChatMemberCount returns a positive number");
  it.todo("returns 401 error for invalid bot token");
  it.todo("handles rate limiting (429) with retry-after");
  it.todo("circuit breaker opens after repeated failures");
});
