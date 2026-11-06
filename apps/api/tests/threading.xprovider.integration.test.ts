/**
 * X/Twitter Provider Threading Tests
 *
 * Tests X/Twitter-specific threading functionality including:
 * - Content rendering for X platform
 * - Thread planning with X constraints
 * - Character limits (280 chars)
 * - Media handling for tweets
 * - Provider limits
 *
 * @file threading.xprovider.integration.test.ts
 * @description Tests for X/Twitter Provider Threading
 * @layer infrastructure
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createXAdapter } from "@providers/x";
import type { CanonicalPost } from "@shared/types";

const xAdapter = createXAdapter();

describe("X/Twitter Provider Threading", () => {
  const longContent =
    "This is a very long post that definitely exceeds the character limit and should be split into multiple tweets. ".repeat(
      15
    );

  describe("Content Rendering", () => {
    it("should render short content as single tweet", () => {
      const shortPost: CanonicalPost = {
        id: "test-1",
        projectId: "dev",
        locale: "es",
        body: "Hello world! This is a short post for testing.",
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = xAdapter.render(shortPost);

      assert.ok(result.ok, `Expected render to succeed: ${result.ok ? "" : result.error}`);
      assert.strictEqual(
        result.value.type,
        "single",
        `Expected single content, got ${result.value.type}`
      );
    });

    it("should render long content as thread", () => {
      const longPost: CanonicalPost = {
        id: "test-2",
        projectId: "dev",
        locale: "es",
        body: longContent,
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = xAdapter.render(longPost);

      assert.ok(result.ok, `Expected render to succeed: ${result.ok ? "" : result.error}`);
      assert.strictEqual(
        result.value.type,
        "thread",
        `Expected thread content, got ${result.value.type}`
      );

      const threadPlan = result.value.content as any;
      assert.ok(threadPlan.needsThreading, "Long content should need threading");
      assert.ok(
        threadPlan.tweets.length > 1,
        `Expected multiple tweets, got ${threadPlan.tweets.length}`
      );
    });
  });

  describe("Thread Planning", () => {
    it("should plan thread for long content", () => {
      const longPost: CanonicalPost = {
        id: "test-plan-1",
        projectId: "dev",
        locale: "es",
        body: longContent,
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = xAdapter.planThread(longPost);

      assert.ok(result.ok, `Expected planThread to succeed: ${result.ok ? "" : result.error}`);
      assert.ok(result.value.needsThreading, "Long post should need threading");
      assert.ok(
        result.value.tweets.length > 1,
        `Expected multiple tweets, got ${result.value.tweets.length}`
      );
    });

    it("should enforce character limits in thread planning", () => {
      const longPost: CanonicalPost = {
        id: "test-limits",
        projectId: "dev",
        locale: "es",
        body: longContent,
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = xAdapter.planThread(longPost);
      assert.ok(result.ok);

      // Check that each tweet is within character limits
      for (const tweet of result.value.tweets) {
        assert.ok(
          tweet.text.length <= 280,
          `Tweet ${tweet.sequence} exceeds character limit: ${tweet.text.length}`
        );
        assert.ok(
          tweet.estimatedChars <= 280,
          `Tweet ${tweet.sequence} estimated chars exceeds limit: ${tweet.estimatedChars}`
        );
      }
    });

    it("should add thread indicators to tweets", () => {
      const longPost: CanonicalPost = {
        id: "test-indicators",
        projectId: "dev",
        locale: "es",
        body: longContent,
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = xAdapter.planThread(longPost);
      assert.ok(result.ok);
      const { tweets } = result.value;

      const totalTweets = tweets.length;

      for (const [i, tweet] of tweets.entries()) {
        const expectedIndicator = `${i + 1}/${totalTweets} `;
        assert.ok(
          tweet.text.startsWith(expectedIndicator),
          `Tweet ${i + 1} should start with thread indicator`
        );
      }
    });

    it("should maintain tweet sequence integrity", () => {
      const longPost: CanonicalPost = {
        id: "test-sequence",
        projectId: "dev",
        locale: "es",
        body: longContent,
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = xAdapter.planThread(longPost);
      assert.ok(result.ok);
      const { tweets } = result.value;

      // Verify sequence numbers are consecutive
      for (const [i, tweet] of tweets.entries()) {
        assert.strictEqual(
          tweet.sequence,
          i + 1,
          `Tweet at index ${i} should have sequence ${i + 1}`
        );
      }
    });
  });

  describe("Credential Validation", () => {
    it("should fail validation with placeholder credentials", async () => {
      const credValidation = await xAdapter.validateCredentials({
        apiKey: "test",
        apiSecret: "test",
        bearerToken: "test",
      });

      assert.ok(!credValidation.ok, "Expected credential validation to fail with test credentials");
      assert.ok(credValidation.error, "Should have error message for invalid credentials");
    });

    it("should fail validation with empty credentials", async () => {
      const credValidation = await xAdapter.validateCredentials({
        apiKey: "",
        apiSecret: "",
        bearerToken: "",
      });

      assert.ok(!credValidation.ok, "Should fail with empty credentials");
    });
  });

  describe("Provider Limits", () => {
    it("should have correct character limit", () => {
      assert.strictEqual(
        xAdapter.limits.maxChars,
        280,
        `Expected maxChars to be 280, got ${xAdapter.limits.maxChars}`
      );
    });

    it("should have maximum tweets per thread limit", () => {
      assert.strictEqual(
        xAdapter.limits.maxPostsPerThread,
        25,
        `Expected maxPostsPerThread to be 25, got ${xAdapter.limits.maxPostsPerThread}`
      );
    });

    it("should have correct media limits", () => {
      assert.ok(xAdapter.limits.maxMediaPerPost, "Should have max media per post limit");
      assert.ok(
        xAdapter.limits.maxMediaPerPost >= 4,
        "Should support at least 4 media items per tweet"
      );
    });
  });

  describe("Media Handling", () => {
    it("should distribute media in thread", () => {
      const postWithMedia: CanonicalPost = {
        id: "test-media-thread",
        projectId: "dev",
        locale: "es",
        body: longContent,
        tags: [],
        media: [
          { id: "m1", type: "image", url: "https://example.com/1.jpg", w: 1200, h: 800 },
          { id: "m2", type: "image", url: "https://example.com/2.jpg", w: 1200, h: 800 },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = xAdapter.planThread(postWithMedia);
      assert.ok(result.ok);

      // Count total media across all tweets
      let totalMedia = 0;
      for (const tweet of result.value.tweets) {
        if (tweet.media) {
          totalMedia += tweet.media.length;
        }
      }

      assert.strictEqual(totalMedia, 2, "Should distribute all media items across thread");
    });
  });

  describe("Thread Plan Structure", () => {
    it("should create valid thread plan with all required fields", () => {
      const longPost: CanonicalPost = {
        id: "test-structure",
        projectId: "dev",
        locale: "es",
        body: longContent,
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = xAdapter.planThread(longPost);
      assert.ok(result.ok);

      const plan = result.value;

      // Verify plan structure
      assert.ok(typeof plan.needsThreading === "boolean", "Should have needsThreading boolean");
      assert.ok(Array.isArray(plan.tweets), "Should have tweets array");
      assert.ok(plan.tweets.length > 0, "Should have at least one tweet");

      // Verify each tweet structure
      for (const tweet of plan.tweets) {
        assert.ok(typeof tweet.sequence === "number", "Tweet should have sequence number");
        assert.ok(typeof tweet.text === "string", "Tweet should have text");
        assert.ok(typeof tweet.estimatedChars === "number", "Tweet should have estimatedChars");
        assert.ok(tweet.sequence > 0, "Sequence should be positive");
        assert.ok(tweet.text.length > 0, "Text should not be empty");
        assert.ok(tweet.estimatedChars > 0, "Estimated chars should be positive");
      }
    });
  });

  describe("Performance", () => {
    it("should handle very long content efficiently", () => {
      const veryLongBody = "This is a test sentence that will be repeated many times. ".repeat(100);

      const veryLongPost: CanonicalPost = {
        id: "test-perf",
        projectId: "dev",
        locale: "es",
        body: veryLongBody,
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const startTime = Date.now();
      const result = xAdapter.planThread(veryLongPost);
      const duration = Date.now() - startTime;

      assert.ok(result.ok, "Should handle very long content");
      assert.ok(duration < 1000, `Thread planning should complete quickly (took ${duration}ms)`);
    });
  });
});
