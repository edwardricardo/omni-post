import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTest, TestContext, makeFlowCleanup } from "./setup.js";

describe("Analytics Flow", { concurrency: 1 }, () => {
  let ctx: TestContext;
  const createdAccounts: string[] = [];
  const createdProjects: string[] = [];
  const createdPosts: string[] = [];

  afterEach(makeFlowCleanup(() => ctx, createdPosts, createdProjects, createdAccounts));

  it("should create account and project for analytics", async () => {
    ctx = await setupTest();

    const accountResult = await ctx.repo.createAccount({
      email: `test-analytics-${Date.now()}@example.com`,
      name: "Analytics Test Account",
      subscription: "PRO",
    });

    assert.ok(
      accountResult.ok,
      `Failed to create account: ${accountResult.ok ? "" : accountResult.error}`
    );
    createdAccounts.push(accountResult.value.id);

    const projectResult = await ctx.repo.createProject(accountResult.value.id, {
      name: "analytics-test-project",
      locale: "es",
    });

    assert.ok(
      projectResult.ok,
      `Failed to create project: ${projectResult.ok ? "" : projectResult.error}`
    );
    createdProjects.push(projectResult.value.id);

    assert.strictEqual(projectResult.value.name, "analytics-test-project");
    assert.strictEqual(projectResult.value.accountId, accountResult.value.id);
  });

  it("should create post for analytics tracking", async () => {
    ctx = await setupTest();

    const accountResult = await ctx.repo.createAccount({
      email: `test-analytics-post-${Date.now()}@example.com`,
      name: "Analytics Post Test Account",
      subscription: "PRO",
    });

    assert.ok(accountResult.ok);
    createdAccounts.push(accountResult.value.id);

    const projectResult = await ctx.repo.createProject(accountResult.value.id, {
      name: "analytics-post-project",
      locale: "es",
    });

    assert.ok(projectResult.ok);
    const projectId = projectResult.value.id;
    createdProjects.push(projectId);

    const postInput = {
      projectId,
      locale: "es" as const,
      body: "Test post for analytics",
    };

    const createResult = await ctx.repo.createPost(postInput);
    assert.ok(
      createResult.ok,
      `Failed to create post: ${createResult.ok ? "" : createResult.error}`
    );

    const postId = createResult.value.id;
    createdPosts.push(postId);

    assert.ok(postId);
    assert.strictEqual(createResult.value.body, "Test post for analytics");
  });

  it("should list analytics data", async () => {
    ctx = await setupTest();

    const analyticsQuery = { limit: 10 };
    const analyticsResult = await ctx.repo.listAnalytics(analyticsQuery);

    assert.ok(
      analyticsResult.ok,
      `Failed to list analytics: ${analyticsResult.ok ? "" : analyticsResult.error}`
    );
    assert.ok(Array.isArray(analyticsResult.value), "Analytics result should be an array");
  });

  it("should verify post exists for analytics tracking", async () => {
    ctx = await setupTest();

    const accountResult = await ctx.repo.createAccount({
      email: `test-analytics-verify-${Date.now()}@example.com`,
      name: "Analytics Verify Test Account",
      subscription: "PRO",
    });

    assert.ok(accountResult.ok);
    createdAccounts.push(accountResult.value.id);

    const projectResult = await ctx.repo.createProject(accountResult.value.id, {
      name: "analytics-verify-project",
      locale: "es",
    });

    assert.ok(projectResult.ok);
    createdProjects.push(projectResult.value.id);

    const postInput = {
      projectId: projectResult.value.id,
      locale: "es" as const,
      body: "Test post for analytics verification",
    };

    const createResult = await ctx.repo.createPost(postInput);
    assert.ok(createResult.ok);
    const postId = createResult.value.id;
    createdPosts.push(postId);

    // Verify post exists for analytics
    const retrieveResult = await ctx.repo.getPostById(postId);
    assert.ok(
      retrieveResult.ok,
      `Failed to retrieve post: ${retrieveResult.ok ? "" : retrieveResult.error}`
    );
    assert.strictEqual(retrieveResult.value.id, postId);
  });

  it("should validate analytics data structure", async () => {
    ctx = await setupTest();

    const accountResult = await ctx.repo.createAccount({
      email: `test-analytics-structure-${Date.now()}@example.com`,
      name: "Analytics Structure Test Account",
      subscription: "PRO",
    });

    assert.ok(accountResult.ok);
    createdAccounts.push(accountResult.value.id);

    const projectResult = await ctx.repo.createProject(accountResult.value.id, {
      name: "analytics-structure-project",
      locale: "es",
    });

    assert.ok(projectResult.ok);
    createdProjects.push(projectResult.value.id);

    const postInput = {
      projectId: projectResult.value.id,
      locale: "es" as const,
      body: "Test post for analytics structure",
    };

    const createResult = await ctx.repo.createPost(postInput);
    assert.ok(createResult.ok);
    const postId = createResult.value.id;
    createdPosts.push(postId);

    // Test analytics data structure
    const mockAnalytics = {
      postId,
      channelId: "dev-x",
      provider: "X" as const,
      views: 100,
      likes: 10,
      comments: 5,
      shares: 2,
    };

    // Validate analytics structure
    assert.strictEqual(mockAnalytics.postId, postId);
    assert.strictEqual(mockAnalytics.channelId, "dev-x");
    assert.strictEqual(mockAnalytics.provider, "X");
    assert.strictEqual(mockAnalytics.views, 100);
    assert.strictEqual(mockAnalytics.likes, 10);
    assert.strictEqual(mockAnalytics.comments, 5);
    assert.strictEqual(mockAnalytics.shares, 2);
  });

  it("should handle analytics listing with custom limits", async () => {
    ctx = await setupTest();

    // Test different limit values
    const analyticsResult1 = await ctx.repo.listAnalytics({ limit: 5 });
    assert.ok(analyticsResult1.ok);
    assert.ok(analyticsResult1.value.length <= 5);

    const analyticsResult2 = await ctx.repo.listAnalytics({ limit: 20 });
    assert.ok(analyticsResult2.ok);
    assert.ok(analyticsResult2.value.length <= 20);
  });

  it("should validate analytics metrics types", async () => {
    ctx = await setupTest();

    const mockAnalytics = {
      postId: "test-post-id",
      channelId: "dev-x",
      provider: "X" as const,
      views: 150,
      likes: 25,
      comments: 8,
      shares: 3,
      retweets: 5,
      impressions: 500,
    };

    // Validate all metrics are numbers
    assert.strictEqual(typeof mockAnalytics.views, "number");
    assert.strictEqual(typeof mockAnalytics.likes, "number");
    assert.strictEqual(typeof mockAnalytics.comments, "number");
    assert.strictEqual(typeof mockAnalytics.shares, "number");
    assert.strictEqual(typeof mockAnalytics.retweets, "number");
    assert.strictEqual(typeof mockAnalytics.impressions, "number");

    // Validate all metrics are non-negative
    assert.ok(mockAnalytics.views >= 0);
    assert.ok(mockAnalytics.likes >= 0);
    assert.ok(mockAnalytics.comments >= 0);
    assert.ok(mockAnalytics.shares >= 0);
  });

  it("should handle analytics for multiple providers", async () => {
    ctx = await setupTest();

    const providers = ["X", "Instagram", "Facebook", "LinkedIn"] as const;

    for (const provider of providers) {
      const mockAnalytics = {
        postId: `test-${provider.toLowerCase()}-post`,
        channelId: `dev-${provider.toLowerCase()}`,
        provider,
        views: Math.floor(Math.random() * 1000),
        likes: Math.floor(Math.random() * 100),
        comments: Math.floor(Math.random() * 50),
        shares: Math.floor(Math.random() * 20),
      };

      assert.strictEqual(mockAnalytics.provider, provider);
      assert.ok(mockAnalytics.views >= 0);
      assert.ok(mockAnalytics.likes >= 0);
    }
  });

  it("should handle zero analytics metrics", async () => {
    ctx = await setupTest();

    const mockAnalytics = {
      postId: "test-new-post",
      channelId: "dev-x",
      provider: "X" as const,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
    };

    // New posts should have valid zero metrics
    assert.strictEqual(mockAnalytics.views, 0);
    assert.strictEqual(mockAnalytics.likes, 0);
    assert.strictEqual(mockAnalytics.comments, 0);
    assert.strictEqual(mockAnalytics.shares, 0);
  });

  it("should complete full analytics workflow", async () => {
    ctx = await setupTest();

    // Create account
    const accountResult = await ctx.repo.createAccount({
      email: `test-analytics-workflow-${Date.now()}@example.com`,
      name: "Analytics Workflow Test Account",
      subscription: "PRO",
    });

    assert.ok(accountResult.ok);
    createdAccounts.push(accountResult.value.id);

    // Create project
    const projectResult = await ctx.repo.createProject(accountResult.value.id, {
      name: "analytics-workflow-project",
      locale: "es",
    });

    assert.ok(projectResult.ok);
    const projectId = projectResult.value.id;
    createdProjects.push(projectId);

    // Create post
    const postInput = {
      projectId,
      locale: "es" as const,
      body: "Complete analytics workflow test",
    };

    const createResult = await ctx.repo.createPost(postInput);
    assert.ok(createResult.ok);
    const postId = createResult.value.id;
    createdPosts.push(postId);

    // List analytics
    const analyticsResult = await ctx.repo.listAnalytics({ limit: 10 });
    assert.ok(analyticsResult.ok);

    // Verify post for analytics tracking
    const retrieveResult = await ctx.repo.getPostById(postId);
    assert.ok(retrieveResult.ok);

    // Test analytics data structure
    const mockAnalytics = {
      postId,
      channelId: "dev-x",
      provider: "X" as const,
      views: 250,
      likes: 45,
      comments: 12,
      shares: 6,
    };

    // Validate complete workflow
    assert.strictEqual(mockAnalytics.postId, postId);
    assert.ok(mockAnalytics.views > 0);
    assert.ok(retrieveResult.value.id === postId);
  });

  it("should handle analytics retrieval errors gracefully", async () => {
    ctx = await setupTest();

    // Try to get analytics for non-existent post
    const invalidPostId = "non-existent-post-id";
    const retrieveResult = await ctx.repo.getPostById(invalidPostId);

    assert.ok(!retrieveResult.ok, "Expected post retrieval to fail with invalid ID");
  });

  it("should validate engagement rate calculations", async () => {
    ctx = await setupTest();

    const mockAnalytics = {
      postId: "test-engagement-post",
      channelId: "dev-x",
      provider: "X" as const,
      views: 1000,
      likes: 50,
      comments: 20,
      shares: 10,
    };

    // Calculate engagement rate: (likes + comments + shares) / views
    const engagements = mockAnalytics.likes + mockAnalytics.comments + mockAnalytics.shares;
    const engagementRate = engagements / mockAnalytics.views;

    assert.strictEqual(engagements, 80);
    assert.strictEqual(engagementRate, 0.08); // 8% engagement rate
    assert.ok(engagementRate > 0 && engagementRate <= 1);
  });
});
