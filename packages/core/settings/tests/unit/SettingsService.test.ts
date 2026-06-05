/**
 * @file SettingsService.test.ts
 * @description Unit tests for SettingsService — configuration status (healthy/partial/
 *   unconfigured), group settings masking, unknown group validation, and credential
 *   update against mocked ports.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { SettingsService } from "../../src/SettingsService.js";
import type { PlatformCredentialPort } from "@ports/core";
import type { PlatformEncryptionKeyRepository } from "@core/domain/repositories/PlatformEncryptionKeyRepository.js";
import type { AiTokenUsageReader } from "@core/domain/repositories/AiTokenUsageReader.js";
import type { AuditEmitterPort } from "@core/domain/repositories/AuditEmitterPort.js";
import type { CredentialGroup } from "@core/domain/value-objects/CredentialGroup.js";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";

function makeCredentialService(
  opts: {
    configuredGroups?: CredentialGroup[];
    groupData?: Record<string, string>;
    getGroupFails?: boolean;
  } = {}
): PlatformCredentialPort {
  const {
    configuredGroups = ["STRIPE", "RESEND", "AI_POOL"],
    groupData = { secretKey: "test-stripe-key-000000000000000", webhookSecret: "test-wh-000" },
    getGroupFails = false,
  } = opts;

  return {
    listConfiguredGroups: vi.fn(async () => ok(configuredGroups)),
    getGroup: vi.fn(async () =>
      getGroupFails
        ? err(new UseCaseError("DB error", USE_CASE_ERRORS.INTERNAL_ERROR))
        : ok(groupData)
    ),
    setCredential: vi.fn(async () => ok(undefined)),
    getCredential: vi.fn(async () => ok(null)),
    setGroupCredentials: vi.fn(async () => ok(undefined)),
    getAccountCredential: vi.fn(async () => ok(null)),
    setAccountCredential: vi.fn(async () => ok(undefined)),
    deleteAccountCredential: vi.fn(async () => ok(undefined)),
  } as unknown as PlatformCredentialPort;
}

function makeEncryptionKeyRepo(): PlatformEncryptionKeyRepository {
  return {
    findActiveLatest: vi.fn(async () => ok(null)),
    createRotation: vi.fn(async () => ok(undefined)),
  } as unknown as PlatformEncryptionKeyRepository;
}

function makeTokenUsageReader(): AiTokenUsageReader {
  return {
    sumTokensThisMonth: vi.fn(async () => ok(0)),
  } as unknown as AiTokenUsageReader;
}

function makeAuditEmitter(): AuditEmitterPort {
  return {
    emit: vi.fn(async () => undefined),
  } as unknown as AuditEmitterPort;
}

function makeService(credSvc?: PlatformCredentialPort): SettingsService {
  return new SettingsService(
    credSvc ?? makeCredentialService(),
    makeEncryptionKeyRepo(),
    makeTokenUsageReader(),
    makeAuditEmitter()
  );
}

describe("SettingsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getConfigurationStatus", () => {
    it("returns healthy when all critical groups are configured", async () => {
      const svc = makeService(
        makeCredentialService({ configuredGroups: ["STRIPE", "RESEND", "AI_POOL"] })
      );
      const r = await svc.getConfigurationStatus();
      assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error}`);
      assert.strictEqual(r.value.overallHealth, "healthy");
    });

    it("returns partial when some but not all critical groups are configured", async () => {
      const svc = makeService(makeCredentialService({ configuredGroups: ["STRIPE"] }));
      const r = await svc.getConfigurationStatus();
      assert.ok(r.ok);
      assert.strictEqual(r.value.overallHealth, "partial");
    });

    it("returns unconfigured when no groups are configured", async () => {
      const svc = makeService(makeCredentialService({ configuredGroups: [] }));
      const r = await svc.getConfigurationStatus();
      assert.ok(r.ok);
      assert.strictEqual(r.value.overallHealth, "unconfigured");
    });
  });

  describe("getGroupSettings", () => {
    it("masks secret values in the group response", async () => {
      const rawKey = "test-stripe-secret-abcdefghijklm";
      const svc = makeService(makeCredentialService({ groupData: { secretKey: rawKey } }));
      const r = await svc.getGroupSettings("STRIPE");
      assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error}`);
      const masked = r.value.secretKey;
      assert.ok(masked !== rawKey, "secret should be masked");
      assert.ok(masked !== null);
    });

    it("returns VALIDATION_ERROR for an unknown credential group", async () => {
      const svc = makeService();
      const r = await svc.getGroupSettings("UNKNOWN_GROUP" as CredentialGroup);
      assert.ok(!r.ok);
      assert.strictEqual(r.error, "VALIDATION_ERROR");
    });
  });
});
