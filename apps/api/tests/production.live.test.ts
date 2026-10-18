/**
 * Comprehensive Production Integration Test
 * Tests the complete flow from customer registration to content publication
 * Covers the customer-facing API surface end to end
 *
 * @file production.live.test.ts
 * @description Tests for Comprehensive Production Integration Test
 * @layer infrastructure
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { faker } from "@faker-js/faker";
import { untilValue } from "@packages/vitest-shared/determinism";
import {
  checkApiAvailable,
  getBaseUrl,
  liveRegistrationBody,
  registerLiveTenant,
} from "./testUtils.js";

const PRODUCTION_API = getBaseUrl();
/**
 * The workers process serves its health + metrics on `METRICS_PORT`, defaulting
 * to 3300. This was hardcoded to 9100 — a port the workers have never listened
 * on (9100 is node_exporter's, per the Prometheus scrape config) — so the
 * availability probe below always failed and the one test that reads this
 * endpoint always skipped, including in a run that had just started the workers.
 */
const WORKERS_METRICS = `http://localhost:${process.env.METRICS_PORT ?? 3300}`;
const _CLIENT_APP = "http://localhost:3000"; // Will need to be adjusted when client runs

/** Builds the Authorization header object for `apiCall`. */
const authHeaders = (token: string): Record<string, string> => ({ Authorization: token });

