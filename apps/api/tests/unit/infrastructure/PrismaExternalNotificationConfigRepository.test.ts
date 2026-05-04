/**
 * @file PrismaExternalNotificationConfigRepository.test.ts
 * @description Verifies that webhook URLs (which often embed bearer tokens
 *   such as Slack incoming-webhook tokens or Teams connector tokens) are
 *   encrypted on write and decrypted on read.
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { PrismaExternalNotificationConfigRepository } from "../../../src/infrastructure/repositories/PrismaExternalNotificationConfigRepository.js";
import { EncryptionService } from "../../../src/security/EncryptionService.js";
import type { ExternalNotificationConfigData } from "../../../src/domain/repositories/ExternalNotificationConfigRepository.js";

const VALID_KEY = randomBytes(32).toString("base64");
// Generic webhook URL with an embedded bearer token, structurally similar to
// what Slack / Teams / Discord / etc. produce. Kept as `example.com` so the
// test fixture does not match GitHub's secret-scanning pattern for any real
// vendor webhook format.
const PLAINTEXT_URL = "https://example.com/webhook/test-bearer-token-XXXXXXXXXXXXXXXXXXXXXXXX";

function makeConfig(
  overrides?: Partial<ExternalNotificationConfigData>
): ExternalNotificationConfigData {
  return {
    id: "ext-1",
    projectId: "proj-1",
    channel: "slack",
    webhookUrl: PLAINTEXT_URL,
    label: "Engineering channel",
    events: ["post.published", "post.failed"],
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("PrismaExternalNotificationConfigRepository", () => {
  let upsertMock: ReturnType<typeof vi.fn>;
  let findUniqueMock: ReturnType<typeof vi.fn>;
  let findManyMock: ReturnType<typeof vi.fn>;
  let prisma: never;
  let encryption: EncryptionService;
  let repo: PrismaExternalNotificationConfigRepository;

  beforeEach(() => {
    encryption = new EncryptionService({ activeKeyBase64: VALID_KEY, activeKeyVersion: 1 });
    upsertMock = vi.fn();
    findUniqueMock = vi.fn();
    findManyMock = vi.fn();
    prisma = {
      externalNotificationConfig: {
        upsert: upsertMock,
        findUnique: findUniqueMock,
        findMany: findManyMock,
        delete: vi.fn(),
      },
    } as never;
    repo = new PrismaExternalNotificationConfigRepository(prisma, encryption);
  });

  describe("save", () => {
    it("encrypts webhookUrl before writing — plaintext URL never reaches the upsert payload", async () => {
      const enc = encryption.encrypt(PLAINTEXT_URL, {
        fieldName: "ExternalNotificationConfig.webhookUrl",
        recordId: "ext-1",
      });
      upsertMock.mockResolvedValueOnce({
        id: "ext-1",
        projectId: "proj-1",
        channel: "slack",
        webhookUrlCiphertext: enc.encryptedValue,
        webhookUrlIv: enc.iv,
        webhookUrlAuthTag: enc.authTag,
        webhookUrlKeyVersion: enc.keyVersion,
        label: "Engineering channel",
        events: ["post.published", "post.failed"],
        isActive: true,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      });

      const result = await repo.save(makeConfig());
      expect(result.ok).toBe(true);
      const args = upsertMock.mock.calls[0]?.[0] as {
        create: Record<string, unknown>;
      };
      const serialized = JSON.stringify(args.create);
      expect(serialized).not.toContain("hooks.slack.com");
      expect(serialized).not.toContain("XXXXXXXXXXXXXXXXXXXXXXXX");
      expect(args.create.webhookUrlCiphertext).toBeTruthy();
      expect(args.create.webhookUrlKeyVersion).toBe(1);
    });
  });

  describe("findById", () => {
    it("decrypts webhookUrl on read", async () => {
      const enc = encryption.encrypt(PLAINTEXT_URL, {
        fieldName: "ExternalNotificationConfig.webhookUrl",
        recordId: "ext-1",
      });
      findUniqueMock.mockResolvedValueOnce({
        id: "ext-1",
        projectId: "proj-1",
        channel: "slack",
        webhookUrlCiphertext: enc.encryptedValue,
        webhookUrlIv: enc.iv,
        webhookUrlAuthTag: enc.authTag,
        webhookUrlKeyVersion: enc.keyVersion,
        label: "Engineering channel",
        events: ["post.published"],
        isActive: true,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      });

      const result = await repo.findById("ext-1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.webhookUrl).toBe(PLAINTEXT_URL);
      }
    });
  });

  describe("findActiveByProjectAndEvent", () => {
    it("decrypts each row's webhookUrl in the result list", async () => {
      const enc1 = encryption.encrypt("https://hooks.slack.com/services/A", {
        fieldName: "ExternalNotificationConfig.webhookUrl",
        recordId: "ext-1",
      });
      const enc2 = encryption.encrypt("https://outlook.office.com/webhook/B", {
        fieldName: "ExternalNotificationConfig.webhookUrl",
        recordId: "ext-2",
      });
      findManyMock.mockResolvedValueOnce([
        {
          id: "ext-1",
          projectId: "proj-1",
          channel: "slack",
          webhookUrlCiphertext: enc1.encryptedValue,
          webhookUrlIv: enc1.iv,
          webhookUrlAuthTag: enc1.authTag,
          webhookUrlKeyVersion: enc1.keyVersion,
          label: "L1",
          events: ["post.published"],
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "ext-2",
          projectId: "proj-1",
          channel: "teams",
          webhookUrlCiphertext: enc2.encryptedValue,
          webhookUrlIv: enc2.iv,
          webhookUrlAuthTag: enc2.authTag,
          webhookUrlKeyVersion: enc2.keyVersion,
          label: "L2",
          events: ["post.published"],
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await repo.findActiveByProjectAndEvent("proj-1", "post.published");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.webhookUrl).toBe("https://hooks.slack.com/services/A");
        expect(result.value[1]?.webhookUrl).toBe("https://outlook.office.com/webhook/B");
      }
    });
  });
});
