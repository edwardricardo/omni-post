/**
 * @file ComplianceService.test.ts
 * @description Unit tests for compliance service — GDPR/security settings,
 *   compliance scoring (11 checks), DSAR lifecycle, breach reports.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ComplianceService } from "../../../src/compliance/ComplianceService.js";
import type { PrismaClient } from "@infra/prisma";

// ── Mock logger to avoid side effects ──────────────────────────────────────
vi.mock("../../../src/lib/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ── Mock Factories ─────────────────────────────────────────────────────────

function makeMockPrisma() {
  return {
    gdprSettings: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    securitySettings: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
      count: vi.fn().mockResolvedValue(5),
    },
    dsarRequest: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    dataBreachReport: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    account: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

function makeMockEmailPort() {
  return { send: vi.fn().mockResolvedValue({ ok: true, value: undefined }) };
}

function makeGdprSettings(overrides = {}) {
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

function makeSecuritySettings(overrides = {}) {
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

// ── Helpers ────────────────────────────────────────────────────────────────

function createService(prisma: ReturnType<typeof makeMockPrisma>, emailPort = makeMockEmailPort()) {
  return new ComplianceService(prisma as unknown as PrismaClient, emailPort);
}

/**
 * Configures prisma mocks so getGdprSettings / getSecuritySettings return
 * the supplied objects (via findFirst).
 */
function stubSettings(
  prisma: ReturnType<typeof makeMockPrisma>,
  gdpr = makeGdprSettings(),
  security = makeSecuritySettings()
) {
  prisma.gdprSettings.findFirst.mockResolvedValue(gdpr);
  prisma.securitySettings.findFirst.mockResolvedValue(security);
}

// ═══════════════════════════════════════════════════════════════════════════
// updateGdprSettings — DPO validation
// ═══════════════════════════════════════════════════════════════════════════

