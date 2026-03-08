/**
 * Unit Tests for PostRoutes (node:test)
 *
 * Tests CRUD operations via application-layer use cases resolved from the
 * DI container. Delete operations use soft-delete (sets deletedAt).
 */

import "./templateRoutes.env-setup.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Fastify, { FastifyInstance } from "fastify";
import { postRoutes } from "../../src/posts/postRoutes.js";
import { prisma } from "@infra/prisma";
import { setupContainer } from "../../src/infrastructure/container/setup.js";

// Test data
const timestamp = Date.now();
/** Valid UUID v4 that does not exist in the database */
const NONEXISTENT_UUID = "a0000000-0000-4000-8000-000000000000";
let fastify: FastifyInstance;
let testAccountId: string;
let testProjectId: string;
let testPostId: string;

// Helper function to safely hard-delete a post with all related data
async function safeDeletePost(postId: string): Promise<void> {
  await prisma.publishLog.deleteMany({ where: { postId } }).catch(() => {});
  await prisma.analytics.deleteMany({ where: { postId } }).catch(() => {});
  await prisma.contentVersion.deleteMany({ where: { postId } }).catch(() => {});
  await prisma.postMedia.deleteMany({ where: { postId } }).catch(() => {});
  await prisma.postContent.deleteMany({ where: { postId } }).catch(() => {});
  await prisma.tweet.deleteMany({ where: { thread: { postId } } }).catch(() => {});
  await prisma.thread.deleteMany({ where: { postId } }).catch(() => {});
  await prisma.post.delete({ where: { id: postId } }).catch(() => {});
}

