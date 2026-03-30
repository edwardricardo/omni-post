/**
 * @file sendEmailNotification.test.ts
 * @description Unit tests for SendEmailNotificationService.
 * @layer test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { SendEmailNotificationService } from "../../../src/application/notifications/SendEmailNotificationService.js";
import { ok } from "@shared/types";

function makeMockEmailPort() {
  return {
    send: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

function makeMockPreferenceRepo(preferences: Array<{ type: string; enabled: boolean }> = []) {
  return {
    findByMember: vi.fn().mockResolvedValue(preferences),
    save: vi.fn(),
    delete: vi.fn(),
  };
}

function makeContext(
  overrides: Partial<{
    type: string;
    recipientEmail: string;
    metadata: Record<string, string>;
  }> = {}
) {
  return {
    recipientId: "member-001",
    recipientEmail: "user@test.com",
    type: "APPROVAL_REQUESTED" as const,
    title: "Post needs approval",
    body: "A post was submitted for review",
    accountName: "Acme Corp",
    ...overrides,
  };
}

describe("SendEmailNotificationService", () => {
  let emailPort: ReturnType<typeof makeMockEmailPort>;
  let prefRepo: ReturnType<typeof makeMockPreferenceRepo>;
  let service: SendEmailNotificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    emailPort = makeMockEmailPort();
    prefRepo = makeMockPreferenceRepo();
    service = new SendEmailNotificationService(emailPort, prefRepo as never);
  });

  it("sends email for APPROVAL_REQUESTED type", async () => {
    await service.send(
      makeContext({
        metadata: {
          authorName: "John",
          postTitle: "Spring Launch",
          postPreview: "Check out our new...",
          platforms: "Instagram,X",
        },
      })
    );

    expect(emailPort.send).toHaveBeenCalledOnce();
    const call = emailPort.send.mock.calls[0]?.[0] as {
      to: string[];
      subject: string;
      html: string;
    };
    assert.ok(call);
    assert.deepStrictEqual(call.to, ["user@test.com"]);
    assert.ok(call.subject.includes("Spring Launch"));
    assert.ok(call.html.includes("John"));
  });

  it("does not send email when user has disabled the type", async () => {
    prefRepo = makeMockPreferenceRepo([{ type: "APPROVAL_REQUESTED", enabled: false }]);
    service = new SendEmailNotificationService(emailPort, prefRepo as never);

    await service.send(makeContext());

    expect(emailPort.send).not.toHaveBeenCalled();
  });

  it("does not send email for types not in EMAIL_ENABLED_TYPES", async () => {
    await service.send(makeContext({ type: "COMMENT_ADDED" as never }));

    expect(emailPort.send).not.toHaveBeenCalled();
  });

  it("does not throw when email send fails", async () => {
    emailPort.send.mockRejectedValue(new Error("Network error"));

    await service.send(makeContext());
    // No error thrown — service swallows it
  });

  it("sends email for POST_APPROVED type", async () => {
    await service.send(
      makeContext({
        type: "POST_APPROVED" as never,
        metadata: { reviewerName: "Jane", postTitle: "Q2 Campaign", postId: "post-123" },
      })
    );

    expect(emailPort.send).toHaveBeenCalledOnce();
    const call = emailPort.send.mock.calls[0]?.[0] as { subject: string };
    assert.ok(call.subject.includes("approved"));
  });

  it("sends email for MENTION type", async () => {
    await service.send(
      makeContext({
        type: "MENTION" as never,
        metadata: { mentionerName: "Alice", context: "task" },
      })
    );

    expect(emailPort.send).toHaveBeenCalledOnce();
    const call = emailPort.send.mock.calls[0]?.[0] as { subject: string };
    assert.ok(call.subject.includes("Alice"));
  });
});
