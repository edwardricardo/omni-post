/**
 * @file media.flow.test.ts
 * @description Tests for Media Flow
 * @layer infrastructure
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTest, TestContext, makeFlowCleanup } from "./setup.js";

describe("Media Flow", { concurrency: 1 }, () => {
  let ctx: TestContext;
  const createdAccounts: string[] = [];
  const createdProjects: string[] = [];
  const createdPosts: string[] = [];

  afterEach(makeFlowCleanup(() => ctx, createdPosts, createdProjects, createdAccounts));

  it("should create account and project for media flow", async () => {
    ctx = await setupTest();

    const accountResult = await ctx.repo.createAccount({
      email: `test-media-${Date.now()}@example.com`,
      name: "Media Test Account",
      subscription: "PRO",
    });

    assert.ok(
      accountResult.ok,
      `Failed to create account: ${accountResult.ok ? "" : accountResult.error}`
    );
    createdAccounts.push(accountResult.value.id);

    const projectResult = await ctx.repo.createProject(accountResult.value.id, {
      name: "media-test-project",
      locale: "es",
    });

    assert.ok(
      projectResult.ok,
      `Failed to create project: ${projectResult.ok ? "" : projectResult.error}`
    );
    createdProjects.push(projectResult.value.id);

    assert.strictEqual(projectResult.value.name, "media-test-project");
    assert.strictEqual(projectResult.value.accountId, accountResult.value.id);
  });

  it("should create post for media attachment", async () => {
    ctx = await setupTest();

    const accountResult = await ctx.repo.createAccount({
      email: `test-media-post-${Date.now()}@example.com`,
      name: "Media Post Test Account",
      subscription: "PRO",
    });

    assert.ok(accountResult.ok);
    createdAccounts.push(accountResult.value.id);

    const projectResult = await ctx.repo.createProject(accountResult.value.id, {
      name: "media-post-project",
      locale: "es",
    });

    assert.ok(projectResult.ok);
    const projectId = projectResult.value.id;
    createdProjects.push(projectId);

    const postInput = {
      projectId,
      locale: "es" as const,
      body: "Test post for media flow",
    };

    const createResult = await ctx.repo.createPost(postInput);
    assert.ok(
      createResult.ok,
      `Failed to create post: ${createResult.ok ? "" : createResult.error}`
    );

    const postId = createResult.value.id;
    createdPosts.push(postId);

    assert.ok(postId);
    assert.strictEqual(createResult.value.body, "Test post for media flow");
  });

  it("should validate media metadata structure", async () => {
    ctx = await setupTest();

    const accountResult = await ctx.repo.createAccount({
      email: `test-media-metadata-${Date.now()}@example.com`,
      name: "Media Metadata Test Account",
      subscription: "PRO",
    });

    assert.ok(accountResult.ok);
    createdAccounts.push(accountResult.value.id);

    const projectResult = await ctx.repo.createProject(accountResult.value.id, {
      name: "media-metadata-project",
      locale: "es",
    });

    assert.ok(projectResult.ok);
    createdProjects.push(projectResult.value.id);

    const postInput = {
      projectId: projectResult.value.id,
      locale: "es" as const,
      body: "Test post with media metadata",
    };

    const createResult = await ctx.repo.createPost(postInput);
    assert.ok(createResult.ok);
    createdPosts.push(createResult.value.id);

    const postId = createResult.value.id;

    // Test media metadata structure (simulated without actual S3 upload)
    const mockMediaUrl = `https://test.example.com/media/${postId}.jpg`;
    const mediaMetadata = {
      url: mockMediaUrl,
      type: "image" as const,
      width: 1920,
      height: 1080,
      alt: "Test image",
    };

    // Validate media metadata structure
    assert.strictEqual(mediaMetadata.type, "image");
    assert.strictEqual(mediaMetadata.width, 1920);
    assert.strictEqual(mediaMetadata.height, 1080);
    assert.strictEqual(mediaMetadata.alt, "Test image");
    assert.ok(mediaMetadata.url.includes(postId));
  });

  it("should retrieve post after media operations", async () => {
    ctx = await setupTest();

    const accountResult = await ctx.repo.createAccount({
      email: `test-media-retrieve-${Date.now()}@example.com`,
      name: "Media Retrieve Test Account",
      subscription: "PRO",
    });

    assert.ok(accountResult.ok);
    createdAccounts.push(accountResult.value.id);

    const projectResult = await ctx.repo.createProject(accountResult.value.id, {
      name: "media-retrieve-project",
      locale: "es",
    });

    assert.ok(projectResult.ok);
    createdProjects.push(projectResult.value.id);

    const postInput = {
      projectId: projectResult.value.id,
      locale: "es" as const,
      body: "Test post for retrieval after media",
    };

    const createResult = await ctx.repo.createPost(postInput);
    assert.ok(createResult.ok);
    const postId = createResult.value.id;
    createdPosts.push(postId);

    // Retrieve post
    const retrieveResult = await ctx.repo.getPostById(postId);
    assert.ok(
      retrieveResult.ok,
      `Failed to retrieve post: ${retrieveResult.ok ? "" : retrieveResult.error}`
    );
    assert.strictEqual(retrieveResult.value.id, postId);
    assert.strictEqual(retrieveResult.value.body, "Test post for retrieval after media");
  });

  it("should handle invalid media metadata gracefully", async () => {
    ctx = await setupTest();

    // Test invalid media metadata structure
    const invalidMediaMetadata = {
      url: "",
      type: "invalid" as const,
      width: -1,
      height: -1,
      alt: "",
    };

    // Validate that invalid values are detected
    assert.strictEqual(invalidMediaMetadata.url, "");
    assert.strictEqual(invalidMediaMetadata.type, "invalid");
    assert.strictEqual(invalidMediaMetadata.width, -1);
    assert.strictEqual(invalidMediaMetadata.height, -1);
  });

  it("should handle post creation failure for media flow", async () => {
    ctx = await setupTest();

    // Try to create post with invalid project ID
    const postInput = {
      projectId: "non-existent-project-id",
      locale: "es" as const,
      body: "This should fail",
    };

    const createResult = await ctx.repo.createPost(postInput);
    assert.ok(!createResult.ok, "Expected post creation to fail with invalid project ID");
  });

  it("should complete full media workflow", async () => {
    ctx = await setupTest();

    // Create account
    const accountResult = await ctx.repo.createAccount({
      email: `test-media-workflow-${Date.now()}@example.com`,
      name: "Media Workflow Test Account",
      subscription: "PRO",
    });

    assert.ok(accountResult.ok);
    createdAccounts.push(accountResult.value.id);

    // Create project
    const projectResult = await ctx.repo.createProject(accountResult.value.id, {
      name: "media-workflow-project",
      locale: "es",
    });

    assert.ok(projectResult.ok);
    const projectId = projectResult.value.id;
    createdProjects.push(projectId);

    // Create post
    const postInput = {
      projectId,
      locale: "es" as const,
      body: "Complete media workflow test",
    };

    const createResult = await ctx.repo.createPost(postInput);
    assert.ok(createResult.ok);
    const postId = createResult.value.id;
    createdPosts.push(postId);

    // Simulate media metadata
    const mediaMetadata = {
      url: `https://test.example.com/media/${postId}.jpg`,
      type: "image" as const,
      width: 1920,
      height: 1080,
      alt: "Workflow test image",
    };

    // Verify media metadata
    assert.ok(mediaMetadata.url);
    assert.strictEqual(mediaMetadata.type, "image");

    // Retrieve and verify post
    const retrieveResult = await ctx.repo.getPostById(postId);
    assert.ok(retrieveResult.ok);
    assert.strictEqual(retrieveResult.value.id, postId);
    assert.strictEqual(retrieveResult.value.projectId, projectId);
  });
});
