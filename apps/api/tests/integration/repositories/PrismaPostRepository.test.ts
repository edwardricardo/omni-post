/**
 * Infrastructure Layer - Prisma Post Repository Unit Tests
 *
 * Tests for the PrismaPostRepository implementation.
 *
 * @file PrismaPostRepository.test.ts
 * @description Tests for PrismaPostRepository
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaPostRepository } from "../../../src/infrastructure/repositories/PrismaPostRepository.js";
import { PostAggregateMapper } from "../../../src/infrastructure/repositories/mappers/PostAggregateMapper.js";
import {
  PostAggregate,
  PostId,
  ProjectId,
  PUBLISH_STATUS,
  type TenantScope,
} from "@core/domain/index.js";
import { createSeedPrismaClient } from "../helpers/seedPrismaClient.js";

/**
 * Fixture AND subject channel: the suite proves the repository's persistence shape. Its
 * tenant behaviour is proved on the application role by `postReadOwnership` and
 * `postDeleteOwnership` in the `integration:tenant-isolation` batch.
 */
const prisma = createSeedPrismaClient();

describe("PrismaPostRepository", () => {
  let repository: PrismaPostRepository;
  let testProjectId: string;
  let testAccountId: string;
  const createdPostIds: string[] = [];
  /** Extra projects an individual arm seeds so it can assert an exact population. */
  const extraProjectIds: string[] = [];
  /** Extra accounts an individual arm seeds so it can assert across a tenant boundary. */
  const extraAccountIds: string[] = [];

  /**
   * The tenant every collection read in this suite runs inside. The scope-first
   * signatures take it positionally, so it is derived once from the fixture account
   * the project belongs to rather than restated per call site.
   */
  const tenantScope = (): TenantScope => ({ accountId: testAccountId });

  before(async () => {
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

  after(async () => {
    // Cleanup: Delete all posts for the test project (cascading related records first)
    // This covers posts tracked in createdPostIds AND any created by bulk operations
    const projectIds = [testProjectId, ...extraProjectIds];
    try {
      // Find all post IDs belonging to the test projects
      const projectPosts = await prisma.post.findMany({
        where: { projectId: { in: projectIds } },
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

    // Delete test projects and accounts
    try {
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
      await prisma.account.deleteMany({
        where: { id: { in: [testAccountId, ...extraAccountIds] } },
      });
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

      assert.ok(result.ok);
      if (!result.ok) return;

      const aggregate = result.value;
      createdPostIds.push(aggregate.id.value);

      // Save the aggregate
      const saveResult = await repository.save(aggregate);
      assert.ok(saveResult.ok);

      // Retrieve it
      const findResult = await repository.findById(aggregate.id);
      assert.ok(findResult.ok);

      if (findResult.ok) {
        assert.equal(findResult.value.id.value, aggregate.id.value);
        assert.equal(findResult.value.content.body, "Test post body");
        assert.equal(findResult.value.content.title, "Test Title");
        assert.deepEqual([...findResult.value.content.tags], ["test", "unit"]);
        assert.ok(findResult.value.isDraft);
      }
    });

    it("should update an existing post", async () => {
      const projectId = ProjectId.fromStringUnsafe(testProjectId);
      const result = PostAggregate.create({
        projectId,
        body: "Original body",
      });

      assert.ok(result.ok);
      if (!result.ok) return;

      const aggregate = result.value;
      createdPostIds.push(aggregate.id.value);

      // Save initially
      await repository.save(aggregate);

      // Update content
      aggregate.updateContent({ body: "Updated body" });

      // Save again
      const updateResult = await repository.save(aggregate);
      assert.ok(updateResult.ok);

      // Retrieve and verify
      const findResult = await repository.findById(aggregate.id);
      assert.ok(findResult.ok);

      if (findResult.ok) {
        assert.equal(findResult.value.content.body, "Updated body");
      }
    });

    it("should return error for non-existent post", async () => {
      const nonExistentId = PostId.generate();
      const result = await repository.findById(nonExistentId);

      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error.name, "EntityNotFoundError");
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

      assert.ok(result.ok);
      if (!result.ok) return;

      const aggregate = result.value;
      createdPostIds.push(aggregate.id.value);

      await repository.save(aggregate);

      const exists = await repository.exists(aggregate.id);
      assert.ok(exists);
    });

    it("should return false for non-existent post", async () => {
      const nonExistentId = PostId.generate();
      const exists = await repository.exists(nonExistentId);
      assert.ok(!exists);
    });
  });

  describe("delete", () => {
    it("should delete an existing post", async () => {
      const projectId = ProjectId.fromStringUnsafe(testProjectId);
      const result = PostAggregate.create({
        projectId,
        body: "Test delete",
      });

      assert.ok(result.ok);
      if (!result.ok) return;

      const aggregate = result.value;
      await repository.save(aggregate);

      // Verify exists
      assert.ok(await repository.exists(aggregate.id));

      // Delete
      const deleteResult = await repository.delete(aggregate.id);
      assert.ok(deleteResult.ok);

      // Verify no longer exists
      assert.ok(!(await repository.exists(aggregate.id)));
    });

    it("should return error when deleting non-existent post", async () => {
      const nonExistentId = PostId.generate();
      const result = await repository.delete(nonExistentId);

      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error.name, "EntityNotFoundError");
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

      // Find with pagination. The tenant scope is FIRST and required: the fixture's
      // project belongs to `testAccountId`, so that is the scope this read runs inside.
      const result = await repository.findByProjectId(tenantScope(), projectId, {
        page: 1,
        limit: 3,
      });

      assert.ok(result.items.length <= 3);
      assert.ok(result.total >= 5);
      assert.equal(result.page, 1);
      assert.equal(result.limit, 3);
    });
  });

  describe("findByStatus", () => {
    it("should find posts by single status", async () => {
      const projectId = ProjectId.fromStringUnsafe(testProjectId);
      const result = PostAggregate.create({
        projectId,
        body: "Draft post",
      });

      assert.ok(result.ok);
      if (!result.ok) return;

      createdPostIds.push(result.value.id.value);
      await repository.save(result.value);

      const findResult = await repository.findByStatus(PUBLISH_STATUS.DRAFT);
      assert.ok(findResult.items.length >= 1);
      assert.ok(findResult.items.every((p) => p.isDraft));
    });

    it("should find posts by multiple statuses", async () => {
      const result = await repository.findByStatus([
        PUBLISH_STATUS.DRAFT,
        PUBLISH_STATUS.SCHEDULED,
      ]);

      assert.ok(result.items.every((p) => p.isDraft || p.isScheduled));
    });
  });

  describe("findReadyForPublishing", () => {
    it("should find scheduled posts with passed time", async () => {
      // This test requires posts with scheduledAt in the past
      // In real scenarios, this would find posts ready to publish
      const result = await repository.findReadyForPublishing(10);
      assert.ok(Array.isArray(result));
    });
  });

  describe("findWithFilters", () => {
    it("should filter posts by project and status", async () => {
      const projectId = ProjectId.fromStringUnsafe(testProjectId);

      const result = await repository.findWithFilters({
        projectId,
        status: PUBLISH_STATUS.DRAFT,
      });

      assert.ok(result.items.every((p) => p.projectId.value === testProjectId));
      assert.ok(result.items.every((p) => p.isDraft));
    });

    it("should filter posts with media", async () => {
      const projectId = ProjectId.fromStringUnsafe(testProjectId);

      const result = await repository.findWithFilters({
        projectId,
        hasMedia: false,
      });

      assert.ok(result.items.every((p) => p.media.length === 0));
    });
  });

  describe("countByProjectId", () => {
    it("should count posts for a project", async () => {
      const projectId = ProjectId.fromStringUnsafe(testProjectId);
      const count = await repository.countByProjectId(tenantScope(), projectId);
      assert.ok(typeof count === "number");
      assert.ok(count >= 0);
    });
  });

  describe("countByStatus", () => {
    it("counts only the posts of the given project that carry the given status", async () => {
      // A project of its own. The shared fixture project accumulates DRAFT posts from
      // every arm above it, so a count taken there could only be asserted as a lower
      // bound — and `count >= 0`, which is what this arm asserted before, is a number
      // no implementation can fail. An exact count needs a population this arm owns.
      const countProjectId = `test-project-count-${Date.now()}`;
      extraProjectIds.push(countProjectId);
      await prisma.project.create({
        data: {
          id: countProjectId,
          name: `Count Project ${countProjectId}`,
          accountId: testAccountId,
          locale: "en",
        },
      });

      const EXPECTED_DRAFTS = 3;
      for (let i = 0; i < EXPECTED_DRAFTS; i++) {
        await prisma.post.create({
          data: {
            projectId: countProjectId,
            accountId: testAccountId,
            status: PUBLISH_STATUS.DRAFT,
          },
        });
      }

      // Three discriminators, one per filter the count applies. Without them an
      // implementation that dropped any single filter would still return 3.
      await prisma.post.create({
        data: {
          projectId: countProjectId,
          accountId: testAccountId,
          status: PUBLISH_STATUS.SCHEDULED,
          scheduledAt: new Date("2030-01-01T00:00:00Z"),
        },
      });
      await prisma.post.create({
        data: {
          projectId: countProjectId,
          accountId: testAccountId,
          status: PUBLISH_STATUS.DRAFT,
          deletedAt: new Date(),
        },
      });
      await prisma.post.create({
        data: {
          projectId: testProjectId,
          accountId: testAccountId,
          status: PUBLISH_STATUS.DRAFT,
        },
      });

      // The FOURTH discriminator, and the only one that can reach the scope
      // argument. The three above are all rows of THIS tenant, so dropping
      // `accountId: scope.accountId` from the implementation still returns 3 and the
      // predicate reads as decorative — measured that way, and the composite FK is
      // why it cannot be fixed by seeding alone: `Post.accountId` is functionally
      // determined by `projectId`, so no row can ever match this project and carry a
      // different tenant. What IS falsifiable is the scope the caller passes, which
      // this suite can vary because its repository runs on the raw owner client, with
      // no guard behind it to inject a tenant the argument forgot.
      const otherAccountId = `test-account-other-${Date.now()}`;
      const otherProjectId = `test-project-other-${Date.now()}`;
      extraAccountIds.push(otherAccountId);
      extraProjectIds.push(otherProjectId);
      await prisma.account.create({
        data: {
          id: otherAccountId,
          email: `test-repo-other-${otherAccountId}@example.com`,
          name: "Other Tenant Account",
        },
      });
      await prisma.project.create({
        data: {
          id: otherProjectId,
          name: `Other Tenant Project ${otherProjectId}`,
          accountId: otherAccountId,
          locale: "en",
        },
      });
      await prisma.post.create({
        data: {
          projectId: otherProjectId,
          accountId: otherAccountId,
          status: PUBLISH_STATUS.DRAFT,
        },
      });
      const otherScope = (): TenantScope => ({ accountId: otherAccountId });

      const count = await repository.countByStatus(
        tenantScope(),
        ProjectId.fromStringUnsafe(countProjectId),
        PUBLISH_STATUS.DRAFT
      );

      assert.equal(
        count,
        EXPECTED_DRAFTS,
        "the count must exclude the other status, the soft-deleted row, and the draft " +
          "filed under a different project of the same tenant"
      );

      const foreignScopeCount = await repository.countByStatus(
        otherScope(),
        ProjectId.fromStringUnsafe(countProjectId),
        PUBLISH_STATUS.DRAFT
      );
      assert.equal(
        foreignScopeCount,
        0,
        "counting THIS project under ANOTHER tenant's scope must answer zero. Drop the " +
          "`accountId` predicate and this returns 3 — the scope argument would then be " +
          "accepted and ignored, which is worse than not taking one"
      );

      const otherOwnCount = await repository.countByStatus(
        otherScope(),
        ProjectId.fromStringUnsafe(otherProjectId),
        PUBLISH_STATUS.DRAFT
      );
      assert.equal(
        otherOwnCount,
        1,
        "the other tenant must still count its OWN draft; without this the zero above " +
          "would also be satisfied by a tenant that simply has no data anywhere"
      );
    });
  });

  describe("getProjectStats", () => {
    it("should return project statistics", async () => {
      const projectId = ProjectId.fromStringUnsafe(testProjectId);
      const stats = await repository.getProjectStats(tenantScope(), projectId);

      assert.ok(typeof stats.total === "number");
      assert.ok(typeof stats.drafts === "number");
      assert.ok(typeof stats.scheduled === "number");
      assert.ok(typeof stats.published === "number");
      assert.ok(typeof stats.failed === "number");

      assert.ok(stats.total >= stats.drafts);
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
      assert.ok(result.ok);
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

      assert.equal(aggregate.id.value, "test-id-123");
      assert.equal(aggregate.projectId.value, "project-123");
      assert.equal(aggregate.content.body, "Test body");
      assert.equal(aggregate.content.title, "Test Title");
      assert.ok(aggregate.isDraft);
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

      assert.equal(aggregate.id.value, "test-id-456");
      assert.ok(aggregate.isScheduled);
      assert.ok(aggregate.scheduledAt);
      assert.ok(aggregate.scheduledAt.hasPassed());
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

      assert.equal(aggregate.media.length, 1);
      assert.equal(aggregate.media[0]?.type, "image");
      assert.equal(aggregate.media[0]?.url, "https://example.com/image.jpg");
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

      assert.ok(result.ok);
      if (!result.ok) return;

      const data = PostAggregateMapper.toPrismaCreate(result.value);

      assert.equal(data.post.id, result.value.id.value);
      assert.equal(data.post.projectId, projectId.value);
      assert.equal(data.post.status, "DRAFT");
      assert.equal(data.content.body, "Test content");
      assert.equal(data.content.title, "Test Title");
      assert.deepEqual(data.content.tags, ["tag1"]);
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

      assert.ok(result.ok);
      if (!result.ok) return;

      const readModel = PostAggregateMapper.toReadModel(result.value);

      assert.equal(readModel.id, result.value.id.value);
      assert.equal(readModel.projectId, projectId.value);
      assert.equal(readModel.body, "Read model test");
      assert.equal(readModel.title, "Read Title");
      assert.equal(readModel.status, "DRAFT");
      assert.equal(readModel.mediaCount, 0);
    });
  });
});
