/**
 * @file PrismaOidcConfigurationRepository.test.ts
 * @description Unit tests for the OIDC configuration repository — verifies the
 *   client secret is encrypted on write, decrypted on read, and that no
 *   plaintext path leaks through the repository surface.
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { PrismaOidcConfigurationRepository } from "../../../src/infrastructure/repositories/PrismaOidcConfigurationRepository.js";
import { EncryptionService } from "../../../src/security/EncryptionService.js";
import type { OidcConfiguration } from "../../../src/domain/entities/OidcConfiguration.js";

const VALID_KEY = randomBytes(32).toString("base64");

function makeEncryption(): EncryptionService {
  return new EncryptionService({ activeKeyBase64: VALID_KEY, activeKeyVersion: 1 });
}

function makeConfig(_overrides?: Partial<OidcConfiguration>): OidcConfiguration {
  return {
    id: "oidc-1",
    accountId: "acc-1",
    issuerUrl: "https://idp.example.com",
    clientId: "client-id-public",
    clientSecret: "super-secret-client-value-123",
    scopes: ["openid", "email", "profile"],
    attributeMapping: { email: "email", name: "name" },
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  } as unknown as OidcConfiguration;
}

describe("PrismaOidcConfigurationRepository", () => {
  let upsertMock: ReturnType<typeof vi.fn>;
  let findUniqueMock: ReturnType<typeof vi.fn>;
  let prisma: {
    oidcConfiguration: {
      upsert: typeof upsertMock;
      findUnique: typeof findUniqueMock;
      deleteMany: ReturnType<typeof vi.fn>;
    };
  };
  let encryption: EncryptionService;
  let repo: PrismaOidcConfigurationRepository;

  beforeEach(() => {
    upsertMock = vi.fn(async (_args: unknown) => ({}));
    findUniqueMock = vi.fn(async (_args: unknown) => null);
    prisma = {
      oidcConfiguration: {
        upsert: upsertMock,
        findUnique: findUniqueMock,
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    encryption = makeEncryption();
    repo = new PrismaOidcConfigurationRepository(prisma as never, encryption);
  });

  describe("save", () => {
    it("encrypts clientSecret before writing — plaintext never reaches the upsert payload", async () => {
      const config = makeConfig();
      const result = await repo.save(config);
      expect(result.ok).toBe(true);
      expect(upsertMock).toHaveBeenCalledOnce();
      const args = upsertMock.mock.calls[0]?.[0] as {
        create: {
          clientSecretCiphertext: string;
          clientSecretIv: string;
          clientSecretAuthTag: string;
          clientSecretKeyVersion: number;
        };
      };
      // Plaintext must NOT appear anywhere in the create payload.
      const serialized = JSON.stringify(args.create);
      expect(serialized).not.toContain("super-secret-client-value-123");
      // Encrypted envelope fields must be populated.
      expect(args.create.clientSecretCiphertext).toBeTruthy();
      expect(args.create.clientSecretIv).toBeTruthy();
      expect(args.create.clientSecretAuthTag).toBeTruthy();
      expect(args.create.clientSecretKeyVersion).toBe(1);
    });

    it("propagates save errors as Result.err", async () => {
      upsertMock.mockRejectedValueOnce(new Error("DB down"));
      const result = await repo.save(makeConfig());
      expect(result.ok).toBe(false);
    });
  });

  describe("findByAccountId", () => {
    it("decrypts clientSecret on read — domain layer sees plaintext", async () => {
      // Pre-encrypt a known plaintext using the same service the repo will use.
      // Same context the repo uses on read (fieldName + accountId as recordId).
      const encrypted = encryption.encrypt("the-real-secret-xyz", {
        fieldName: "OidcConfiguration.clientSecret",
        recordId: "acc-1",
      });
      findUniqueMock.mockResolvedValueOnce({
        id: "oidc-1",
        accountId: "acc-1",
        issuerUrl: "https://idp.example.com",
        clientId: "client-id-public",
        clientSecretCiphertext: encrypted.encryptedValue,
        clientSecretIv: encrypted.iv,
        clientSecretAuthTag: encrypted.authTag,
        clientSecretKeyVersion: encrypted.keyVersion,
        scopes: ["openid"],
        attributeMapping: { email: "email" },
        isActive: true,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      });
      const data = await repo.findByAccountId("acc-1");
      expect(data?.clientSecret).toBe("the-real-secret-xyz");
    });

    it("returns null when no config exists", async () => {
      findUniqueMock.mockResolvedValueOnce(null);
      const data = await repo.findByAccountId("missing");
      expect(data).toBeNull();
    });
  });
});
