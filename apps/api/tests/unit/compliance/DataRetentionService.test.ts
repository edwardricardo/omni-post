/**
 * @file DataRetentionService.test.ts
 * @description Unit tests for DataRetentionService — automated data
 *   retention cleanup including audit log deletion and DSAR request
 *   expiration. Post-S4.1 the service is framework-free; tests mock the
 *   4 ports (GdprSettings, AuditLogRetention, DsarRequest, AuditEmitter).
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { DataRetentionService } from "../../../src/compliance/DataRetentionService.js";
import type { GdprSettingsRepository } from "@core/domain/repositories/GdprSettingsRepository.js";
import type { AuditLogRetentionPort } from "@core/domain/repositories/AuditLogRetentionPort.js";
import type { DsarRequestRepository } from "@core/domain/repositories/DsarRequestRepository.js";
import type { AuditEmitterPort } from "@core/domain/repositories/AuditEmitterPort.js";

// ===========================
// Mock Factories
// ===========================

function makeGdprRepo(): GdprSettingsRepository {
  return {
    findSingleton: vi.fn().mockResolvedValue({ ok: true, value: null }),
    createDefault: vi.fn(),
    update: vi.fn(),
  };
}

function makeAuditLogRetention(): AuditLogRetentionPort {
  return {
    countSince: vi.fn().mockResolvedValue({ ok: true, value: 0 }),
    deleteOlderThan: vi.fn().mockResolvedValue({ ok: true, value: 0 }),
  };
}

function makeDsarRepo(): DsarRequestRepository {
  return {
    listWithAccount: vi.fn(),
    findByIdWithAccount: vi.fn(),
    findById: vi.fn(),
    countPendingByEmail: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    markOverdueAsExpired: vi.fn().mockResolvedValue({ ok: true, value: 0 }),
  };
}

function makeAuditEmitter(): AuditEmitterPort {
  return { emit: vi.fn().mockResolvedValue(undefined) };
}

// ===========================
// Guard: enableAutoDataDeletion=false (4 tests)
// ===========================

describe("DataRetentionService - guard (auto-deletion disabled)", () => {
  let service: DataRetentionService;
  let gdpr: GdprSettingsRepository;
  let auditLog: AuditLogRetentionPort;
  let dsar: DsarRequestRepository;
  let audit: AuditEmitterPort;

  beforeEach(() => {
    vi.clearAllMocks();
    gdpr = makeGdprRepo();
    auditLog = makeAuditLogRetention();
    dsar = makeDsarRepo();
    audit = makeAuditEmitter();
    service = new DataRetentionService(gdpr, auditLog, dsar, audit);
  });

  it("returns zeros when enableAutoDataDeletion is false", async () => {
    (gdpr.findSingleton as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: { enableAutoDataDeletion: false },
    });

    const result = await service.runRetentionCleanup();

    assert.strictEqual(result.auditLogsDeleted, 0);
    assert.strictEqual(result.expiredDsarRequests, 0);
  });

  it("returns zeros when no gdprSettings record exists", async () => {
    (gdpr.findSingleton as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: null,
    });

    const result = await service.runRetentionCleanup();

    assert.strictEqual(result.auditLogsDeleted, 0);
    assert.strictEqual(result.expiredDsarRequests, 0);
  });

  it("does not call auditLog.deleteOlderThan when disabled", async () => {
    (gdpr.findSingleton as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: { enableAutoDataDeletion: false },
    });

    await service.runRetentionCleanup();

    expect(auditLog.deleteOlderThan).not.toHaveBeenCalled();
  });

  it("does not call dsar.markOverdueAsExpired when disabled", async () => {
    (gdpr.findSingleton as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: { enableAutoDataDeletion: false },
    });

    await service.runRetentionCleanup();

    expect(dsar.markOverdueAsExpired).not.toHaveBeenCalled();
  });
});

// ===========================
// Active: enableAutoDataDeletion=true (8 tests)
// ===========================

describe("DataRetentionService - active cleanup", () => {
  let service: DataRetentionService;
  let gdpr: GdprSettingsRepository;
  let auditLog: AuditLogRetentionPort;
  let dsar: DsarRequestRepository;
  let audit: AuditEmitterPort;

  const activeSettings = {
    enableAutoDataDeletion: true,
    auditLogRetentionDays: 90,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    gdpr = makeGdprRepo();
    auditLog = makeAuditLogRetention();
    dsar = makeDsarRepo();
    audit = makeAuditEmitter();
    service = new DataRetentionService(gdpr, auditLog, dsar, audit);
    (gdpr.findSingleton as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: activeSettings,
    });
  });

  it("deletes audit logs older than retention period", async () => {
    (auditLog.deleteOlderThan as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: 15,
    });

    const result = await service.runRetentionCleanup();

    assert.strictEqual(result.auditLogsDeleted, 15);
    expect(auditLog.deleteOlderThan).toHaveBeenCalledTimes(1);
    const cutoffArg = (auditLog.deleteOlderThan as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(cutoffArg).toBeInstanceOf(Date);
  });

  it("uses correct cutoff based on auditLogRetentionDays", async () => {
    const before = Date.now();
    await service.runRetentionCleanup();
    const after = Date.now();

    const cutoff = (auditLog.deleteOlderThan as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Date;
    const retentionMs = 90 * 24 * 60 * 60 * 1000;
    assert.ok(cutoff.getTime() >= before - retentionMs - 100);
    assert.ok(cutoff.getTime() <= after - retentionMs + 100);
  });

  it("marks overdue DSAR requests as EXPIRED via the dedicated port method", async () => {
    (dsar.markOverdueAsExpired as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: 3,
    });

    const result = await service.runRetentionCleanup();

    assert.strictEqual(result.expiredDsarRequests, 3);
    expect(dsar.markOverdueAsExpired).toHaveBeenCalledTimes(1);
  });

  it("passes a `now` Date to markOverdueAsExpired", async () => {
    const before = Date.now();
    await service.runRetentionCleanup();
    const after = Date.now();

    const nowArg = (dsar.markOverdueAsExpired as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as Date;
    expect(nowArg).toBeInstanceOf(Date);
    assert.ok(nowArg.getTime() >= before - 100);
    assert.ok(nowArg.getTime() <= after + 100);
  });

  it("emits cleanup summary via AuditEmitterPort", async () => {
    (auditLog.deleteOlderThan as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: 10,
    });
    (dsar.markOverdueAsExpired as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: 4,
    });

    await service.runRetentionCleanup();

    expect(audit.emit).toHaveBeenCalledTimes(1);
    const emitCall = (audit.emit as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    assert.strictEqual(emitCall.action, "DATA_RETENTION_CLEANUP");
    assert.strictEqual(emitCall.resourceType, "system");
    assert.strictEqual(emitCall.success, true);
    expect(emitCall.details).toEqual({ auditLogsDeleted: 10, expiredDsarRequests: 4 });
  });

  it("returns both counts in the result", async () => {
    (auditLog.deleteOlderThan as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: 7,
    });
    (dsar.markOverdueAsExpired as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: 1,
    });

    const result = await service.runRetentionCleanup();

    assert.strictEqual(result.auditLogsDeleted, 7);
    assert.strictEqual(result.expiredDsarRequests, 1);
  });
});
