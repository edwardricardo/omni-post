/**
 * Unit Tests for PlatformContentAdapter - Simple Smoke Test
 *
 * Verifies that the adapter correctly handles Twitter/X content adaptation
 * including character-limit enforcement on a body that exceeds 280 chars.
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { prisma } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import promClient from "prom-client";
import { PlatformContentAdapter } from "../../src/content/PlatformContentAdapter";
import type { EventService } from "../../src/events/EventService";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../../src/providers/providerAdapter.interface";

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

/** Minimal Redis mock — no real connection needed for content adaptation logic */
const mockRedis = {
  get: vi.fn(async () => null),
  set: vi.fn(async () => "OK"),
  setex: vi.fn(async () => "OK"),
  del: vi.fn(async () => 1),
  hget: vi.fn(async () => null),
  hset: vi.fn(async () => 1),
  hexists: vi.fn(async () => 0),
  keys: vi.fn(async () => []),
  lpush: vi.fn(async () => 1),
  lrange: vi.fn(async () => []),
  xack: vi.fn(async () => 0),
  xgroup: vi.fn(async () => "OK"),
  xreadgroup: vi.fn(async () => null),
  disconnect: vi.fn(),
  quit: vi.fn(),
  status: "ready",
} as unknown as import("ioredis").default;

describe("PlatformContentAdapter - Simple Test", () => {
  let adapter: PlatformContentAdapter;

  beforeAll(async () => {
    const eventService: Pick<EventService, "publishEvent"> = {
      publishEvent: async () => ({ ok: true as const, value: undefined }),
    };

    adapter = new PlatformContentAdapter({
      prisma: prisma as unknown as PrismaClient,
      redis: mockRedis,
      eventService: eventService as EventService,
    });

    await adapter.initialize();
  });

  afterAll(async () => {
    promClient.register.clear();
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

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.adaptedContent.body.length <= 280).toBeTruthy();
    }
  });
});
