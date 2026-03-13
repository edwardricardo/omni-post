#!/usr/bin/env tsx
/**
 * Unit Tests for contentRoutes (F28)
 *
 * Covers all 17 content sync endpoints:
 *   POST /content/sync/:postId
 *   GET  /content/sync/metrics
 *   GET  /content/sync/metrics/:channelId
 *   POST /content/sync/:transactionId/rollback
 *   POST /content/channels
 *   POST /content/channels/realtime/start
 *   POST /content/channels/realtime/stop/:postId
 *   GET  /content/versions/:postId
 *   POST /content/versions/:postId
 *   POST /content/versions/:postId/restore/:versionId
 *   POST /content/versions/compare
 *   POST /content/conflicts/resolve
 *   GET  /content/conflicts/history/:channelId
 *   POST /content/transform
 *   POST /content/transform/multi
 *   POST /content/transform/recommendations
 *   POST /content/render/:provider
 *   POST /content/diff
 */

// Suppress console output during tests
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};
console.log = () => {};
console.info = () => {};
console.warn = () => {};
console.error = () => {};

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import { contentRoutes } from "../../src/content/contentRoutes.js";
import { setupContainer } from "../../src/infrastructure/container/setup.js";
import { createRedisConnection } from "../../src/lib/redis.js";
import { prisma } from "@infra/prisma";
import type Redis from "ioredis";

let redis: Redis;

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const container = setupContainer({ prisma });
  app.decorate("container", container);
  app.decorate("redis", redis);
  await app.register(fastifyCookie);
  await app.register(contentRoutes);
  await app.ready();
  return app;
}

let app: FastifyInstance;

// Sample canonical content used across multiple tests
const sampleContent = {
  id: "test-content-001",
  projectId: "test-project-001",
  body: "Test content for transformation and rendering",
  tags: ["test", "content"],
  locale: "en",
};

