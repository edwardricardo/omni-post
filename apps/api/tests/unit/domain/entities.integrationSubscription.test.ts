/**
 * @file entities.integrationSubscription.test.ts
 * @description Unit tests for IntegrationSubscription domain entity.
 * @layer domain
 */

import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";
import { IntegrationSubscription } from "@core/domain/entities/IntegrationSubscription.js";

describe("IntegrationSubscription", () => {
  const validInput = {
    accountId: "acc-001",
    event: "post.published",
    targetUrl: "https://hooks.zapier.com/webhook/abc123",
  };

  describe("create()", () => {
    it("creates a valid subscription for a supported event (default platform ZAPIER)", () => {
      const result = IntegrationSubscription.create(validInput);

      assert.ok(result.ok, "Should succeed");
      expect(result.value.accountId).toBe("acc-001");
      expect(result.value.event).toBe("post.published");
      expect(result.value.targetUrl).toBe("https://hooks.zapier.com/webhook/abc123");
      expect(result.value.active).toBe(true);
      expect(result.value.platform).toBe("ZAPIER");
      expect(result.value.id).toBeTruthy();
      expect(result.value.createdAt).toBeInstanceOf(Date);
    });

    it("creates a subscription with MAKE platform", () => {
      const result = IntegrationSubscription.create({
        ...validInput,
        platform: "MAKE",
        targetUrl: "https://hook.make.com/webhook/abc123",
      });

      assert.ok(result.ok, "Should succeed");
      expect(result.value.platform).toBe("MAKE");
      expect(result.value.targetUrl).toBe("https://hook.make.com/webhook/abc123");
    });

    it("creates subscriptions for all supported event types", () => {
      for (const event of IntegrationSubscription.SUPPORTED_EVENTS) {
        const result = IntegrationSubscription.create({
          ...validInput,
          event,
        });

        assert.ok(result.ok, `Should succeed for event: ${event}`);
        expect(result.value.event).toBe(event);
      }
    });

    it("rejects empty accountId", () => {
      const result = IntegrationSubscription.create({ ...validInput, accountId: "  " });

      assert.ok(!result.ok, "Should fail");
      expect(result.error.message).toContain("Account ID is required");
    });

    it("rejects unsupported event type", () => {
      const result = IntegrationSubscription.create({
        ...validInput,
        event: "not.a.real.event",
      });

      assert.ok(!result.ok, "Should fail");
      expect(result.error.message).toContain("Unsupported event");
      expect(result.error.message).toContain("not.a.real.event");
    });

    it("rejects non-HTTPS targetUrl", () => {
      const result = IntegrationSubscription.create({
        ...validInput,
        targetUrl: "http://hooks.zapier.com/webhook/abc123",
      });

      assert.ok(!result.ok, "Should fail");
      expect(result.error.message).toContain("HTTPS");
    });

    it("rejects plain domain without protocol", () => {
      const result = IntegrationSubscription.create({
        ...validInput,
        targetUrl: "hooks.zapier.com/webhook/abc123",
      });

      assert.ok(!result.ok, "Should fail");
      expect(result.error.message).toContain("HTTPS");
    });
  });

  describe("deactivate()", () => {
    it("sets active to false", () => {
      const result = IntegrationSubscription.create(validInput);
      assert.ok(result.ok);

      expect(result.value.active).toBe(true);

      result.value.deactivate();

      expect(result.value.active).toBe(false);
    });

    it("is idempotent -- second call is a no-op", () => {
      const result = IntegrationSubscription.create(validInput);
      assert.ok(result.ok);

      result.value.deactivate();
      result.value.deactivate();

      expect(result.value.active).toBe(false);
    });
  });

  describe("toJSON()", () => {
    it("serializes all fields including platform", () => {
      const result = IntegrationSubscription.create(validInput);
      assert.ok(result.ok);

      const json = result.value.toJSON();

      expect(json).toHaveProperty("id");
      expect(json).toHaveProperty("accountId", "acc-001");
      expect(json).toHaveProperty("event", "post.published");
      expect(json).toHaveProperty("targetUrl");
      expect(json).toHaveProperty("active", true);
      expect(json).toHaveProperty("createdAt");
      expect(json).toHaveProperty("platform", "ZAPIER");
    });
  });

  describe("reconstitute()", () => {
    it("rebuilds from persisted data without validation", () => {
      const props = {
        id: "sub-001",
        accountId: "acc-001",
        platform: "ZAPIER" as const,
        event: "post.published",
        targetUrl: "https://hooks.zapier.com/webhook/abc123",
        active: false,
        createdAt: new Date("2025-01-01"),
      };

      const sub = IntegrationSubscription.reconstitute(props);

      expect(sub.id).toBe("sub-001");
      expect(sub.active).toBe(false);
      expect(sub.platform).toBe("ZAPIER");
      expect(sub.createdAt).toEqual(new Date("2025-01-01"));
    });

    it("reconstitutes a MAKE subscription correctly", () => {
      const props = {
        id: "sub-002",
        accountId: "acc-002",
        platform: "MAKE" as const,
        event: "post.failed",
        targetUrl: "https://hook.make.com/webhook/test",
        active: true,
        createdAt: new Date("2025-02-01"),
      };

      const sub = IntegrationSubscription.reconstitute(props);

      expect(sub.platform).toBe("MAKE");
      expect(sub.event).toBe("post.failed");
    });
  });
});
