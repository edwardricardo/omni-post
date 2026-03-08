/**
 * Unit Tests for PlatformContentAdapter - Simple Smoke Test
 *
 * Verifies that the adapter correctly handles Twitter/X content adaptation
 * including character-limit enforcement on a body that exceeds 280 chars.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import Redis from "ioredis";
import promClient from "prom-client";
import { PlatformContentAdapter } from "../../src/content/PlatformContentAdapter";
import { EventService } from "../../src/events/EventService";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../../src/providers/providerAdapter.interface";

describe("PlatformContentAdapter - Simple Test", { concurrency: 1 }, () => {
  let adapter: PlatformContentAdapter;
  let prisma: PrismaClient;
  let redis: Redis;

  before(async () => {
    prisma = createTestPrismaClient();
    redis = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
    });

    const eventService = new EventService({
      prisma,
      redis,
      enableMetrics: false,
      enableReplay: false,
    });

    adapter = new PlatformContentAdapter({
      prisma,
      redis,
      eventService,
    });

    await adapter.initialize();
  });

  after(async () => {
    promClient.register.clear();
    redis.disconnect(false);
    await prisma.$disconnect();
  });

  it("should adapt content for Twitter/X and enforce 280-char limit", async () => {
    const samplePost: CanonicalPost = {
      id: "test-1",
      body: "A".repeat(300), // Exceeds 280 limit
      media: [],
      tags: ["testing"],
      scheduledAt: new Date(),
    };

    const result = await adapter.adaptForSingleProvider(samplePost, "x" as ProviderId);

    assert.strictEqual(result.ok, true, "Adaptation should succeed");
    if (result.ok) {
      assert.ok(
        result.value.adaptedContent.body.length <= 280,
        `Adapted body should be <=280 chars, got ${result.value.adaptedContent.body.length}`
      );
    }
  });
});