describe("ComplianceService", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let emailPort: ReturnType<typeof makeMockEmailPort>;
  let service: ComplianceService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makeMockPrisma();
    emailPort = makeMockEmailPort();
    service = createService(prisma, emailPort);
  });

  // ─── updateGdprSettings ────────────────────────────────────────────────

  describe("updateGdprSettings", () => {
    beforeEach(() => {
      stubSettings(prisma);
      prisma.gdprSettings.update.mockResolvedValue(makeGdprSettings());
    });

    it("returns VALIDATION_ERROR when dpoType=INTERNAL and dpoEmail is null", async () => {
      const result = await service.updateGdprSettings(
        { dpoType: "INTERNAL", dpoEmail: null },
        "admin-001"
      );

      assert.ok(!result.ok, "Should fail validation");
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when dpoType=INTERNAL and dpoEmail is empty string", async () => {
      const result = await service.updateGdprSettings(
        { dpoType: "INTERNAL", dpoEmail: "" },
        "admin-001"
      );

      assert.ok(!result.ok, "Empty string is falsy, should fail validation");
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when dpoType=EXTERNAL and dpoUrl is null", async () => {
      const result = await service.updateGdprSettings(
        { dpoType: "EXTERNAL", dpoUrl: null },
        "admin-001"
      );

      assert.ok(!result.ok, "Should fail validation");
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when dpoType=EXTERNAL and dpoUrl is empty string", async () => {
      const result = await service.updateGdprSettings(
        { dpoType: "EXTERNAL", dpoUrl: "" },
        "admin-001"
      );

      assert.ok(!result.ok, "Empty string is falsy, should fail validation");
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("succeeds when dpoType=INTERNAL and dpoEmail is valid", async () => {
      const result = await service.updateGdprSettings(
        { dpoType: "INTERNAL", dpoEmail: "dpo@example.com" },
        "admin-001"
      );

      assert.ok(result.ok, "Should succeed with valid INTERNAL DPO email");
    });

    it("succeeds when dpoType=EXTERNAL and dpoUrl is valid", async () => {
      const result = await service.updateGdprSettings(
        { dpoType: "EXTERNAL", dpoUrl: "https://dpo.example.com" },
        "admin-001"
      );

      assert.ok(result.ok, "Should succeed with valid EXTERNAL DPO url");
    });

    it("returns VALIDATION_ERROR when dataRetentionDays < 30", async () => {
      const result = await service.updateGdprSettings({ dataRetentionDays: 29 }, "admin-001");

      assert.ok(!result.ok, "Should fail for retention days below minimum");
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when dataRetentionDays > 3650", async () => {
      const result = await service.updateGdprSettings({ dataRetentionDays: 3651 }, "admin-001");

      assert.ok(!result.ok, "Should fail for retention days above maximum");
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when dsarResponseDays < 15", async () => {
      const result = await service.updateGdprSettings({ dsarResponseDays: 14 }, "admin-001");

      assert.ok(!result.ok, "Should fail for DSAR days below minimum");
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when dsarResponseDays > 45", async () => {
      const result = await service.updateGdprSettings({ dsarResponseDays: 46 }, "admin-001");

      assert.ok(!result.ok, "Should fail for DSAR days above maximum");
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("records updatedBy from provided userId", async () => {
      const updatedSettings = makeGdprSettings({ updatedBy: "admin-999" });
      prisma.gdprSettings.update.mockResolvedValue(updatedSettings);

      const result = await service.updateGdprSettings(
        { privacyPolicyUrl: "https://new.example.com/privacy" },
        "admin-999"
      );

      assert.ok(result.ok, "Should succeed");
      expect(prisma.gdprSettings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ updatedBy: "admin-999" }),
        })
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: "admin-999" }),
        })
      );
    });
  });

  // ─── getComplianceScore ────────────────────────────────────────────────

  describe("getComplianceScore", () => {
    it("returns score=100 when all 11 checks pass", async () => {
      stubSettings(prisma, makeGdprSettings(), makeSecuritySettings());

      const { score, checks } = await service.getComplianceScore();

      assert.strictEqual(score, 100);
      assert.ok(
        checks.every((c) => c.passing),
        "All checks should pass"
      );
    });

    it("returns score=0 when all checks fail", async () => {
      stubSettings(
        prisma,
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
      prisma.auditLog.count.mockResolvedValue(0);

      const { score, checks } = await service.getComplianceScore();

      assert.strictEqual(score, 0);
      assert.ok(
        checks.every((c) => !c.passing),
        "All checks should fail"
      );
    });

    it("privacy_policy_url check has weight=12 and fails when null", async () => {
      stubSettings(prisma, makeGdprSettings({ privacyPolicyUrl: null }), makeSecuritySettings());

      const { score, checks } = await service.getComplianceScore();
      const check = checks.find((c) => c.key === "privacy_policy_url");

      assert.ok(check, "Check must exist");
      assert.strictEqual(check.weight, 12);
      assert.strictEqual(check.passing, false);
      assert.strictEqual(score, 100 - 12);
    });

    it("terms_of_service_url check has weight=8 and fails when null", async () => {
      stubSettings(prisma, makeGdprSettings({ termsOfServiceUrl: null }), makeSecuritySettings());

      const { score, checks } = await service.getComplianceScore();
      const check = checks.find((c) => c.key === "terms_of_service_url");

      assert.ok(check, "Check must exist");
      assert.strictEqual(check.weight, 8);
      assert.strictEqual(check.passing, false);
      assert.strictEqual(score, 100 - 8);
    });

    it("dpo_configured passes with INTERNAL+email, fails with INTERNAL+no email", async () => {
      // Passing: INTERNAL with email
      stubSettings(
        prisma,
        makeGdprSettings({ dpoType: "INTERNAL", dpoEmail: "dpo@example.com" }),
        makeSecuritySettings()
      );

      const passing = await service.getComplianceScore();
      const checkPass = passing.checks.find((c) => c.key === "dpo_configured");
      assert.ok(checkPass, "Check must exist");
      assert.strictEqual(checkPass.weight, 12);
      assert.strictEqual(checkPass.passing, true);

      // Failing: INTERNAL without email
      stubSettings(
        prisma,
        makeGdprSettings({ dpoType: "INTERNAL", dpoEmail: null }),
        makeSecuritySettings()
      );

      const failing = await service.getComplianceScore();
      const checkFail = failing.checks.find((c) => c.key === "dpo_configured");
      assert.ok(checkFail, "Check must exist");
      assert.strictEqual(checkFail.passing, false);
    });

    it("dpo_configured passes with EXTERNAL+url, fails with EXTERNAL+no url", async () => {
      // Passing: EXTERNAL with url
      stubSettings(
        prisma,
        makeGdprSettings({ dpoType: "EXTERNAL", dpoUrl: "https://dpo.example.com" }),
        makeSecuritySettings()
      );

      const passing = await service.getComplianceScore();
      const checkPass = passing.checks.find((c) => c.key === "dpo_configured");
      assert.ok(checkPass, "Check must exist");
      assert.strictEqual(checkPass.passing, true);

      // Failing: EXTERNAL without url
      stubSettings(
        prisma,
        makeGdprSettings({ dpoType: "EXTERNAL", dpoUrl: null }),
        makeSecuritySettings()
      );

      const failing = await service.getComplianceScore();
      const checkFail = failing.checks.find((c) => c.key === "dpo_configured");
      assert.ok(checkFail, "Check must exist");
      assert.strictEqual(checkFail.passing, false);
    });

    it("data_retention_set has weight=10 and fails when enableAutoDataDeletion=false", async () => {
      stubSettings(
        prisma,
        makeGdprSettings({ enableAutoDataDeletion: false }),
        makeSecuritySettings()
      );

      const { score, checks } = await service.getComplianceScore();
      const check = checks.find((c) => c.key === "data_retention_set");

      assert.ok(check, "Check must exist");
      assert.strictEqual(check.weight, 10);
      assert.strictEqual(check.passing, false);
      assert.strictEqual(score, 100 - 10);
    });

    it("data_retention_set fails when dataRetentionDays=0", async () => {
      stubSettings(prisma, makeGdprSettings({ dataRetentionDays: 0 }), makeSecuritySettings());

      const { checks } = await service.getComplianceScore();
      const check = checks.find((c) => c.key === "data_retention_set");

      assert.ok(check, "Check must exist");
      assert.strictEqual(check.passing, false);
    });

    it("session_timeout has weight=8 and fails when >480", async () => {
      stubSettings(
        prisma,
        makeGdprSettings(),
        makeSecuritySettings({ sessionTimeoutMinutes: 481 })
      );

      const { score, checks } = await service.getComplianceScore();
      const check = checks.find((c) => c.key === "session_timeout");

      assert.ok(check, "Check must exist");
      assert.strictEqual(check.weight, 8);
      assert.strictEqual(check.passing, false);
      assert.strictEqual(score, 100 - 8);
    });

    it("session_timeout passes at exactly 480 (boundary)", async () => {
      stubSettings(
        prisma,
        makeGdprSettings(),
        makeSecuritySettings({ sessionTimeoutMinutes: 480 })
      );

      const { checks } = await service.getComplianceScore();
      const check = checks.find((c) => c.key === "session_timeout");

      assert.ok(check, "Check must exist");
      assert.strictEqual(check.passing, true);
    });

    it("login_protection has weight=8 and passes at exactly 10 (boundary)", async () => {
      stubSettings(prisma, makeGdprSettings(), makeSecuritySettings({ maxLoginAttempts: 10 }));

      const { checks } = await service.getComplianceScore();
      const check = checks.find((c) => c.key === "login_protection");

      assert.ok(check, "Check must exist");
      assert.strictEqual(check.weight, 8);
      assert.strictEqual(check.passing, true);
    });

    it("dsar_response_time has weight=7 and passes at exactly 30 (boundary)", async () => {
      stubSettings(prisma, makeGdprSettings({ dsarResponseDays: 30 }), makeSecuritySettings());

      const { checks } = await service.getComplianceScore();
      const check = checks.find((c) => c.key === "dsar_response_time");

      assert.ok(check, "Check must exist");
      assert.strictEqual(check.weight, 7);
      assert.strictEqual(check.passing, true);
    });

    it("weights sum to 100", async () => {
      stubSettings(prisma);

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
      stubSettings(prisma);
      prisma.dsarRequest.create.mockImplementation(async ({ data }) => ({
        id: "dsar-001",
        ...data,
      }));
    });

    it("deadline +15 days for LGPD", async () => {
      const before = Date.now();
      const result = await service.submitDsarRequest({
        ...baseDsarInput,
        jurisdiction: "LGPD",
      });

      assert.ok(result.ok, "Should succeed");
      const deadline = result.value.deadlineAt.getTime();
      const expectedMin = before + 15 * 24 * 60 * 60 * 1000;
      const expectedMax = Date.now() + 15 * 24 * 60 * 60 * 1000;
      assert.ok(deadline >= expectedMin && deadline <= expectedMax, "Deadline should be ~15 days");
    });

    it("deadline +45 days for CCPA", async () => {
      const before = Date.now();
      const result = await service.submitDsarRequest({
        ...baseDsarInput,
        jurisdiction: "CCPA",
      });

      assert.ok(result.ok, "Should succeed");
      const deadline = result.value.deadlineAt.getTime();
      const expectedMin = before + 45 * 24 * 60 * 60 * 1000;
      const expectedMax = Date.now() + 45 * 24 * 60 * 60 * 1000;
      assert.ok(deadline >= expectedMin && deadline <= expectedMax, "Deadline should be ~45 days");
    });

    it("deadline +30 days for GDPR", async () => {
      const before = Date.now();
      const result = await service.submitDsarRequest({
        ...baseDsarInput,
        jurisdiction: "GDPR",
      });

      assert.ok(result.ok, "Should succeed");
      const deadline = result.value.deadlineAt.getTime();
      const expectedMin = before + 30 * 24 * 60 * 60 * 1000;
      const expectedMax = Date.now() + 30 * 24 * 60 * 60 * 1000;
      assert.ok(deadline >= expectedMin && deadline <= expectedMax, "Deadline should be ~30 days");
    });

    it("deadline +30 days for PIPEDA", async () => {
      const before = Date.now();
      const result = await service.submitDsarRequest({
        ...baseDsarInput,
        jurisdiction: "PIPEDA",
      });

      assert.ok(result.ok, "Should succeed");
      const deadline = result.value.deadlineAt.getTime();
      const expectedMin = before + 30 * 24 * 60 * 60 * 1000;
      const expectedMax = Date.now() + 30 * 24 * 60 * 60 * 1000;
      assert.ok(deadline >= expectedMin && deadline <= expectedMax, "Deadline should be ~30 days");
    });

    it("uses gdprSettings.dsarResponseDays for unknown jurisdiction", async () => {
      const customDays = 25;
      prisma.gdprSettings.findFirst.mockResolvedValue(
        makeGdprSettings({ dsarResponseDays: customDays, defaultJurisdiction: "GDPR" })
      );

      const before = Date.now();
      const result = await service.submitDsarRequest({
        ...baseDsarInput,
        jurisdiction: "UNKNOWN_JURISDICTION",
      });

      assert.ok(result.ok, "Should succeed");
      const deadline = result.value.deadlineAt.getTime();
      const expectedMin = before + customDays * 24 * 60 * 60 * 1000;
      const expectedMax = Date.now() + customDays * 24 * 60 * 60 * 1000;
      assert.ok(
        deadline >= expectedMin && deadline <= expectedMax,
        `Deadline should be ~${customDays} days (from dsarResponseDays)`
      );
    });

    it("returns RATE_LIMITED when 3 pending requests for same email", async () => {
      prisma.dsarRequest.count.mockResolvedValue(3);

      const result = await service.submitDsarRequest(baseDsarInput);

      assert.ok(!result.ok, "Should be rate limited");
      assert.strictEqual(result.error, "RATE_LIMITED");
    });

    it("succeeds when 2 pending requests (under limit)", async () => {
      prisma.dsarRequest.count.mockResolvedValue(2);

      const result = await service.submitDsarRequest(baseDsarInput);

      assert.ok(result.ok, "Should succeed with 2 pending requests");
    });

    it("succeeds when 3 COMPLETED requests (not counted)", async () => {
      // count mock returns 0 by default (only counts PENDING/IN_PROGRESS)
      prisma.dsarRequest.count.mockResolvedValue(0);

      const result = await service.submitDsarRequest(baseDsarInput);

      assert.ok(result.ok, "Completed requests should not count toward rate limit");
    });

    it("generates verificationToken", async () => {
      const result = await service.submitDsarRequest(baseDsarInput);

      assert.ok(result.ok, "Should succeed");
      expect(prisma.dsarRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            verificationToken: expect.stringMatching(
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
            ),
          }),
        })
      );
    });

    it("writes to auditLog", async () => {
      await service.submitDsarRequest(baseDsarInput);

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "DSAR_SUBMITTED",
            resource: "dsar_request",
            success: true,
          }),
        })
      );
    });
  });

  // ─── updateSecuritySettings ────────────────────────────────────────────

  describe("updateSecuritySettings", () => {
    beforeEach(() => {
      stubSettings(prisma);
      prisma.securitySettings.update.mockResolvedValue(makeSecuritySettings());
    });

    it("returns VALIDATION_ERROR when sessionTimeoutMinutes < 15", async () => {
      const result = await service.updateSecuritySettings(
        { sessionTimeoutMinutes: 14 },
        "admin-001"
      );

      assert.ok(!result.ok, "Should fail validation");
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when sessionTimeoutMinutes > 10080", async () => {
      const result = await service.updateSecuritySettings(
        { sessionTimeoutMinutes: 10081 },
        "admin-001"
      );

      assert.ok(!result.ok, "Should fail validation");
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when maxLoginAttempts < 3", async () => {
      const result = await service.updateSecuritySettings({ maxLoginAttempts: 2 }, "admin-001");

      assert.ok(!result.ok, "Should fail validation");
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when passwordMinLength < 6", async () => {
      const result = await service.updateSecuritySettings({ passwordMinLength: 5 }, "admin-001");

      assert.ok(!result.ok, "Should fail validation");
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    });
  });
});
