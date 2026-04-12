/**
 * @file DlqArchivalService.test.ts
 * @description Unit tests for DlqArchivalService — soft-archival of resolved DLQ events
 *              and flagging of stale unresolved events.
 * @layer test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { PrismaClient } from "@infra/prisma";
import { DlqArchivalService } from "../../../src/webhooks/DlqArchivalService.js";

// ===========================
// Mock Factory
// ===========================

function makeMockPrisma() {
  return {
    webhookDeadLetter: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

// ===========================
// archiveResolvedEvents Tests (5 tests)
// ===========================

describe("DlqArchivalService - archiveResolvedEvents", () => {
  let service: DlqArchivalService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = makeMockPrisma();
    service = new DlqArchivalService(mockPrisma as unknown as PrismaClient);
  });

  it("archives resolved events older than retentionDays", async () => {
    mockPrisma.webhookDeadLetter.updateMany.mockResolvedValue({ count: 5 });

    const result = await service.archiveResolvedEvents(30);

    assert.strictEqual(result.archived, 5);

    const call = mockPrisma.webhookDeadLetter.updateMany.mock.calls[0]![0]!;
    const where = call.where as Record<string, unknown>;
    expect(where).toHaveProperty("resolvedAt");
    expect(where).toHaveProperty("archivedAt", null);
    expect(call.data).toHaveProperty("archivedAt");
  });

  it("uses correct cutoff date based on retentionDays", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    await service.archiveResolvedEvents(90);

    const call = mockPrisma.webhookDeadLetter.updateMany.mock.calls[0]![0]!;
    const resolvedAt = (call.where as Record<string, Record<string, Date>>).resolvedAt;
    const expectedCutoff = new Date(now - 90 * 24 * 60 * 60 * 1000);
    assert.strictEqual(resolvedAt.lt.getTime(), expectedCutoff.getTime());

    vi.restoreAllMocks();
  });

  it("skips unresolved events (resolvedAt filter requires not null)", async () => {
    await service.archiveResolvedEvents(30);

    const call = mockPrisma.webhookDeadLetter.updateMany.mock.calls[0]![0]!;
    const where = call.where as Record<string, Record<string, unknown>>;
    expect(where.resolvedAt).toHaveProperty("not", null);
  });

  it("returns count from updateMany result", async () => {
    mockPrisma.webhookDeadLetter.updateMany.mockResolvedValue({ count: 42 });

    const result = await service.archiveResolvedEvents(7);

    assert.strictEqual(result.archived, 42);
  });

  it("returns 0 when no events qualify for archival", async () => {
    mockPrisma.webhookDeadLetter.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.archiveResolvedEvents(30);

    assert.strictEqual(result.archived, 0);
  });
});

// ===========================
// flagStaleEvents Tests (5 tests)
// ===========================

describe("DlqArchivalService - flagStaleEvents", () => {
  let service: DlqArchivalService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = makeMockPrisma();
    service = new DlqArchivalService(mockPrisma as unknown as PrismaClient);
  });

  it("finds stale unresolved events older than staleAfterDays", async () => {
    const staleEvents = [
      {
        id: "evt-1",
        provider: "X",
        eventType: "POST_PUBLISHED",
        firstFailedAt: new Date("2024-01-01"),
      },
      {
        id: "evt-2",
        provider: "FACEBOOK",
        eventType: "COMMENT_RECEIVED",
        firstFailedAt: new Date("2024-01-05"),
      },
    ];
    mockPrisma.webhookDeadLetter.findMany.mockResolvedValue(staleEvents);

    const result = await service.flagStaleEvents(14);

    assert.strictEqual(result.stale, 2);
    assert.deepStrictEqual(result.eventIds, ["evt-1", "evt-2"]);
  });

  it("queries for unresolved and non-archived events only", async () => {
    await service.flagStaleEvents(7);

    const call = mockPrisma.webhookDeadLetter.findMany.mock.calls[0]![0]!;
    const where = call.where as Record<string, unknown>;
    assert.strictEqual(where.resolvedAt, null);
    assert.strictEqual(where.archivedAt, null);
  });

  it("uses correct cutoff date for staleAfterDays", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    await service.flagStaleEvents(21);

    const call = mockPrisma.webhookDeadLetter.findMany.mock.calls[0]![0]!;
    const firstFailedAt = (call.where as Record<string, Record<string, Date>>).firstFailedAt;
    const expectedCutoff = new Date(now - 21 * 24 * 60 * 60 * 1000);
    assert.strictEqual(firstFailedAt.lt.getTime(), expectedCutoff.getTime());

    vi.restoreAllMocks();
  });

  it("returns count and IDs of stale events", async () => {
    const staleEvents = [
      { id: "stale-a", provider: "INSTAGRAM", eventType: "API_ERROR", firstFailedAt: new Date() },
    ];
    mockPrisma.webhookDeadLetter.findMany.mockResolvedValue(staleEvents);

    const result = await service.flagStaleEvents(30);

    assert.strictEqual(result.stale, 1);
    assert.deepStrictEqual(result.eventIds, ["stale-a"]);
  });

  it("returns empty result when no stale events exist", async () => {
    mockPrisma.webhookDeadLetter.findMany.mockResolvedValue([]);

    const result = await service.flagStaleEvents(7);

    assert.strictEqual(result.stale, 0);
    assert.deepStrictEqual(result.eventIds, []);
  });
});
