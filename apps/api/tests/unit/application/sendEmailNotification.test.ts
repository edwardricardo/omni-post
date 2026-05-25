/**
 * @file sendEmailNotification.test.ts
 * @description Unit tests for SendEmailNotificationService — the gate logic
 *              (type allow-list + recipient preferences) and delegation to the
 *              NotificationMailer. Template rendering/subject/html is covered by
 *              the TransactionalEmailAdapter test.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { SendEmailNotificationService } from "../../../src/application/notifications/SendEmailNotificationService.js";
import { ok } from "@shared/types";

function makeMockMailer() {
  return {
    sendNotification: vi.fn().mockResolvedValue(ok(undefined)),
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
  let mailer: ReturnType<typeof makeMockMailer>;
  let prefRepo: ReturnType<typeof makeMockPreferenceRepo>;
  let service: SendEmailNotificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    mailer = makeMockMailer();
    prefRepo = makeMockPreferenceRepo();
    service = new SendEmailNotificationService(mailer, prefRepo as never);
  });

  it("delegates to the mailer for an enabled APPROVAL_REQUESTED type", async () => {
    const ctx = makeContext();
    await service.send(ctx);

    expect(mailer.sendNotification).toHaveBeenCalledOnce();
    const call = mailer.sendNotification.mock.calls[0]?.[0];
    assert.strictEqual(call?.type, "APPROVAL_REQUESTED");
    assert.strictEqual(call?.recipientEmail, "user@test.com");
  });

  it("does not send when the recipient has disabled the type", async () => {
    prefRepo = makeMockPreferenceRepo([{ type: "APPROVAL_REQUESTED", enabled: false }]);
    service = new SendEmailNotificationService(mailer, prefRepo as never);

    await service.send(makeContext());

    expect(mailer.sendNotification).not.toHaveBeenCalled();
  });

  it("does not send for types not in the email allow-list", async () => {
    await service.send(makeContext({ type: "COMMENT_ADDED" as never }));

    expect(mailer.sendNotification).not.toHaveBeenCalled();
  });

  it("does not throw when the mailer fails", async () => {
    mailer.sendNotification.mockRejectedValue(new Error("Network error"));

    await service.send(makeContext());
    // No error thrown — service swallows it.
  });

  it("delegates POST_APPROVED to the mailer", async () => {
    await service.send(makeContext({ type: "POST_APPROVED" as never }));

    expect(mailer.sendNotification).toHaveBeenCalledOnce();
    assert.strictEqual(mailer.sendNotification.mock.calls[0]?.[0]?.type, "POST_APPROVED");
  });

  it("delegates MENTION to the mailer", async () => {
    await service.send(makeContext({ type: "MENTION" as never }));

    expect(mailer.sendNotification).toHaveBeenCalledOnce();
    assert.strictEqual(mailer.sendNotification.mock.calls[0]?.[0]?.type, "MENTION");
  });
});
