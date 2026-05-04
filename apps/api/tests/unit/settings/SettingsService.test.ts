/**
 * @file SettingsService.test.ts
 * @description Unit tests for platform settings management service.
 * @layer application
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsService } from "../../../src/settings/SettingsService.js";
import type { PlatformCredentialService } from "../../../src/security/PlatformCredentialService.js";
import type { PrismaClient } from "@infra/prisma";

function makeMockCredentialService(
  overrides: Partial<Record<keyof PlatformCredentialService, unknown>> = {}
): PlatformCredentialService {
  return {
    getGroup: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    setCredential: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    getCredential: vi.fn().mockResolvedValue({ ok: true, value: null }),
    deleteCredential: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    isGroupConfigured: vi.fn().mockResolvedValue({ ok: true, value: false }),
    listConfiguredGroups: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    setAccountCredential: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    getAccountCredential: vi.fn().mockResolvedValue({ ok: true, value: null }),
    deleteAccountCredential: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    ...overrides,
  } as unknown as PlatformCredentialService;
}

function makeMockPrisma() {
  return {
    aiTokenUsage: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { tokensUsed: 0 } }),
    },
    platformEncryptionKey: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

describe("SettingsService", () => {
  let service: SettingsService;
  let mockCreds: PlatformCredentialService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreds = makeMockCredentialService();
    mockPrisma = makeMockPrisma();
    service = new SettingsService(mockCreds, mockPrisma as PrismaClient);
  });

  // ─── getGroupSettings ──────────────────────────────────────────────

  describe("getGroupSettings", () => {
    it("returns masked values for secret keys", async () => {
      (mockCreds.getGroup as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: { secretKey: "sk_live_abc123def456ghi789", webhookSecret: "whsec_longvalue1234" },
      });

      const result = await service.getGroupSettings("STRIPE");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value["secretKey"]).toBe(
          "sk_l\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022i789"
        );
        expect(result.value["webhookSecret"]).toBe(
          "whse\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u20221234"
        );
      }
    });

    it("returns plain values for non-secret keys", async () => {
      (mockCreds.getGroup as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: { sandboxMode: "true" },
      });

      const result = await service.getGroupSettings("STRIPE");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value["sandboxMode"]).toBe("true");
      }
    });

    it("returns null for unconfigured keys", async () => {
      const result = await service.getGroupSettings("STRIPE");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value["secretKey"]).toBeNull();
        expect(result.value["webhookSecret"]).toBeNull();
      }
    });

    it("masks short values (<=8 chars) as full dots", async () => {
      (mockCreds.getGroup as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: { secretKey: "sk_12" },
      });

      const result = await service.getGroupSettings("STRIPE");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value["secretKey"]).toBe("\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022");
      }
    });

    it("returns all expected keys for the group even if some are null", async () => {
      (mockCreds.getGroup as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: { secretKey: "sk_live_abc123def456ghi789" },
      });

      const result = await service.getGroupSettings("STRIPE");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.keys(result.value)).toContain("secretKey");
        expect(Object.keys(result.value)).toContain("webhookSecret");
        expect(Object.keys(result.value)).toContain("priceStarterMonthly");
        expect(Object.keys(result.value)).toContain("sandboxMode");
      }
    });

    it("propagates credential service errors", async () => {
      (mockCreds.getGroup as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        error: "ENCRYPTION_ERROR",
      });

      const result = await service.getGroupSettings("STRIPE");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("ENCRYPTION_ERROR");
    });
  });

  // ─── setGroupSettings ──────────────────────────────────────────────

  describe("setGroupSettings", () => {
    it("rejects unknown keys not in CREDENTIAL_KEYS", async () => {
      const result = await service.setGroupSettings("STRIPE", { unknownKey: "value" }, "admin-1");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("VALIDATION_ERROR");
      expect(mockCreds.setCredential).not.toHaveBeenCalled();
    });

    it("calls setCredential for each valid key", async () => {
      const result = await service.setGroupSettings(
        "STRIPE",
        { secretKey: "sk_test_123", webhookSecret: "whsec_456" },
        "admin-1"
      );
      expect(result.ok).toBe(true);
      expect(mockCreds.setCredential).toHaveBeenCalledTimes(2);
      expect(mockCreds.setCredential).toHaveBeenCalledWith(
        "STRIPE",
        "secretKey",
        "sk_test_123",
        "admin-1"
      );
      expect(mockCreds.setCredential).toHaveBeenCalledWith(
        "STRIPE",
        "webhookSecret",
        "whsec_456",
        "admin-1"
      );
    });

    it("returns ok on success", async () => {
      const result = await service.setGroupSettings("RESEND", { apiKey: "re_test_key" }, "admin-1");
      expect(result.ok).toBe(true);
    });

    it("returns first error if any setCredential fails", async () => {
      (mockCreds.setCredential as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true, value: undefined })
        .mockResolvedValueOnce({ ok: false, error: "DATABASE_ERROR" });

      const result = await service.setGroupSettings(
        "STRIPE",
        { secretKey: "sk_1", webhookSecret: "wh_2" },
        "admin-1"
      );
      expect(result.ok).toBe(false);
    });
  });

  // ─── getConfigurationStatus ────────────────────────────────────────

  describe("getConfigurationStatus", () => {
    it("returns healthy when critical groups are configured", async () => {
      (mockCreds.listConfiguredGroups as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: ["STRIPE", "RESEND", "AI_POOL", "PLATFORM"],
      });

      const result = await service.getConfigurationStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.overallHealth).toBe("healthy");
        expect(result.value.groups["STRIPE"]).toBe(true);
        expect(result.value.groups["RESEND"]).toBe(true);
        expect(result.value.groups["PADDLE"]).toBe(false);
      }
    });

    it("returns partial when some groups are configured", async () => {
      (mockCreds.listConfiguredGroups as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: ["STRIPE"],
      });

      const result = await service.getConfigurationStatus();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.overallHealth).toBe("partial");
    });

    it("returns unconfigured when no groups are configured", async () => {
      const result = await service.getConfigurationStatus();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.overallHealth).toBe("unconfigured");
    });

    it("correctly maps each group to boolean", async () => {
      (mockCreds.listConfiguredGroups as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: ["SOCIAL_X", "SOCIAL_TELEGRAM"],
      });

      const result = await service.getConfigurationStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.groups["SOCIAL_X"]).toBe(true);
        expect(result.value.groups["SOCIAL_TELEGRAM"]).toBe(true);
        expect(result.value.groups["SOCIAL_FACEBOOK"]).toBe(false);
        expect(result.value.groups["STRIPE"]).toBe(false);
      }
    });
  });

  // ─── testConnection ────────────────────────────────────────────────

  describe("testConnection", () => {
    it("returns success for PLATFORM without calling fetch", async () => {
      const result = await service.testConnection("PLATFORM");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.message).toBe("No connection test needed");
      }
    });

    it("returns success for MONITORING without calling fetch", async () => {
      const result = await service.testConnection("MONITORING");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
      }
    });

    it("returns failure when group has no credentials", async () => {
      const result = await service.testConnection("STRIPE");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(false);
        expect(result.value.message).toContain("No credentials configured");
      }
    });

    it("calls fetch for STRIPE and returns success on 200", async () => {
      (mockCreds.getGroup as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: { secretKey: "sk_test_123" },
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await service.testConnection("STRIPE");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.message).toBe("Stripe API connected");
        expect(result.value.latencyMs).toBeDefined();
      }

      expect(mockFetch).toHaveBeenCalledWith("https://api.stripe.com/v1/balance", {
        headers: { Authorization: "Bearer sk_test_123" },
        signal: expect.any(AbortSignal),
      });

      vi.unstubAllGlobals();
    });

    it("returns failure with message when connection fails", async () => {
      (mockCreds.getGroup as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: { secretKey: "sk_invalid" },
      });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
        })
      );

      const result = await service.testConnection("STRIPE");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(false);
        expect(result.value.message).toContain("401");
      }

      vi.unstubAllGlobals();
    });

    it("includes latencyMs in the result", async () => {
      (mockCreds.getGroup as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: { apiKey: "re_test_key" },
      });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK" })
      );

      const result = await service.testConnection("RESEND");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(typeof result.value.latencyMs).toBe("number");
        expect(result.value.latencyMs).toBeGreaterThanOrEqual(0);
      }

      vi.unstubAllGlobals();
    });
  });

  // ─── logEncryptionKeyRotation ──────────────────────────────────────

  describe("logEncryptionKeyRotation", () => {
    it("creates PlatformEncryptionKey record and audit log", async () => {
      const result = await service.logEncryptionKeyRotation("admin-1", "Quarterly rotation");
      expect(result.ok).toBe(true);
      expect(mockPrisma.platformEncryptionKey.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          keyVersion: 1,
          rotatedBy: "admin-1",
          note: "Quarterly rotation",
          isActive: true,
        }),
      });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "ENCRYPTION_KEY_ROTATED",
          resource: "platform_encryption_key",
          details: { version: 1 },
          userId: "admin-1",
        }),
      });
    });

    it("increments version from latest existing key", async () => {
      (mockPrisma.platformEncryptionKey.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        keyVersion: 3,
      });

      const result = await service.logEncryptionKeyRotation("admin-1");
      expect(result.ok).toBe(true);
      expect(mockPrisma.platformEncryptionKey.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ keyVersion: 4 }),
      });
    });
  });

  // ─── getAiRateLimit ────────────────────────────────────────────────

  describe("getAiRateLimit", () => {
    it("returns hasOwnKey:true when account has BYOK configured", async () => {
      (mockCreds.getAccountCredential as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: "sk-byok-key",
      });
      (mockCreds.getCredential as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: "1000000",
      });

      const result = await service.getAiRateLimit("acc-1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hasOwnKey).toBe(true);
        expect(result.value.byokProvider).toBe("openai");
      }
    });

    it("returns hasOwnKey:false when account has no BYOK", async () => {
      const result = await service.getAiRateLimit("acc-1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hasOwnKey).toBe(false);
        expect(result.value.byokProvider).toBeNull();
      }
    });

    it("returns correct remainingTokens calculation", async () => {
      (mockPrisma.aiTokenUsage.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
        _sum: { tokensUsed: 250000 },
      });
      (mockCreds.getCredential as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: "1000000",
      });

      const result = await service.getAiRateLimit("acc-1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.monthlyBudget).toBe(1000000);
        expect(result.value.usedThisMonth).toBe(250000);
        expect(result.value.remainingTokens).toBe(750000);
      }
    });

    it("returns first day of next month as resetDate", async () => {
      const result = await service.getAiRateLimit("acc-1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        const reset = result.value.resetDate;
        expect(reset.getDate()).toBe(1);
        expect(reset > new Date()).toBe(true);
      }
    });

    it("returns 0 usage if no records exist", async () => {
      const result = await service.getAiRateLimit("acc-1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usedThisMonth).toBe(0);
        expect(result.value.remainingTokens).toBe(0);
        expect(result.value.monthlyBudget).toBe(0);
      }
    });
  });

  // ─── setByokKey ────────────────────────────────────────────────────

  describe("setByokKey", () => {
    it("delegates to setAccountCredential", async () => {
      const result = await service.setByokKey("acc-1", "openai", "sk-abc123");
      expect(result.ok).toBe(true);
      expect(mockCreds.setAccountCredential).toHaveBeenCalledWith(
        "acc-1",
        "AI_BYOK",
        "openai",
        "sk-abc123"
      );
    });
  });

  // ─── deleteByokKey ─────────────────────────────────────────────────

  describe("deleteByokKey", () => {
    it("delegates to deleteAccountCredential", async () => {
      const result = await service.deleteByokKey("acc-1", "openai");
      expect(result.ok).toBe(true);
      expect(mockCreds.deleteAccountCredential).toHaveBeenCalledWith("acc-1", "AI_BYOK", "openai");
    });
  });

  // ─── testByokKey ───────────────────────────────────────────────────

  describe("testByokKey", () => {
    it("returns success when provider API responds 200", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK" })
      );

      const result = await service.testByokKey("openai", "sk-test-key-12345");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.message).toContain("openai");
        expect(result.value.latencyMs).toBeDefined();
      }

      vi.unstubAllGlobals();
    });

    it("returns failure when provider API responds with error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: "Forbidden" })
      );

      const result = await service.testByokKey("anthropic", "sk-invalid-key-12345");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(false);
        expect(result.value.message).toContain("403");
      }

      vi.unstubAllGlobals();
    });

    it("returns failure for unknown provider", async () => {
      const result = await service.testByokKey("unknown-provider", "sk-key-12345678");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(false);
        expect(result.value.message).toContain("Unknown AI provider");
      }
    });
  });

  // ─── getPublicPlatformSettings ──────────────────────────────────────

  describe("getPublicPlatformSettings", () => {
    it("returns only NON_SECRET_KEYS values from PLATFORM group", async () => {
      (mockCreds.getGroup as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: {
          name: "OmniPost",
          baseUrl: "https://app.omnipost.io",
          adminUrl: "https://admin.omnipost.io",
          turnstileSiteKey: "0x4AAAAAAA_test_key",
          turnstileSecretKey: "0x4AAAAAAA_secret_value",
        },
      });

      const result = await service.getPublicPlatformSettings();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value["name"]).toBe("OmniPost");
        expect(result.value["baseUrl"]).toBe("https://app.omnipost.io");
        expect(result.value["adminUrl"]).toBe("https://admin.omnipost.io");
        expect(result.value["turnstileSiteKey"]).toBe("0x4AAAAAAA_test_key");
      }
    });

    it("never returns turnstileSecretKey or other secrets", async () => {
      (mockCreds.getGroup as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: {
          name: "OmniPost",
          turnstileSiteKey: "0x4AAAAAAA_test_key",
          turnstileSecretKey: "0x4AAAAAAA_secret_value",
        },
      });

      const result = await service.getPublicPlatformSettings();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value["turnstileSecretKey"]).toBeUndefined();
      }
    });

    it("returns empty object when PLATFORM group not configured", async () => {
      (mockCreds.getGroup as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: {},
      });

      const result = await service.getPublicPlatformSettings();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.keys(result.value)).toHaveLength(0);
      }
    });

    it("omits null/empty values from response", async () => {
      (mockCreds.getGroup as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: { name: "OmniPost", baseUrl: "", adminUrl: null },
      });

      const result = await service.getPublicPlatformSettings();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value["name"]).toBe("OmniPost");
        expect(result.value["baseUrl"]).toBeUndefined();
        expect(result.value["adminUrl"]).toBeUndefined();
      }
    });

    it("returns DATABASE_ERROR when credential service fails", async () => {
      (mockCreds.getGroup as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        error: "DECRYPTION_FAILED",
      });

      const result = await service.getPublicPlatformSettings();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("DATABASE_ERROR");
      }
    });
  });
});