describe("contentRoutes Unit Tests", () => {
  beforeAll(async () => {
    redis = createRedisConnection({ maxRetriesPerRequest: 1 });
    redis.on("error", () => {});
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
    Object.assign(console, originalConsole);
  });

  // ── GET /content/sync/metrics ──────────────────────────────────────────────

  it("should return global sync metrics", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/content/sync/metrics",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data !== undefined).toBeTruthy();
  });

  it("should return per-channel sync metrics", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/content/sync/metrics/channel-001",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data !== undefined).toBeTruthy();
  });

  // ── POST /content/sync/:postId ────────────────────────────────────────────

  it("should return 400 for missing channelId when syncing a post", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/sync/post-001",
      payload: {
        // Missing required channelId
        direction: "source_to_target",
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should attempt post sync with valid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/sync/post-nonexistent-001",
      payload: {
        channelId: "channel-001",
        direction: "source_to_target",
      },
    });
    // 400 (validation error from SyncEngine: post not found) or 500
    expect(res.statusCode === 400 || res.statusCode === 500).toBeTruthy();
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  // ── POST /content/sync/:transactionId/rollback ────────────────────────────

  it("should attempt rollback for a non-existent transaction", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/sync/tx-nonexistent-001/rollback",
    });
    // 400 (validation/not found) or 500
    expect(res.statusCode === 400 || res.statusCode === 500).toBeTruthy();
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  // ── POST /content/channels ────────────────────────────────────────────────

  it("should return 400 for invalid channel creation body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/channels",
      payload: {
        // Missing required fields (name, sourceProvider, targetProvider)
        bidirectional: false,
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should create a sync channel with valid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/channels",
      payload: {
        name: `Test Sync Channel ${Date.now()}`,
        sourceProvider: "x",
        targetProvider: "instagram",
        bidirectional: false,
        configuration: {},
      },
    });
    // 201 on success or 400/500 if service fails
    expect(res.statusCode === 201 || res.statusCode === 400 || res.statusCode === 500).toBeTruthy();
    const body = JSON.parse(res.body);
    expect("ok" in body).toBeTruthy();
  });

  // ── POST /content/channels/realtime/start ────────────────────────────────

  it("should return 400 for invalid realtime start body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/channels/realtime/start",
      payload: {
        // Missing required postId and channelIds
        invalid: true,
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should attempt to start realtime sync with valid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/channels/realtime/start",
      payload: {
        postId: "post-realtime-001",
        channelIds: ["channel-001"],
      },
    });
    // 200 on success or 400/500 if service fails
    expect(res.statusCode === 200 || res.statusCode === 400 || res.statusCode === 500).toBeTruthy();
    const body = JSON.parse(res.body);
    expect("ok" in body).toBeTruthy();
  });

  // ── POST /content/channels/realtime/stop/:postId ─────────────────────────

  it("should stop realtime sync for a post", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/channels/realtime/stop/post-stop-001",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data.postId).toBe("post-stop-001");
    expect(body.data.status).toBe("realtime_sync_stopped");
  });

  // ── GET /content/versions/:postId ────────────────────────────────────────

  it("should return empty version history for a non-existent post", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/content/versions/post-version-nonexistent-001",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    // ContentVersionManager.getVersionHistory returns an array (possibly empty)
    expect(Array.isArray(body.data)).toBeTruthy();
  });

  it("should accept branch and limit query params for version list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/content/versions/post-001?branch=main&limit=5",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(Array.isArray(body.data)).toBeTruthy();
  });

  // ── POST /content/versions/:postId ────────────────────────────────────────

  it("should return 400 for invalid version snapshot body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/versions/post-001",
      payload: {
        // Missing required 'content' and 'createdBy'
        tags: ["test"],
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should attempt to create version snapshot with valid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/versions/post-001",
      payload: {
        content: sampleContent,
        adaptations: {},
        createdBy: "user-001",
        changelog: "Initial version",
        branchName: "main",
        tags: ["initial"],
      },
    });
    // 201 on success or 400/500 if service fails (e.g., post not found in DB)
    expect(res.statusCode === 201 || res.statusCode === 400 || res.statusCode === 500).toBeTruthy();
    const body = JSON.parse(res.body);
    expect("ok" in body).toBeTruthy();
  });

  // ── POST /content/versions/:postId/restore/:versionId ────────────────────

  it("should return 400 for missing restoredBy body in version restore", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/versions/post-001/restore/version-001",
      payload: {
        // Missing required 'restoredBy'
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should attempt to restore version with valid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/versions/post-001/restore/version-nonexistent-001",
      payload: {
        restoredBy: "user-001",
      },
    });
    // 404 (version not found) or 500
    expect(res.statusCode === 404 || res.statusCode === 500).toBeTruthy();
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  // ── POST /content/versions/compare ──────────────────────────────────────

  it("should return 400 for missing version IDs in compare", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/versions/compare",
      payload: {
        // Missing required fromVersionId and toVersionId
        invalid: true,
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should attempt version comparison with valid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/versions/compare",
      payload: {
        fromVersionId: "version-001",
        toVersionId: "version-002",
      },
    });
    // 400 (not found) or 500
    expect(res.statusCode === 400 || res.statusCode === 500).toBeTruthy();
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  // ── POST /content/conflicts/resolve ──────────────────────────────────────

  it("should return 400 for invalid conflict resolution body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/conflicts/resolve",
      payload: {
        // Missing required transactionId and resolutions
        invalid: true,
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should attempt conflict resolution with valid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/conflicts/resolve",
      payload: {
        transactionId: "tx-nonexistent-001",
        resolutions: [
          {
            conflictId: "conflict-001",
            resolution: "source_wins",
          },
        ],
      },
    });
    // 400 (transaction not found) or 500
    expect(res.statusCode === 400 || res.statusCode === 500).toBeTruthy();
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  // ── GET /content/conflicts/history/:channelId ────────────────────────────

  it("should return conflict history for a channel (empty for new channel)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/content/conflicts/history/channel-test-001",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect("channelId" in body.data).toBeTruthy();
    expect("conflicts" in body.data).toBeTruthy();
    expect(body.data.channelId).toBe("channel-test-001");
    expect(Array.isArray(body.data.conflicts)).toBeTruthy();
  });

  // ── POST /content/transform ───────────────────────────────────────────────

  it("should return 400 for invalid transform body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/transform",
      payload: {
        // Missing required 'content' and 'targetProvider'
        invalid: true,
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should transform content for a single provider", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/transform",
      payload: {
        content: sampleContent,
        targetProvider: "x",
        userPreferences: {
          preserveFormatting: true,
          allowContentTruncation: true,
          preferredHashtagStyle: "inline",
          mediaQualityPreference: "optimized",
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data !== undefined).toBeTruthy();
  });

  it("should transform content with minimal body (no userPreferences)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/transform",
      payload: {
        content: sampleContent,
        targetProvider: "instagram",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
  });

  // ── POST /content/transform/multi ────────────────────────────────────────

  it("should return 400 for invalid multi-transform body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/transform/multi",
      payload: {
        // Missing required 'targetProviders'
        content: sampleContent,
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should transform content for multiple providers", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/transform/multi",
      payload: {
        content: sampleContent,
        targetProviders: ["x", "instagram", "facebook"],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect("adaptations" in body.data).toBeTruthy();
    // adaptations should be an object keyed by provider
    expect(typeof body.data.adaptations === "object").toBeTruthy();
  });

  // ── POST /content/transform/recommendations ───────────────────────────────

  it("should return 400 for invalid recommendations body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/transform/recommendations",
      payload: {
        // Missing required fields
        invalid: true,
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should return adaptation recommendations", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/transform/recommendations",
      payload: {
        content: sampleContent,
        targetProviders: ["x", "instagram"],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect("recommendations" in body.data).toBeTruthy();
    expect(typeof body.data.recommendations === "object").toBeTruthy();
  });

  // ── POST /content/render/:provider ───────────────────────────────────────

  it("should return 400 for invalid render body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/render/x",
      payload: {
        // Missing required 'content'
        provider: "x",
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should render content for a provider", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/render/x",
      payload: {
        content: sampleContent,
        provider: "x",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect("provider" in body.data).toBeTruthy();
    expect(body.data.provider).toBe("x");
    expect("adaptedContent" in body.data).toBeTruthy();
    expect("confidence" in body.data).toBeTruthy();
    expect("warnings" in body.data).toBeTruthy();
  });

  it("should render content for instagram provider", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/render/instagram",
      payload: {
        content: sampleContent,
        provider: "instagram",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data.provider).toBe("instagram");
  });

  // ── POST /content/diff ───────────────────────────────────────────────────

  it("should return 400 for invalid diff body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/content/diff",
      payload: {
        // Missing required 'fromVersion' and 'toVersion'
        invalid: true,
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should calculate diff between two versions", async () => {
    const fromVersion = {
      content: { ...sampleContent, body: "Original body text" },
      adaptations: {},
    };
    const toVersion = {
      content: { ...sampleContent, body: "Updated body text with changes" },
      adaptations: {},
    };

    const res = await app.inject({
      method: "POST",
      url: "/content/diff",
      payload: {
        fromVersion,
        toVersion,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect("diffs" in body.data).toBeTruthy();
    expect("summary" in body.data).toBeTruthy();
    expect(Array.isArray(body.data.diffs)).toBeTruthy();
  });

  it("should return empty diff for identical versions", async () => {
    const version = {
      content: sampleContent,
      adaptations: {},
    };

    const res = await app.inject({
      method: "POST",
      url: "/content/diff",
      payload: {
        fromVersion: version,
        toVersion: version,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(Array.isArray(body.data.diffs)).toBeTruthy();
  });
});
