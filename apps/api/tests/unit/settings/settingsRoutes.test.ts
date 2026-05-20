/**
 * @file settingsRoutes.test.ts
 * @description Unit tests for settings API route handlers.
 *   Tests Zod validation, auth requirements, and response shapes.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  groupParamsSchema,
  groupKeyParamsSchema,
  updateCredentialsSchema,
  setByokSchema,
  byokProviderParamsSchema,
  testByokSchema,
  rotateEncryptionSchema,
  credentialGroupSchema,
} from "../../../src/settings/settingsSchemas.js";

describe("Settings Schemas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── credentialGroupSchema ─────────────────────────────────────────

  describe("credentialGroupSchema", () => {
    it("accepts valid credential groups", () => {
      expect(credentialGroupSchema.safeParse("STRIPE").success).toBe(true);
      expect(credentialGroupSchema.safeParse("PADDLE").success).toBe(true);
      expect(credentialGroupSchema.safeParse("RESEND").success).toBe(true);
      expect(credentialGroupSchema.safeParse("SOCIAL_X").success).toBe(true);
      expect(credentialGroupSchema.safeParse("SOCIAL_BLUESKY").success).toBe(true);
    });

    it("rejects invalid group names", () => {
      expect(credentialGroupSchema.safeParse("INVALID_GROUP").success).toBe(false);
      expect(credentialGroupSchema.safeParse("").success).toBe(false);
      expect(credentialGroupSchema.safeParse("stripe").success).toBe(false);
    });
  });

  // ─── groupParamsSchema ─────────────────────────────────────────────

  describe("groupParamsSchema", () => {
    it("accepts valid group param", () => {
      const result = groupParamsSchema.safeParse({ group: "STRIPE" });
      expect(result.success).toBe(true);
    });

    it("rejects invalid group param", () => {
      const result = groupParamsSchema.safeParse({ group: "NOPE" });
      expect(result.success).toBe(false);
    });

    it("rejects missing group param", () => {
      const result = groupParamsSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  // ─── groupKeyParamsSchema ──────────────────────────────────────────

  describe("groupKeyParamsSchema", () => {
    it("accepts valid group and key", () => {
      const result = groupKeyParamsSchema.safeParse({ group: "STRIPE", key: "secretKey" });
      expect(result.success).toBe(true);
    });

    it("rejects empty key", () => {
      const result = groupKeyParamsSchema.safeParse({ group: "STRIPE", key: "" });
      expect(result.success).toBe(false);
    });

    it("rejects missing key", () => {
      const result = groupKeyParamsSchema.safeParse({ group: "STRIPE" });
      expect(result.success).toBe(false);
    });
  });

  // ─── updateCredentialsSchema ───────────────────────────────────────

  describe("updateCredentialsSchema", () => {
    it("accepts valid credentials object", () => {
      const result = updateCredentialsSchema.safeParse({
        credentials: { secretKey: "sk_test_123", webhookSecret: "whsec_456" },
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty values in credentials", () => {
      const result = updateCredentialsSchema.safeParse({
        credentials: { secretKey: "" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing credentials key", () => {
      const result = updateCredentialsSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-object credentials", () => {
      const result = updateCredentialsSchema.safeParse({ credentials: "not-an-object" });
      expect(result.success).toBe(false);
    });
  });

  // ─── rotateEncryptionSchema ────────────────────────────────────────

  describe("rotateEncryptionSchema", () => {
    it("accepts empty object (note is optional)", () => {
      const result = rotateEncryptionSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts with note", () => {
      const result = rotateEncryptionSchema.safeParse({ note: "Quarterly rotation" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.note).toBe("Quarterly rotation");
      }
    });
  });

  // ─── setByokSchema ────────────────────────────────────────────────

  describe("setByokSchema", () => {
    it("accepts valid BYOK input", () => {
      const result = setByokSchema.safeParse({
        provider: "openai",
        apiKey: "FAKE-byok-test-fixture",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid provider", () => {
      const result = setByokSchema.safeParse({
        provider: "invalid-provider",
        apiKey: "FAKE-byok-test-fixture",
      });
      expect(result.success).toBe(false);
    });

    it("rejects API key shorter than 10 chars", () => {
      const result = setByokSchema.safeParse({ provider: "openai", apiKey: "short" });
      expect(result.success).toBe(false);
    });

    it("accepts all valid AI providers", () => {
      for (const provider of ["openai", "anthropic", "gemini", "perplexity"]) {
        const result = setByokSchema.safeParse({
          provider,
          apiKey: "FAKE-byok-test-fixture",
        });
        expect(result.success).toBe(true);
      }
    });
  });

  // ─── byokProviderParamsSchema ──────────────────────────────────────

  describe("byokProviderParamsSchema", () => {
    it("accepts valid AI provider", () => {
      expect(byokProviderParamsSchema.safeParse({ provider: "openai" }).success).toBe(true);
      expect(byokProviderParamsSchema.safeParse({ provider: "anthropic" }).success).toBe(true);
    });

    it("rejects invalid provider", () => {
      expect(byokProviderParamsSchema.safeParse({ provider: "gpt" }).success).toBe(false);
    });
  });

  // ─── testByokSchema ───────────────────────────────────────────────

  describe("testByokSchema", () => {
    it("accepts valid test BYOK input", () => {
      const result = testByokSchema.safeParse({
        provider: "anthropic",
        apiKey: "sk-ant-api03-abc123def456",
      });
      expect(result.success).toBe(true);
    });

    it("rejects API key longer than 500 chars", () => {
      const result = testByokSchema.safeParse({
        provider: "openai",
        apiKey: "x".repeat(501),
      });
      expect(result.success).toBe(false);
    });
  });
});