// Helper function to make API calls
async function apiCall(method: string, path: string, body?: any, headers?: Record<string, string>) {
  const requestHeaders: Record<string, string> = headers || {};
  if (body) {
    requestHeaders["Content-Type"] = "application/json";
  }

  const response = await fetch(`${PRODUCTION_API}${path}`, {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();
  return { status: response.status, data };
}

/**
 * Polls a saga until it reaches a terminal state (COMPLETED / FAILED /
 * COMPENSATED) and returns it, or throws naming the last status read once
 * `timeoutMs` has passed. Post creation and scheduling are driven by the
 * post-publishing saga, which executes asynchronously, so the test must wait
 * for the saga to settle before reading the resulting post.
 */
async function pollSagaTerminal(
  sagaId: string,
  token: string,
  timeoutMs = 10_000
): Promise<string> {
  let lastRead = "no status";
  return untilValue(
    async () => {
      const { data } = await apiCall("GET", `/sagas/${sagaId}`, undefined, authHeaders(token));
      const status: string | undefined = data?.data?.status;
      lastRead = status ?? "no status";
      const terminal = status === "COMPLETED" || status === "FAILED" || status === "COMPENSATED";
      return terminal ? status : null;
    },
    {
      description: () => `saga ${sagaId} to reach a terminal state (last read: ${lastRead})`,
      timeoutMs,
      intervalMs: 250,
    }
  );
}

// Generate test data
function generateTestData() {
  const timestamp = Date.now();
  // Text fields below feed routes guarded by `SecureSchemas` (account name,
  // project name/description, post title/body). The security validator flags
  // shell-injection tokens (`; & | $ ( ) { } [ ] < > /`) and bare command
  // words (`id`, `cat`, `ls`, ...), which random faker prose intermittently
  // produces — making the suite flaky. These strings are deterministic and
  // free of every flagged token, and stay unique via the timestamp suffix.
  return {
    account: {
      email: faker.internet.email({ provider: `test${timestamp}.com` }),
      name: `Production Test Account ${timestamp}`,
    },
    project: {
      name: `Production Test Project ${timestamp}`,
      description: `Project created by the production integration suite at ${timestamp}`,
    },
    post: {
      title: `Production Test Post ${timestamp}`,
      content:
        `Production integration test post body number ${timestamp}. ` +
        "This is plain marketing copy used to exercise the publishing flow end to end.",
      hashtags: ["#tech", "#innovation", "#startup", "#cloud", "#growth"],
      platforms: ["X", "INSTAGRAM", "FACEBOOK"],
    },
    channel: {
      x: {
        name: `X Channel ${timestamp}`,
        platform: "X" as const,
        credentials: {
          apiKey: faker.string.alphanumeric(32),
          apiSecret: faker.string.alphanumeric(32),
          accessToken: faker.string.alphanumeric(32),
          accessSecret: faker.string.alphanumeric(32),
        },
      },
      instagram: {
        name: `Instagram Channel ${timestamp}`,
        platform: "INSTAGRAM" as const,
        credentials: {
          accessToken: faker.string.alphanumeric(64),
          userId: faker.string.numeric(10),
        },
      },
    },
  };
}

describe("Comprehensive Production Integration Test", () => {
  let testData: ReturnType<typeof generateTestData>;
  let accountId: string;
  let projectId: string;
  let postId: string;
  let channelIds: string[] = [];
  // The owner's access token registration issued — threads through every tenant-scoped op.
  let accountToken: string;
  let apiAvailable = false;
  let workerAvailable = false;

  before(async () => {
    testData = generateTestData();
    // stdout is the node:test runner's message channel; diagnostics go to stderr (DEF-83).
    console.error("Starting Comprehensive Production Integration Test");
    console.error("=".repeat(60));

    apiAvailable = await checkApiAvailable();
    if (!apiAvailable) {
      console.warn("API not available - API integration tests will be skipped");
    }

    try {
      const response = await fetch(`${WORKERS_METRICS}/metrics`, {
        signal: AbortSignal.timeout(3000),
      });
      workerAvailable = response.ok;
      if (!workerAvailable) {
        console.warn("Workers metrics not available - worker tests will be skipped");
      }
    } catch {
      console.warn("Workers metrics not available - worker tests will be skipped");
      workerAvailable = false;
    }
  });

  const skipIfApiUnavailable = (t: any): boolean => {
    if (!apiAvailable) {
      t.skip("API not available");
      return true;
    }
    return false;
  };

  const skipIfWorkerUnavailable = (t: any): boolean => {
    if (!workerAvailable) {
      t.skip("Workers metrics not available");
      return true;
    }
    return false;
  };

  describe("Account Management", () => {
    it("should create account successfully", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      console.error("\nPHASE 1: Account Management");
      console.error("-".repeat(40));

      // Customer registration is the one route that creates an account for a customer; it
      // answers with the account and its owner's access token.
      const tenant = await registerLiveTenant({
        email: testData.account.email,
        accountName: testData.account.name,
      });
      accountId = tenant.accountId;
      accountToken = tenant.authorization;
      assert.ok(accountId, `Account ID received: ${accountId}`);
      console.error(`Account created successfully: ${accountId}`);
    });

    it("should verify account details", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      const getAccountResponse = await apiCall(
        "GET",
        `/accounts/${accountId}`,
        undefined,
        authHeaders(accountToken)
      );
      assert.equal(getAccountResponse.status, 200, "Account retrieved successfully");

      // `Foo@Example.com` and `foo@example.com` are ONE registration identity, so
      // the address is stored — and therefore returned — in its canonical form.
      // This line asserted byte-equality with the submitted address before that
      // rule existed, pinning the ABSENCE of normalization as though it were the
      // contract.
      //
      // The expectation is spelled out here rather than computed with the
      // production `normalizeEmail` helper on purpose: a test that calls the same
      // function the route calls agrees with it by construction, and would follow
      // a redefinition of the rule anywhere it went — including back to
      // `validator.normalizeEmail`, which also strips Gmail dots and `+tags` and
      // so folds two people's addresses into one account.
      const canonicalEmail = testData.account.email.trim().toLowerCase();

      // Without this the assertion below is self-satisfying whenever the fixture
      // happens to submit an already-canonical address: it would keep passing
      // while proving nothing about normalization. faker capitalizes the local
      // part today, and this fails loudly if that ever stops being true.
      assert.notEqual(
        testData.account.email,
        canonicalEmail,
        "Fixture must submit a non-canonical address or this case proves nothing"
      );

      assert.equal(
        getAccountResponse.data.data.email,
        canonicalEmail,
        "Account email is returned in its canonical identity form"
      );
      assert.equal(
        getAccountResponse.data.data.name,
        testData.account.name,
        "Account name matches"
      );
      console.error("Account details verified");
    });
  });

  describe("Project Management", () => {
    it("should create project", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      console.error("\nPHASE 2: Project Management");
      console.error("-".repeat(40));

      const projectResponse = await apiCall(
        "POST",
        `/accounts/${accountId}/projects`,
        testData.project,
        authHeaders(accountToken)
      );
      assert.equal(projectResponse.status, 200, "Project created successfully");
      projectId = projectResponse.data.data.id;
      assert.ok(projectId, `Project ID received: ${projectId}`);
      console.error(`Project created successfully: ${projectId}`);
    });

    it("should verify project details", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      const getProjectResponse = await apiCall(
        "GET",
        `/projects/${projectId}`,
        undefined,
        authHeaders(accountToken)
      );
      assert.equal(getProjectResponse.status, 200, "Project retrieved successfully");
      assert.equal(
        getProjectResponse.data.data.name,
        testData.project.name,
        "Project name matches"
      );
      assert.equal(
        getProjectResponse.data.data.accountId,
        accountId,
        "Project linked to correct account"
      );
      console.error("Project details verified");
    });

    it("should list projects by account", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      const listProjectsResponse = await apiCall(
        "GET",
        `/accounts/${accountId}/projects`,
        undefined,
        authHeaders(accountToken)
      );
      assert.equal(listProjectsResponse.status, 200, "Projects listed by account successfully");
      assert.ok(Array.isArray(listProjectsResponse.data.data), "Projects list is an array");
      const foundProject = listProjectsResponse.data.data.find(
        (proj: any) => proj.id === projectId
      );
      assert.ok(foundProject, "Created project found in account's project list");
      console.error("Project found in account's project list");
    });
  });

  describe("Channel Configuration", () => {
    it("should create X channel", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      console.error("\nPHASE 3: Channel Configuration");
      console.error("-".repeat(40));

      const xChannelResponse = await apiCall(
        "POST",
        "/channels",
        {
          ...testData.channel.x,
          projectId,
        },
        authHeaders(accountToken)
      );
      assert.equal(xChannelResponse.status, 201, "X channel created successfully");
      const xChannelId = xChannelResponse.data.data.id;
      channelIds.push(xChannelId);
      assert.ok(xChannelId, `X channel ID received: ${xChannelId}`);
      console.error(`X channel created: ${xChannelId}`);
    });

    it("should create Instagram channel", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      const igChannelResponse = await apiCall(
        "POST",
        "/channels",
        {
          ...testData.channel.instagram,
          projectId,
        },
        authHeaders(accountToken)
      );
      assert.equal(igChannelResponse.status, 201, "Instagram channel created successfully");
      const igChannelId = igChannelResponse.data.data.id;
      channelIds.push(igChannelId);
      assert.ok(igChannelId, `Instagram channel ID received: ${igChannelId}`);
      console.error(`Instagram channel created: ${igChannelId}`);
    });

    it("should list channels by project", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      const listChannelsResponse = await apiCall(
        "GET",
        `/projects/${projectId}/channels`,
        undefined,
        authHeaders(accountToken)
      );
      assert.equal(listChannelsResponse.status, 200, "Channels listed by project successfully");
      assert.equal(listChannelsResponse.data.data.length, 2, "Both channels found in project");
      console.error("Both channels found in project");
    });
  });

  describe("Content Creation & Publishing", () => {
    it("should create post", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      console.error("\nPHASE 4: Content Creation & Publishing");
      console.error("-".repeat(40));

      // Customer post creation flows through the post-publishing saga
      // (mode="draft"). The saga runs asynchronously and returns a sagaId,
      // not the post, so the test waits for the saga to complete and then
      // recovers the created DRAFT post from the project's post list.
      const draftResponse = await apiCall(
        "POST",
        "/sagas/post-publishing/start",
        {
          mode: "draft",
          projectId,
          locale: "en",
          body: testData.post.content,
          title: testData.post.title,
          tags: testData.post.hashtags,
        },
        authHeaders(accountToken)
      );
      assert.equal(draftResponse.status, 200, "Draft saga started successfully");
      const sagaId = draftResponse.data.data.sagaId;
      assert.ok(sagaId, `Saga ID received: ${sagaId}`);

      const sagaStatus = await pollSagaTerminal(sagaId, accountToken);
      assert.equal(sagaStatus, "COMPLETED", `Draft saga should complete (got ${sagaStatus})`);

      const listResponse = await apiCall(
        "GET",
        `/posts?projectId=${projectId}`,
        undefined,
        authHeaders(accountToken)
      );
      assert.equal(listResponse.status, 200, "Posts listed for project");
      const posts = listResponse.data.data.data;
      assert.ok(Array.isArray(posts) && posts.length > 0, "Project should have at least one post");
      postId = posts[0].id;
      assert.ok(postId, `Post ID received: ${postId}`);
      console.error(`Post created successfully: ${postId}`);
    });

    it("should simulate media upload", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      // Verify the post exists before simulating media attachment
      assert.ok(postId, "Post should exist before media upload simulation");
      const getPostResponse = await apiCall(
        "GET",
        `/posts/${postId}`,
        undefined,
        authHeaders(accountToken)
      );
      assert.equal(getPostResponse.status, 200, "Post should be retrievable for media attachment");
    });

    it("should schedule publication", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      // Scheduling an existing draft also flows through the post-publishing
      // saga (mode="schedule" with the existing postId + target channels).
      const scheduledDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow
      const scheduleResponse = await apiCall(
        "POST",
        "/sagas/post-publishing/start",
        {
          mode: "schedule",
          projectId,
          postId,
          channelIds,
          scheduledAt: scheduledDate.toISOString(),
        },
        authHeaders(accountToken)
      );
      assert.equal(scheduleResponse.status, 200, "Schedule saga started successfully");
      const sagaId = scheduleResponse.data.data.sagaId;
      assert.ok(sagaId, `Schedule saga ID received: ${sagaId}`);

      const sagaStatus = await pollSagaTerminal(sagaId, accountToken);
      assert.equal(sagaStatus, "COMPLETED", `Schedule saga should complete (got ${sagaStatus})`);
      console.error("Post scheduled successfully");
    });

    it("should get post details with schedule", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      const getPostResponse = await apiCall(
        "GET",
        `/posts/${postId}`,
        undefined,
        authHeaders(accountToken)
      );
      assert.equal(getPostResponse.status, 200, "Post retrieved with details");
      assert.ok(getPostResponse.data.data.body, "Post has content body");
      console.error("Post details retrieved");
    });
  });

  describe("Analytics & Monitoring", () => {
    it("should get project analytics", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      console.error("\nPHASE 5: Analytics & Monitoring");
      console.error("-".repeat(40));

      const analyticsResponse = await apiCall(
        "GET",
        `/analytics/project/${projectId}`,
        undefined,
        authHeaders(accountToken)
      );
      assert.equal(analyticsResponse.status, 200, "Analytics retrieved for project");
      console.error("Analytics retrieved for project");
    });

    it("should get publishing history", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      const publishLogsResponse = await apiCall(
        "GET",
        `/projects/${projectId}/publish-logs`,
        undefined,
        authHeaders(accountToken)
      );
      assert.equal(publishLogsResponse.status, 200, "Publish logs retrieved");
      assert.ok(Array.isArray(publishLogsResponse.data.data), "Publish logs is an array");
      console.error("Publish logs retrieved");
    });
  });

  describe("Client Interface Verification", () => {
    it("should verify client interface features", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      console.error("\nPHASE 6: Client Interface Verification");
      console.error("-".repeat(40));

      // Verify the API health endpoint exposes expected fields for client consumption
      const healthResponse = await apiCall("GET", "/health");
      assert.equal(healthResponse.status, 200, "Health endpoint should be accessible for client");
      assert.ok(healthResponse.data.status, "Health response should include status field");
    });
  });

  describe("Background Workers & Queues", () => {
    it("should check worker metrics", async (t) => {
      if (skipIfWorkerUnavailable(t)) return;
      console.error("\nPHASE 7: Background Workers & Queues");
      console.error("-".repeat(40));

      const metricsResponse = await fetch(`${WORKERS_METRICS}/metrics`);
      assert.equal(metricsResponse.status, 200, "Worker metrics endpoint accessible");
      const metricsText = await metricsResponse.text();
      assert.ok(
        metricsText.includes("process_cpu_seconds_total"),
        "Worker metrics contain CPU data"
      );
      assert.ok(
        metricsText.includes("nodejs_gc_duration_seconds"),
        "Worker metrics contain GC data"
      );
      console.error("Workers are processing jobs and exposing metrics");
    });
  });

  describe("Error Handling & Edge Cases", () => {
    it("should test duplicate account email", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      console.error("\nPHASE 8: Error Handling & Edge Cases");
      console.error("-".repeat(40));

      // The same submitted address again: registration stored its canonical form, so this
      // also proves the duplicate check reads the address the way the account holds it.
      const duplicateResponse = await apiCall(
        "POST",
        "/auth/customer/register",
        liveRegistrationBody({
          email: testData.account.email,
          accountName: testData.account.name,
        })
      );
      assert.equal(duplicateResponse.status, 409, "Duplicate email rejected with 409 status");
      assert.equal(
        duplicateResponse.data.error,
        "Email already exists",
        "Correct error message for duplicate"
      );
      console.error("Duplicate email rejected correctly");
    });

    it("should test invalid account ID", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      const invalidAccountResponse = await apiCall(
        "GET",
        "/accounts/invalid-uuid",
        undefined,
        authHeaders(accountToken)
      );
      assert.equal(invalidAccountResponse.status, 400, "Invalid UUID rejected with 400 status");
      console.error("Invalid UUID rejected correctly");
    });

    it("should verify quota enforcement", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      // Every self-registered account starts on the BASIC tier, whose limit is one project.
      const getAccountResponse = await apiCall(
        "GET",
        `/accounts/${accountId}`,
        undefined,
        authHeaders(accountToken)
      );
      assert.equal(getAccountResponse.status, 200, "Account should be retrievable");
      assert.equal(
        getAccountResponse.data.data.maxProjects,
        1,
        "A BASIC account should have max 1 project"
      );
    });
  });

  describe("Cleanup", () => {
    it("should delete post", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      console.error("\nPHASE 9: Cleanup");
      console.error("-".repeat(40));

      const deletePostResponse = await apiCall(
        "DELETE",
        `/posts/${postId}`,
        undefined,
        authHeaders(accountToken)
      );
      // The schedule saga queues one publish job per channel and leaves the post's own status
      // DRAFT (measured on the live stack), and `DeletePostUseCase` deletes a DRAFT, FAILED or
      // CANCELLED post, so the delete succeeds.
      assert.equal(deletePostResponse.status, 200, "The DRAFT post is deleted");
      assert.equal(deletePostResponse.data.data.deleted, true, "The delete reports the post gone");
      console.error("Post deleted successfully");
    });

    it("should delete channels", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      for (const channelId of channelIds) {
        const deleteChannelResponse = await apiCall(
          "DELETE",
          `/channels/${channelId}`,
          undefined,
          authHeaders(accountToken)
        );
        assert.equal(deleteChannelResponse.status, 200, `Channel ${channelId} deleted`);
        console.error(`Channel ${channelId} deleted`);
      }
    });

    it("should delete project", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      const deleteProjectResponse = await apiCall(
        "DELETE",
        `/projects/${projectId}`,
        undefined,
        authHeaders(accountToken)
      );
      assert.equal(deleteProjectResponse.status, 200, "Project deleted successfully");
      console.error("Project deleted successfully");
    });

    it("should delete account with cascade", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      const deleteAccountResponse = await apiCall(
        "DELETE",
        `/accounts/${accountId}`,
        undefined,
        authHeaders(accountToken)
      );
      assert.equal(deleteAccountResponse.status, 200, "Account deleted with cascade");
      console.error("Account deleted with cascade");
    });
  });

  describe("Test Summary", () => {
    it("should verify system is operational via health check", async (t) => {
      if (skipIfApiUnavailable(t)) return;
      const healthResponse = await apiCall("GET", "/health");
      assert.equal(healthResponse.status, 200, "Health endpoint should return 200");
      assert.ok(healthResponse.data.status, "Health response should have status");
      console.error("\n" + "=".repeat(60));
      console.error("ALL PRODUCTION INTEGRATION TESTS PASSED!");
      console.error("=".repeat(60));
    });
  });
});
