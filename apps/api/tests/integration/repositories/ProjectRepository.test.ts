/**
 * Comprehensive Tests for ProjectRepository (ProjectRepository.ts)
 *
 * This test suite validates the project data access layer that eliminates N+1 queries.
 *
 * Tests cover:
 * - Post ID retrieval
 * - Posts with content/media
 * - Posts with analytics
 * - Project lookup
 * - Account projects
 * - Post counting
 * - Published posts filtering
 *
 * Run with: pnpm --filter @apps/api exec tsx tests/unit/ProjectRepository.test.ts
 *
 * @file ProjectRepository.test.ts
 * @description Tests for ProjectRepository - Basic Operations
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaProjectQueryRepository } from "../../../src/infrastructure/repositories/PrismaProjectQueryRepository.js";
import { prisma } from "@infra/prisma";

// ========================================
// TEST DATA SETUP & TEARDOWN
// ========================================

let testAccountId: string;
let testProjectId: string;
let testChannelId: string;
let testPostIds: string[] = [];

async function setupTestData() {
  // Create test account with unique email
  const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const account = await prisma.account.create({
    data: {
      name: "Test Repository Account",
      email: `test-repo-${uniqueId}@example.com`,
    },
  });
  testAccountId = account.id;

  // Create test project
  const project = await prisma.project.create({
    data: {
      name: "Test Repository Project",
      accountId: testAccountId,
    },
  });
  testProjectId = project.id;

  // Create test channel for analytics
  const channel = await prisma.channel.create({
    data: {
      projectId: testProjectId,
      accountId: testAccountId,
      provider: "X",
      handle: "@test_handle",
      credentialsCiphertext: "test-ciphertext",
      credentialsIv: "test-iv",
      credentialsAuthTag: "test-auth-tag",
    },
  });
  testChannelId = channel.id;

  // Create test posts with content and media
  for (let i = 0; i < 5; i++) {
    const post = await prisma.post.create({
      data: {
        projectId: testProjectId,
        status: i < 3 ? "PUBLISHED" : "DRAFT",
        publishedAt: i < 3 ? new Date() : null,
        contents: {
          create: {
            locale: "en",
            body: `Test post ${i} content`,
            revision: 1,
          },
        },
        media: {
          create: {
            url: `https://example.com/media${i}.jpg`,
            type: "image",
          },
        },
      },
    });
    testPostIds.push(post.id);

    // Create analytics for published posts
    if (i < 3) {
      await prisma.analytics.create({
        data: {
          postId: post.id,
          channelId: testChannelId,
          provider: "X",
          views: 1000 * (i + 1),
          likes: 50 * (i + 1),
          comments: 10 * (i + 1),
          shares: 5 * (i + 1),
          capturedAt: new Date(),
        },
      });
    }
  }
}

async function teardownTestData() {
  // Clean up in reverse order of creation
  if (testPostIds.length > 0) {
    await prisma.analytics.deleteMany({ where: { postId: { in: testPostIds } } });
    await prisma.postMedia.deleteMany({ where: { postId: { in: testPostIds } } });
    await prisma.postContent.deleteMany({ where: { postId: { in: testPostIds } } });
    await prisma.post.deleteMany({ where: { id: { in: testPostIds } } });
  }
  if (testChannelId) {
    await prisma.channel.deleteMany({ where: { id: testChannelId } });
  }
  if (testProjectId) {
    await prisma.project.deleteMany({ where: { id: testProjectId } });
  }
  if (testAccountId) {
    await prisma.account.deleteMany({ where: { id: testAccountId } });
  }
}

// ========================================
// TESTS: Basic Repository Operations
// ========================================

describe("ProjectRepository - Basic Operations", () => {
  it("ProjectRepository instantiates successfully", () => {
    const repo = new PrismaProjectQueryRepository(prisma);
    assert.ok(repo !== null);
  });
});

// ========================================
// TESTS: getPostIds
// ========================================

describe("ProjectRepository - getPostIds", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns all post IDs for a project", async () => {
    const repo = new PrismaProjectQueryRepository(prisma);
    const postIds = await repo.getPostIds(testProjectId);

    assert.ok(Array.isArray(postIds));
    assert.equal(postIds.length, 5);

    // Verify all test post IDs are included
    testPostIds.forEach((testId) => {
      assert.ok(postIds.includes(testId));
    });
  });

  it("returns empty array for project with no posts", async () => {
    // Create project without posts
    const emptyProject = await prisma.project.create({
      data: {
        name: "Empty Project",
        accountId: testAccountId,
      },
    });

    const repo = new PrismaProjectQueryRepository(prisma);
    const postIds = await repo.getPostIds(emptyProject.id);

    assert.ok(Array.isArray(postIds));
    assert.equal(postIds.length, 0);

    await prisma.project.delete({ where: { id: emptyProject.id } });
  });

  it("returns empty array for non-existent project", async () => {
    const repo = new PrismaProjectQueryRepository(prisma);
    const postIds = await repo.getPostIds("non-existent-project-id");

    assert.ok(Array.isArray(postIds));
    assert.equal(postIds.length, 0);
  });
});

// ========================================
// TESTS: getPostsWithContent
// ========================================

describe("ProjectRepository - getPostsWithContent", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns posts with content and media", async () => {
    const repo = new PrismaProjectQueryRepository(prisma);
    const posts = await repo.getPostsWithContent(testProjectId);

    assert.ok(Array.isArray(posts));
    assert.equal(posts.length, 5);

    // Verify each post has content and media
    posts.forEach((post) => {
      assert.ok(Array.isArray(post.contents));
      assert.ok(post.contents.length > 0);
      assert.ok(Array.isArray(post.media));
      assert.ok(post.media.length > 0);
    });
  });

  it("respects take option for pagination", async () => {
    const repo = new PrismaProjectQueryRepository(prisma);
    const posts = await repo.getPostsWithContent(testProjectId, { take: 2 });

    assert.equal(posts.length, 2);
  });

  it("respects skip option for pagination", async () => {
    const repo = new PrismaProjectQueryRepository(prisma);
    const allPosts = await repo.getPostsWithContent(testProjectId);
    const skippedPosts = await repo.getPostsWithContent(testProjectId, { skip: 2 });

    assert.equal(skippedPosts.length, 3);
    assert.notEqual(skippedPosts[0]!.id, allPosts[0]!.id);
  });

  it("orders by createdAt desc by default", async () => {
    const repo = new PrismaProjectQueryRepository(prisma);
    const posts = await repo.getPostsWithContent(testProjectId);

    // Verify descending order
    for (let i = 0; i < posts.length - 1; i++) {
      const currentTime = posts[i]!.createdAt.getTime();
      const nextTime = posts[i + 1]!.createdAt.getTime();
      assert.ok(currentTime >= nextTime);
    }
  });
});

// ========================================
// TESTS: getPostsWithAnalytics
// ========================================

describe("ProjectRepository - getPostsWithAnalytics", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns posts with analytics data", async () => {
    const repo = new PrismaProjectQueryRepository(prisma);
    const posts = await repo.getPostsWithAnalytics(testProjectId);

    assert.ok(Array.isArray(posts));
    assert.equal(posts.length, 5);

    // Verify published posts have analytics
    const publishedPosts = posts.filter((p) => p.publishedAt !== null);
    publishedPosts.forEach((post) => {
      assert.ok(Array.isArray(post.analytics));
      assert.ok(post.analytics.length > 0);
    });
  });

  it("includes draft posts even without analytics", async () => {
    const repo = new PrismaProjectQueryRepository(prisma);
    const posts = await repo.getPostsWithAnalytics(testProjectId);

    const draftPosts = posts.filter((p) => p.publishedAt === null);
    assert.equal(draftPosts.length, 2);

    draftPosts.forEach((post) => {
      assert.ok(Array.isArray(post.analytics));
      // Draft posts won't have analytics, so array should be empty
    });
  });
});

// ========================================
// TESTS: findById
// ========================================

describe("ProjectRepository - findById", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns project when it exists", async () => {
    const repo = new PrismaProjectQueryRepository(prisma);
    const project = await repo.findById(testProjectId);

    assert.ok(project !== null);
    assert.equal(project!.id, testProjectId);
    assert.equal(project!.accountId, testAccountId);
  });

  it("returns null when project does not exist", async () => {
    const repo = new PrismaProjectQueryRepository(prisma);
    const project = await repo.findById("non-existent-project-id");

    assert.equal(project, null);
  });
});

// ========================================
// TESTS: getByAccountId
// ========================================

describe("ProjectRepository - getByAccountId", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns all projects for an account", async () => {
    // Create additional project for same account
    const project2 = await prisma.project.create({
      data: {
        name: "Second Test Project",
        accountId: testAccountId,
      },
    });

    const repo = new PrismaProjectQueryRepository(prisma);
    const projects = await repo.getByAccountId(testAccountId);

    assert.ok(Array.isArray(projects));
    assert.equal(projects.length, 2);
    assert.ok(projects.every((p) => p.accountId === testAccountId));

    await prisma.project.delete({ where: { id: project2.id } });
  });

  it("returns empty array for account with no projects", async () => {
    const repo = new PrismaProjectQueryRepository(prisma);
    const projects = await repo.getByAccountId("non-existent-account-id");

    assert.ok(Array.isArray(projects));
    assert.equal(projects.length, 0);
  });

  it("orders projects by createdAt desc", async () => {
    // Create additional project
    const project2 = await prisma.project.create({
      data: {
        name: "Newer Project",
        accountId: testAccountId,
      },
    });

    const repo = new PrismaProjectQueryRepository(prisma);
    const projects = await repo.getByAccountId(testAccountId);

    // Verify descending order
    for (let i = 0; i < projects.length - 1; i++) {
      const currentTime = projects[i]!.createdAt.getTime();
      const nextTime = projects[i + 1]!.createdAt.getTime();
      assert.ok(currentTime >= nextTime);
    }

    await prisma.project.delete({ where: { id: project2.id } });
  });
});

// ========================================
// TESTS: countPosts
// ========================================

describe("ProjectRepository - countPosts", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns correct count of posts", async () => {
    const repo = new PrismaProjectQueryRepository(prisma);
    const count = await repo.countPosts(testProjectId);

    assert.equal(count, 5);
  });

  it("returns 0 for project with no posts", async () => {
    const emptyProject = await prisma.project.create({
      data: {
        name: "Empty Project",
        accountId: testAccountId,
      },
    });

    const repo = new PrismaProjectQueryRepository(prisma);
    const count = await repo.countPosts(emptyProject.id);

    assert.equal(count, 0);

    await prisma.project.delete({ where: { id: emptyProject.id } });
  });
});

// ========================================
// TESTS: getPublishedPosts
// ========================================

describe("ProjectRepository - getPublishedPosts", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns only published posts", async () => {
    const repo = new PrismaProjectQueryRepository(prisma);
    const posts = await repo.getPublishedPosts(testProjectId);

    assert.ok(Array.isArray(posts));
    assert.equal(posts.length, 3);

    posts.forEach((post) => {
      assert.ok(post.publishedAt !== null);
      assert.equal(post.status, "PUBLISHED");
    });
  });

  it("includes content and media", async () => {
    const repo = new PrismaProjectQueryRepository(prisma);
    const posts = await repo.getPublishedPosts(testProjectId);

    posts.forEach((post) => {
      assert.ok(Array.isArray(post.contents));
      assert.ok(post.contents.length > 0);
      assert.ok(Array.isArray(post.media));
      assert.ok(post.media.length > 0);
    });
  });

  it("orders by publishedAt desc by default", async () => {
    const repo = new PrismaProjectQueryRepository(prisma);
    const posts = await repo.getPublishedPosts(testProjectId);

    // Verify descending order by publishedAt
    for (let i = 0; i < posts.length - 1; i++) {
      const current = posts[i]!.publishedAt;
      const next = posts[i + 1]!.publishedAt;
      if (current && next) {
        assert.ok(current.getTime() >= next.getTime());
      }
    }
  });

  it("respects pagination options", async () => {
    const repo = new PrismaProjectQueryRepository(prisma);
    const posts = await repo.getPublishedPosts(testProjectId, { take: 2 });

    assert.equal(posts.length, 2);
  });
});
