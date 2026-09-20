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
import { describeRetractionCause } from "@core/notifications/retractionAlertMessage.js";

const CLIENT_URL = "https://app.test";

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
    assert.ok((call?.html ?? "").includes("https://app.test/accept-invitation?token=tok"));
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

  describe("PUBLICATION_RETRACTION_PENDING", () => {
    const sendRetractionAlert = async (
      adapterUnderTest: TransactionalEmailAdapter,
      metadata?: Record<string, unknown>
    ) =>
      adapterUnderTest.sendNotification({
        recipientId: "m-1",
        recipientEmail: "user@test.com",
        type: "PUBLICATION_RETRACTION_PENDING",
        title: "Content is still live on Acme on X: manual removal required",
        body: "Part of your post is still published on Acme on X.",
        accountName: "Acme Corp",
        metadata: metadata ?? {
          postId: "post-1",
          channelId: "channel-1",
          channelName: "Acme on X",
          postExcerpt: "Launch week",
          cause: "NO_CAPABILITY",
          actionWindowEndsAt: "2026-09-22T09:00:00.000Z",
          liveFragments: [
            { index: 1, externalId: "18110001", url: "https://x.test/acme/1" },
            { index: 2, externalId: "18110002" },
          ],
        },
      });

    it("renders a dedicated template naming the channel, the fragments and the action", async () => {
      await sendRetractionAlert(adapter);

      const call = emailPort.send.mock.calls[0]?.[0];
      const html = call?.html ?? "";
      assert.match(call?.subject ?? "", /Acme on X/);
      assert.ok(html.includes("18110001"), "the first live fragment is not named");
      assert.ok(html.includes("18110002"), "the second live fragment is not named");
      assert.ok(html.includes("https://x.test/acme/1"), "the fragment's link is missing");
      assert.match(html, /manual/i);
      assert.ok(html.includes("Launch week"), "the post excerpt is missing");
    });

    it("states the cause in the SAME vocabulary the dashboard and the webhook use", async () => {
      // Asserted against the shared vocabulary rather than a literal: the email used to
      // carry its own copy of these sentences, so the two could be edited apart and the
      // customer would read one explanation on the dashboard and another in the inbox.
      await sendRetractionAlert(adapter);
      const noCapability = emailPort.send.mock.calls[0]?.[0]?.html ?? "";
      assert.ok(
        noCapability.includes(describeRetractionCause("NO_CAPABILITY")),
        "the email's cause sentence has drifted from the one every other medium states"
      );

      emailPort.send.mockClear();
      await sendRetractionAlert(adapter, {
        channelName: "Acme on X",
        cause: "EXHAUSTED",
        postExcerpt: "Launch week",
        liveFragments: [{ index: 1, externalId: "18110001" }],
      });
      const exhausted = emailPort.send.mock.calls[0]?.[0]?.html ?? "";
      assert.ok(exhausted.includes(describeRetractionCause("EXHAUSTED")));
    });

    it("states the unknown-cause sentence from that same vocabulary", async () => {
      await sendRetractionAlert(adapter, {
        channelName: "Acme on X",
        cause: "SOMETHING_NOBODY_HAS_NAMED_YET",
        postExcerpt: "Launch week",
        liveFragments: [{ index: 1, externalId: "18110001" }],
      });

      const html = emailPort.send.mock.calls[0]?.[0]?.html ?? "";
      assert.ok(html.includes(describeRetractionCause("SOMETHING_NOBODY_HAS_NAMED_YET")));
    });

    it("names the deadline when a window is open and omits it when there is none", async () => {
      await sendRetractionAlert(adapter);
      assert.ok((emailPort.send.mock.calls[0]?.[0]?.html ?? "").includes("2026-09-22"));

      emailPort.send.mockClear();
      await sendRetractionAlert(adapter, {
        channelName: "Acme on X",
        cause: "NO_CAPABILITY",
        postExcerpt: "Launch week",
        liveFragments: [{ index: 1, externalId: "18110001" }],
      });
      const withoutWindow = emailPort.send.mock.calls[0]?.[0]?.html ?? "";
      assert.ok(!/act by/i.test(withoutWindow));
    });

    it("carries no credential-shaped field into the rendered email", async () => {
      await sendRetractionAlert(adapter);

      const rendered = JSON.stringify(emailPort.send.mock.calls[0]?.[0] ?? {}).toLowerCase();
      for (const forbidden of ["token", "secret", "credential", "password", "webhookurl"]) {
        assert.ok(!rendered.includes(forbidden), `the email carries a ${forbidden}-shaped field`);
      }
    });

    it("still renders when the metadata carries no fragments at all", async () => {
      await sendRetractionAlert(adapter, { channelName: "Acme on X", cause: "NO_CAPABILITY" });

      const call = emailPort.send.mock.calls[0]?.[0];
      assert.match(call?.subject ?? "", /Acme on X/);
    });
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
});
