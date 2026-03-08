/**
 * Threading Planner Tests
 *
 * Tests the thread planning logic for splitting content into multiple tweets
 * with proper character limits, media distribution, and thread indicators.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planThread } from "../../../packages/core/threading/src/threadPlanner.js";
import type { CanonicalPost } from "@shared/types";

describe("Thread Planner", () => {
  const longBody =
    "This is a very long post that should definitely be split into multiple tweets because it exceeds the 280 character limit for a single tweet. ".repeat(
      10
    );

  describe("Short Content", () => {
    it("should not need threading for short posts", () => {
      const shortPost: CanonicalPost = {
        id: "test-1",
        projectId: "dev",
        locale: "es",
        body: "Hello world! This is a short post.",
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = planThread(shortPost, "AUTO");

      assert.ok(
        result.ok,
        `Expected planThread to succeed for short post: ${result.ok ? "" : result.error}`
      );
      assert.strictEqual(
        result.value.needsThreading,
        false,
        "Short post should not need threading"
      );
      assert.strictEqual(
        result.value.tweets.length,
        1,
        `Expected 1 tweet, got ${result.value.tweets.length}`
      );
    });

    it("should create single tweet for short content", () => {
      const shortPost: CanonicalPost = {
        id: "test-short",
        projectId: "dev",
        locale: "es",
        body: "Short tweet content here.",
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = planThread(shortPost, "AUTO");
      assert.ok(result.ok);

      const tweet = result.value.tweets[0];
      assert.ok(tweet, "Should have first tweet");
      assert.strictEqual(tweet.sequence, 1, "Tweet should have sequence 1");
      assert.ok(
        tweet.text.includes("Short tweet content"),
        "Tweet should contain original content"
      );
    });
  });

  describe("Long Content Threading", () => {
    it("should need threading for long posts", () => {
      const longPost: CanonicalPost = {
        id: "test-2",
        projectId: "dev",
        locale: "es",
        body: longBody,
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = planThread(longPost, "AUTO");

      assert.ok(
        result.ok,
        `Expected planThread to succeed for long post: ${result.ok ? "" : result.error}`
      );
      assert.strictEqual(result.value.needsThreading, true, "Long post should need threading");
      assert.ok(
        result.value.tweets.length > 1,
        `Expected multiple tweets, got ${result.value.tweets.length}`
      );
    });

    it("should create sequential tweet numbers", () => {
      const longPost: CanonicalPost = {
        id: "test-sequence",
        projectId: "dev",
        locale: "es",
        body: longBody,
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = planThread(longPost, "AUTO");
      assert.ok(result.ok);

      // Verify sequence numbers
      for (let i = 0; i < result.value.tweets.length; i++) {
        const tweet = result.value.tweets[i];
        assert.ok(tweet, `Tweet at index ${i} should exist`);
        assert.strictEqual(
          tweet.sequence,
          i + 1,
          `Expected tweet ${i} to have sequence ${i + 1}, got ${tweet.sequence}`
        );
      }
    });

    it("should add thread indicators to each tweet", () => {
      const longPost: CanonicalPost = {
        id: "test-indicators",
        projectId: "dev",
        locale: "es",
        body: longBody,
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = planThread(longPost, "AUTO");
      assert.ok(result.ok);

      const totalTweets = result.value.tweets.length;

      for (let i = 0; i < totalTweets; i++) {
        const tweet = result.value.tweets[i];
        const expectedIndicator = `${i + 1}/${totalTweets} `;
        assert.ok(
          tweet?.text.startsWith(expectedIndicator),
          `Tweet ${i + 1} should start with "${expectedIndicator}"`
        );
      }
    });
  });

  describe("Media Distribution", () => {
    it("should distribute media properly across tweets", () => {
      const postWithMedia: CanonicalPost = {
        id: "test-3",
        projectId: "dev",
        locale: "es",
        body: "Check out this amazing content with media attachments! ".repeat(5),
        tags: [],
        media: [
          {
            id: "media-1",
            type: "image",
            url: "https://example.com/image1.jpg",
            w: 1200,
            h: 800,
          },
          {
            id: "media-2",
            type: "image",
            url: "https://example.com/image2.jpg",
            w: 1200,
            h: 800,
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = planThread(postWithMedia, "AUTO");

      assert.ok(
        result.ok,
        `Expected planThread to succeed for media post: ${result.ok ? "" : result.error}`
      );

      // Check that all media is included
      const totalMediaInTweets = result.value.tweets.reduce(
        (acc, tweet) => acc + (tweet.media?.length || 0),
        0
      );
      assert.strictEqual(
        totalMediaInTweets,
        2,
        `Expected 2 media items, got ${totalMediaInTweets}`
      );
    });

    it("should not exceed max media limit per tweet", () => {
      const postWithMedia: CanonicalPost = {
        id: "test-media-limit",
        projectId: "dev",
        locale: "es",
        body: "Test media distribution. ".repeat(10),
        tags: [],
        media: [
          { id: "m1", type: "image", url: "https://example.com/1.jpg", w: 1200, h: 800 },
          { id: "m2", type: "image", url: "https://example.com/2.jpg", w: 1200, h: 800 },
          { id: "m3", type: "image", url: "https://example.com/3.jpg", w: 1200, h: 800 },
          { id: "m4", type: "image", url: "https://example.com/4.jpg", w: 1200, h: 800 },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = planThread(postWithMedia, "AUTO");
      assert.ok(result.ok);

      // No tweet should exceed max media limit (4 for X)
      for (const tweet of result.value.tweets) {
        if (tweet.media) {
          assert.ok(
            tweet.media.length <= 4,
            `Tweet ${tweet.sequence} has ${tweet.media.length} media items, exceeding limit of 4`
          );
        }
      }
    });
  });

  describe("Threading Strategies", () => {
    it("should force single tweet with SINGLE strategy", () => {
      const longPost: CanonicalPost = {
        id: "test-single-strategy",
        projectId: "dev",
        locale: "es",
        body: longBody,
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = planThread(longPost, "SINGLE");

      assert.ok(
        result.ok,
        `Expected planThread to succeed for SINGLE strategy: ${result.ok ? "" : result.error}`
      );
      assert.strictEqual(
        result.value.needsThreading,
        false,
        "SINGLE strategy should not need threading"
      );
      assert.strictEqual(
        result.value.tweets.length,
        1,
        `SINGLE strategy should produce 1 tweet, got ${result.value.tweets.length}`
      );
    });

    it("should respect AUTO strategy for long content", () => {
      const longPost: CanonicalPost = {
        id: "test-auto-strategy",
        projectId: "dev",
        locale: "es",
        body: longBody,
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = planThread(longPost, "AUTO");

      assert.ok(result.ok);
      assert.strictEqual(
        result.value.needsThreading,
        true,
        "AUTO strategy should detect threading need"
      );
      assert.ok(result.value.tweets.length > 1, "AUTO strategy should create multiple tweets");
    });
  });

  describe("Character Limits", () => {
    it("should respect 280 character limit per tweet", () => {
      const longPost: CanonicalPost = {
        id: "test-char-limit",
        projectId: "dev",
        locale: "es",
        body: longBody,
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = planThread(longPost, "AUTO");
      assert.ok(result.ok);

      for (const tweet of result.value.tweets) {
        assert.ok(
          tweet.text.length <= 280,
          `Tweet ${tweet.sequence} exceeds 280 characters: ${tweet.text.length}`
        );
        assert.ok(
          tweet.estimatedChars <= 280,
          `Tweet ${tweet.sequence} estimated chars exceeds limit: ${tweet.estimatedChars}`
        );
      }
    });

    it("should handle content at character boundary", () => {
      const boundaryContent = "a".repeat(280);
      const boundaryPost: CanonicalPost = {
        id: "test-boundary",
        projectId: "dev",
        locale: "es",
        body: boundaryContent,
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = planThread(boundaryPost, "AUTO");
      assert.ok(result.ok);

      // Should need threading because thread indicators take space
      assert.strictEqual(
        result.value.needsThreading,
        true,
        "280 char content should need threading due to indicators"
      );
    });

    it("should account for thread indicators in character count", () => {
      const longPost: CanonicalPost = {
        id: "test-indicator-chars",
        projectId: "dev",
        locale: "es",
        body: longBody,
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = planThread(longPost, "AUTO");
      assert.ok(result.ok);

      const totalTweets = result.value.tweets.length;
      const _indicatorLength = `${totalTweets}/${totalTweets} `.length;

      for (const tweet of result.value.tweets) {
        // Text should include the indicator
        assert.ok(
          tweet.text.startsWith(`${tweet.sequence}/${totalTweets} `),
          "Tweet should start with indicator"
        );

        // Estimated chars should account for everything
        assert.ok(
          tweet.estimatedChars <= 280,
          `Tweet ${tweet.sequence} estimated chars should be within limit`
        );
      }
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty body gracefully", () => {
      const emptyPost: CanonicalPost = {
        id: "test-empty",
        projectId: "dev",
        locale: "es",
        body: "",
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = planThread(emptyPost, "AUTO");

      // Should either succeed with empty tweet or fail gracefully
      if (result.ok) {
        assert.ok(result.value.tweets.length >= 1, "Should have at least one tweet");
      } else {
        assert.ok(result.error, "Should have error message for empty body");
      }
    });

    it("should handle special characters correctly", () => {
      const specialCharsPost: CanonicalPost = {
        id: "test-special",
        projectId: "dev",
        locale: "es",
        body: "Testing special chars: 你好世界 🌍 @user #hashtag https://example.com",
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = planThread(specialCharsPost, "AUTO");

      assert.ok(result.ok, "Should handle special characters");
      assert.ok(result.value.tweets.length >= 1, "Should create at least one tweet");
    });

    it("should handle very long continuous words", () => {
      const longWordPost: CanonicalPost = {
        id: "test-long-word",
        projectId: "dev",
        locale: "es",
        body: "a".repeat(300), // Single very long "word"
        tags: [],
        media: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = planThread(longWordPost, "AUTO");

      assert.ok(result.ok, "Should handle long continuous words");
      assert.ok(result.value.needsThreading, "Should need threading for long word");
    });
  });
});
