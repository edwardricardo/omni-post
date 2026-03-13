/**
 * AbstractWebhookProcessor Tests
 * TDD - RED Phase: Tests for the webhook processor base class
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { createHmac } from "crypto";
import {
  AbstractWebhookProcessor,
  type RelatedEntities,
  type NormalizedWebhookData,
} from "../../../src/webhooks/processors/AbstractWebhookProcessor.js";
import type { WebhookEventType } from "@infra/prisma";

// Concrete implementation for testing
class TestWebhookProcessor extends AbstractWebhookProcessor {
  protected override providerId = "FACEBOOK" as const; // Use valid Provider enum value for testing
  protected override signaturePrefix = "sha256=";
  protected override signatureEncoding: "hex" | "base64" = "hex";

  protected override async parsePayload(payload: Record<string, any>): Promise<{
    eventType: WebhookEventType;
    normalizedData: Record<string, any>;
  }> {
    const eventType = (payload.type as WebhookEventType) || "POST_UPDATED";
    return {
      eventType,
      normalizedData: {
        eventType: payload.type as string,
        postId: payload.postId as string,
      },
    };
  }

  protected override async resolveRelatedEntities(
    _payload: Record<string, any>,
    _normalizedData: Record<string, any>
  ): Promise<RelatedEntities> {
    return {
      accountId: "test-account",
      projectId: "test-project",
      channelId: "test-channel",
    };
  }

  protected override async processEvent(
    _normalizedData: Record<string, any>,
    _relatedEntities: RelatedEntities
  ): Promise<void> {
    // Test implementation - does nothing
  }
}

describe("AbstractWebhookProcessor", () => {
  let processor: TestWebhookProcessor;
  const testSecret = "test-webhook-secret";

  beforeEach(() => {
    processor = new TestWebhookProcessor();
  });

  describe("verify()", () => {
    it("should verify valid HMAC-SHA256 signature", () => {
      const payload = '{"type":"POST_PUBLISHED","postId":"123"}';
      const expectedSignature = createHmac("sha256", testSecret)
        .update(payload, "utf8")
        .digest("hex");
      const signature = `sha256=${expectedSignature}`;

      const result = processor.verify(payload, signature, testSecret);

      expect(result).toBe(true);
    });

    it("should reject invalid signature", () => {
      const payload = '{"type":"POST_PUBLISHED","postId":"123"}';
      const signature = "sha256=invalid-signature-here";

      const result = processor.verify(payload, signature, testSecret);

      expect(result).toBe(false);
    });

    it("should handle signature without prefix", () => {
      const payload = '{"type":"POST_PUBLISHED","postId":"123"}';
      const expectedSignature = createHmac("sha256", testSecret)
        .update(payload, "utf8")
        .digest("hex");

      const result = processor.verify(payload, expectedSignature, testSecret);

      expect(result).toBe(true);
    });

    it("should reject empty signature", () => {
      const payload = '{"type":"POST_PUBLISHED","postId":"123"}';

      const result = processor.verify(payload, "", testSecret);

      expect(result).toBe(false);
    });

    it("should use constant-time comparison (timing attack prevention)", () => {
      const payload = '{"type":"POST_PUBLISHED"}';
      const validSig = createHmac("sha256", testSecret).update(payload).digest("hex");
      const invalidSig = "a".repeat(validSig.length);

      // Both should complete in similar time (not measurable in test, but ensures code path)
      const validResult = processor.verify(payload, `sha256=${validSig}`, testSecret);
      const invalidResult = processor.verify(payload, `sha256=${invalidSig}`, testSecret);

      expect(validResult).toBe(true);
      expect(invalidResult).toBe(false);
    });
  });

  describe("parse()", () => {
    it("should parse payload and return normalized data with event type", async () => {
      const payload = { type: "POST_PUBLISHED", postId: "123" };

      const result = await processor.parse(payload);

      expect(result.eventType).toBe("POST_PUBLISHED");
      expect(result.normalizedData.eventType).toBe("POST_PUBLISHED");
      expect(result.normalizedData.postId).toBe("123");
    });

    it("should include related entities in parse result", async () => {
      const payload = { type: "POST_PUBLISHED", postId: "123" };

      const result = await processor.parse(payload);

      expect(result.relatedEntities).toBeTruthy();
      expect(result.relatedEntities.accountId).toBe("test-account");
      expect(result.relatedEntities.projectId).toBe("test-project");
      expect(result.relatedEntities.channelId).toBe("test-channel");
    });
  });

  describe("process()", () => {
    it("should call processEvent with normalized data and entities", async () => {
      const normalizedData: NormalizedWebhookData = {
        eventType: "post_published",
        postId: "123",
      };
      const entities: RelatedEntities = {
        accountId: "acc-1",
        projectId: "proj-1",
        channelId: "ch-1",
      };

      // Should not throw
      await processor.process(normalizedData, entities);
    });

    it("should return early when no related entities found", async () => {
      // Create a processor that tracks processEvent calls
      let processEventCalled = false;
      const trackingProcessor = new (class extends TestWebhookProcessor {
        protected override async processEvent() {
          processEventCalled = true;
        }
      })();

      const normalizedData: NormalizedWebhookData = { eventType: "unknown" };
      const entities: RelatedEntities = {}; // No accountId or projectId

      await trackingProcessor.process(normalizedData, entities);

      // processEvent should NOT be called when there are no related entities
      expect(processEventCalled).toBe(false);
    });
  });

  describe("getProviderId()", () => {
    it("should return the provider ID", () => {
      expect(processor.getProviderId()).toBe("FACEBOOK");
    });
  });
});

describe("AbstractWebhookProcessor with base64 encoding", () => {
  class Base64WebhookProcessor extends AbstractWebhookProcessor {
    protected override providerId = "X" as const; // Use valid Provider enum value (X uses base64)
    protected override signaturePrefix = "sha256=";
    protected override signatureEncoding: "hex" | "base64" = "base64";

    protected override async parsePayload(_payload: Record<string, any>): Promise<{
      eventType: WebhookEventType;
      normalizedData: Record<string, any>;
    }> {
      return {
        eventType: "POST_UPDATED",
        normalizedData: { eventType: "test" },
      };
    }

    protected override async resolveRelatedEntities(): Promise<RelatedEntities> {
      return {};
    }

    protected override async processEvent(): Promise<void> {}
  }

  it("should verify base64-encoded signatures", () => {
    const processor = new Base64WebhookProcessor();
    const payload = '{"test":"data"}';
    const secret = "test-secret";
    const expectedSignature = createHmac("sha256", secret).update(payload, "utf8").digest("base64");

    const result = processor.verify(payload, `sha256=${expectedSignature}`, secret);

    expect(result).toBe(true);
  });
});

describe("AbstractWebhookProcessor with broadcaster", () => {
  it("should accept broadcaster in constructor", (t) => {
    const mockBroadcaster = {
      broadcastPostStatusChange: vi.fn(),
      broadcastEngagementUpdate: vi.fn(),
    };

    const processor = new TestWebhookProcessor(mockBroadcaster as any);

    expect(processor).toBeTruthy();
  });
});
