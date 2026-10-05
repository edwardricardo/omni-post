/**
 * @file ComplianceService.test.ts
 * @description Unit tests for ComplianceService — updateGdprSettings validation
 *   and acknowledgeDsar happy/not-found paths.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok } from "@shared/types";
import type { LoggerPort } from "@ports/core";
import { ComplianceService } from "../../src/ComplianceService.js";
import type {
  GdprSettingsRepository,
  GdprSettings,
} from "@core/domain/repositories/GdprSettingsRepository.js";
import type {
  SecuritySettingsRepository,
  SecuritySettings,
} from "@core/domain/repositories/SecuritySettingsRepository.js";
import type { DsarRequestRepository } from "@core/domain/repositories/DsarRequestRepository.js";
import type { DataBreachReportRepository } from "@core/domain/repositories/DataBreachReportRepository.js";
import type { AuditLogRetentionPort } from "@core/domain/repositories/AuditLogRetentionPort.js";
import type { AccountNotificationReader } from "@core/domain/repositories/AccountNotificationReader.js";
import type { EmailPort } from "@core/domain/repositories/EmailPort.js";
import type { AuditEmitterPort } from "@core/domain/repositories/AuditEmitterPort.js";

const NOW = new Date("2024-01-01T00:00:00Z");

function makeGdprSettings(overrides: Partial<GdprSettings> = {}): GdprSettings {
  return {
    id: "gdpr-singleton",
    privacyPolicyUrl: "https://example.com/privacy",
    termsOfServiceUrl: "https://example.com/terms",
    dpoType: "INTERNAL" as never,
    dpoEmail: "dpo@example.com",
    dpoUrl: null,
    dataRetentionDays: 365,
    enableAutoDataDeletion: true,
    enableRightToErasure: true,
    enableDataExport: true,
    enableBreachNotification: true,
    dsarResponseDays: 30,
    defaultJurisdiction: "GDPR" as never,
    updatedAt: NOW,
    updatedBy: "system",
    ...overrides,
  };
}

function makeSecuritySettings(overrides: Partial<SecuritySettings> = {}): SecuritySettings {
  return {
    id: "sec-singleton",
    sessionTimeoutMinutes: 60,
    maxLoginAttempts: 5,
    passwordMinLength: 8,
    updatedAt: NOW,
    updatedBy: "system",
    ...overrides,
  };
}

function makeDsarRow() {
  return {
    id: "dsar-001",
    status: "PENDING",
    requestorEmail: "user@example.com",
    type: "ACCESS",
    createdAt: NOW,
  };
}

function makeMockGdprRepo(
  opts: { findSingleton?: unknown; update?: unknown } = {}
): GdprSettingsRepository {
  const settings = makeGdprSettings();
  return {
    findSingleton: vi.fn(async () => opts.findSingleton ?? ok(settings)),
    createDefault: vi.fn(async () => ok(settings)),
    update: vi.fn(async () => opts.update ?? ok(settings)),
  } as unknown as GdprSettingsRepository;
}

function makeMockSecurityRepo(): SecuritySettingsRepository {
  const settings = makeSecuritySettings();
  return {
    findSingleton: vi.fn(async () => ok(settings)),
    createDefault: vi.fn(async () => ok(settings)),
    update: vi.fn(async () => ok(settings)),
  } as unknown as SecuritySettingsRepository;
}

function makeMockDsarRepo(
  opts: { findById?: unknown; update?: unknown } = {}
): DsarRequestRepository {
  const row = makeDsarRow();
  return {
    findById: vi.fn(async () => opts.findById ?? ok(row)),
    findByIdWithAccount: vi.fn(async () => ok(null)),
    listWithAccount: vi.fn(async () => ok({ requests: [], total: 0 })),
    update: vi.fn(async () => opts.update ?? ok(row)),
    create: vi.fn(async () => ok(row)),
    countPendingByEmail: vi.fn(async () => ok(0)),
  } as unknown as DsarRequestRepository;
}

function makeMockBreachRepo(): DataBreachReportRepository {
  return {
    list: vi.fn(async () => ok({ reports: [], total: 0 })),
    findById: vi.fn(async () => ok(null)),
    create: vi.fn(async () => ok({ id: "breach-001", title: "Test" })),
    update: vi.fn(async () => ok({ id: "breach-001" })),
  } as unknown as DataBreachReportRepository;
}

function makeMockAuditRetention(): AuditLogRetentionPort {
  return { countSince: vi.fn(async () => ok(5)) } as unknown as AuditLogRetentionPort;
}

function makeMockAccountNotifications(): AccountNotificationReader {
  return { listActiveEmails: vi.fn(async () => ok([])) } as unknown as AccountNotificationReader;
}

function makeMockEmail(): EmailPort {
  return { send: vi.fn(async () => ok({ messageId: "msg-001" })) } as unknown as EmailPort;
}

function makeMockAuditEmitter(): AuditEmitterPort {
  return { emit: vi.fn(async () => undefined) } as unknown as AuditEmitterPort;
}

function makeMockLogger() {
  return { warn: vi.fn(), error: vi.fn() } satisfies LoggerPort;
}

function makeService(
  opts: {
    gdprRepo?: GdprSettingsRepository;
    dsarRepo?: DsarRequestRepository;
    logger?: LoggerPort;
  } = {}
) {
  return new ComplianceService(
    opts.gdprRepo ?? makeMockGdprRepo(),
    makeMockSecurityRepo(),
    opts.dsarRepo ?? makeMockDsarRepo(),
    makeMockBreachRepo(),
    makeMockAuditRetention(),
    makeMockAccountNotifications(),
    makeMockEmail(),
    makeMockAuditEmitter(),
    opts.logger ?? makeMockLogger()
  );
}

describe("ComplianceService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateGdprSettings", () => {
    it("returns updated settings when data is valid", async () => {
      const svc = makeService();
      const r = await svc.updateGdprSettings({ dataRetentionDays: 90 }, "admin-1");
      assert.ok(r.ok, `expected ok but got err: ${r.ok ? "" : String(r.error)}`);
    });

    it("returns VALIDATION_ERROR when dpoType is INTERNAL but dpoEmail is missing", async () => {
      const svc = makeService();
      const r = await svc.updateGdprSettings({ dpoType: "INTERNAL" }, "admin-1");
      assert.ok(!r.ok);
      assert.strictEqual(r.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when dataRetentionDays is below the minimum of 30", async () => {
      const svc = makeService();
      const r = await svc.updateGdprSettings({ dataRetentionDays: 5 }, "admin-1");
      assert.ok(!r.ok);
      assert.strictEqual(r.error, "VALIDATION_ERROR");
    });

    it("returns DATABASE_ERROR and reports the cause through the injected logger when the settings write throws", async () => {
      const cause = new Error("connection reset");
      const gdprRepo = makeMockGdprRepo();
      vi.mocked(gdprRepo.update).mockRejectedValue(cause);
      const logger = makeMockLogger();
      const svc = makeService({ gdprRepo, logger });

      const r = await svc.updateGdprSettings({ dataRetentionDays: 90 }, "admin-1");

      assert.ok(!r.ok);
      assert.strictEqual(r.error, "DATABASE_ERROR");
      expect(logger.error).toHaveBeenCalledWith({ err: cause }, "Failed to update GDPR settings");
    });
  });

  describe("acknowledgeDsar", () => {
    it("returns the updated DSAR row when the request exists", async () => {
      const svc = makeService();
      const r = await svc.acknowledgeDsar("dsar-001", "admin-1");
      assert.ok(r.ok, `expected ok but got err: ${r.ok ? "" : String(r.error)}`);
    });

    it("returns NOT_FOUND when the DSAR request does not exist", async () => {
      const svc = makeService({ dsarRepo: makeMockDsarRepo({ findById: ok(null) }) });
      const r = await svc.acknowledgeDsar("nonexistent", "admin-1");
      assert.ok(!r.ok);
      assert.strictEqual(r.error, "NOT_FOUND");
    });
  });
});