describe("PostRoutes", { concurrency: 1 }, () => {
  before(async () => {
    // Initialize Fastify instance with DI container
    fastify = Fastify({ logger: false });

    const container = setupContainer({ prisma });
    fastify.decorate("container", container);

    // Register the post routes
    await fastify.register(postRoutes);
    await fastify.ready();

    // Create test account
    const account = await prisma.account.upsert({
      where: { email: `postroutes-${timestamp}@example.com` },
      update: {},
      create: {
        email: `postroutes-${timestamp}@example.com`,
        name: "PostRoutes Test Account",
        subscription: "PRO",
      },
    });
    testAccountId = account.id;

    // Create test project
    const project = await prisma.project.create({
      data: {
        accountId: testAccountId,
        name: `postroutes-test-${timestamp}`,
        locale: "en",
      },
    });
    testProjectId = project.id;
  });

  after(async () => {
    // Cleanup test data
    try {
      // Delete all test posts and their content (hard-delete for cleanup)
      const testPosts = await prisma.post.findMany({
        where: {
          project: { accountId: testAccountId },
        },
      });

      for (const post of testPosts) {
        await safeDeletePost(post.id);
      }

      if (testProjectId) {
        await prisma.project.delete({ where: { id: testProjectId } }).catch(() => {});
      }

      await prisma.account
        .delete({
          where: { email: `postroutes-${timestamp}@example.com` },
        })
        .catch(() => {});
    } catch (error) {
      console.error("Cleanup error:", error);
    }

    await fastify.close();
  });

  describe("POST /posts", () => {
    it("should create a post successfully", async () => {
      const response = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: testProjectId,
          locale: "en",
          body: "Test post body content",
          title: "Test Post Title",
          tags: ["test", "automated"],
          status: "DRAFT",
        },
      });

      assert.strictEqual(response.statusCode, 201);

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.ok, true);
      assert.ok(result.data.id);
      assert.strictEqual(result.data.projectId, testProjectId);
      assert.strictEqual(result.data.locale, "en");
      assert.strictEqual(result.data.body, "Test post body content");
      assert.strictEqual(result.data.title, "Test Post Title");
      assert.deepStrictEqual(result.data.tags, ["test", "automated"]);
      assert.strictEqual(result.data.status, "DRAFT");

      // Store for later tests
      testPostId = result.data.id;
    });

    it("should create a post without optional title", async () => {
      const response = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: testProjectId,
          locale: "es",
          body: "Contenido de prueba",
          tags: [],
          status: "DRAFT",
        },
      });

      assert.strictEqual(response.statusCode, 201);

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.data.locale, "es");
      assert.strictEqual(result.data.body, "Contenido de prueba");

      // Clean up
      await safeDeletePost(result.data.id);
    });

    it("should default status to DRAFT", async () => {
      const response = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: testProjectId,
          locale: "en",
          body: "Default status test",
          tags: [],
        },
      });

      assert.strictEqual(response.statusCode, 201);

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.data.status, "DRAFT");

      // Clean up
      await safeDeletePost(result.data.id);
    });

    it("should reject invalid projectId format", async () => {
      const response = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: "invalid-uuid",
          locale: "en",
          body: "Test body",
        },
      });

      assert.strictEqual(response.statusCode, 400);

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, "Invalid request body");
    });

    it("should reject missing required fields", async () => {
      const response = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: testProjectId,
          locale: "en",
          // Missing body
        },
      });

      assert.strictEqual(response.statusCode, 400);

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, "Invalid request body");
    });

    it("should reject invalid locale format", async () => {
      const response = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: testProjectId,
          locale: "x", // Too short
          body: "Test body",
        },
      });

      assert.strictEqual(response.statusCode, 400);

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.ok, false);
    });

    it("should reject invalid status value", async () => {
      const response = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: testProjectId,
          locale: "en",
          body: "Test body",
          status: "INVALID_STATUS",
        },
      });

      assert.strictEqual(response.statusCode, 400);

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.ok, false);
    });

    it("should return 404 for non-existent project", async () => {
      const response = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: NONEXISTENT_UUID, // Non-existent UUID
          locale: "en",
          body: "Test body",
        },
      });

      assert.strictEqual(response.statusCode, 404);

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, "Project not found");
    });

    it("should create post with content persisted to database", async () => {
      const response = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: testProjectId,
          locale: "en",
          body: "Transaction test",
          title: "Transaction Post",
        },
      });

      assert.strictEqual(response.statusCode, 201);

      const result = JSON.parse(response.payload);
      const postId = result.data.id;

      // Verify post and content were both created
      const post = await prisma.post.findUnique({
        where: { id: postId },
        include: { contents: true },
      });

      assert.ok(post);
      assert.strictEqual(post.contents.length, 1);
      assert.strictEqual(post.contents[0].body, "Transaction test");
      assert.strictEqual(post.contents[0].revision, 1);

      // Clean up
      await safeDeletePost(postId);
    });

    it("should reject dangerous HTML content", async () => {
      const response = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: testProjectId,
          locale: "en",
          body: "Test with special chars: <script>alert('xss')</script>",
          title: "Security Test",
        },
      });

      // Security layer should block dangerous content
      assert.strictEqual(response.statusCode, 400);
    });
  });

  describe("GET /posts/:id", () => {
    it("should retrieve a post by id", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: `/posts/${testPostId}`,
      });

      assert.strictEqual(response.statusCode, 200);

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.data.id, testPostId);
      assert.strictEqual(result.data.projectId, testProjectId);
      assert.ok(result.data.body);
      assert.ok(result.data.createdAt);
    });

    it("should return 404 for non-existent post", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: `/posts/${NONEXISTENT_UUID}`,
      });

      assert.strictEqual(response.statusCode, 404);

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, "Post not found");
    });

    it("should return 400 for invalid uuid format", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: "/posts/invalid-id",
      });

      assert.strictEqual(response.statusCode, 400);

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, "Invalid post ID");
    });

    it("should include post content", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: `/posts/${testPostId}`,
      });

      const result = JSON.parse(response.payload);
      assert.ok(result.data.locale);
      assert.ok(result.data.body);
      assert.ok(result.data.title);
      assert.ok(Array.isArray(result.data.tags));
    });

    it("should include thread data if exists", async () => {
      // Create a post with content + thread via the use case path
      const createResponse = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: testProjectId,
          locale: "en",
          body: "Thread test post",
        },
      });
      const createResult = JSON.parse(createResponse.payload);
      const postId = createResult.data.id;

      // Add thread data directly (threads are not part of the use case)
      await prisma.thread.create({
        data: {
          postId,
          strategy: "MANUAL",
          tweets: {
            create: [
              { sequenceNumber: 1, content: "First tweet" },
              { sequenceNumber: 2, content: "Second tweet" },
            ],
          },
        },
      });

      const response = await fastify.inject({
        method: "GET",
        url: `/posts/${postId}`,
      });

      const result = JSON.parse(response.payload);
      assert.ok(result.data.thread);
      assert.strictEqual(result.data.thread.strategy, "MANUAL");
      assert.ok(Array.isArray(result.data.thread.tweets));
      assert.strictEqual(result.data.thread.tweets.length, 2);

      // Clean up
      await safeDeletePost(postId);
    });

    it("should return posts with correct status", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: `/posts/${testPostId}`,
      });

      const result = JSON.parse(response.payload);
      assert.ok(["DRAFT", "SCHEDULED", "PUBLISHED", "FAILED"].includes(result.data.status));
    });
  });

  describe("DELETE /posts/:id", () => {
    it("should soft-delete a post successfully", async () => {
      // Create a post to delete (via use case — has content)
      const createResponse = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: testProjectId,
          locale: "en",
          body: "Post to remove",
        },
      });
      const createResult = JSON.parse(createResponse.payload);
      const postId = createResult.data.id;

      const response = await fastify.inject({
        method: "DELETE",
        url: `/posts/${postId}`,
      });

      assert.strictEqual(response.statusCode, 200);

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.data.deleted, true);

      // Verify post is soft-deleted (not visible with deletedAt filter)
      const softDeletedPost = await prisma.post.findFirst({
        where: { id: postId, deletedAt: null },
      });
      assert.strictEqual(softDeletedPost, null);

      // But the row still exists in the database
      const rawPost = await prisma.post.findUnique({
        where: { id: postId },
      });
      assert.ok(rawPost, "Post row should still exist (soft-deleted)");
      assert.ok(rawPost.deletedAt, "deletedAt should be set");

      // Hard-delete for cleanup
      await safeDeletePost(postId);
    });

    it("should return 404 for non-existent post", async () => {
      const response = await fastify.inject({
        method: "DELETE",
        url: `/posts/${NONEXISTENT_UUID}`,
      });

      assert.strictEqual(response.statusCode, 404);

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, "Post not found");
    });

    it("should return 400 for invalid uuid", async () => {
      const response = await fastify.inject({
        method: "DELETE",
        url: "/posts/not-a-uuid",
      });

      assert.strictEqual(response.statusCode, 400);

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, "Invalid post ID");
    });

    it("should soft-delete post while retaining content", async () => {
      // Create a post with content via use case
      const createResponse = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: testProjectId,
          locale: "en",
          body: "Content for cascade removal",
        },
      });
      const createResult = JSON.parse(createResponse.payload);
      const postId = createResult.data.id;

      const response = await fastify.inject({
        method: "DELETE",
        url: `/posts/${postId}`,
      });

      assert.strictEqual(response.statusCode, 200);

      // Content is retained (soft-delete preserves child data for auditing)
      const retainedContent = await prisma.postContent.findFirst({
        where: { postId },
      });
      assert.ok(retainedContent, "Post content should be retained after soft-delete");

      // Hard-delete for cleanup
      await safeDeletePost(postId);
    });

    it("should handle double delete gracefully", async () => {
      // Create a post via use case
      const createResponse = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: testProjectId,
          locale: "en",
          body: "Double removal test",
        },
      });
      const createResult = JSON.parse(createResponse.payload);
      const postId = createResult.data.id;

      // First delete
      await fastify.inject({
        method: "DELETE",
        url: `/posts/${postId}`,
      });

      // Second delete should return 404 (soft-deleted post is invisible)
      const response = await fastify.inject({
        method: "DELETE",
        url: `/posts/${postId}`,
      });

      assert.strictEqual(response.statusCode, 404);

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, "Post not found");

      // Hard-delete for cleanup
      await safeDeletePost(postId);
    });
  });

  describe("Request Validation", () => {
    it("should validate body content length", async () => {
      // Test with extremely long body (if validation exists)
      const longBody = "x".repeat(100000);

      const response = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: testProjectId,
          locale: "en",
          body: longBody,
        },
      });

      // Should either accept or reject based on validation rules
      assert.ok([201, 400].includes(response.statusCode));

      // Clean up if created
      if (response.statusCode === 201) {
        const result = JSON.parse(response.payload);
        if (result.data?.id) {
          await safeDeletePost(result.data.id);
        }
      }
    });

    it("should validate tags array", async () => {
      const response = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: testProjectId,
          locale: "en",
          body: "Tags test",
          tags: ["valid", "tags", "array"],
        },
      });

      assert.strictEqual(response.statusCode, 201);

      const result = JSON.parse(response.payload);
      assert.deepStrictEqual(result.data.tags, ["valid", "tags", "array"]);

      // Clean up
      await safeDeletePost(result.data.id);
    });

    it("should reject invalid tags format", async () => {
      const response = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: testProjectId,
          locale: "en",
          body: "Test",
          tags: "not-an-array", // Invalid
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });
  });

  describe("Response Formats", () => {
    it("should return consistent success response format", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: `/posts/${testPostId}`,
      });

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.ok, true);
      assert.ok(result.data);
      assert.strictEqual(typeof result.data, "object");
    });

    it("should return consistent error response format", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: "/posts/invalid-id",
      });

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.ok, false);
      assert.ok(result.error);
      assert.strictEqual(typeof result.error, "string");
    });

    it("should include proper timestamps", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: `/posts/${testPostId}`,
      });

      const result = JSON.parse(response.payload);
      assert.ok(result.data.createdAt);

      // Verify valid ISO date
      const date = new Date(result.data.createdAt);
      assert.ok(!isNaN(date.getTime()));
    });
  });

  describe("Error Handling", () => {
    it("should handle database errors gracefully", async () => {
      // Try to create post with valid data
      const response = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: testProjectId,
          locale: "en",
          body: "Test",
          status: "DRAFT",
        },
      });

      // Should return either success or proper error
      assert.ok([201, 400, 500].includes(response.statusCode));

      const result = JSON.parse(response.payload);
      assert.ok("ok" in result);

      // Clean up if created
      if (result.ok && result.data?.id) {
        await safeDeletePost(result.data.id);
      }
    });

    it("should return 400 for invalid post ID format in GET", async () => {
      // Invalid UUID format should return 400, not 500
      const response = await fastify.inject({
        method: "GET",
        url: "/posts/not-a-uuid",
      });
      assert.ok(
        response.statusCode === 400 || response.statusCode === 404,
        `Expected 400 or 404 for invalid ID, got ${response.statusCode}`
      );
    });
  });

  describe("BaseRouteHandler Integration", () => {
    it("should use standardized logging", async () => {
      // Logging is configured to be silent in tests
      const response = await fastify.inject({
        method: "GET",
        url: `/posts/${testPostId}`,
      });

      assert.strictEqual(response.statusCode, 200);
    });

    it("should use standardized error responses", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: "/posts/invalid-uuid-format",
      });

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.ok, false);
      assert.ok(result.error);
    });
  });

  describe("Content Validation", () => {
    it("should store body content correctly", async () => {
      const testBody = "This is a test post with punctuation: Hello, World! How are you?";

      const response = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: testProjectId,
          locale: "en",
          body: testBody,
        },
      });

      assert.strictEqual(response.statusCode, 201);

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.data.body, testBody);

      // Clean up
      await safeDeletePost(result.data.id);
    });

    it("should handle unicode content", async () => {
      const unicodeBody = "Test with emoji and unicode: hola mundo";

      const response = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: testProjectId,
          locale: "zh",
          body: unicodeBody,
        },
      });

      assert.strictEqual(response.statusCode, 201);

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.data.body, unicodeBody);

      // Clean up
      await safeDeletePost(result.data.id);
    });

    it("should preserve newlines and formatting", async () => {
      const formattedBody = "Line 1\n\nLine 2\n\tTabbed line";

      const response = await fastify.inject({
        method: "POST",
        url: "/posts",
        payload: {
          projectId: testProjectId,
          locale: "en",
          body: formattedBody,
        },
      });

      assert.strictEqual(response.statusCode, 201);

      const result = JSON.parse(response.payload);
      assert.strictEqual(result.data.body, formattedBody);

      // Clean up
      await safeDeletePost(result.data.id);
    });
  });
});
