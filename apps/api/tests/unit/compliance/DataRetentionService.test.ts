/**
 * @file DataRetentionService.test.ts
 * @description Unit tests for DataRetentionService — automated data retention cleanup
 *              including audit log deletion and DSAR request expiration.
 * @layer test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { PrismaClient } from "@infra/prisma";
import { DataRetentionService } from "../../../src/compliance/DataRetentionService.js";

// ===========================
// Mock Factory
// ===========================

function makeMockPrisma() {
  return {
    gdprSettings: {
      findFirst: vi.fn(),
    },
    auditLog: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({}),
    },
    dsarRequest: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

// ===========================
// Guard: enableAutoDataDeletion=false (4 tests)
// ===========================

describe("DataRetentionService - guard (auto-deletion disabled)", () => {
  let service: DataRetentionService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = makeMockPrisma();
    service = new DataRetentionService(mockPrisma as unknown as PrismaClient);
  });

  it("returns zeros when enableAutoDataDeletion is false", async () => {
    mockPrisma.gdprSettings.findFirst.mockResolvedValue({ enableAutoDataDeletion: false });

    const result = await service.runRetentionCleanup();

    assert.strictEqual(result.auditLogsDeleted, 0);
    assert.strictEqual(result.expiredDsarRequests, 0);
  });

  it("returns zeros when no gdprSettings record exists", async () => {
    mockPrisma.gdprSettings.findFirst.mockResolvedValue(null);

    const result = await service.runRetentionCleanup();

    assert.strictEqual(result.auditLogsDeleted, 0);
    assert.strictEqual(result.expiredDsarRequests, 0);
  });

  it("does not query auditLog when disabled", async () => {
    mockPrisma.gdprSettings.findFirst.mockResolvedValue({ enableAutoDataDeletion: false });

    await service.runRetentionCleanup();

    expect(mockPrisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });

  it("does not query dsarRequest when disabled", async () => {
    mockPrisma.gdprSettings.findFirst.mockResolvedValue({ enableAutoDataDeletion: false });

    await service.runRetentionCleanup();

    expect(mockPrisma.dsarRequest.updateMany).not.toHaveBeenCalled();
  });
});

// ===========================
// Active: enableAutoDataDeletion=true (8 tests)
// ===========================

describe("DataRetentionService - active cleanup", () => {
  let service: DataRetentionService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;

  const activeSettings = {
    enableAutoDataDeletion: true,
    auditLogRetentionDays: 90,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = makeMockPrisma();
    service = new DataRetentionService(mockPrisma as unknown as PrismaClient);
    mockPrisma.gdprSettings.findFirst.mockResolvedValue(activeSettings);
  });

  it("deletes audit logs older than retention period", async () => {
    mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 15 });

    const result = await service.runRetentionCleanup();

    assert.strictEqual(result.auditLogsDeleted, 15);
    expect(mockPrisma.auditLog.deleteMany).toHaveBeenCalledTimes(1);

    const call = mockPrisma.auditLog.deleteMany.mock.calls[0]![0]!;
    const where = call.where as Record<string, Record<string, Date>>;
    expect(where.createdAt).toHaveProperty("lt");
    expect(where.createdAt.lt).toBeInstanceOf(Date);
  });

  it("uses correct cutoff based on auditLogRetentionDays", async () => {
    const before = Date.now();
    await service.runRetentionCleanup();
    const after = Date.now();

    const call = mockPrisma.auditLog.deleteMany.mock.calls[0]![0]!;
    const cutoff = (call.where as Record<string, Record<string, Date>>).createdAt.lt;
    const retentionMs = 90 * 24 * 60 * 60 * 1000;
    // Cutoff should be within the time window accounting for execution time
    assert.ok(cutoff.getTime() >= before - retentionMs - 100);
    assert.ok(cutoff.getTime() <= after - retentionMs + 100);
  });

  it("marks PENDING DSAR requests as expired when past deadline", async () => {
    mockPrisma.dsarRequest.updateMany.mockResolvedValue({ count: 3 });

    const result = await service.runRetentionCleanup();

    assert.strictEqual(result.expiredDsarRequests, 3);

    const call = mockPrisma.dsarRequest.updateMany.mock.calls[0]![0]!;
    const where = call.where as Record<string, Record<string, unknown>>;
    expect((where.status as Record<string, string[]>).in).toContain("PENDING");
    expect(call.data).toEqual({ status: "EXPIRED" });
  });

  it("marks IN_PROGRESS DSAR requests as expired when past deadline", async () => {
    mockPrisma.dsarRequest.updateMany.mockResolvedValue({ count: 2 });

    await service.runRetentionCleanup();

    const call = mockPrisma.dsarRequest.updateMany.mock.calls[0]![0]!;
    const where = call.where as Record<string, Record<string, unknown>>;
    expect((where.status as Record<string, string[]>).in).toContain("IN_PROGRESS");
  });

  it("does not expire COMPLETED or REJECTED DSAR requests (only PENDING, IN_PROGRESS)", async () => {
    await service.runRetentionCleanup();

    const call = mockPrisma.dsarRequest.updateMany.mock.calls[0]![0]!;
    const where = call.where as Record<string, Record<string, unknown>>;
    const statusIn = (where.status as Record<string, string[]>).in;

    expect(statusIn).not.toContain("COMPLETED");
    expect(statusIn).not.toContain("REJECTED");
    assert.strictEqual(statusIn.length, 2);
  });

  it("filters DSAR requests by deadlineAt < now", async () => {
    await service.runRetentionCleanup();

    const call = mockPrisma.dsarRequest.updateMany.mock.calls[0]![0]!;
    const where = call.where as Record<string, Record<string, Date>>;
    expect(where.deadlineAt).toHaveProperty("lt");
    expect(where.deadlineAt.lt).toBeInstanceOf(Date);
  });

  it("writes cleanup summary to audit log", async () => {
    mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 10 });
    mockPrisma.dsarRequest.updateMany.mockResolvedValue({ count: 4 });

    await service.runRetentionCleanup();

    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);

    const createCall = mockPrisma.auditLog.create.mock.calls[0]![0]!;
    const data = createCall.data as Record<string, unknown>;
    assert.strictEqual(data.action, "DATA_RETENTION_CLEANUP");
    assert.strictEqual(data.resource, "system");
    assert.strictEqual(data.success, true);
    expect(data.details).toEqual({ auditLogsDeleted: 10, expiredDsarRequests: 4 });
  });

  it("returns both counts in the result", async () => {
    mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 7 });
    mockPrisma.dsarRequest.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.runRetentionCleanup();

    assert.strictEqual(result.auditLogsDeleted, 7);
    assert.strictEqual(result.expiredDsarRequests, 1);
  });
});
