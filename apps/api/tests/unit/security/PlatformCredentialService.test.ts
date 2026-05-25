/**
 * @file PlatformCredentialService.test.ts
 * @description Unit tests for encrypted credential CRUD service.
 * @layer application
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlatformCredentialService } from "../../../src/security/PlatformCredentialService.js";
import type { EncryptionService, EncryptedValue } from "../../../src/security/EncryptionService.js";
import type { PrismaClient } from "@infra/prisma";

function makeMockEncryptionService(_overrides: Partial<EncryptionService> = {}): EncryptionService {
  return {
    encrypt: vi.fn().mockReturnValue({
      encryptedValue: "encrypted_base64",
      iv: "iv_base64",
      authTag: "tag_base64",
    } satisfies EncryptedValue),
    decrypt: vi.fn().mockReturnValue("decrypted_plaintext"),
    isConfigured: vi.fn().mockReturnValue(true),
  } as unknown as EncryptionService;
}

function makeMockPrisma() {
  return {
    platformCredential: {
      upsert: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    accountCredential: {
      upsert: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

describe("PlatformCredentialService", () => {
  let service: PlatformCredentialService;
  let mockEncryption: EncryptionService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEncryption = makeMockEncryptionService();
    mockPrisma = makeMockPrisma();
    service = new PlatformCredentialService(mockPrisma as PrismaClient, mockEncryption);
  });

  describe("setCredential", () => {
    it("calls encrypt before writing to DB", async () => {
      const result = await service.setCredential("STRIPE", "secretKey", "sk_test_123", "admin-1");

      expect(result.ok).toBe(true);
      expect(mockEncryption.encrypt).toHaveBeenCalledWith("sk_test_123", {
        fieldName: "PlatformCredential",
        recordId: "STRIPE:secretKey",
        caller: "PlatformCredentialService.setCredential",
      });
      expect(mockPrisma.platformCredential.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            encryptedValue: "encrypted_base64",
            iv: "iv_base64",
            authTag: "tag_base64",
          }),
        })
      );
    });

    it("upserts — does not create duplicate for same group+key", async () => {
      await service.setCredential("STRIPE", "secretKey", "value1", "admin-1");
      await service.setCredential("STRIPE", "secretKey", "value2", "admin-1");

      const calls = (mockPrisma.platformCredential.upsert as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(2);
      for (const call of calls) {
        expect(call[0]).toHaveProperty("where", {
          group_key: { group: "STRIPE", key: "secretKey" },
        });
      }
    });

    it("writes AuditLog entry with group and key but NOT the plaintext value", async () => {
      await service.setCredential("STRIPE", "secretKey", "sk_test_secret", "admin-1");

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "CREDENTIAL_UPDATED",
          resource: "platform_credential",
          details: { group: "STRIPE", key: "secretKey" },
          userId: "admin-1",
        }),
      });

      const auditData = (mockPrisma.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
        .data;
      expect(JSON.stringify(auditData)).not.toContain("sk_test_secret");
    });
  });

  describe("getCredential", () => {
    it("returns null when credential does not exist", async () => {
      const result = await service.getCredential("STRIPE", "nonexistent");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBeNull();
    });

    it("calls decrypt with the stored encrypted data", async () => {
      (mockPrisma.platformCredential.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        encryptedValue: "stored_encrypted",
        iv: "stored_iv",
        authTag: "stored_tag",
      });

      const result = await service.getCredential("STRIPE", "secretKey");

      expect(mockEncryption.decrypt).toHaveBeenCalledWith(
        {
          encryptedValue: "stored_encrypted",
          iv: "stored_iv",
          authTag: "stored_tag",
          keyVersion: undefined,
        },
        {
          fieldName: "PlatformCredential",
          recordId: "STRIPE:secretKey",
          caller: "PlatformCredentialService.getCredential",
        }
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe("decrypted_plaintext");
    });
  });

  describe("getGroup", () => {
    it("returns all credentials for a group as decrypted key-value map", async () => {
      (mockPrisma.platformCredential.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { key: "apiKey", encryptedValue: "e1", iv: "i1", authTag: "t1" },
        { key: "webhookSecret", encryptedValue: "e2", iv: "i2", authTag: "t2" },
      ]);

      const result = await service.getGroup("STRIPE");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveProperty("apiKey");
        expect(result.value).toHaveProperty("webhookSecret");
      }
      expect(mockEncryption.decrypt).toHaveBeenCalledTimes(2);
    });

    it("returns empty object when group has no credentials", async () => {
      const result = await service.getGroup("RESEND");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({});
    });
  });

  describe("getPlatformCredentials (PlatformCredentialReader port)", () => {
    it("reads the PLATFORM group as a decrypted key-value map", async () => {
      (mockPrisma.platformCredential.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { key: "baseUrl", encryptedValue: "e1", iv: "i1", authTag: "t1" },
        { key: "supportEmail", encryptedValue: "e2", iv: "i2", authTag: "t2" },
      ]);

      const result = await service.getPlatformCredentials();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveProperty("baseUrl");
        expect(result.value).toHaveProperty("supportEmail");
      }
      // Scoped to the PLATFORM group only.
      expect(mockPrisma.platformCredential.findMany).toHaveBeenCalledWith({
        where: { group: "PLATFORM", isActive: true },
      });
    });

    it("returns empty object when the PLATFORM group has no credentials", async () => {
      const result = await service.getPlatformCredentials();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({});
    });
  });

  describe("deleteCredential", () => {
    it("deletes from DB and writes audit log", async () => {
      const result = await service.deleteCredential("STRIPE", "secretKey", "admin-1");
      expect(result.ok).toBe(true);
      expect(mockPrisma.platformCredential.delete).toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "CREDENTIAL_DELETED",
          details: { group: "STRIPE", key: "secretKey" },
        }),
      });
    });
  });

  describe("isGroupConfigured", () => {
    it("returns true when group has at least one active credential", async () => {
      (mockPrisma.platformCredential.count as ReturnType<typeof vi.fn>).mockResolvedValue(3);
      const result = await service.isGroupConfigured("STRIPE");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(true);
    });

    it("returns false when group has no credentials", async () => {
      const result = await service.isGroupConfigured("RESEND");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(false);
    });

    it("does NOT call decrypt", async () => {
      await service.isGroupConfigured("STRIPE");
      expect(mockEncryption.decrypt).not.toHaveBeenCalled();
    });
  });

  describe("listConfiguredGroups", () => {
    it("returns only groups with active credentials", async () => {
      (mockPrisma.platformCredential.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
        { group: "STRIPE" },
        { group: "RESEND" },
      ]);

      const result = await service.listConfiguredGroups();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(["STRIPE", "RESEND"]);
      }
    });

    it("does NOT call decrypt", async () => {
      await service.listConfiguredGroups();
      expect(mockEncryption.decrypt).not.toHaveBeenCalled();
    });
  });

  describe("setAccountCredential", () => {
    it("encrypts before writing", async () => {
      const result = await service.setAccountCredential(
        "acc-1",
        "AI_BYOK",
        "openaiApiKey",
        "sk-abc"
      );
      expect(result.ok).toBe(true);
      expect(mockEncryption.encrypt).toHaveBeenCalledWith("sk-abc", {
        fieldName: "AccountCredential",
        recordId: "acc-1:AI_BYOK:openaiApiKey",
        caller: "PlatformCredentialService.setAccountCredential",
      });
      expect(mockPrisma.accountCredential.upsert).toHaveBeenCalled();
    });

    it("scopes credential to the specific accountId", async () => {
      await service.setAccountCredential("acc-1", "AI_BYOK", "openaiApiKey", "sk-abc");
      const call = (mockPrisma.accountCredential.upsert as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.where).toEqual({
        accountId_group_key: { accountId: "acc-1", group: "AI_BYOK", key: "openaiApiKey" },
      });
      expect(call.create).toHaveProperty("accountId", "acc-1");
    });
  });

  describe("getAccountCredential", () => {
    it("returns null for wrong accountId", async () => {
      const result = await service.getAccountCredential("wrong-acc", "AI_BYOK", "key");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBeNull();
    });

    it("returns decrypted value for correct accountId", async () => {
      (mockPrisma.accountCredential.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        encryptedValue: "enc",
        iv: "iv",
        authTag: "tag",
      });

      const result = await service.getAccountCredential("acc-1", "AI_BYOK", "openaiApiKey");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe("decrypted_plaintext");
    });
  });

  describe("deleteAccountCredential", () => {
    it("deletes the credential scoped to accountId", async () => {
      const result = await service.deleteAccountCredential("acc-1", "AI_BYOK", "openaiApiKey");
      expect(result.ok).toBe(true);
      expect(mockPrisma.accountCredential.delete).toHaveBeenCalledWith({
        where: {
          accountId_group_key: { accountId: "acc-1", group: "AI_BYOK", key: "openaiApiKey" },
        },
      });
    });
  });
});
