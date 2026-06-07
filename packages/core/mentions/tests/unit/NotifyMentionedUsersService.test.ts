/**
 * @file NotifyMentionedUsersService.test.ts
 * @description Unit tests for NotifyMentionedUsersService — happy path with
 *   mentions, self-mention filtering, no mentions, and dispatch failure handling.
 * @layer infrastructure
 */
import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import {
  NotifyMentionedUsersService,
  MENTION_CONTEXT,
} from "../../src/NotifyMentionedUsersService.js";
import type { NotificationDispatchPort } from "@ports/core";
import type { UseCaseError } from "@core/application/UseCase.js";

function makeMockDispatch(fails = false): NotificationDispatchPort {
  return {
    dispatch: vi.fn(async () =>
      fails
        ? err({ code: "INTERNAL_ERROR", message: "dispatch failed" } as unknown as UseCaseError)
        : ok({ id: "notif-uuid-001" })
    ),
  };
}

// MentionParser format: @[DisplayName](customerUserId)
const BASE_INPUT = {
  text: "Hey @[Bob](user-uuid-002) and @[Carol](user-uuid-003), please review this!",
  accountId: "acc-uuid-001",
  mentionedById: "user-uuid-001",
  mentionedByName: "Alice",
  context: MENTION_CONTEXT.CONVERSATION_NOTE,
  contextId: "conv-uuid-001",
};

describe("NotifyMentionedUsersService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns notification ids for each uniquely mentioned user", async () => {
    const svc = new NotifyMentionedUsersService(makeMockDispatch());
    const ids = await svc.notify(BASE_INPUT);
    assert.strictEqual(ids.length, 2);
    assert.ok(ids.every((id) => id.length > 0));
  });

  it("returns an empty array when no @mentions are present in the text", async () => {
    const svc = new NotifyMentionedUsersService(makeMockDispatch());
    const ids = await svc.notify({ ...BASE_INPUT, text: "No mentions here." });
    assert.strictEqual(ids.length, 0);
  });

  it("filters out self-mentions so the author is not notified", async () => {
    // author (mentionedById = user-uuid-001) mentions themselves + one other
    const svc = new NotifyMentionedUsersService(makeMockDispatch());
    const ids = await svc.notify({
      ...BASE_INPUT,
      text: "@[Alice](user-uuid-001) check this out @[Bob](user-uuid-002)",
    });
    // Only user-uuid-002 should receive a notification
    assert.strictEqual(ids.length, 1);
  });

  it("skips failed dispatches and does not include them in the result array", async () => {
    const svc = new NotifyMentionedUsersService(makeMockDispatch(true));
    const ids = await svc.notify(BASE_INPUT);
    assert.strictEqual(ids.length, 0);
  });
});
