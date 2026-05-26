/**
 * @file ReplaceOidcClientSecretUseCase.test.ts
 * @description Unit tests for the OIDC client secret atomic-replace use case.
 *              Stubs the repository + handshake probe to verify validation,
 *              not-found, handshake failure (no DB write), success path, and
 *              UoW wrapping.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import {
  ReplaceOidcClientSecretUseCase,
  type OidcHandshakeProbe,
} from "@core/application/auth/ReplaceOidcClientSecretUseCase.js";
import type {
  OidcConfigurationRepository,
  OidcConfigurationData,
} from "@core/domain/repositories/OidcConfigurationRepository.js";

const ACCOUNT_ID = "acct-uuid-123";
const NEW_SECRET = "new-shiny-client-secret";

function makeData(): OidcConfigurationData {
  return {
    id: "cfg-uuid",
    accountId: ACCOUNT_ID,
    issuerUrl: "https://accounts.example.com",
    clientId: "client-abc",
    clientSecret: "old-secret",
    scopes: ["openid", "email", "profile"],
    attributeMapping: { email: "email" },
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function makeRepo(
  overrides: Partial<OidcConfigurationRepository> = {}
): OidcConfigurationRepository {
  return {
    findByAccountId: vi.fn().mockResolvedValue(makeData()),
    save: vi.fn().mockResolvedValue(ok(undefined)),
    delete: vi.fn().mockResolvedValue(ok(undefined)),
    ...overrides,
  } as OidcConfigurationRepository;
}

function makeProbe(
  behavior: { throws?: Error; partial?: boolean; partialReason?: string } = {}
): OidcHandshakeProbe {
  return {
    discover: vi.fn(async () => {
      if (behavior.throws) throw behavior.throws;
      if (behavior.partial) {
        return { validated: "partial" as const, reason: behavior.partialReason ?? "x" };
      }
      return { validated: "strict" as const };
    }),
  };
}

describe("ReplaceOidcClientSecretUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects empty accountId with VALIDATION_FAILED", async () => {
    const useCase = new ReplaceOidcClientSecretUseCase(makeRepo(), makeProbe());
    const result = await useCase.execute({ accountId: "  ", newClientSecret: NEW_SECRET });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("rejects empty newClientSecret with VALIDATION_FAILED", async () => {
    const useCase = new ReplaceOidcClientSecretUseCase(makeRepo(), makeProbe());
    const result = await useCase.execute({ accountId: ACCOUNT_ID, newClientSecret: "  " });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("returns NOT_FOUND when no OIDC config exists for account", async () => {
    const repo = makeRepo({ findByAccountId: vi.fn().mockResolvedValue(null) });
    const useCase = new ReplaceOidcClientSecretUseCase(repo, makeProbe());
    const result = await useCase.execute({
      accountId: ACCOUNT_ID,
      newClientSecret: NEW_SECRET,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "NOT_FOUND");
    assert.equal((repo.save as ReturnType<typeof vi.fn>).mock.calls.length, 0);
  });

  it("does NOT persist when handshake fails (returns VALIDATION_FAILED with IdP message)", async () => {
    const probe = makeProbe({ throws: new Error("invalid_client") });
    const repo = makeRepo();
    const useCase = new ReplaceOidcClientSecretUseCase(repo, probe);
    const result = await useCase.execute({
      accountId: ACCOUNT_ID,
      newClientSecret: NEW_SECRET,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
    assert.ok(result.error.message.includes("invalid_client"));
    assert.equal((repo.save as ReturnType<typeof vi.fn>).mock.calls.length, 0);
  });

  it("calls handshake probe with the NEW secret + existing issuerUrl + clientId", async () => {
    const probe = makeProbe();
    const useCase = new ReplaceOidcClientSecretUseCase(makeRepo(), probe);
    await useCase.execute({ accountId: ACCOUNT_ID, newClientSecret: NEW_SECRET });
    const arg = (probe.discover as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    assert.equal(arg.issuerUrl, "https://accounts.example.com");
    assert.equal(arg.clientId, "client-abc");
    assert.equal(arg.clientSecret, NEW_SECRET);
  });

  it("persists the new secret + returns DTO with validation=strict when handshake succeeds (canon: oidc-client-secret-validation-clientcredentialsgrant)", async () => {
    const repo = makeRepo();
    const useCase = new ReplaceOidcClientSecretUseCase(repo, makeProbe());
    const result = await useCase.execute({
      accountId: ACCOUNT_ID,
      newClientSecret: NEW_SECRET,
    });
    assert.ok(result.ok, result.ok ? "" : result.error.message);
    assert.equal(result.value.accountId, ACCOUNT_ID);
    assert.equal(result.value.issuerUrl, "https://accounts.example.com");
    assert.equal(typeof result.value.updatedAt, "string");
    assert.equal(result.value.validation, "strict");
    assert.equal(result.value.validationReason, undefined);
    const saveCalls = (repo.save as ReturnType<typeof vi.fn>).mock.calls;
    assert.equal(saveCalls.length, 1);
    const savedEntity = saveCalls[0]?.[0] as { clientSecret: string };
    assert.equal(savedEntity.clientSecret, NEW_SECRET);
  });

  it("returns DTO with validation=partial + reason when probe returns partial (IdP rejected client_credentials)", async () => {
    const repo = makeRepo();
    const probe = makeProbe({ partial: true, partialReason: "unsupported_grant_type" });
    const useCase = new ReplaceOidcClientSecretUseCase(repo, probe);
    const result = await useCase.execute({
      accountId: ACCOUNT_ID,
      newClientSecret: NEW_SECRET,
    });
    assert.ok(result.ok);
    assert.equal(result.value.validation, "partial");
    assert.equal(result.value.validationReason, "unsupported_grant_type");
    // Still persists — partial does NOT block. Operator must verify with real SSO attempt.
    const saveCalls = (repo.save as ReturnType<typeof vi.fn>).mock.calls;
    assert.equal(saveCalls.length, 1);
  });

  it("returns INTERNAL_ERROR when repository save fails", async () => {
    const repo = makeRepo({
      save: vi.fn().mockResolvedValue(err(new Error("DB exploded"))),
    });
    const useCase = new ReplaceOidcClientSecretUseCase(repo, makeProbe());
    const result = await useCase.execute({
      accountId: ACCOUNT_ID,
      newClientSecret: NEW_SECRET,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "INTERNAL_ERROR");
  });

  it("DTO does NOT leak the client secret value", async () => {
    const useCase = new ReplaceOidcClientSecretUseCase(makeRepo(), makeProbe());
    const result = await useCase.execute({
      accountId: ACCOUNT_ID,
      newClientSecret: NEW_SECRET,
    });
    assert.ok(result.ok);
    const json = JSON.stringify(result.value);
    assert.ok(!json.includes(NEW_SECRET));
    assert.ok(!json.includes("old-secret"));
  });

  it("runs persistence inside UoW.executeInTransaction when UoW provided", async () => {
    const uowExecute = vi.fn(async (cb: () => Promise<void>) => {
      await cb();
    });
    const useCase = new ReplaceOidcClientSecretUseCase(makeRepo(), makeProbe(), {
      executeInTransaction: uowExecute,
    });
    const result = await useCase.execute({
      accountId: ACCOUNT_ID,
      newClientSecret: NEW_SECRET,
    });
    assert.ok(result.ok);
    assert.equal(uowExecute.mock.calls.length, 1);
  });

  it("does NOT call save when handshake fails (idempotent on probe failure)", async () => {
    const repo = makeRepo();
    const probe = makeProbe({ throws: new Error("network timeout") });
    const useCase = new ReplaceOidcClientSecretUseCase(repo, probe);
    await useCase.execute({ accountId: ACCOUNT_ID, newClientSecret: NEW_SECRET });
    assert.equal((repo.save as ReturnType<typeof vi.fn>).mock.calls.length, 0);
  });
});
