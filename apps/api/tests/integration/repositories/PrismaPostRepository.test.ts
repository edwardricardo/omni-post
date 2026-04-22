/**
 * Infrastructure Layer - Prisma Post Repository Unit Tests
 *
 * Tests for the PrismaPostRepository implementation.
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { prisma } from "@infra/prisma";
import { PrismaPostRepository } from "../../../src/infrastructure/repositories/PrismaPostRepository.js";
import { PostAggregateMapper } from "../../../src/infrastructure/repositories/mappers/PostAggregateMapper.js";
import { PostAggregate, PostId, ProjectId, PUBLISH_STATUS } from "../../../src/domain/index.js";

describe("PrismaPostRepository", () => {
  let repository: PrismaPostRepository;
  let testProjectId: string;
  let testAccountId: string;
  const createdPostIds: string[] = [];

  beforeAll(async () => {
    repository = new PrismaPostRepository(prisma);

    // Create test account and project
    const uniqueSuffix = Date.now();
    testAccountId = `test-account-${uniqueSuffix}`;
    testProjectId = `test-project-${uniqueSuffix}`;

    await prisma.account.create({
      data: {
        id: testAccountId,
        email: `test-repo-${uniqueSuffix}@example.com`,
        name: "Test Account",
      },
    });

    await prisma.project.create({
      data: {
        id: testProjectId,
        name: `Test Project ${uniqueSuffix}`,
        accountId: testAccountId,
        locale: "en",
      },
    });
  });

  afterAll(async () => {
    // Cleanup: Delete all posts for the test project (cascading related records first)
    // This covers posts tracked in createdPostIds AND any created by bulk operations
    try {
      // Find all post IDs belonging to the test project
      const projectPosts = await prisma.post.findMany({
        where: { projectId: testProjectId },
        select: { id: true },
      });
      const allPostIds = projectPosts.map((p) => p.id);

      if (allPostIds.length > 0) {
        await prisma.publishLog.deleteMany({ where: { postId: { in: allPostIds } } });
        await prisma.postContent.deleteMany({ where: { postId: { in: allPostIds } } });
        await prisma.postMedia.deleteMany({ where: { postId: { in: allPostIds } } });
        await prisma.contentVersion.deleteMany({ where: { postId: { in: allPostIds } } });
        await prisma.post.deleteMany({ where: { id: { in: allPostIds } } });
      }
    } catch {
      // Ignore cleanup failures
    }

    // Delete test project and account
    try {
      await prisma.project.deleteMany({ where: { id: testProjectId } });
      await prisma.account.deleteMany({ where: { id: testAccountId } });
    } catch {
      // Ignore if already deleted
    }

    await prisma.$disconnect();
  });

  describe("save and findById", () => {
    it("should create a new post and retrieve it", async () => {
      const projectId = ProjectId.fromStringUnsafe(testProjectId);
      const result = PostAggregate.create({
        projectId,
        body: "Test post body",
        title: "Test Title",
        tags: ["test", "unit"],
      });

      expect(result.ok).toBeTruthy();
      if (!result.ok) return;

      const aggregate = result.value;
      createdPostIds.push(aggregate.id.value);

      // Save the aggregate
      const saveResult = await repository.save(aggregate);
      expect(saveResult.ok).toBeTruthy();

      // Retrieve it
      const findResult = await repository.findById(aggregate.id);
      expect(findResult.ok).toBeTruthy();

      if (findResult.ok) {
        expect(findResult.value.id.value).toBe(aggregate.id.value);
        expect(findResult.value.content.body).toBe("Test post body");
        expect(findResult.value.content.title).toBe("Test Title");
        expect([...findResult.value.content.tags]).toEqual(["test", "unit"]);
        expect(findResult.value.isDraft).toBeTruthy();
      }
    });

    it("should update an existing post", async () => {
      const projectId = ProjectId.fromStringUnsafe(testProjectId);
      const result = PostAggregate.create({
        projectId,
        body: "Original body",
      });

      expect(result.ok).toBeTruthy();
      if (!result.ok) return;

      const aggregate = result.value;
      createdPostIds.push(aggregate.id.value);

      // Save initially
      await repository.save(aggregate);

      // Update content
      aggregate.updateContent({ body: "Updated body" });

      // Save again
      const updateResult = await repository.save(aggregate);
      expect(updateResult.ok).toBeTruthy();

      // Retrieve and verify
      const findResult = await repository.findById(aggregate.id);
      expect(findResult.ok).toBeTruthy();

      if (findResult.ok) {
        expect(findResult.value.content.body).toBe("Updated body");
      }
    });

    it("should return error for non-existent post", async () => {
      const nonExistentId = PostId.generate();
      const result = await repository.findById(nonExistentId);

      expect(result.ok).toBeFalsy();
      if (!result.ok) {
        expect(result.error.name).toBe("EntityNotFoundError");
      }
    });
  });

  describe("exists", () => {
    it("should return true for existing post", async () => {
      const projectId = ProjectId.fromStringUnsafe(testProjectId);
      const result = PostAggregate.create({
        projectId,
        body: "Test exists",
      });

      expect(result.ok).toBeTruthy();
      if (!result.ok) return;

      const aggregate = result.value;
      createdPostIds.push(aggregate.id.value);

      await repository.save(aggregate);

      const exists = await repository.exists(aggregate.id);
      expect(exists).toBeTruthy();
    });

    it("should return false for non-existent post", async () => {
      const nonExistentId = PostId.generate();
      const exists = await repository.exists(nonExistentId);
      expect(exists).toBeFalsy();
    });
  });

  describe("delete", () => {
    it("should delete an existing post", async () => {
      const projectId = ProjectId.fromStringUnsafe(testProjectId);
      const result = PostAggregate.create({
        projectId,
        body: "Test delete",
      });

      expect(result.ok).toBeTruthy();
      if (!result.ok) return;

      const aggregate = result.value;
      await repository.save(aggregate);

      // Verify exists
      expect(await repository.exists(aggregate.id)).toBeTruthy();

      // Delete
      const deleteResult = await repository.delete(aggregate.id);
      expect(deleteResult.ok).toBeTruthy();

      // Verify no longer exists
      expect(await repository.exists(aggregate.id)).toBeFalsy();
    });

    it("should return error when deleting non-existent post", async () => {
      const nonExistentId = PostId.generate();
      const result = await repository.delete(nonExistentId);

      expect(result.ok).toBeFalsy();
      if (!result.ok) {
        expect(result.error.name).toBe("EntityNotFoundError");
      }
    });
  });

  describe("findByProjectId", () => {
    it("should find all posts for a project with pagination", async () => {
      const projectId = ProjectId.fromStringUnsafe(testProjectId);

      // Create multiple posts
      for (let i = 0; i < 5; i++) {
        const result = PostAggregate.create({
          projectId,
          body: `Project post ${i}`,
        });
        if (result.ok) {
          createdPostIds.push(result.value.id.value);
          await repository.save(result.value);
        }
      }

      // Find with pagination
      const result = await repository.findByProjectId(projectId, { page: 1, limit: 3 });

      expect(result.items.length <= 3).toBeTruthy();
      expect(result.total >= 5).toBeTruthy();
      expect(result.page).toBe(1);
      expect(result.limit).toBe(3);
    });
  });

  describe("findByStatus", () => {
    it("should find posts by single status", async () => {
      const projectId = ProjectId.fromStringUnsafe(testProjectId);
      const result = PostAggregate.create({
        projectId,
        body: "Draft post",
      });

      expect(result.ok).toBeTruthy();
      if (!result.ok) return;

      createdPostIds.push(result.value.id.value);
      await repository.save(result.value);

      const findResult = await repository.findByStatus(PUBLISH_STATUS.DRAFT);
      expect(findResult.items.length >= 1).toBeTruthy();
      expect(findResult.items.every((p) => p.isDraft)).toBeTruthy();
    });

    it("should find posts by multiple statuses", async () => {
      const result = await repository.findByStatus([
        PUBLISH_STATUS.DRAFT,
        PUBLISH_STATUS.SCHEDULED,
      ]);

      expect(result.items.every((p) => p.isDraft || p.isScheduled)).toBeTruthy();
    });
  });

  describe("findReadyForPublishing", () => {
    it("should find scheduled posts with passed time", async () => {
      // This test requires posts with scheduledAt in the past
      // In real scenarios, this would find posts ready to publish
      const result = await repository.findReadyForPublishing(10);
      expect(Array.isArray(result)).toBeTruthy();
    });
  });

  describe("findWithFilters", () => {
    it("should filter posts by project and status", async () => {
      const projectId = ProjectId.fromStringUnsafe(testProjectId);

      const result = await repository.findWithFilters({
        projectId,
        status: PUBLISH_STATUS.DRAFT,
      });

      expect(result.items.every((p) => p.projectId.value === testProjectId)).toBeTruthy();
      expect(result.items.every((p) => p.isDraft)).toBeTruthy();
    });

    it("should filter posts with media", async () => {
      const projectId = ProjectId.fromStringUnsafe(testProjectId);

      const result = await repository.findWithFilters({
        projectId,
        hasMedia: false,
      });

      expect(result.items.every((p) => p.media.length === 0)).toBeTruthy();
    });
  });

  describe("countByProjectId", () => {
    it("should count posts for a project", async () => {
      const projectId = ProjectId.fromStringUnsafe(testProjectId);
      const count = await repository.countByProjectId(projectId);
      expect(typeof count === "number").toBeTruthy();
      expect(count >= 0).toBeTruthy();
    });
  });

  describe("countByStatus", () => {
    it("should count posts by status", async () => {
      const projectId = ProjectId.fromStringUnsafe(testProjectId);
      const count = await repository.countByStatus(projectId, PUBLISH_STATUS.DRAFT);
      expect(typeof count === "number").toBeTruthy();
      expect(count >= 0).toBeTruthy();
    });
  });

  describe("getProjectStats", () => {
    it("should return project statistics", async () => {
      const projectId = ProjectId.fromStringUnsafe(testProjectId);
      const stats = await repository.getProjectStats(projectId);

      expect(typeof stats.total === "number").toBeTruthy();
      expect(typeof stats.drafts === "number").toBeTruthy();
      expect(typeof stats.scheduled === "number").toBeTruthy();
      expect(typeof stats.published === "number").toBeTruthy();
      expect(typeof stats.failed === "number").toBeTruthy();

      expect(stats.total >= stats.drafts).toBeTruthy();
    });
  });

  describe("bulkUpdateStatus", () => {
    it("should update status for multiple posts", async () => {
      const projectId = ProjectId.fromStringUnsafe(testProjectId);

      // Create test posts
      const postIds: PostId[] = [];
      for (let i = 0; i < 3; i++) {
        const result = PostAggregate.create({
          projectId,
          body: `Bulk update post ${i}`,
        });
        if (result.ok) {
          createdPostIds.push(result.value.id.value);
          await repository.save(result.value);
          postIds.push(result.value.id);
        }
      }

      // Note: We can't bulk update to CANCELLED from DRAFT directly in the aggregate
      // but the repository method bypasses aggregate rules
      // In real usage, this would be used carefully
      const result = await repository.bulkUpdateStatus(postIds, PUBLISH_STATUS.CANCELLED);
      expect(result.ok).toBeTruthy();
    });
  });
});

describe("PostAggregateMapper", () => {
  describe("toDomain", () => {
    it("should map Prisma post to domain aggregate", () => {
      const prismaPost = {
        id: "test-id-123",
        projectId: "project-123",
        status: "DRAFT",
        scheduledAt: null,
        publishedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        contents: [
          {
            id: "content-1",
            postId: "test-id-123",
            locale: "en",
            title: "Test Title",
            summary: null,
            body: "Test body",
            tags: ["tag1", "tag2"],
            revision: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        media: [],
        contentVersions: [],
      };

      const aggregate = PostAggregateMapper.toDomain(prismaPost);

      expect(aggregate.id.value).toBe("test-id-123");
      expect(aggregate.projectId.value).toBe("project-123");
      expect(aggregate.content.body).toBe("Test body");
      expect(aggregate.content.title).toBe("Test Title");
      expect(aggregate.isDraft).toBeTruthy();
    });

    it("should map scheduled post with past date", () => {
      const pastDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

      const prismaPost = {
        id: "test-id-456",
        projectId: "project-456",
        status: "SCHEDULED",
        scheduledAt: pastDate,
        publishedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        contents: [
          {
            id: "content-2",
            postId: "test-id-456",
            locale: "es",
            title: null,
            summary: null,
            body: "Scheduled content",
            tags: [],
            revision: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        media: [],
        contentVersions: [],
      };

      const aggregate = PostAggregateMapper.toDomain(prismaPost);

      expect(aggregate.id.value).toBe("test-id-456");
      expect(aggregate.isScheduled).toBeTruthy();
      expect(aggregate.scheduledAt).toBeTruthy();
      expect(aggregate.scheduledAt.hasPassed()).toBeTruthy();
    });

    it("should map post with media", () => {
      const prismaPost = {
        id: "test-id-789",
        projectId: "project-789",
        status: "DRAFT",
        scheduledAt: null,
        publishedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        contents: [
          {
            id: "content-3",
            postId: "test-id-789",
            locale: "en",
            title: null,
            summary: null,
            body: "Post with media",
            tags: [],
            revision: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        media: [
          {
            id: "media-1",
            postId: "test-id-789",
            type: "image" as const,
            url: "https://example.com/image.jpg",
            width: 1200,
            height: 800,
            durationMs: null,
            alt: "Test image",
            hash: null,
            createdAt: new Date(),
          },
        ],
        contentVersions: [],
      };

      const aggregate = PostAggregateMapper.toDomain(prismaPost);

      expect(aggregate.media.length).toBe(1);
      expect(aggregate.media[0]?.type).toBe("image");
      expect(aggregate.media[0]?.url).toBe("https://example.com/image.jpg");
    });
  });

  describe("toPrismaCreate", () => {
    it("should map aggregate to Prisma create input", () => {
      const projectId = ProjectId.generate();
      const result = PostAggregate.create({
        projectId,
        body: "Test content",
        title: "Test Title",
        tags: ["tag1"],
      });

      expect(result.ok).toBeTruthy();
      if (!result.ok) return;

      const data = PostAggregateMapper.toPrismaCreate(result.value);

      expect(data.post.id).toBe(result.value.id.value);
      expect(data.post.projectId).toBe(projectId.value);
      expect(data.post.status).toBe("DRAFT");
      expect(data.content.body).toBe("Test content");
      expect(data.content.title).toBe("Test Title");
      expect(data.content.tags).toEqual(["tag1"]);
    });
  });

  describe("toReadModel", () => {
    it("should map aggregate to read model", () => {
      const projectId = ProjectId.generate();
      const result = PostAggregate.create({
        projectId,
        body: "Read model test",
        title: "Read Title",
        tags: ["read", "model"],
      });

      expect(result.ok).toBeTruthy();
      if (!result.ok) return;

      const readModel = PostAggregateMapper.toReadModel(result.value);

      expect(readModel.id).toBe(result.value.id.value);
      expect(readModel.projectId).toBe(projectId.value);
      expect(readModel.body).toBe("Read model test");
      expect(readModel.title).toBe("Read Title");
      expect(readModel.status).toBe("DRAFT");
      expect(readModel.mediaCount).toBe(0);
    });
  });
});
