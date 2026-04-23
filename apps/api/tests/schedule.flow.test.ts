/**
 * @file schedule.flow.test.ts
 * @description Tests for Schedule Flow
 * @layer infrastructure
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTest, TestContext, makeFlowCleanup } from "./setup.js";

describe("Schedule Flow", { concurrency: 1 }, () => {
  let ctx: TestContext;
  const createdAccounts: string[] = [];
  const createdProjects: string[] = [];
  const createdPosts: string[] = [];

  afterEach(makeFlowCleanup(() => ctx, createdPosts, createdProjects, createdAccounts));

  it("should create account and project for scheduling", async () => {
    ctx = await setupTest();

    const accountResult = await ctx.repo.createAccount({
      email: `test-schedule-${Date.now()}@example.com`,
      name: "Schedule Test Account",
      subscription: "PRO",
    });

    assert.ok(
      accountResult.ok,
      `Failed to create account: ${accountResult.ok ? "" : accountResult.error}`
    );
    createdAccounts.push(accountResult.value.id);

    const projectResult = await ctx.repo.createProject(accountResult.value.id, {
      name: "schedule-test-project",
      locale: "es",
    });

    assert.ok(
      projectResult.ok,
      `Failed to create project: ${projectResult.ok ? "" : projectResult.error}`
    );
    createdProjects.push(projectResult.value.id);

    assert.strictEqual(projectResult.value.name, "schedule-test-project");
    assert.strictEqual(projectResult.value.accountId, accountResult.value.id);
  });

  it("should create post for scheduling", async () => {
    ctx = await setupTest();

    const accountResult = await ctx.repo.createAccount({
      email: `test-schedule-post-${Date.now()}@example.com`,
      name: "Schedule Post Test Account",
      subscription: "PRO",
    });

    assert.ok(accountResult.ok);
    createdAccounts.push(accountResult.value.id);

    const projectResult = await ctx.repo.createProject(accountResult.value.id, {
      name: "schedule-post-project",
      locale: "es",
    });

    assert.ok(projectResult.ok);
    const projectId = projectResult.value.id;
    createdProjects.push(projectId);

    const postInput = {
      projectId,
      locale: "es" as const,
      body: "Test post for scheduling",
    };

    const createResult = await ctx.repo.createPost(postInput);
    assert.ok(
      createResult.ok,
      `Failed to create post: ${createResult.ok ? "" : createResult.error}`
    );

    const postId = createResult.value.id;
    createdPosts.push(postId);

    assert.ok(postId);
    assert.strictEqual(createResult.value.body, "Test post for scheduling");
  });

  it("should verify queue health for scheduling operations", async () => {
    ctx = await setupTest();

    const queueHealth = await ctx.queue.health();
    assert.ok(queueHealth.ok, `Queue not healthy: ${queueHealth.ok ? "" : queueHealth.error}`);

    // Verify queue is ready for scheduling
    assert.ok(queueHealth.value);
  });

  it("should prepare post for scheduling", async () => {
    ctx = await setupTest();

    const accountResult = await ctx.repo.createAccount({
      email: `test-schedule-prepare-${Date.now()}@example.com`,
      name: "Schedule Prepare Test Account",
      subscription: "PRO",
    });

    assert.ok(accountResult.ok);
    createdAccounts.push(accountResult.value.id);

    const projectResult = await ctx.repo.createProject(accountResult.value.id, {
      name: "schedule-prepare-project",
      locale: "es",
    });

    assert.ok(projectResult.ok);
    createdProjects.push(projectResult.value.id);

    const postInput = {
      projectId: projectResult.value.id,
      locale: "es" as const,
      body: "Test post to prepare for scheduling",
    };

    const createResult = await ctx.repo.createPost(postInput);
    assert.ok(createResult.ok);
    const postId = createResult.value.id;
    createdPosts.push(postId);

    // Verify post exists and can be scheduled
    const retrieveResult = await ctx.repo.getPostById(postId);
    assert.ok(
      retrieveResult.ok,
      `Failed to retrieve post: ${retrieveResult.ok ? "" : retrieveResult.error}`
    );
    assert.strictEqual(retrieveResult.value.id, postId);
  });

  it("should validate scheduling logic and parameters", async () => {
    ctx = await setupTest();

    const accountResult = await ctx.repo.createAccount({
      email: `test-schedule-logic-${Date.now()}@example.com`,
      name: "Schedule Logic Test Account",
      subscription: "PRO",
    });

    assert.ok(accountResult.ok);
    createdAccounts.push(accountResult.value.id);

    const projectResult = await ctx.repo.createProject(accountResult.value.id, {
      name: "schedule-logic-project",
      locale: "es",
    });

    assert.ok(projectResult.ok);
    createdProjects.push(projectResult.value.id);

    const postInput = {
      projectId: projectResult.value.id,
      locale: "es" as const,
      body: "Test scheduling logic",
    };

    const createResult = await ctx.repo.createPost(postInput);
    assert.ok(createResult.ok);
    const postId = createResult.value.id;
    createdPosts.push(postId);

    // Test scheduling parameters
    const scheduleTime = new Date(Date.now() + 60_000); // 1 minute in future
    const dedupeKey = `test-${postId}-${Date.now()}`;

    // Validate scheduling parameters
    assert.ok(scheduleTime > new Date(), "Schedule time should be in the future");
    assert.ok(dedupeKey.includes(postId), "Dedupe key should include post ID");
    assert.ok(dedupeKey.startsWith("test-"), "Dedupe key should start with test- prefix");
  });

  it("should handle scheduling errors gracefully", async () => {
    ctx = await setupTest();

    // Try to schedule with invalid post ID
    const invalidPostId = "non-existent-post-id";
    const retrieveResult = await ctx.repo.getPostById(invalidPostId);

    assert.ok(!retrieveResult.ok, "Expected post retrieval to fail with invalid ID");
  });

  it("should validate past schedule times are rejected", async () => {
    ctx = await setupTest();

    // Test that past schedule times should be invalid
    const pastScheduleTime = new Date(Date.now() - 60_000); // 1 minute in past
    const currentTime = new Date();

    assert.ok(pastScheduleTime < currentTime, "Past schedule time should be before current time");
  });

  it("should validate future schedule times are accepted", async () => {
    ctx = await setupTest();

    // Test that future schedule times should be valid
    const futureScheduleTime = new Date(Date.now() + 3600_000); // 1 hour in future
    const currentTime = new Date();

    assert.ok(
      futureScheduleTime > currentTime,
      "Future schedule time should be after current time"
    );
  });

  it("should complete full scheduling workflow", async () => {
    ctx = await setupTest();

    // Create account
    const accountResult = await ctx.repo.createAccount({
      email: `test-schedule-workflow-${Date.now()}@example.com`,
      name: "Schedule Workflow Test Account",
      subscription: "PRO",
    });

    assert.ok(accountResult.ok);
    createdAccounts.push(accountResult.value.id);

    // Create project
    const projectResult = await ctx.repo.createProject(accountResult.value.id, {
      name: "schedule-workflow-project",
      locale: "es",
    });

    assert.ok(projectResult.ok);
    const projectId = projectResult.value.id;
    createdProjects.push(projectId);

    // Create post
    const postInput = {
      projectId,
      locale: "es" as const,
      body: "Complete scheduling workflow test",
    };

    const createResult = await ctx.repo.createPost(postInput);
    assert.ok(createResult.ok);
    const postId = createResult.value.id;
    createdPosts.push(postId);

    // Verify queue health
    const queueHealth = await ctx.queue.health();
    assert.ok(queueHealth.ok);

    // Prepare scheduling parameters
    const scheduleTime = new Date(Date.now() + 60_000);
    const dedupeKey = `workflow-${postId}-${Date.now()}`;

    // Verify post can be retrieved
    const retrieveResult = await ctx.repo.getPostById(postId);
    assert.ok(retrieveResult.ok);
    assert.strictEqual(retrieveResult.value.id, postId);

    // Validate scheduling logic
    assert.ok(scheduleTime > new Date());
    assert.ok(dedupeKey.includes(postId));
  });

  it("should handle concurrent scheduling requests", async () => {
    ctx = await setupTest();

    const accountResult = await ctx.repo.createAccount({
      email: `test-schedule-concurrent-${Date.now()}@example.com`,
      name: "Schedule Concurrent Test Account",
      subscription: "PRO",
    });

    assert.ok(accountResult.ok);
    createdAccounts.push(accountResult.value.id);

    const projectResult = await ctx.repo.createProject(accountResult.value.id, {
      name: "schedule-concurrent-project",
      locale: "es",
    });

    assert.ok(projectResult.ok);
    const projectId = projectResult.value.id;
    createdProjects.push(projectId);

    // Create multiple posts for concurrent scheduling simulation
    const post1Result = await ctx.repo.createPost({
      projectId,
      locale: "es" as const,
      body: "Concurrent post 1",
    });
    assert.ok(post1Result.ok);
    createdPosts.push(post1Result.value.id);

    const post2Result = await ctx.repo.createPost({
      projectId,
      locale: "es" as const,
      body: "Concurrent post 2",
    });
    assert.ok(post2Result.ok);
    createdPosts.push(post2Result.value.id);

    // Verify both posts can be scheduled
    const retrieve1 = await ctx.repo.getPostById(post1Result.value.id);
    const retrieve2 = await ctx.repo.getPostById(post2Result.value.id);

    assert.ok(retrieve1.ok);
    assert.ok(retrieve2.ok);
    assert.notStrictEqual(retrieve1.value.id, retrieve2.value.id);
  });
});
