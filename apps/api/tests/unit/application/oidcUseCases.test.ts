/**
 * @file oidcUseCases.test.ts
 * @description Unit tests for OIDC SSO use cases: ConfigureOidc, EnableOidcSso,
 *              DisableOidcSso, GetOidcConfigurationQuery.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import assert from "node:assert/strict";
import { ConfigureOidcUseCase } from "@core/auth/ConfigureOidcUseCase.js";
import { EnableOidcSsoUseCase } from "@core/auth/EnableOidcSsoUseCase.js";
import { DisableOidcSsoUseCase } from "@core/auth/DisableOidcSsoUseCase.js";
import { GetOidcConfigurationQuery } from "@core/auth/GetOidcConfigurationQuery.js";
import type {
  OidcConfigurationRepository,
  OidcConfigurationData,
} from "@core/domain/repositories/OidcConfigurationRepository.js";
import type { AccountQueryRepositoryPort } from "@core/domain/repositories/AccountQueryRepository.js";
import { ok } from "@shared/types";

// ── Mock Factories ──────────────────────────────────────────────────────────

function makeMockOidcRepo(
  overrides: Partial<OidcConfigurationRepository> = {}
): OidcConfigurationRepository {
  return {
    findByAccountId: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(ok(undefined)),
    delete: vi.fn().mockResolvedValue(ok(undefined)),
    ...overrides,
  };
}

function makeMockAccountQueryRepo(
  overrides: Partial<AccountQueryRepositoryPort> = {}
): AccountQueryRepositoryPort {
  return {
    findWithProjects: vi.fn().mockResolvedValue(ok({})),
    findManyWithProjects: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(ok({})),
    findByEmail: vi.fn().mockResolvedValue(ok({})),
    updateSubscription: vi.fn().mockResolvedValue(ok({})),
    getExpiringTrials: vi.fn().mockResolvedValue([]),
    setSsoEnabled: vi.fn().mockResolvedValue(ok(undefined)),
    ...overrides,
  };
}

function makeMockUoW() {
  return {
    executeInTransaction: vi.fn(async (fn: () => Promise<unknown>) => {
      await fn();
    }),
  };
}

function makeOidcConfigData(overrides: Partial<OidcConfigurationData> = {}): OidcConfigurationData {
  return {
    id: "config-001",
    accountId: "account-001",
    issuerUrl: "https://accounts.google.com",
    clientId: "client-id-123",
    clientSecret: "secret-xyz",
    scopes: ["openid", "email", "profile"],
    attributeMapping: { email: "email" },
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ── ConfigureOidcUseCase ────────────────────────────────────────────────────

describe("ConfigureOidcUseCase", () => {
  let repo: OidcConfigurationRepository;
  let useCase: ConfigureOidcUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    const savedConfig = makeOidcConfigData();
    repo = makeMockOidcRepo({
      findByAccountId: vi.fn().mockResolvedValue(savedConfig),
    });
    useCase = new ConfigureOidcUseCase(repo, makeMockUoW());
  });

  it("creates OIDC configuration with valid input", async () => {
    const result = await useCase.execute({
      accountId: "account-001",
      issuerUrl: "https://accounts.google.com",
      clientId: "client-id-123",
      clientSecret: "secret-xyz",
      attributeMapping: { email: "email" },
    });

    assert.ok(result.ok, "should succeed");
    assert.equal(result.value.accountId, "account-001");
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it("creates OIDC configuration with custom scopes", async () => {
    const result = await useCase.execute({
      accountId: "account-001",
      issuerUrl: "https://accounts.google.com",
      clientId: "client-id-123",
      clientSecret: "secret-xyz",
      scopes: ["openid", "email"],
      attributeMapping: { email: "email" },
    });

    assert.ok(result.ok, "should succeed");
    // Verify saved entity has correct scopes
    const savedCall = vi.mocked(repo.save).mock.calls[0];
    const savedEntity = savedCall[0];
    assert.deepEqual(savedEntity.scopes, ["openid", "email"]);
  });

  it("replaces existing configuration on re-configure", async () => {
    // First call
    await useCase.execute({
      accountId: "account-001",
      issuerUrl: "https://accounts.google.com",
      clientId: "client-id-1",
      clientSecret: "secret-1",
      attributeMapping: { email: "email" },
    });

    // Second call (upsert behavior)
    await useCase.execute({
      accountId: "account-001",
      issuerUrl: "https://login.microsoftonline.com/tenant",
      clientId: "client-id-2",
      clientSecret: "secret-2",
      attributeMapping: { email: "preferred_username" },
    });

    expect(repo.save).toHaveBeenCalledTimes(2);
  });

  it("returns validation error for empty accountId", async () => {
    const result = await useCase.execute({
      accountId: "",
      issuerUrl: "https://accounts.google.com",
      clientId: "client-id",
      clientSecret: "secret",
      attributeMapping: { email: "email" },
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("returns validation error for non-HTTPS issuerUrl", async () => {
    const result = await useCase.execute({
      accountId: "account-001",
      issuerUrl: "http://accounts.google.com",
      clientId: "client-id",
      clientSecret: "secret",
      attributeMapping: { email: "email" },
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("returns validation error for empty clientId", async () => {
    const result = await useCase.execute({
      accountId: "account-001",
      issuerUrl: "https://accounts.google.com",
      clientId: "",
      clientSecret: "secret",
      attributeMapping: { email: "email" },
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("returns validation error for empty clientSecret", async () => {
    const result = await useCase.execute({
      accountId: "account-001",
      issuerUrl: "https://accounts.google.com",
      clientId: "client-id",
      clientSecret: "",
      attributeMapping: { email: "email" },
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("returns validation error for missing email in attributeMapping", async () => {
    const result = await useCase.execute({
      accountId: "account-001",
      issuerUrl: "https://accounts.google.com",
      clientId: "client-id",
      clientSecret: "secret",
      attributeMapping: { firstName: "given_name" } as unknown as { email: string },
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("returns internal error when save fails", async () => {
    const failRepo = makeMockOidcRepo({
      save: vi.fn().mockResolvedValue({ ok: false, error: new Error("DB error") }),
    });
    const failUseCase = new ConfigureOidcUseCase(failRepo, makeMockUoW());

    const result = await failUseCase.execute({
      accountId: "account-001",
      issuerUrl: "https://accounts.google.com",
      clientId: "client-id",
      clientSecret: "secret",
      attributeMapping: { email: "email" },
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "INTERNAL_ERROR");
  });

  it("returns internal error when findByAccountId returns null after save", async () => {
    const noReadBackRepo = makeMockOidcRepo({
      save: vi.fn().mockResolvedValue(ok(undefined)),
      findByAccountId: vi.fn().mockResolvedValue(null),
    });
    const noReadBackUseCase = new ConfigureOidcUseCase(noReadBackRepo, makeMockUoW());

    const result = await noReadBackUseCase.execute({
      accountId: "account-001",
      issuerUrl: "https://accounts.google.com",
      clientId: "client-id",
      clientSecret: "secret",
      attributeMapping: { email: "email" },
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "INTERNAL_ERROR");
  });

  it("works without unit of work", async () => {
    const noUowUseCase = new ConfigureOidcUseCase(repo);

    const result = await noUowUseCase.execute({
      accountId: "account-001",
      issuerUrl: "https://accounts.google.com",
      clientId: "client-id",
      clientSecret: "secret",
      attributeMapping: { email: "email" },
    });

    assert.ok(result.ok, "should succeed without UoW");
  });
});

// ── EnableOidcSsoUseCase ──────────────────────────────────────────────────

describe("EnableOidcSsoUseCase", () => {
  let repo: OidcConfigurationRepository;
  let accountQueryRepo: AccountQueryRepositoryPort;
  let useCase: EnableOidcSsoUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockOidcRepo();
    accountQueryRepo = makeMockAccountQueryRepo();
    useCase = new EnableOidcSsoUseCase(repo, accountQueryRepo);
  });

  it("enables SSO when OIDC config exists and is active", async () => {
    vi.mocked(repo.findByAccountId).mockResolvedValue(makeOidcConfigData({ isActive: true }));

    const result = await useCase.execute({ accountId: "account-001" });

    assert.ok(result.ok, "should succeed");
    expect(accountQueryRepo.setSsoEnabled).toHaveBeenCalledWith("account-001", true, "OIDC");
  });

  it("fails when no OIDC configuration exists", async () => {
    vi.mocked(repo.findByAccountId).mockResolvedValue(null);

    const result = await useCase.execute({ accountId: "account-001" });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
    assert.ok(result.error.message.includes("OIDC configuration must be set up"));
  });

  it("fails when OIDC configuration is inactive", async () => {
    vi.mocked(repo.findByAccountId).mockResolvedValue(makeOidcConfigData({ isActive: false }));

    const result = await useCase.execute({ accountId: "account-001" });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
    assert.ok(result.error.message.includes("not active"));
  });

  it("fails with empty accountId", async () => {
    const result = await useCase.execute({ accountId: "" });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("returns NOT_FOUND when account update returns NOT_FOUND", async () => {
    vi.mocked(repo.findByAccountId).mockResolvedValue(makeOidcConfigData({ isActive: true }));
    vi.mocked(accountQueryRepo.setSsoEnabled).mockResolvedValue({
      ok: false,
      error: "NOT_FOUND",
    });

    const result = await useCase.execute({ accountId: "account-001" });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "NOT_FOUND");
  });

  it("returns internal error when account update throws", async () => {
    vi.mocked(repo.findByAccountId).mockResolvedValue(makeOidcConfigData({ isActive: true }));
    vi.mocked(accountQueryRepo.setSsoEnabled).mockRejectedValue(new Error("DB connection lost"));

    const result = await useCase.execute({ accountId: "account-001" });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "INTERNAL_ERROR");
  });
});

// ── DisableOidcSsoUseCase ─────────────────────────────────────────────────

describe("DisableOidcSsoUseCase", () => {
  let accountQueryRepo: AccountQueryRepositoryPort;
  let useCase: DisableOidcSsoUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    accountQueryRepo = makeMockAccountQueryRepo();
    useCase = new DisableOidcSsoUseCase(accountQueryRepo);
  });

  it("sets ssoEnabled to false and ssoProvider to NONE", async () => {
    const result = await useCase.execute({ accountId: "account-001" });

    assert.ok(result.ok, "should succeed");
    expect(accountQueryRepo.setSsoEnabled).toHaveBeenCalledWith("account-001", false, "NONE");
  });

  it("does NOT delete the OIDC configuration", async () => {
    const result = await useCase.execute({ accountId: "account-001" });

    assert.ok(result.ok);
    // Verify only setSsoEnabled was called
    expect(accountQueryRepo.setSsoEnabled).toHaveBeenCalledTimes(1);
  });

  it("fails with empty accountId", async () => {
    const result = await useCase.execute({ accountId: "" });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("returns NOT_FOUND when account does not exist", async () => {
    vi.mocked(accountQueryRepo.setSsoEnabled).mockResolvedValue({
      ok: false,
      error: "NOT_FOUND",
    });

    const result = await useCase.execute({ accountId: "account-001" });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "NOT_FOUND");
  });

  it("returns internal error when account update throws", async () => {
    vi.mocked(accountQueryRepo.setSsoEnabled).mockRejectedValue(new Error("DB offline"));

    const result = await useCase.execute({ accountId: "account-001" });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "INTERNAL_ERROR");
  });
});

// ── GetOidcConfigurationQuery ─────────────────────────────────────────────

describe("GetOidcConfigurationQuery", () => {
  let repo: OidcConfigurationRepository;
  let query: GetOidcConfigurationQuery;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockOidcRepo();
    query = new GetOidcConfigurationQuery(repo);
  });

  it("returns null when no config exists", async () => {
    vi.mocked(repo.findByAccountId).mockResolvedValue(null);

    const result = await query.execute({ accountId: "account-001" });

    assert.ok(result.ok);
    assert.equal(result.value, null);
  });

  it("returns config data when it exists", async () => {
    const configData = makeOidcConfigData();
    vi.mocked(repo.findByAccountId).mockResolvedValue(configData);

    const result = await query.execute({ accountId: "account-001" });

    assert.ok(result.ok);
    assert.equal(result.value?.id, "config-001");
    assert.equal(result.value?.issuerUrl, "https://accounts.google.com");
    assert.equal(result.value?.clientId, "client-id-123");
  });

  it("fails with empty accountId", async () => {
    const result = await query.execute({ accountId: "" });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });
});
