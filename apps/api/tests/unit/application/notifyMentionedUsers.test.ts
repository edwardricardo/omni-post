/**
 * @file notifyMentionedUsers.test.ts
 * @description Unit tests for NotifyMentionedUsersService.
 *   Validates notification creation for @mentions with deduplication
 *   and self-mention filtering.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  NotifyMentionedUsersService,
  MENTION_CONTEXT,
} from "@core/mentions/NotifyMentionedUsersService.js";
import type { NotificationDispatchPort } from "@ports/core";
import { ok } from "@shared/types";

/**
 * Factory for creating a mock NotificationDispatchPort.
 */
function makeMockNotificationDispatch(): NotificationDispatchPort {
  return {
    dispatch: vi.fn().mockResolvedValue(ok({ id: "notif-001" })),
  };
}

function makeInput(overrides?: Partial<Parameters<NotifyMentionedUsersService["notify"]>[0]>) {
  return {
    text: "@[Alice](member-1) please review",
    accountId: "account-001",
    mentionedById: "member-999",
    mentionedByName: "Bob",
    context: MENTION_CONTEXT.CONVERSATION_NOTE as const,
    contextId: "conv-001",
    ...overrides,
  };
}

describe("NotifyMentionedUsersService", () => {
  let notificationDispatch: ReturnType<typeof makeMockNotificationDispatch>;
  let service: NotifyMentionedUsersService;

  beforeEach(() => {
    vi.clearAllMocks();
    notificationDispatch = makeMockNotificationDispatch();
    service = new NotifyMentionedUsersService(notificationDispatch);
  });

  it("notifies each unique mentioned member", async () => {
    const input = makeInput({
      text: "@[Alice](member-1) and @[Charlie](member-2) check this",
    });

    const result = await service.notify(input);

    expect(notificationDispatch.dispatch).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);

    // Verify first call
    const firstCall = vi.mocked(notificationDispatch.dispatch).mock.calls[0]?.[0];
    expect(firstCall?.recipientId).toBe("member-1");
    expect(firstCall?.type).toBe("MENTION");
    expect(firstCall?.actorId).toBe("member-999");

    // Verify second call
    const secondCall = vi.mocked(notificationDispatch.dispatch).mock.calls[1]?.[0];
    expect(secondCall?.recipientId).toBe("member-2");
  });

  it("skips self-mentions", async () => {
    const input = makeInput({
      text: "@[Bob](member-999) mentioned himself and @[Alice](member-1)",
      mentionedById: "member-999",
    });

    const result = await service.notify(input);

    // Should only notify Alice, not Bob (self-mention)
    expect(notificationDispatch.dispatch).toHaveBeenCalledTimes(1);
    const call = vi.mocked(notificationDispatch.dispatch).mock.calls[0]?.[0];
    expect(call?.recipientId).toBe("member-1");
    expect(result).toHaveLength(1);
  });

  it("does nothing when no mentions in text", async () => {
    const input = makeInput({
      text: "Just a regular note with no mentions",
    });

    const result = await service.notify(input);

    expect(notificationDispatch.dispatch).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("deduplicates multiple mentions of the same person", async () => {
    const input = makeInput({
      text: "@[Alice](member-1) said hi. @[Alice](member-1) said bye.",
    });

    const result = await service.notify(input);

    // Should only notify Alice once
    expect(notificationDispatch.dispatch).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
  });

  it("returns empty array when only self-mentions exist", async () => {
    const input = makeInput({
      text: "@[Bob](member-999) testing self mention",
      mentionedById: "member-999",
    });

    const result = await service.notify(input);

    expect(notificationDispatch.dispatch).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("includes correct context in notification metadata", async () => {
    const input = makeInput({
      context: MENTION_CONTEXT.TASK,
      contextId: "task-001",
    });

    await service.notify(input);

    const call = vi.mocked(notificationDispatch.dispatch).mock.calls[0]?.[0];
    expect(call?.resourceType).toBe("task");
    expect(call?.resourceId).toBe("task-001");
    expect(call?.metadata).toEqual(
      expect.objectContaining({
        context: "task",
        contextId: "task-001",
      })
    );
  });

  it("includes actor name in notification title", async () => {
    const input = makeInput({
      mentionedByName: "Charlie Brown",
    });

    await service.notify(input);

    const call = vi.mocked(notificationDispatch.dispatch).mock.calls[0]?.[0];
    expect(call?.title).toBe("Charlie Brown mentioned you");
    expect(call?.actorName).toBe("Charlie Brown");
  });

  it("handles notification creation failure gracefully", async () => {
    const failingPort: NotificationDispatchPort = {
      dispatch: vi.fn().mockResolvedValue({ ok: false, error: new Error("DB error") }),
    };
    const failService = new NotifyMentionedUsersService(failingPort);

    const input = makeInput();
    const result = await failService.notify(input);

    // Should still complete without throwing, but no IDs collected
    expect(failingPort.dispatch).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });
});
