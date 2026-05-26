/**
 * @file linkedinWebhookProcessor.test.ts
 * @description Unit tests for LinkedInWebhookProcessor covering HMAC-SHA256
 *              signature verification via X-LI-Signature header, event parsing
 *              (LIKE, COMMENT, SHARE, SHARE_MENTION, COMMENT_EDIT, COMMENT_DELETE),
 *              and event type mapping to OmniPost webhook event types.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import { createHmac } from "node:crypto";
import { LinkedInWebhookProcessor } from "../../../src/webhooks/processors/linkedinWebhookProcessor.js";
import { makeWebhookPrismaFake } from "../helpers/webhookPrismaFake.js";

// ============================================================================
// Test helpers
// ============================================================================

const TEST_SECRET = "linkedin-test-client-secret-abc123";

function signLinkedIn(payload: string, secret: string): string {
  return "hmacsha256=" + createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function makeNotificationPayload(
  overrides?: Partial<{
    eventType: string;
    resourceUrn: string;
    actorUrn: string;
    organizationUrn: string;
    notificationId: string;
    timestamp: number;
  }>
) {
  return {
    notifications: [
      {
        notificationId: overrides?.notificationId || "notif-001",
        eventType: overrides?.eventType || "LIKE",
        resourceUrn: overrides?.resourceUrn || "urn:li:share:12345",
        actorUrn: overrides?.actorUrn || "urn:li:person:actor-001",
        organizationUrn: overrides?.organizationUrn || "urn:li:organization:org-001",
        timestamp: overrides?.timestamp || 1717200000000,
      },
    ],
  };
}

// ============================================================================
// Signature Verification Tests
// ============================================================================

describe("LinkedInWebhookProcessor - Signature Verification", () => {
  let processor: LinkedInWebhookProcessor;

  let _originalConsoleLog: typeof console.log;
  beforeAll(() => {
    _originalConsoleLog = console.log;
    console.log = () => {};
  });
  afterAll(() => {
    console.log = _originalConsoleLog;
  });

  beforeEach(() => {
    processor = new LinkedInWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("accepts valid payload with correct hmacsha256 signature", () => {
    const payload = JSON.stringify(makeNotificationPayload());
    const signature = signLinkedIn(payload, TEST_SECRET);

    expect(processor.verify(payload, signature, TEST_SECRET)).toBe(true);
  });

  it("accepts valid signature without prefix", () => {
    const payload = JSON.stringify(makeNotificationPayload());
    const rawHash = createHmac("sha256", TEST_SECRET).update(payload, "utf8").digest("hex");

    expect(processor.verify(payload, rawHash, TEST_SECRET)).toBe(true);
  });

  it("rejects tampered body after signing", () => {
    const originalPayload = JSON.stringify(makeNotificationPayload({ eventType: "LIKE" }));
    const signature = signLinkedIn(originalPayload, TEST_SECRET);

    const tamperedPayload = JSON.stringify(makeNotificationPayload({ eventType: "SHARE" }));

    expect(processor.verify(tamperedPayload, signature, TEST_SECRET)).toBe(false);
  });

  it("rejects empty signature", () => {
    const payload = JSON.stringify(makeNotificationPayload());

    expect(processor.verify(payload, "", TEST_SECRET)).toBe(false);
  });

  it("rejects signature computed with wrong secret", () => {
    const payload = JSON.stringify(makeNotificationPayload());
    const wrongSignature = signLinkedIn(payload, "attacker-secret");

    expect(processor.verify(payload, wrongSignature, TEST_SECRET)).toBe(false);
  });

  it("rejects all-zero signature value", () => {
    const payload = JSON.stringify(makeNotificationPayload());
    const zeroSig = "hmacsha256=0000000000000000000000000000000000000000000000000000000000000000";

    expect(processor.verify(payload, zeroSig, TEST_SECRET)).toBe(false);
  });

  it("handles unicode characters in payload correctly", () => {
    const payload = JSON.stringify({
      notifications: [
        {
          notificationId: "notif-unicode",
          eventType: "COMMENT",
          resourceUrn: "urn:li:share:99999",
          actorUrn: "urn:li:person:user-unicode",
          organizationUrn: "urn:li:organization:org-001",
          timestamp: 1717200000000,
          details: { text: "Great post! Merci beaucoup! Danke!" },
        },
      ],
    });
    const signature = signLinkedIn(payload, TEST_SECRET);

    expect(processor.verify(payload, signature, TEST_SECRET)).toBe(true);
  });

  it("returns correct provider ID", () => {
    expect(processor.getProviderId()).toBe("LINKEDIN");
  });
});

// ============================================================================
// Event Parsing Tests
// ============================================================================

describe("LinkedInWebhookProcessor - Event Parsing", () => {
  let processor: LinkedInWebhookProcessor;

  let _originalConsoleLog: typeof console.log;
  beforeAll(() => {
    _originalConsoleLog = console.log;
    console.log = () => {};
  });
  afterAll(() => {
    console.log = _originalConsoleLog;
  });

  beforeEach(() => {
    processor = new LinkedInWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("maps LIKE event to LIKE_RECEIVED", async () => {
    const payload = makeNotificationPayload({ eventType: "LIKE" });
    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    expect(result.eventType).toBe("LIKE_RECEIVED");
    expect(result.normalizedData.eventType).toBe("LIKE");
  });

  it("maps COMMENT event to COMMENT_RECEIVED", async () => {
    const payload = makeNotificationPayload({ eventType: "COMMENT" });
    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    expect(result.eventType).toBe("COMMENT_RECEIVED");
  });

  it("maps ADMIN_COMMENT event to COMMENT_RECEIVED", async () => {
    const payload = makeNotificationPayload({ eventType: "ADMIN_COMMENT" });
    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    expect(result.eventType).toBe("COMMENT_RECEIVED");
  });

  it("maps SHARE event to SHARE_RECEIVED", async () => {
    const payload = makeNotificationPayload({ eventType: "SHARE" });
    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    expect(result.eventType).toBe("SHARE_RECEIVED");
  });

  it("maps SHARE_MENTION event to MENTION_RECEIVED", async () => {
    const payload = makeNotificationPayload({ eventType: "SHARE_MENTION" });
    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    expect(result.eventType).toBe("MENTION_RECEIVED");
  });

  it("maps COMMENT_EDIT event to POST_UPDATED", async () => {
    const payload = makeNotificationPayload({ eventType: "COMMENT_EDIT" });
    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    expect(result.eventType).toBe("POST_UPDATED");
  });

  it("maps COMMENT_DELETE event to POST_UPDATED", async () => {
    const payload = makeNotificationPayload({ eventType: "COMMENT_DELETE" });
    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    expect(result.eventType).toBe("POST_UPDATED");
  });

  it("maps unknown event to POST_ENGAGEMENT_UPDATE", async () => {
    const payload = makeNotificationPayload({
      eventType: "UNKNOWN_EVENT" as string,
    });
    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    expect(result.eventType).toBe("POST_ENGAGEMENT_UPDATE");
  });

  it("normalizes notification data correctly", async () => {
    const payload = makeNotificationPayload({
      notificationId: "notif-normalized",
      eventType: "LIKE",
      resourceUrn: "urn:li:share:55555",
      actorUrn: "urn:li:person:actor-norm",
      organizationUrn: "urn:li:organization:org-norm",
      timestamp: 1717300000000,
    });

    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    expect(result.normalizedData.notificationId).toBe("notif-normalized");
    expect(result.normalizedData.resourceUrn).toBe("urn:li:share:55555");
    expect(result.normalizedData.actorUrn).toBe("urn:li:person:actor-norm");
    expect(result.normalizedData.organizationUrn).toBe("urn:li:organization:org-norm");
    expect(result.normalizedData.timestamp).toBe(1717300000000);
  });

  it("parses single notification format (no notifications array)", async () => {
    const payload = {
      eventType: "LIKE",
      resourceUrn: "urn:li:share:single-001",
      actorUrn: "urn:li:person:single-actor",
      organizationUrn: "urn:li:organization:org-single",
      notificationId: "notif-single",
      timestamp: 1717400000000,
    };

    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    expect(result.eventType).toBe("LIKE_RECEIVED");
    expect(result.normalizedData.eventType).toBe("LIKE");
  });

  it("throws error when eventType is missing", async () => {
    const payload = {
      resourceUrn: "urn:li:share:no-event",
      actorUrn: "urn:li:person:actor",
    };

    await expect(processor.parse(payload as unknown as Record<string, unknown>)).rejects.toThrow(
      /missing eventType/
    );
  });
});
