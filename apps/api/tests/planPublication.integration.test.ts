/**
 * Publication Planning Tests
 *
 * Tests the core publication planning engine including:
 * - Planning canonical posts for providers
 * - Provider adapter integration
 * - Empty channel lists and per-locale planning
 * - Multi-channel planning
 *
 * @file planPublication.integration.test.ts
 * @description Tests for Publication Planning
 * @layer infrastructure
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { planPublication } from "@core/engine";
import { createXAdapter } from "@providers/x";

const xAdapter = createXAdapter();

describe("Publication Planning", () => {
  let canonicalPost: any;

  beforeEach(() => {
    canonicalPost = {
      id: "test-1",
      projectId: "dev",
      locale: "es",
      body: "Hola mundo",
    };
  });

  describe("Basic Planning", () => {
    it("should plan publication for single channel", () => {
      const result = planPublication(canonicalPost, [{ channelId: "dev-x", provider: xAdapter }]);

      assert.ok(result.ok, `Expected ok result: ${result.ok ? "ok" : result.error}`);
      assert.strictEqual(result.value.length, 1, "Expected one plan");
    });

    it("should use correct channel ID", () => {
      const result = planPublication(canonicalPost, [{ channelId: "dev-x", provider: xAdapter }]);

      assert.ok(result.ok);
      const plan = result.value[0];

      assert.strictEqual(plan.channelId, "dev-x");
    });

    it("should use correct provider ID", () => {
      const result = planPublication(canonicalPost, [{ channelId: "dev-x", provider: xAdapter }]);

      assert.ok(result.ok);
      const plan = result.value[0];

      assert.strictEqual(plan.providerId, "x");
    });
  });

  describe("Multi-Channel Planning", () => {
    it("should plan for multiple channels", () => {
      const result = planPublication(canonicalPost, [
        { channelId: "dev-x-1", provider: xAdapter },
        { channelId: "dev-x-2", provider: xAdapter },
      ]);

      assert.ok(result.ok);
      assert.strictEqual(result.value.length, 2, "Expected two plans");
    });

    it("should maintain channel IDs for multiple channels", () => {
      const result = planPublication(canonicalPost, [
        { channelId: "dev-x-1", provider: xAdapter },
        { channelId: "dev-x-2", provider: xAdapter },
      ]);

      assert.ok(result.ok);
      const channelIds = result.value.map((plan) => plan.channelId);

      assert.ok(channelIds.includes("dev-x-1"));
      assert.ok(channelIds.includes("dev-x-2"));
    });
  });

  describe("Error Handling", () => {
    it("should handle empty channels array", () => {
      const result = planPublication(canonicalPost, []);

      assert.ok(result.ok);
      assert.strictEqual(result.value.length, 0, "Should return empty array for no channels");
    });
  });

  describe("Localization", () => {
    it("should handle Spanish locale", () => {
      const spanishPost = {
        id: "test-es",
        projectId: "dev",
        locale: "es",
        body: "Hola mundo",
      };

      const result = planPublication(spanishPost as any, [
        { channelId: "dev-x", provider: xAdapter },
      ]);

      assert.ok(result.ok);
      assert.strictEqual(result.value.length, 1);
    });

    it("should handle English locale", () => {
      const englishPost = {
        id: "test-en",
        projectId: "dev",
        locale: "en",
        body: "Hello world",
      };

      const result = planPublication(englishPost as any, [
        { channelId: "dev-x", provider: xAdapter },
      ]);

      assert.ok(result.ok);
      assert.strictEqual(result.value.length, 1);
    });
  });
});
