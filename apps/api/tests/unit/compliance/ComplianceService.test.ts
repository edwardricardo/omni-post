/**
 * @file ComplianceService.test.ts
 * @description Unit tests for compliance service — GDPR/security settings,
 *   compliance scoring (11 checks), DSAR lifecycle, breach reports.
 *   Post-S4.1 the service is framework-free; tests mock the 6 ports + audit.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ComplianceService } from "../../../src/compliance/ComplianceService.js";
import type { GdprSettingsRepository } from "@core/domain/repositories/GdprSettingsRepository.js";
import type { SecuritySettingsRepository } from "@core/domain/repositories/SecuritySettingsRepository.js";
import type { DsarRequestRepository } from "@core/domain/repositories/DsarRequestRepository.js";
import type { DataBreachReportRepository } from "@core/domain/repositories/DataBreachReportRepository.js";
import type { AuditLogRetentionPort } from "@core/domain/repositories/AuditLogRetentionPort.js";
import type { AccountNotificationReader } from "@core/domain/repositories/AccountNotificationReader.js";
import type { AuditEmitterPort } from "@core/domain/repositories/AuditEmitterPort.js";
import type { EmailPort } from "@core/domain/repositories/EmailPort.js";

// ── Mock Factories ─────────────────────────────────────────────────────────

function makeGdprRepo(): GdprSettingsRepository {
  return {
    findSingleton: vi.fn().mockResolvedValue({ ok: true, value: null }),
    createDefault: vi.fn(),
    update: vi.fn(),
  };
}

function makeSecurityRepo(): SecuritySettingsRepository {
  return {
    findSingleton: vi.fn().mockResolvedValue({ ok: true, value: null }),
    createDefault: vi.fn(),
    update: vi.fn(),
  };
}

function makeDsarRepo(): DsarRequestRepository {
  return {
    listWithAccount: vi.fn().mockResolvedValue({ ok: true, value: { requests: [], total: 0 } }),
    findByIdWithAccount: vi.fn().mockResolvedValue({ ok: true, value: null }),
    findById: vi.fn().mockResolvedValue({ ok: true, value: null }),
    countPendingByEmail: vi.fn().mockResolvedValue({ ok: true, value: 0 }),
    create: vi.fn(),
    update: vi.fn(),
    markOverdueAsExpired: vi.fn().mockResolvedValue({ ok: true, value: 0 }),
  };
}

function makeBreachRepo(): DataBreachReportRepository {
  return {
    list: vi.fn().mockResolvedValue({ ok: true, value: { reports: [], total: 0 } }),
    findById: vi.fn().mockResolvedValue({ ok: true, value: null }),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  };
}

function makeAuditLogRetention(): AuditLogRetentionPort {
  return {
    countSince: vi.fn().mockResolvedValue({ ok: true, value: 5 }),
    deleteOlderThan: vi.fn().mockResolvedValue({ ok: true, value: 0 }),
  };
}

function makeAccountNotifications(): AccountNotificationReader {
  return {
    listActiveEmails: vi.fn().mockResolvedValue({ ok: true, value: [] }),
  };
}

function makeAuditEmitter(): AuditEmitterPort {
  return { emit: vi.fn().mockResolvedValue(undefined) };
}

function makeMockEmailPort(): EmailPort {
  return {
    send: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  } as unknown as EmailPort;
}

function makeGdprSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: "gdpr-001",
    privacyPolicyUrl: "https://example.com/privacy",
    cookiePolicyUrl: null,
    termsOfServiceUrl: "https://example.com/terms",
    dpoType: "INTERNAL",
    dpoEmail: "dpo@example.com",
    dpoUrl: null,
    dataRetentionDays: 365,
    auditLogRetentionDays: 90,
    enableAutoDataDeletion: true,
    dsarResponseDays: 30,
    defaultJurisdiction: "GDPR",
    enableRightToErasure: true,
    enableDataExport: true,
    enableDataAccess: true,
    enableBreachNotification: true,
    updatedAt: new Date(),
    updatedBy: null,
    ...overrides,
  };
}

function makeSecuritySettings(overrides: Record<string, unknown> = {}) {
  return {
    id: "sec-001",
    require2FA: false,
    sessionTimeoutMinutes: 480,
    maxLoginAttempts: 5,
    passwordMinLength: 8,
    requireUppercase: false,
    requireSpecialChar: false,
    ipAllowlistEnabled: false,
    ipAllowlist: [],
    updatedAt: new Date(),
    updatedBy: null,
    ...overrides,
  };
}

interface Bag {
  gdpr: GdprSettingsRepository;
  security: SecuritySettingsRepository;
  dsar: DsarRequestRepository;
  breach: DataBreachReportRepository;
  auditLog: AuditLogRetentionPort;
  notifications: AccountNotificationReader;
  audit: AuditEmitterPort;
  email: EmailPort;
}

function createService(bag: Bag): ComplianceService {
  return new ComplianceService(
    bag.gdpr,
    bag.security,
    bag.dsar,
    bag.breach,
    bag.auditLog,
    bag.notifications,
    bag.email,
    bag.audit
  );
}

function stubSettings(
  bag: Bag,
  gdpr: Record<string, unknown> = makeGdprSettings(),
  security: Record<string, unknown> = makeSecuritySettings()
): void {
  (bag.gdpr.findSingleton as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    value: gdpr,
  });
  (bag.security.findSingleton as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    value: security,
  });
  (bag.gdpr.update as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    value: gdpr,
  });
  (bag.security.update as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    value: security,
  });
}

describe("ComplianceService", () => {
  let bag: Bag;
  let service: ComplianceService;

  beforeEach(() => {
    vi.clearAllMocks();
    bag = {
      gdpr: makeGdprRepo(),
      security: makeSecurityRepo(),
      dsar: makeDsarRepo(),
      breach: makeBreachRepo(),
      auditLog: makeAuditLogRetention(),
      notifications: makeAccountNotifications(),
      audit: makeAuditEmitter(),
      email: makeMockEmailPort(),
    };
    service = createService(bag);
  });

  // ─── updateGdprSettings ────────────────────────────────────────────────

  describe("updateGdprSettings", () => {
    beforeEach(() => stubSettings(bag));

    it("returns VALIDATION_ERROR when dpoType=INTERNAL and dpoEmail is null", async () => {
      const result = await service.updateGdprSettings(
        { dpoType: "INTERNAL", dpoEmail: null },
        "admin-001"
      );
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when dpoType=INTERNAL and dpoEmail is empty string", async () => {
      const result = await service.updateGdprSettings(
        { dpoType: "INTERNAL", dpoEmail: "" },
        "admin-001"
      );
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when dpoType=EXTERNAL and dpoUrl is null", async () => {
      const result = await service.updateGdprSettings(
        { dpoType: "EXTERNAL", dpoUrl: null },
        "admin-001"
      );
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when dpoType=EXTERNAL and dpoUrl is empty string", async () => {
      const result = await service.updateGdprSettings(
        { dpoType: "EXTERNAL", dpoUrl: "" },
        "admin-001"
      );
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("succeeds when dpoType=INTERNAL and dpoEmail is valid", async () => {
      const result = await service.updateGdprSettings(
        { dpoType: "INTERNAL", dpoEmail: "dpo@example.com" },
        "admin-001"
      );
      assert.ok(result.ok);
    });

    it("succeeds when dpoType=EXTERNAL and dpoUrl is valid", async () => {
      const result = await service.updateGdprSettings(
        { dpoType: "EXTERNAL", dpoUrl: "https://dpo.example.com" },
        "admin-001"
      );
      assert.ok(result.ok);
    });

    it("returns VALIDATION_ERROR when dataRetentionDays < 30", async () => {
      const result = await service.updateGdprSettings({ dataRetentionDays: 29 }, "admin-001");
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when dataRetentionDays > 3650", async () => {
      const result = await service.updateGdprSettings({ dataRetentionDays: 3651 }, "admin-001");
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when dsarResponseDays < 15", async () => {
      const result = await service.updateGdprSettings({ dsarResponseDays: 14 }, "admin-001");
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when dsarResponseDays > 45", async () => {
      const result = await service.updateGdprSettings({ dsarResponseDays: 46 }, "admin-001");
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("records updatedBy from provided userId", async () => {
      const result = await service.updateGdprSettings(
        { privacyPolicyUrl: "https://new.example.com/privacy" },
        "admin-999"
      );
      assert.ok(result.ok);
      expect(bag.gdpr.update).toHaveBeenCalledWith(
        "gdpr-001",
        expect.objectContaining({ updatedBy: "admin-999" })
      );
      expect(bag.audit.emit).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "admin-999", action: "GDPR_SETTINGS_UPDATED" })
      );
    });
  });

  // ─── getComplianceScore ────────────────────────────────────────────────

  describe("getComplianceScore", () => {
    it("returns score=100 when all 11 checks pass", async () => {
      stubSettings(bag);
      const { score, checks } = await service.getComplianceScore();
      assert.strictEqual(score, 100);
      assert.ok(checks.every((c) => c.passing));
    });

    it("returns score=0 when all checks fail", async () => {
      stubSettings(
        bag,
        makeGdprSettings({
          privacyPolicyUrl: null,
          termsOfServiceUrl: null,
          dpoType: "NONE",
          dpoEmail: null,
          dpoUrl: null,
          dataRetentionDays: 0,
          enableAutoDataDeletion: false,
          enableRightToErasure: false,
          enableDataExport: false,
          enableBreachNotification: false,
          dsarResponseDays: 31,
        }),
        makeSecuritySettings({
          sessionTimeoutMinutes: 481,
          maxLoginAttempts: 11,
        })
      );
      (bag.auditLog.countSince as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: 0,
      });

      const { score, checks } = await service.getComplianceScore();
      assert.strictEqual(score, 0);
      assert.ok(checks.every((c) => !c.passing));
    });

    it("privacy_policy_url check has weight=12 and fails when null", async () => {
      stubSettings(bag, makeGdprSettings({ privacyPolicyUrl: null }), makeSecuritySettings());
      const { score, checks } = await service.getComplianceScore();
      const check = checks.find((c) => c.key === "privacy_policy_url");
      assert.ok(check);
      assert.strictEqual(check.weight, 12);
      assert.strictEqual(check.passing, false);
      assert.strictEqual(score, 100 - 12);
    });

    it("terms_of_service_url check has weight=8 and fails when null", async () => {
      stubSettings(bag, makeGdprSettings({ termsOfServiceUrl: null }), makeSecuritySettings());
      const { score, checks } = await service.getComplianceScore();
      const check = checks.find((c) => c.key === "terms_of_service_url");
      assert.ok(check);
      assert.strictEqual(check.weight, 8);
      assert.strictEqual(check.passing, false);
      assert.strictEqual(score, 100 - 8);
    });

    it("dpo_configured passes with INTERNAL+email, fails with INTERNAL+no email", async () => {
      stubSettings(
        bag,
        makeGdprSettings({ dpoType: "INTERNAL", dpoEmail: "dpo@example.com" }),
        makeSecuritySettings()
      );
      const passing = await service.getComplianceScore();
      const checkPass = passing.checks.find((c) => c.key === "dpo_configured");
      assert.ok(checkPass);
      assert.strictEqual(checkPass.weight, 12);
      assert.strictEqual(checkPass.passing, true);

      stubSettings(
        bag,
        makeGdprSettings({ dpoType: "INTERNAL", dpoEmail: null }),
        makeSecuritySettings()
      );
      const failing = await service.getComplianceScore();
      const checkFail = failing.checks.find((c) => c.key === "dpo_configured");
      assert.ok(checkFail);
      assert.strictEqual(checkFail.passing, false);
    });

    it("dpo_configured passes with EXTERNAL+url, fails with EXTERNAL+no url", async () => {
      stubSettings(
        bag,
        makeGdprSettings({ dpoType: "EXTERNAL", dpoUrl: "https://dpo.example.com" }),
        makeSecuritySettings()
      );
      const passing = await service.getComplianceScore();
      const checkPass = passing.checks.find((c) => c.key === "dpo_configured");
      assert.ok(checkPass);
      assert.strictEqual(checkPass.passing, true);

      stubSettings(
        bag,
        makeGdprSettings({ dpoType: "EXTERNAL", dpoUrl: null }),
        makeSecuritySettings()
      );
      const failing = await service.getComplianceScore();
      const checkFail = failing.checks.find((c) => c.key === "dpo_configured");
      assert.ok(checkFail);
      assert.strictEqual(checkFail.passing, false);
    });

    it("data_retention_set has weight=10 and fails when enableAutoDataDeletion=false", async () => {
      stubSettings(
        bag,
        makeGdprSettings({ enableAutoDataDeletion: false }),
        makeSecuritySettings()
      );
      const { score, checks } = await service.getComplianceScore();
      const check = checks.find((c) => c.key === "data_retention_set");
      assert.ok(check);
      assert.strictEqual(check.weight, 10);
      assert.strictEqual(check.passing, false);
      assert.strictEqual(score, 100 - 10);
    });

    it("data_retention_set fails when dataRetentionDays=0", async () => {
      stubSettings(bag, makeGdprSettings({ dataRetentionDays: 0 }), makeSecuritySettings());
      const { checks } = await service.getComplianceScore();
      const check = checks.find((c) => c.key === "data_retention_set");
      assert.ok(check);
      assert.strictEqual(check.passing, false);
    });

    it("session_timeout has weight=8 and fails when >480", async () => {
      stubSettings(bag, makeGdprSettings(), makeSecuritySettings({ sessionTimeoutMinutes: 481 }));
      const { score, checks } = await service.getComplianceScore();
      const check = checks.find((c) => c.key === "session_timeout");
      assert.ok(check);
      assert.strictEqual(check.weight, 8);
      assert.strictEqual(check.passing, false);
      assert.strictEqual(score, 100 - 8);
    });

    it("session_timeout passes at exactly 480 (boundary)", async () => {
      stubSettings(bag, makeGdprSettings(), makeSecuritySettings({ sessionTimeoutMinutes: 480 }));
      const { checks } = await service.getComplianceScore();
      const check = checks.find((c) => c.key === "session_timeout");
      assert.ok(check);
      assert.strictEqual(check.passing, true);
    });

    it("login_protection has weight=8 and passes at exactly 10 (boundary)", async () => {
      stubSettings(bag, makeGdprSettings(), makeSecuritySettings({ maxLoginAttempts: 10 }));
      const { checks } = await service.getComplianceScore();
      const check = checks.find((c) => c.key === "login_protection");
      assert.ok(check);
      assert.strictEqual(check.weight, 8);
      assert.strictEqual(check.passing, true);
    });

    it("dsar_response_time has weight=7 and passes at exactly 30 (boundary)", async () => {
      stubSettings(bag, makeGdprSettings({ dsarResponseDays: 30 }), makeSecuritySettings());
      const { checks } = await service.getComplianceScore();
      const check = checks.find((c) => c.key === "dsar_response_time");
      assert.ok(check);
      assert.strictEqual(check.weight, 7);
      assert.strictEqual(check.passing, true);
    });

    it("weights sum to 100", async () => {
      stubSettings(bag);
      const { checks } = await service.getComplianceScore();
      const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
      assert.strictEqual(totalWeight, 100);
    });
  });

  // ─── submitDsarRequest ─────────────────────────────────────────────────

  describe("submitDsarRequest", () => {
    const baseDsarInput = {
      requestorEmail: "user@example.com",
      requestorName: "Test User",
      type: "EXPORT",
    };

    beforeEach(() => {
      stubSettings(bag);
      (bag.dsar.create as ReturnType<typeof vi.fn>).mockImplementation(async (input) => ({
        ok: true,
        value: { id: "dsar-001", ...input },
      }));
    });

    it("deadline +15 days for LGPD", async () => {
      const before = Date.now();
      const result = await service.submitDsarRequest({
        ...baseDsarInput,
        jurisdiction: "LGPD",
      });
      assert.ok(result.ok);
      const deadline = result.value.deadlineAt.getTime();
      const expectedMin = before + 15 * 24 * 60 * 60 * 1000;
      const expectedMax = Date.now() + 15 * 24 * 60 * 60 * 1000;
      assert.ok(deadline >= expectedMin && deadline <= expectedMax);
    });

    it("deadline +45 days for CCPA", async () => {
      const before = Date.now();
      const result = await service.submitDsarRequest({
        ...baseDsarInput,
        jurisdiction: "CCPA",
      });
      assert.ok(result.ok);
      const deadline = result.value.deadlineAt.getTime();
      const expectedMin = before + 45 * 24 * 60 * 60 * 1000;
      const expectedMax = Date.now() + 45 * 24 * 60 * 60 * 1000;
      assert.ok(deadline >= expectedMin && deadline <= expectedMax);
    });

    it("deadline +30 days for GDPR", async () => {
      const before = Date.now();
      const result = await service.submitDsarRequest({
        ...baseDsarInput,
        jurisdiction: "GDPR",
      });
      assert.ok(result.ok);
      const deadline = result.value.deadlineAt.getTime();
      const expectedMin = before + 30 * 24 * 60 * 60 * 1000;
      const expectedMax = Date.now() + 30 * 24 * 60 * 60 * 1000;
      assert.ok(deadline >= expectedMin && deadline <= expectedMax);
    });

    it("deadline +30 days for PIPEDA", async () => {
      const before = Date.now();
      const result = await service.submitDsarRequest({
        ...baseDsarInput,
        jurisdiction: "PIPEDA",
      });
      assert.ok(result.ok);
      const deadline = result.value.deadlineAt.getTime();
      const expectedMin = before + 30 * 24 * 60 * 60 * 1000;
      const expectedMax = Date.now() + 30 * 24 * 60 * 60 * 1000;
      assert.ok(deadline >= expectedMin && deadline <= expectedMax);
    });

    it("uses gdprSettings.dsarResponseDays for unknown jurisdiction", async () => {
      const customDays = 25;
      (bag.gdpr.findSingleton as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: makeGdprSettings({ dsarResponseDays: customDays, defaultJurisdiction: "GDPR" }),
      });
      const before = Date.now();
      const result = await service.submitDsarRequest({
        ...baseDsarInput,
        jurisdiction: "UNKNOWN_JURISDICTION",
      });
      assert.ok(result.ok);
      const deadline = result.value.deadlineAt.getTime();
      const expectedMin = before + customDays * 24 * 60 * 60 * 1000;
      const expectedMax = Date.now() + customDays * 24 * 60 * 60 * 1000;
      assert.ok(deadline >= expectedMin && deadline <= expectedMax);
    });

    it("returns RATE_LIMITED when 3 pending requests for same email", async () => {
      (bag.dsar.countPendingByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: 3,
      });
      const result = await service.submitDsarRequest(baseDsarInput);
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "RATE_LIMITED");
    });

    it("succeeds when 2 pending requests (under limit)", async () => {
      (bag.dsar.countPendingByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: 2,
      });
      const result = await service.submitDsarRequest(baseDsarInput);
      assert.ok(result.ok);
    });

    it("succeeds when 3 COMPLETED requests (not counted)", async () => {
      (bag.dsar.countPendingByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: 0,
      });
      const result = await service.submitDsarRequest(baseDsarInput);
      assert.ok(result.ok);
    });

    it("generates verificationToken", async () => {
      await service.submitDsarRequest(baseDsarInput);
      expect(bag.dsar.create).toHaveBeenCalledWith(
        expect.objectContaining({
          verificationToken: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
          ),
        })
      );
    });

    it("emits audit event", async () => {
      await service.submitDsarRequest(baseDsarInput);
      expect(bag.audit.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "DSAR_SUBMITTED",
          resourceType: "dsar_request",
          success: true,
        })
      );
    });
  });

  // ─── updateSecuritySettings ────────────────────────────────────────────

  describe("updateSecuritySettings", () => {
    beforeEach(() => stubSettings(bag));

    it("returns VALIDATION_ERROR when sessionTimeoutMinutes < 15", async () => {
      const result = await service.updateSecuritySettings(
        { sessionTimeoutMinutes: 14 },
        "admin-001"
      );
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when sessionTimeoutMinutes > 10080", async () => {
      const result = await service.updateSecuritySettings(
        { sessionTimeoutMinutes: 10081 },
        "admin-001"
      );
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when maxLoginAttempts < 3", async () => {
      const result = await service.updateSecuritySettings({ maxLoginAttempts: 2 }, "admin-001");
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when passwordMinLength < 6", async () => {
      const result = await service.updateSecuritySettings({ passwordMinLength: 5 }, "admin-001");
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });
  });
});
