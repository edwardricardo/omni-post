/**
 * @file DlqArchivalService.test.ts
 * @description Unit tests for DlqArchivalService — soft-archival of resolved
 *   DLQ events and flagging of stale unresolved events. Post-S4.2 the
 *   service is framework-free; tests mock the archival port.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { DlqArchivalService } from "@core/webhooks/DlqArchivalService.js";
import type { WebhookDeadLetterArchivalPort } from "@core/domain/repositories/WebhookDeadLetterArchivalPort.js";

function makeArchivalPort(): WebhookDeadLetterArchivalPort {
  return {
    archiveResolvedBefore: vi.fn().mockResolvedValue({ ok: true, value: 0 }),
    findStaleUnresolved: vi.fn().mockResolvedValue({ ok: true, value: [] }),
  };
}

// ===========================
// archiveResolvedEvents Tests (5 tests)
// ===========================

describe("DlqArchivalService - archiveResolvedEvents", () => {
  let service: DlqArchivalService;
  let archivalRepo: WebhookDeadLetterArchivalPort;

  beforeEach(() => {
    vi.clearAllMocks();
    archivalRepo = makeArchivalPort();
    service = new DlqArchivalService(archivalRepo);
  });

  it("archives resolved events older than retentionDays", async () => {
    (archivalRepo.archiveResolvedBefore as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: 5,
    });

    const result = await service.archiveResolvedEvents(30);

    assert.strictEqual(result.archived, 5);
    expect(archivalRepo.archiveResolvedBefore).toHaveBeenCalledTimes(1);
    const cutoffArg = (archivalRepo.archiveResolvedBefore as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as Date;
    expect(cutoffArg).toBeInstanceOf(Date);
  });

  it("uses correct cutoff date based on retentionDays", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    await service.archiveResolvedEvents(90);

    const cutoffArg = (archivalRepo.archiveResolvedBefore as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as Date;
    const expectedCutoff = new Date(now - 90 * 24 * 60 * 60 * 1000);
    assert.strictEqual(cutoffArg.getTime(), expectedCutoff.getTime());

    vi.restoreAllMocks();
  });

  it("returns count from port result", async () => {
    (archivalRepo.archiveResolvedBefore as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: 42,
    });

    const result = await service.archiveResolvedEvents(7);

    assert.strictEqual(result.archived, 42);
  });

  it("returns 0 when no events qualify for archival", async () => {
    (archivalRepo.archiveResolvedBefore as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: 0,
    });

    const result = await service.archiveResolvedEvents(30);

    assert.strictEqual(result.archived, 0);
  });

  it("returns 0 when the port fails (DATABASE_ERROR)", async () => {
    (archivalRepo.archiveResolvedBefore as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: "DATABASE_ERROR",
    });

    const result = await service.archiveResolvedEvents(30);

    assert.strictEqual(result.archived, 0);
  });
});

// ===========================
// flagStaleEvents Tests (5 tests)
// ===========================

describe("DlqArchivalService - flagStaleEvents", () => {
  let service: DlqArchivalService;
  let archivalRepo: WebhookDeadLetterArchivalPort;

  beforeEach(() => {
    vi.clearAllMocks();
    archivalRepo = makeArchivalPort();
    service = new DlqArchivalService(archivalRepo);
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
    (archivalRepo.findStaleUnresolved as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: staleEvents,
    });

    const result = await service.flagStaleEvents(14);

    assert.strictEqual(result.stale, 2);
    assert.deepStrictEqual(result.eventIds, ["evt-1", "evt-2"]);
  });

  it("delegates to the archival port with a cutoff Date", async () => {
    await service.flagStaleEvents(7);

    expect(archivalRepo.findStaleUnresolved).toHaveBeenCalledTimes(1);
    const cutoffArg = (archivalRepo.findStaleUnresolved as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as Date;
    expect(cutoffArg).toBeInstanceOf(Date);
  });

  it("uses correct cutoff date for staleAfterDays", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    await service.flagStaleEvents(21);

    const cutoffArg = (archivalRepo.findStaleUnresolved as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as Date;
    const expectedCutoff = new Date(now - 21 * 24 * 60 * 60 * 1000);
    assert.strictEqual(cutoffArg.getTime(), expectedCutoff.getTime());

    vi.restoreAllMocks();
  });

  it("returns count and IDs of stale events", async () => {
    const staleEvents = [
      { id: "stale-a", provider: "INSTAGRAM", eventType: "API_ERROR", firstFailedAt: new Date() },
    ];
    (archivalRepo.findStaleUnresolved as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: staleEvents,
    });

    const result = await service.flagStaleEvents(30);

    assert.strictEqual(result.stale, 1);
    assert.deepStrictEqual(result.eventIds, ["stale-a"]);
  });

  it("returns empty result when no stale events exist", async () => {
    (archivalRepo.findStaleUnresolved as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: [],
    });

    const result = await service.flagStaleEvents(7);

    assert.strictEqual(result.stale, 0);
    assert.deepStrictEqual(result.eventIds, []);
  });
});
