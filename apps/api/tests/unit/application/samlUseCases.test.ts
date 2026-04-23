/**
 * @file samlUseCases.test.ts
 * @description Unit tests for SAML SSO use cases: ConfigureSaml, EnableSso, DisableSso,
 *              GetSamlConfigurationQuery.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import assert from "node:assert/strict";
import { ConfigureSamlUseCase } from "../../../src/application/auth/ConfigureSamlUseCase.js";
import { EnableSsoUseCase } from "../../../src/application/auth/EnableSsoUseCase.js";
import { DisableSsoUseCase } from "../../../src/application/auth/DisableSsoUseCase.js";
import { GetSamlConfigurationQuery } from "../../../src/application/auth/GetSamlConfigurationQuery.js";
import type {
  SamlConfigurationRepository,
  SamlConfigurationData,
} from "../../../src/domain/repositories/SamlConfigurationRepository.js";
import type { AccountQueryRepositoryPort } from "../../../src/domain/repositories/AccountQueryRepository.js";
import { ok } from "@shared/types";

// ── Mock Factories ──────────────────────────────────────────────────────────

function makeMockSamlRepo(
  overrides: Partial<SamlConfigurationRepository> = {}
): SamlConfigurationRepository {
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

function makeSamlConfigData(overrides: Partial<SamlConfigurationData> = {}): SamlConfigurationData {
  return {
    id: "config-001",
    accountId: "account-001",
    entityId: "https://omnipost.app/saml/account-001",
    idpEntityId: "https://idp.example.com",
    idpSsoUrl: "https://idp.example.com/sso",
    idpCertificate: "CERT_DATA_LONG_ENOUGH_FOR_DISPLAY",
    attributeMapping: { email: "mail" },
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ── ConfigureSamlUseCase ────────────────────────────────────────────────────

describe("ConfigureSamlUseCase", () => {
  let repo: SamlConfigurationRepository;
  let useCase: ConfigureSamlUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    const savedConfig = makeSamlConfigData();
    repo = makeMockSamlRepo({
      findByAccountId: vi.fn().mockResolvedValue(savedConfig),
    });
    useCase = new ConfigureSamlUseCase(repo, makeMockUoW());
  });

  it("creates SAML configuration with valid input", async () => {
    const result = await useCase.execute({
      accountId: "account-001",
      idpEntityId: "https://idp.example.com",
      idpSsoUrl: "https://idp.example.com/sso",
      idpCertificate: "MIICmTCCAg-valid-cert",
      attributeMapping: { email: "mail" },
    });

    assert.ok(result.ok, "should succeed");
    assert.equal(result.value.accountId, "account-001");
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it("generates entityId as https://omnipost.app/saml/{accountId}", async () => {
    const result = await useCase.execute({
      accountId: "my-account-123",
      idpEntityId: "https://idp.example.com",
      idpSsoUrl: "https://idp.example.com/sso",
      idpCertificate: "MIICmTCCAg-valid-cert",
      attributeMapping: { email: "mail" },
    });

    assert.ok(result.ok);
    // The saved entity should have the correct entityId
    const savedCall = vi.mocked(repo.save).mock.calls[0];
    const savedEntity = savedCall[0];
    assert.equal(savedEntity.entityId, "https://omnipost.app/saml/my-account-123");
  });

  it("replaces existing configuration on re-configure", async () => {
    // First call
    await useCase.execute({
      accountId: "account-001",
      idpEntityId: "https://idp1.example.com",
      idpSsoUrl: "https://idp1.example.com/sso",
      idpCertificate: "CERT1",
      attributeMapping: { email: "mail" },
    });

    // Second call (upsert behavior)
    await useCase.execute({
      accountId: "account-001",
      idpEntityId: "https://idp2.example.com",
      idpSsoUrl: "https://idp2.example.com/sso",
      idpCertificate: "CERT2",
      attributeMapping: { email: "email" },
    });

    expect(repo.save).toHaveBeenCalledTimes(2);
  });

  it("returns validation error for empty accountId", async () => {
    const result = await useCase.execute({
      accountId: "",
      idpEntityId: "https://idp.example.com",
      idpSsoUrl: "https://idp.example.com/sso",
      idpCertificate: "CERT",
      attributeMapping: { email: "mail" },
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("returns validation error for non-HTTPS idpSsoUrl", async () => {
    const result = await useCase.execute({
      accountId: "account-001",
      idpEntityId: "https://idp.example.com",
      idpSsoUrl: "http://idp.example.com/sso",
      idpCertificate: "CERT",
      attributeMapping: { email: "mail" },
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("returns validation error for missing email in attributeMapping", async () => {
    const result = await useCase.execute({
      accountId: "account-001",
      idpEntityId: "https://idp.example.com",
      idpSsoUrl: "https://idp.example.com/sso",
      idpCertificate: "CERT",
      attributeMapping: { firstName: "givenname" } as unknown as { email: string },
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });
});

// ── EnableSsoUseCase ────────────────────────────────────────────────────────

describe("EnableSsoUseCase", () => {
  let repo: SamlConfigurationRepository;
  let accountQueryRepo: AccountQueryRepositoryPort;
  let useCase: EnableSsoUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockSamlRepo();
    accountQueryRepo = makeMockAccountQueryRepo();
    useCase = new EnableSsoUseCase(repo, accountQueryRepo);
  });

  it("enables SSO when SAML config exists and is active", async () => {
    vi.mocked(repo.findByAccountId).mockResolvedValue(makeSamlConfigData({ isActive: true }));

    const result = await useCase.execute({ accountId: "account-001" });

    assert.ok(result.ok, "should succeed");
    expect(accountQueryRepo.setSsoEnabled).toHaveBeenCalledWith("account-001", true, "SAML");
  });

  it("fails when no SAML configuration exists", async () => {
    vi.mocked(repo.findByAccountId).mockResolvedValue(null);

    const result = await useCase.execute({ accountId: "account-001" });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
    assert.ok(result.error.message.includes("SAML configuration must be set up"));
  });

  it("fails when SAML configuration is inactive", async () => {
    vi.mocked(repo.findByAccountId).mockResolvedValue(makeSamlConfigData({ isActive: false }));

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

  it("returns internal error when account update fails", async () => {
    vi.mocked(repo.findByAccountId).mockResolvedValue(makeSamlConfigData({ isActive: true }));
    vi.mocked(accountQueryRepo.setSsoEnabled).mockRejectedValue(new Error("DB connection lost"));

    const result = await useCase.execute({ accountId: "account-001" });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "INTERNAL_ERROR");
  });
});

// ── DisableSsoUseCase ───────────────────────────────────────────────────────

describe("DisableSsoUseCase", () => {
  let accountQueryRepo: AccountQueryRepositoryPort;
  let useCase: DisableSsoUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    accountQueryRepo = makeMockAccountQueryRepo();
    useCase = new DisableSsoUseCase(accountQueryRepo);
  });

  it("sets ssoEnabled to false", async () => {
    const result = await useCase.execute({ accountId: "account-001" });

    assert.ok(result.ok, "should succeed");
    expect(accountQueryRepo.setSsoEnabled).toHaveBeenCalledWith("account-001", false, "NONE");
  });

  it("does NOT delete the SAML configuration", async () => {
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

  it("returns internal error when account update fails", async () => {
    vi.mocked(accountQueryRepo.setSsoEnabled).mockRejectedValue(new Error("DB offline"));

    const result = await useCase.execute({ accountId: "account-001" });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "INTERNAL_ERROR");
  });
});

// ── GetSamlConfigurationQuery ───────────────────────────────────────────────

describe("GetSamlConfigurationQuery", () => {
  let repo: SamlConfigurationRepository;
  let query: GetSamlConfigurationQuery;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockSamlRepo();
    query = new GetSamlConfigurationQuery(repo);
  });

  it("returns null when no config exists", async () => {
    vi.mocked(repo.findByAccountId).mockResolvedValue(null);

    const result = await query.execute({ accountId: "account-001" });

    assert.ok(result.ok);
    assert.equal(result.value, null);
  });

  it("returns config data when it exists", async () => {
    const configData = makeSamlConfigData();
    vi.mocked(repo.findByAccountId).mockResolvedValue(configData);

    const result = await query.execute({ accountId: "account-001" });

    assert.ok(result.ok);
    assert.equal(result.value?.id, "config-001");
    assert.equal(result.value?.idpEntityId, "https://idp.example.com");
  });

  it("fails with empty accountId", async () => {
    const result = await query.execute({ accountId: "" });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });
});
