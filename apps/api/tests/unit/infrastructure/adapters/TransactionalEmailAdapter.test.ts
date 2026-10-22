/**
 * @file TransactionalEmailAdapter.test.ts
 * @description Tests the transactional-email adapter: each role-port method
 *              renders the template, builds the plain-text body, and sends via
 *              the EmailPort. For notifications it maps the type to a template
 *              and builds links from the configured client URL.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { ok } from "@shared/types";
import { TransactionalEmailAdapter } from "../../../../src/infrastructure/adapters/TransactionalEmailAdapter.js";

const CLIENT_URL = "https://app.test";

/** The targets of every link of an email, with the character references a mail client decodes. */
function linkTargets(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) =>
    (match[1] ?? "")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
      .replaceAll("&amp;", "&")
  );
}

function makeEmailPort() {
  return { send: vi.fn().mockResolvedValue(ok(undefined)) };
}

describe("TransactionalEmailAdapter", () => {
  let emailPort: ReturnType<typeof makeEmailPort>;
  let adapter: TransactionalEmailAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    emailPort = makeEmailPort();
    adapter = new TransactionalEmailAdapter(emailPort as never, CLIENT_URL);
  });

  it("renders + sends the referral-reward email", async () => {
    await adapter.sendReferralReward("referrer@example.com", {
      referrerName: "Acme Inc.",
      referredCompanyName: "Globex Corp.",
      rewardDays: 30,
      newExpiryDate: "2026-07-01",
      totalConversions: 3,
      billingUrl: "https://app.test/dashboard/settings/billing",
      accountName: "Acme Inc.",
    });

    expect(emailPort.send).toHaveBeenCalledOnce();
    const call = emailPort.send.mock.calls[0]?.[0];
    assert.deepStrictEqual(call?.to, ["referrer@example.com"]);
    assert.match(call?.subject ?? "", /Globex Corp\./);
    assert.match(call?.subject ?? "", /30 free days/);
    assert.ok((call?.html ?? "").includes("Acme Inc."));
  });

  it("renders + sends the welcome email", async () => {
    await adapter.sendWelcome("john@test.com", {
      accountName: "Test Account",
      onboardingUrl: "https://app.test.io/dashboard",
      supportEmail: "help@test.io",
    });

    expect(emailPort.send).toHaveBeenCalledOnce();
    const call = emailPort.send.mock.calls[0]?.[0];
    assert.deepStrictEqual(call?.to, ["john@test.com"]);
    assert.match(call?.subject ?? "", /Welcome/i);
    assert.ok((call?.html ?? "").includes("https://app.test.io"));
  });

  it("renders + sends the team-invitation email", async () => {
    await adapter.sendTeamInvitation("invitee@test.com", {
      inviterName: "An admin",
      accountName: "acc-1",
      role: "EDITOR",
      acceptUrl: "https://app.test/accept-invitation?token=tok",
    });

    expect(emailPort.send).toHaveBeenCalledOnce();
    const call = emailPort.send.mock.calls[0]?.[0];
    assert.deepStrictEqual(call?.to, ["invitee@test.com"]);
    assert.deepStrictEqual(linkTargets(call?.html ?? ""), [
      "https://app.test/accept-invitation?token=tok",
    ]);
  });

  it("renders APPROVAL_REQUESTED notification with the review link", async () => {
    await adapter.sendNotification({
      recipientId: "m-1",
      recipientEmail: "user@test.com",
      type: "APPROVAL_REQUESTED",
      title: "Post needs approval",
      body: "Check out our new...",
      accountName: "Acme Corp",
      metadata: { authorName: "John", postTitle: "Spring Launch", platforms: "Instagram,X" },
    });

    expect(emailPort.send).toHaveBeenCalledOnce();
    const call = emailPort.send.mock.calls[0]?.[0];
    assert.deepStrictEqual(call?.to, ["user@test.com"]);
    assert.ok((call?.subject ?? "").includes("Spring Launch"));
    assert.ok((call?.html ?? "").includes("John"));
    assert.ok((call?.html ?? "").includes(`${CLIENT_URL}/dashboard/approvals`));
  });

  it("renders POST_APPROVED notification", async () => {
    await adapter.sendNotification({
      recipientId: "m-1",
      recipientEmail: "user@test.com",
      type: "POST_APPROVED",
      title: "Approved",
      body: "Your post was approved",
      accountName: "Acme Corp",
      metadata: { reviewerName: "Jane", postTitle: "Q2 Campaign", postId: "post-123" },
    });

    const call = emailPort.send.mock.calls[0]?.[0];
    assert.ok((call?.subject ?? "").includes("approved"));
  });

  it("renders MENTION notification", async () => {
    await adapter.sendNotification({
      recipientId: "m-1",
      recipientEmail: "user@test.com",
      type: "MENTION",
      title: "Mentioned",
      body: "You were mentioned",
      accountName: "Acme Corp",
      metadata: { mentionerName: "Alice", context: "task" },
    });

    const call = emailPort.send.mock.calls[0]?.[0];
    assert.ok((call?.subject ?? "").includes("Alice"));
  });

  it("renders + sends the deleted-account notice with its plain-text body", async () => {
    const result = await adapter.notifyRegistrationAttemptOnDeletedAccount("owner@test.com", {
      supportEmail: "help@test.io",
    });

    assert.ok(result.ok);
    expect(emailPort.send).toHaveBeenCalledOnce();
    const call = emailPort.send.mock.calls[0]?.[0];
    assert.deepStrictEqual(call?.to, ["owner@test.com"]);
    assert.match(call?.subject ?? "", /registration was attempted/i);
    assert.ok((call?.html ?? "").includes("help@test.io"));
    assert.ok((call?.body ?? "").includes("help@test.io"));
    assert.match(call?.body ?? "", /erases all of the account's data/);
  });

  it("returns the transport's failure for the deleted-account notice", async () => {
    const failure = new Error("transport down");
    emailPort.send.mockResolvedValue({ ok: false, error: failure });

    const result = await adapter.notifyRegistrationAttemptOnDeletedAccount("owner@test.com", {
      supportEmail: "help@test.io",
    });

    assert.deepStrictEqual(result, { ok: false, error: failure });
  });

  it("falls back to a plain body for an unmapped notification type", async () => {
    await adapter.sendNotification({
      recipientId: "m-1",
      recipientEmail: "user@test.com",
      type: "COMMENT_ADDED" as never,
      title: "A title",
      body: "Some body",
      accountName: "Acme Corp",
    });

    const call = emailPort.send.mock.calls[0]?.[0];
    assert.strictEqual(call?.subject, "A title");
    assert.ok((call?.html ?? "").includes("Some body"));
  });

  it("escapes the body of an unmapped notification instead of sending it as markup", async () => {
    await adapter.sendNotification({
      recipientId: "m-1",
      recipientEmail: "user@test.com",
      type: "COMMENT_ADDED" as never,
      title: "A title",
      body: '<a href="https://evil.test">click</a>',
      accountName: "Acme Corp",
    });

    const call = emailPort.send.mock.calls[0]?.[0];
    assert.strictEqual(
      call?.html,
      "<p>&lt;a href&#x3D;&quot;https://evil.test&quot;&gt;click&lt;/a&gt;</p>"
    );
    assert.strictEqual(
      call?.body,
      '<a href="https://evil.test">click</a>',
      "the text part is not HTML"
    );
  });

  it.each([
    ["a javascript: link", "javascript:alert(1)"],
    ["a data: link", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
    ["a relative link", "/accept-invitation?token=tok"],
  ])("refuses to send an email whose call to action is %s", async (_label, acceptUrl) => {
    const result = await adapter.sendTeamInvitation("invitee@test.com", {
      inviterName: "An admin",
      accountName: "acc-1",
      role: "EDITOR",
      acceptUrl,
    });

    assert.strictEqual(result.ok, false, "the adapter reports the refusal as a Result error");
    expect(emailPort.send).not.toHaveBeenCalled();
  });
});
