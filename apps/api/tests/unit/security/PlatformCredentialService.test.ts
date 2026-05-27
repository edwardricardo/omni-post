/**
 * @file PlatformCredentialService.test.ts
 * @description Unit tests for the encrypted credential CRUD service. Mocks the
 *   three injected ports (`PlatformCredentialRepository`, `EncryptionPort`,
 *   `AuditEmitterPort`); no Prisma or real encryption involved.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, err, type Result } from "@shared/types";
import { PlatformCredentialService } from "../../../src/security/PlatformCredentialService.js";
import type {
  PlatformCredentialRepository,
  CredentialStoreError,
} from "@core/domain/repositories/PlatformCredentialRepository.js";
import type { EncryptionPort, EncryptedValue } from "@core/domain/repositories/EncryptionPort.js";
import type { AuditEmitterPort } from "@core/domain/repositories/AuditEmitterPort.js";

function makeEncryption(): EncryptionPort {
  return {
    encrypt: vi.fn().mockReturnValue({
      encryptedValue: "encrypted_base64",
      iv: "iv_base64",
      authTag: "tag_base64",
      keyVersion: 1,
    } satisfies EncryptedValue),
    decrypt: vi.fn().mockReturnValue("decrypted_plaintext"),
  };
}

function makeRepo(): PlatformCredentialRepository {
  return {
    upsertCredential: vi
      .fn<PlatformCredentialRepository["upsertCredential"]>()
      .mockResolvedValue(ok(undefined) as Result<void, CredentialStoreError>),
    findCredential: vi
      .fn<PlatformCredentialRepository["findCredential"]>()
      .mockResolvedValue(ok(null) as Result<EncryptedValue | null, CredentialStoreError>),
    findGroupCredentials: vi
      .fn<PlatformCredentialRepository["findGroupCredentials"]>()
      .mockResolvedValue(ok({}) as Result<Record<string, EncryptedValue>, CredentialStoreError>),
    deleteCredential: vi
      .fn<PlatformCredentialRepository["deleteCredential"]>()
      .mockResolvedValue(ok(undefined) as Result<void, CredentialStoreError>),
    countGroupCredentials: vi
      .fn<PlatformCredentialRepository["countGroupCredentials"]>()
      .mockResolvedValue(ok(0) as Result<number, CredentialStoreError>),
    listGroupsWithActiveCredentials: vi
      .fn<PlatformCredentialRepository["listGroupsWithActiveCredentials"]>()
      .mockResolvedValue(ok([]) as Result<typeof __dummy, CredentialStoreError>),
    upsertAccountCredential: vi
      .fn<PlatformCredentialRepository["upsertAccountCredential"]>()
      .mockResolvedValue(ok(undefined) as Result<void, CredentialStoreError>),
    findAccountCredential: vi
      .fn<PlatformCredentialRepository["findAccountCredential"]>()
      .mockResolvedValue(ok(null) as Result<EncryptedValue | null, CredentialStoreError>),
    deleteAccountCredential: vi
      .fn<PlatformCredentialRepository["deleteAccountCredential"]>()
      .mockResolvedValue(ok(undefined) as Result<void, CredentialStoreError>),
  };
}
// Helper: dummy type alias for the CredentialGroup[] return type to keep the
// mock factory compact without re-importing the enum.
const __dummy: never[] = [];

function makeAuditEmitter(): AuditEmitterPort & { emit: ReturnType<typeof vi.fn> } {
  return { emit: vi.fn().mockResolvedValue(undefined) };
}

describe("PlatformCredentialService", () => {
  let service: PlatformCredentialService;
  let encryption: EncryptionPort;
  let repo: PlatformCredentialRepository;
  let auditEmitter: AuditEmitterPort & { emit: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    encryption = makeEncryption();
    repo = makeRepo();
    auditEmitter = makeAuditEmitter();
    service = new PlatformCredentialService(repo, encryption, auditEmitter);
  });

  describe("setCredential", () => {
    it("calls encrypt and upserts via the repository", async () => {
      const result = await service.setCredential("STRIPE", "secretKey", "sk_test_123", "admin-1");
      expect(result.ok).toBe(true);
      expect(encryption.encrypt).toHaveBeenCalledWith("sk_test_123", {
        fieldName: "PlatformCredential",
        recordId: "STRIPE:secretKey",
        caller: "PlatformCredentialService.setCredential",
      });
      expect(repo.upsertCredential).toHaveBeenCalledWith(
        "STRIPE",
        "secretKey",
        expect.objectContaining({ encryptedValue: "encrypted_base64", keyVersion: 1 }),
        "admin-1"
      );
    });

    it("emits audit with group and key but NOT the plaintext value", async () => {
      await service.setCredential("STRIPE", "secretKey", "sk_test_secret", "admin-1");
      expect(auditEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "CREDENTIAL_UPDATED",
          category: "SECURITY",
          userId: "admin-1",
          resourceType: "platform_credential",
          resourceId: "STRIPE:secretKey",
          details: { group: "STRIPE", key: "secretKey" },
        })
      );
      expect(JSON.stringify(auditEmitter.emit.mock.calls[0])).not.toContain("sk_test_secret");
    });

    it("returns INTERNAL_ERROR when encryption throws", async () => {
      (encryption.encrypt as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("PLATFORM_ENCRYPTION_KEY missing");
      });
      const result = await service.setCredential("STRIPE", "secretKey", "v", "admin-1");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns NOT_FOUND when repository reports NOT_FOUND", async () => {
      (repo.upsertCredential as ReturnType<typeof vi.fn>).mockResolvedValue(err("NOT_FOUND"));
      const result = await service.setCredential("STRIPE", "secretKey", "v", "admin-1");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    });
  });

  describe("getCredential", () => {
    it("returns null when the credential does not exist", async () => {
      const result = await service.getCredential("STRIPE", "nonexistent");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBeNull();
    });

    it("decrypts the stored envelope", async () => {
      (repo.findCredential as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok({
          encryptedValue: "stored_encrypted",
          iv: "stored_iv",
          authTag: "stored_tag",
          keyVersion: 2,
        })
      );
      const result = await service.getCredential("STRIPE", "secretKey");
      expect(encryption.decrypt).toHaveBeenCalledWith(
        {
          encryptedValue: "stored_encrypted",
          iv: "stored_iv",
          authTag: "stored_tag",
          keyVersion: 2,
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
    it("returns all credentials for a group as a decrypted map", async () => {
      (repo.findGroupCredentials as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok({
          apiKey: { encryptedValue: "e1", iv: "i1", authTag: "t1", keyVersion: 1 },
          webhookSecret: { encryptedValue: "e2", iv: "i2", authTag: "t2", keyVersion: 1 },
        })
      );
      const result = await service.getGroup("STRIPE");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveProperty("apiKey");
        expect(result.value).toHaveProperty("webhookSecret");
      }
      expect(encryption.decrypt).toHaveBeenCalledTimes(2);
    });

    it("returns empty object when group has no credentials", async () => {
      const result = await service.getGroup("RESEND");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({});
    });
  });

  describe("getPlatformCredentials (PlatformCredentialReader port)", () => {
    it("reads PLATFORM group via findGroupCredentials", async () => {
      (repo.findGroupCredentials as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok({
          baseUrl: { encryptedValue: "e1", iv: "i1", authTag: "t1", keyVersion: 1 },
          supportEmail: { encryptedValue: "e2", iv: "i2", authTag: "t2", keyVersion: 1 },
        })
      );
      const result = await service.getPlatformCredentials();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveProperty("baseUrl");
        expect(result.value).toHaveProperty("supportEmail");
      }
      expect(repo.findGroupCredentials).toHaveBeenCalledWith("PLATFORM");
    });

    it("returns empty object when PLATFORM is empty", async () => {
      const result = await service.getPlatformCredentials();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({});
    });

    it("returns string-union error when decrypt throws (port contract)", async () => {
      (repo.findGroupCredentials as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok({ baseUrl: { encryptedValue: "e", iv: "i", authTag: "t", keyVersion: 1 } })
      );
      (encryption.decrypt as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("AAD mismatch");
      });
      const result = await service.getPlatformCredentials();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("ENCRYPTION_ERROR");
    });
  });

  describe("deleteCredential", () => {
    it("deletes and emits CREDENTIAL_DELETED audit", async () => {
      const result = await service.deleteCredential("STRIPE", "secretKey", "admin-1");
      expect(result.ok).toBe(true);
      expect(repo.deleteCredential).toHaveBeenCalledWith("STRIPE", "secretKey");
      expect(auditEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "CREDENTIAL_DELETED",
          details: { group: "STRIPE", key: "secretKey" },
        })
      );
    });
  });

  describe("isGroupConfigured", () => {
    it("returns true when count > 0", async () => {
      (repo.countGroupCredentials as ReturnType<typeof vi.fn>).mockResolvedValue(ok(3));
      const result = await service.isGroupConfigured("STRIPE");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(true);
    });

    it("returns false when count == 0", async () => {
      const result = await service.isGroupConfigured("RESEND");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(false);
    });

    it("does NOT call decrypt", async () => {
      await service.isGroupConfigured("STRIPE");
      expect(encryption.decrypt).not.toHaveBeenCalled();
    });
  });

  describe("listConfiguredGroups", () => {
    it("forwards repo output", async () => {
      (repo.listGroupsWithActiveCredentials as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok(["STRIPE", "RESEND"])
      );
      const result = await service.listConfiguredGroups();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual(["STRIPE", "RESEND"]);
    });

    it("does NOT call decrypt", async () => {
      await service.listConfiguredGroups();
      expect(encryption.decrypt).not.toHaveBeenCalled();
    });
  });

  describe("setAccountCredential", () => {
    it("encrypts and upserts via the repository", async () => {
      const result = await service.setAccountCredential(
        "acc-1",
        "AI_BYOK",
        "openaiApiKey",
        "sk-abc"
      );
      expect(result.ok).toBe(true);
      expect(encryption.encrypt).toHaveBeenCalledWith("sk-abc", {
        fieldName: "AccountCredential",
        recordId: "acc-1:AI_BYOK:openaiApiKey",
        caller: "PlatformCredentialService.setAccountCredential",
      });
      expect(repo.upsertAccountCredential).toHaveBeenCalledWith(
        "acc-1",
        "AI_BYOK",
        "openaiApiKey",
        expect.objectContaining({ encryptedValue: "encrypted_base64" })
      );
    });

    it("does NOT emit audit (per-account writes are scoped)", async () => {
      await service.setAccountCredential("acc-1", "AI_BYOK", "key", "value");
      expect(auditEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("getAccountCredential", () => {
    it("returns null when not stored", async () => {
      const result = await service.getAccountCredential("acc-1", "AI_BYOK", "key");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBeNull();
    });

    it("decrypts when stored", async () => {
      (repo.findAccountCredential as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok({ encryptedValue: "enc", iv: "iv", authTag: "tag", keyVersion: 1 })
      );
      const result = await service.getAccountCredential("acc-1", "AI_BYOK", "openaiApiKey");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe("decrypted_plaintext");
    });
  });

  describe("deleteAccountCredential", () => {
    it("forwards delete to the repository", async () => {
      const result = await service.deleteAccountCredential("acc-1", "AI_BYOK", "openaiApiKey");
      expect(result.ok).toBe(true);
      expect(repo.deleteAccountCredential).toHaveBeenCalledWith("acc-1", "AI_BYOK", "openaiApiKey");
    });
  });
});
