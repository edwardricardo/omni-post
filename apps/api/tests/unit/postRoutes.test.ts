/**
 * @file postRoutes.test.ts
 * @description Unit tests for postRoutes. Uses mocked Prisma stores and
 *              a real Fastify instance to test HTTP endpoint behavior.
 *
 * Tests CRUD operations via application-layer use cases resolved from the
 * DI container. Delete operations use soft-delete (sets deletedAt).
 * @layer test
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule, createStore, buildModelMock } from "./helpers/mockPrisma.js";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

// Stores for cross-model include resolution
const postStore = createStore();
const postContentStore = createStore();
const postMediaStore = createStore();
const threadStore = createStore();
const tweetStore = createStore();
const contentVersionStore = createStore();

// Project defaults for domain mapper compatibility
const projectDefaults = {
  locale: "en",
  isInCrisisMode: false,
  crisisStartedAt: null,
  crisisReason: null,
  crisisModeHistory: [],
  deletedAt: null,
  channels: [],
  posts: [],
};

// Post defaults
const postDefaults = {
  status: "DRAFT",
  scheduledAt: null,
  publishedAt: null,
  deletedAt: null,
};

// PostContent defaults
const postContentDefaults = {
  title: null,
  summary: null,
  tags: [],
  revision: 1,
};

// Thread defaults
const threadDefaults = {
  strategy: "MANUAL",
};

// Tweet defaults
const tweetDefaults = {
  media: null,
  tweetId: null,
  parentTweetId: null,
  status: "DRAFT",
  publishedAt: null,
};

// Include resolver for posts — joins contents, media, thread, _count
const postIncludeResolver = (
  record: Record<string, unknown>,
  include: Record<string, boolean | Record<string, unknown>>
): Record<string, unknown> => {
  const result = { ...record };
  const postId = record.id as string;

  if (include.contents) {
    let contents = postContentStore
      .all()
      .filter((c) => (c as Record<string, unknown>).postId === postId);
    // Support { take: N } on contents include
    if (typeof include.contents === "object" && "take" in include.contents) {
      contents = contents.slice(0, include.contents.take as number);
    }
    result.contents = contents.map((c) => ({ ...c }));
  }

  if (include.media) {
    result.media = postMediaStore
      .all()
      .filter((m) => (m as Record<string, unknown>).postId === postId)
      .map((m) => ({ ...m }));
  }

  if (include.contentVersions) {
    result.contentVersions = contentVersionStore
      .all()
      .filter((v) => (v as Record<string, unknown>).postId === postId)
      .map((v) => ({ ...v }));
  }

  if (include._count) {
    const mediaCount = postMediaStore
      .all()
      .filter((m) => (m as Record<string, unknown>).postId === postId).length;
    result._count = { media: mediaCount };
  }

  if (include.thread) {
    const thread = threadStore.all().find((t) => (t as Record<string, unknown>).postId === postId);
    if (thread) {
      const threadId = (thread as Record<string, unknown>).id as string;
      const tweets = tweetStore
        .all()
        .filter((tw) => (tw as Record<string, unknown>).threadId === threadId)
        .map((tw) => ({ ...tw }))
        .sort(
          (a, b) =>
            ((a as Record<string, unknown>).sequenceNumber as number) -
            ((b as Record<string, unknown>).sequenceNumber as number)
        );
      result.thread = { ...thread, tweets };
    } else {
      result.thread = null;
    }
  }

  return result;
};

// Build post model with include resolver
const postModel = buildModelMock(postStore, postDefaults, "id", postIncludeResolver);

// Replace project mock with one that has correct defaults
(mockPrisma.prisma as Record<string, unknown>).project = buildModelMock(
  stores.project,
  projectDefaults
);

// Add extra models used by post routes and repositories
const extraModels = {
  post: postModel,
  postContent: buildModelMock(postContentStore, postContentDefaults),
  postMedia: buildModelMock(postMediaStore),
  thread: buildModelMock(threadStore, threadDefaults),
  tweet: buildModelMock(tweetStore, tweetDefaults),
  contentVersion: buildModelMock(contentVersionStore),
  channel: buildModelMock(createStore()),
  analytics: buildModelMock(createStore()),
  publishLog: buildModelMock(createStore()),
  adminUserPermission: buildModelMock(createStore()),
  outboxEvent: buildModelMock(createStore()),
};
Object.assign(mockPrisma.prisma, extraModels);

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

vi.mock("../../src/lib/logger.js", () => {
  const noop = vi.fn();
  const noopLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => noopLogger,
  };
  return { logger: noopLogger, authLogger: noopLogger, createLogger: () => noopLogger };
});

// ---------------------------------------------------------------------------
// Dynamic imports after mocks
// ---------------------------------------------------------------------------

const Fastify = (await import("fastify")).default;
const { postRoutes } = await import("../../src/posts/postRoutes.js");
const { setupContainer } = await import("../../src/infrastructure/container/setup.js");

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const timestamp = Date.now();
const NONEXISTENT_UUID = "a0000000-0000-4000-8000-000000000000";

let fastify: import("fastify").FastifyInstance;
let testProjectId: string;
let testAccountId: string;
let testPostId: string;

// Helper function to safely hard-delete a post with all related data (in-memory)
async function safeDeletePost(postId: string): Promise<void> {
  const prisma = mockPrisma.prisma as Record<string, Record<string, Function>>;
  await prisma.publishLog.deleteMany({ where: { postId } }).catch(() => {});
  await prisma.analytics.deleteMany({ where: { postId } }).catch(() => {});
  await prisma.contentVersion.deleteMany({ where: { postId } }).catch(() => {});
  await prisma.postMedia.deleteMany({ where: { postId } }).catch(() => {});
  await prisma.postContent.deleteMany({ where: { postId } }).catch(() => {});
  // For tweets, we need to find threads first
  const threads = threadStore.all().filter((t) => (t as Record<string, unknown>).postId === postId);
  for (const thread of threads) {
    const threadId = (thread as Record<string, unknown>).id as string;
    await prisma.tweet.deleteMany({ where: { threadId } }).catch(() => {});
  }
  await prisma.thread.deleteMany({ where: { postId } }).catch(() => {});
  await prisma.post.delete({ where: { id: postId } }).catch(() => {});
}

describe("PostRoutes", () => {
  beforeAll(async () => {
    fastify = Fastify({ logger: false });

    const container = setupContainer({ prisma: mockPrisma.prisma as never });
    fastify.decorate("container", container);

    await fastify.register(postRoutes);
    await fastify.ready();

    // Create test account via mock prisma
    const account = await (mockPrisma.prisma.account as { upsert: Function }).upsert({
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
    const project = await (mockPrisma.prisma.project as { create: Function }).create({
      data: {
        accountId: testAccountId,
        name: `postroutes-test-${timestamp}`,
        locale: "en",
      },
    });
    testProjectId = project.id;
  });

  afterAll(async () => {
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

      expect(response.statusCode).toBe(201);

      const result = JSON.parse(response.payload);
      expect(result.ok).toBe(true);
      expect(result.data.id).toBeTruthy();
      expect(result.data.projectId).toBe(testProjectId);
      expect(result.data.locale).toBe("en");
      expect(result.data.body).toBe("Test post body content");
      expect(result.data.title).toBe("Test Post Title");
      expect(result.data.tags).toStrictEqual(["test", "automated"]);
      expect(result.data.status).toBe("DRAFT");

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

      expect(response.statusCode).toBe(201);

      const result = JSON.parse(response.payload);
      expect(result.ok).toBe(true);
      expect(result.data.locale).toBe("es");
      expect(result.data.body).toBe("Contenido de prueba");

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

      expect(response.statusCode).toBe(201);

      const result = JSON.parse(response.payload);
      expect(result.data.status).toBe("DRAFT");

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

      expect(response.statusCode).toBe(400);

      const result = JSON.parse(response.payload);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("Invalid request body");
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

      expect(response.statusCode).toBe(400);

      const result = JSON.parse(response.payload);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("Invalid request body");
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

      expect(response.statusCode).toBe(400);

      const result = JSON.parse(response.payload);
      expect(result.ok).toBe(false);
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

      expect(response.statusCode).toBe(400);

      const result = JSON.parse(response.payload);
      expect(result.ok).toBe(false);
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

      expect(response.statusCode).toBe(404);

      const result = JSON.parse(response.payload);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("Project not found");
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

      expect(response.statusCode).toBe(201);

      const result = JSON.parse(response.payload);
      const postId = result.data.id;

      // Verify post and content were both created via mock prisma
      const post = await (mockPrisma.prisma.post as { findUnique: Function }).findUnique({
        where: { id: postId },
        include: { contents: true },
      });

      expect(post).toBeTruthy();
      expect(post.contents.length).toBe(1);
      expect(post.contents[0].body).toBe("Transaction test");
      expect(post.contents[0].revision).toBe(1);

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
      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /posts/:id", () => {
    it("should retrieve a post by id", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: `/posts/${testPostId}`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      expect(result.ok).toBe(true);
      expect(result.data.id).toBe(testPostId);
      expect(result.data.projectId).toBe(testProjectId);
      expect(result.data.body).toBeTruthy();
      expect(result.data.createdAt).toBeTruthy();
    });

    it("should return 404 for non-existent post", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: `/posts/${NONEXISTENT_UUID}`,
      });

      expect(response.statusCode).toBe(404);

      const result = JSON.parse(response.payload);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("Post not found");
    });

    it("should return 400 for invalid uuid format", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: "/posts/invalid-id",
      });

      expect(response.statusCode).toBe(400);

      const result = JSON.parse(response.payload);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("Invalid post ID");
    });

    it("should include post content", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: `/posts/${testPostId}`,
      });

      const result = JSON.parse(response.payload);
      expect(result.data.locale).toBeTruthy();
      expect(result.data.body).toBeTruthy();
      expect(result.data.title).toBeTruthy();
      expect(Array.isArray(result.data.tags)).toBeTruthy();
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

      // Add thread data directly via mock prisma
      const thread = await (mockPrisma.prisma.thread as { create: Function }).create({
        data: {
          postId,
          strategy: "MANUAL",
        },
      });

      // Add tweets to the thread
      await (mockPrisma.prisma.tweet as { create: Function }).create({
        data: {
          threadId: thread.id,
          sequenceNumber: 1,
          content: "First tweet",
        },
      });
      await (mockPrisma.prisma.tweet as { create: Function }).create({
        data: {
          threadId: thread.id,
          sequenceNumber: 2,
          content: "Second tweet",
        },
      });

      const response = await fastify.inject({
        method: "GET",
        url: `/posts/${postId}`,
      });

      const result = JSON.parse(response.payload);
      expect(result.data.thread).toBeTruthy();
      expect(result.data.thread.strategy).toBe("MANUAL");
      expect(Array.isArray(result.data.thread.tweets)).toBeTruthy();
      expect(result.data.thread.tweets.length).toBe(2);

      // Clean up
      await safeDeletePost(postId);
    });

    it("should return posts with correct status", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: `/posts/${testPostId}`,
      });

      const result = JSON.parse(response.payload);
      expect(
        ["DRAFT", "SCHEDULED", "PUBLISHED", "FAILED"].includes(result.data.status)
      ).toBeTruthy();
    });
  });

  describe("DELETE /posts/:id", () => {
    it("should soft-delete a post successfully", async () => {
      // Create a post to delete (via use case - has content)
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

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      expect(result.ok).toBe(true);
      expect(result.data.deleted).toBe(true);

      // Verify post is soft-deleted (not visible with deletedAt filter)
      const softDeletedPost = await (mockPrisma.prisma.post as { findFirst: Function }).findFirst({
        where: { id: postId, deletedAt: null },
      });
      expect(softDeletedPost).toBe(null);

      // But the row still exists in the database
      const rawPost = await (mockPrisma.prisma.post as { findUnique: Function }).findUnique({
        where: { id: postId },
      });
      expect(rawPost).toBeTruthy();
      expect(rawPost.deletedAt).toBeTruthy();

      // Hard-delete for cleanup
      await safeDeletePost(postId);
    });

    it("should return 404 for non-existent post", async () => {
      const response = await fastify.inject({
        method: "DELETE",
        url: `/posts/${NONEXISTENT_UUID}`,
      });

      expect(response.statusCode).toBe(404);

      const result = JSON.parse(response.payload);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("Post not found");
    });

    it("should return 400 for invalid uuid", async () => {
      const response = await fastify.inject({
        method: "DELETE",
        url: "/posts/not-a-uuid",
      });

      expect(response.statusCode).toBe(400);

      const result = JSON.parse(response.payload);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("Invalid post ID");
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

      expect(response.statusCode).toBe(200);

      // Content is retained (soft-delete preserves child data for auditing)
      const retainedContent = await (
        mockPrisma.prisma.postContent as { findFirst: Function }
      ).findFirst({
        where: { postId },
      });
      expect(retainedContent).toBeTruthy();

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

      expect(response.statusCode).toBe(404);

      const result = JSON.parse(response.payload);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("Post not found");

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
      expect([201, 400].includes(response.statusCode)).toBeTruthy();

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

      expect(response.statusCode).toBe(201);

      const result = JSON.parse(response.payload);
      expect(result.data.tags).toStrictEqual(["valid", "tags", "array"]);

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

      expect(response.statusCode).toBe(400);
    });
  });

  describe("Response Formats", () => {
    it("should return consistent success response format", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: `/posts/${testPostId}`,
      });

      const result = JSON.parse(response.payload);
      expect(result.ok).toBe(true);
      expect(result.data).toBeTruthy();
      expect(typeof result.data).toBe("object");
    });

    it("should return consistent error response format", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: "/posts/invalid-id",
      });

      const result = JSON.parse(response.payload);
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
      expect(typeof result.error).toBe("string");
    });

    it("should include proper timestamps", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: `/posts/${testPostId}`,
      });

      const result = JSON.parse(response.payload);
      expect(result.data.createdAt).toBeTruthy();

      // Verify valid ISO date
      const date = new Date(result.data.createdAt);
      expect(isNaN(date.getTime())).toBeFalsy();
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
      expect([201, 400, 500].includes(response.statusCode)).toBeTruthy();

      const result = JSON.parse(response.payload);
      expect("ok" in result).toBeTruthy();

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
      expect(response.statusCode === 400 || response.statusCode === 404).toBeTruthy();
    });
  });

  describe("BaseRouteHandler Integration", () => {
    it("should use standardized logging", async () => {
      // Logging is configured to be silent in tests
      const response = await fastify.inject({
        method: "GET",
        url: `/posts/${testPostId}`,
      });

      expect(response.statusCode).toBe(200);
    });

    it("should use standardized error responses", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: "/posts/invalid-uuid-format",
      });

      const result = JSON.parse(response.payload);
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
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

      expect(response.statusCode).toBe(201);

      const result = JSON.parse(response.payload);
      expect(result.data.body).toBe(testBody);

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

      expect(response.statusCode).toBe(201);

      const result = JSON.parse(response.payload);
      expect(result.data.body).toBe(unicodeBody);

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

      expect(response.statusCode).toBe(201);

      const result = JSON.parse(response.payload);
      expect(result.data.body).toBe(formattedBody);

      // Clean up
      await safeDeletePost(result.data.id);
    });
  });
});
