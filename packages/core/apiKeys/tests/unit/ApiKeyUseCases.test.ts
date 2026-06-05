/**
 * @file ApiKeyUseCases.test.ts
 * @description Unit tests for CreateApiKeyUseCase, ValidateApiKeyUseCase, and RotateApiKeyUseCase.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import {
  CreateApiKeyUseCase,
  ValidateApiKeyUseCase,
  RotateApiKeyUseCase,
} from "../../src/ApiKeyUseCases.js";
import type { DomainApiKey } from "@core/domain/repositories/ApiKeyRepository.js";

const makeDomainApiKey = (overrides?: Partial<DomainApiKey>): DomainApiKey => ({
  id: "key-uuid-001",
  accountId: "acct-uuid-001",
  name: "Test Key",
  prefix: "op_testabc123",
  keyHash: "dummy-hash-value",
  permissions: ["read"],
  rateLimit: 1000,
  isActive: true,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
  ...overrides,
});

const makeRepo = () => ({
  create: vi.fn().mockResolvedValue(makeDomainApiKey()),
  findActiveByPrefix: vi.fn().mockResolvedValue(makeDomainApiKey()),
  findByAccountId: vi.fn().mockResolvedValue([makeDomainApiKey()]),
  rotate: vi.fn().mockResolvedValue(ok(makeDomainApiKey())),
  deactivate: vi.fn().mockResolvedValue(ok(undefined)),
  recordUsage: vi.fn().mockResolvedValue(undefined),
});

const makeHasher = () => ({
  hash: vi.fn().mockResolvedValue("dummy-hash-value"),
  verify: vi.fn().mockResolvedValue(true),
  needsRehash: vi.fn().mockResolvedValue(false),
});

describe("CreateApiKeyUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let hasher: ReturnType<typeof makeHasher>;
  let useCase: CreateApiKeyUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    hasher = makeHasher();
    useCase = new CreateApiKeyUseCase(repo, hasher);
  });

  it("returns ok with key and rawKey when name is valid", async () => {
    const result = await useCase.execute({
      accountId: "acct-uuid-001",
      name: "My Integration Key",
    });
    assert.ok(result.ok, "Expected ok result");
    assert.ok(result.value.rawKey, "Expected rawKey to be present");
    assert.strictEqual(result.value.key.name, "Test Key");
  });

  it("returns VALIDATION_FAILED when name is empty", async () => {
    const result = await useCase.execute({
      accountId: "acct-uuid-001",
      name: "   ",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns VALIDATION_FAILED when rateLimit is out of range", async () => {
    const result = await useCase.execute({
      accountId: "acct-uuid-001",
      name: "Key",
      rateLimit: 0,
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns VALIDATION_FAILED when expiresAt is in the past", async () => {
    const result = await useCase.execute({
      accountId: "acct-uuid-001",
      name: "Key",
      expiresAt: new Date("2020-01-01T00:00:00Z"),
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });
});

describe("ValidateApiKeyUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let hasher: ReturnType<typeof makeHasher>;
  let useCase: ValidateApiKeyUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    hasher = makeHasher();
    useCase = new ValidateApiKeyUseCase(repo, hasher);
  });

  it("returns ok with key when raw key is valid", async () => {
    const result = await useCase.execute({ rawKey: "op_dummy_placeholder" });
    assert.ok(result.ok, "Expected ok result");
    assert.strictEqual(result.value.key.id, "key-uuid-001");
  });

  it("returns UNAUTHORIZED when raw key format is invalid", async () => {
    const result = await useCase.execute({ rawKey: "invalid-format" });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "UNAUTHORIZED");
  });

  it("returns UNAUTHORIZED when key prefix not found in repo", async () => {
    repo.findActiveByPrefix.mockResolvedValue(null);
    const result = await useCase.execute({ rawKey: "op_dummy_placeholder" });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "UNAUTHORIZED");
  });

  it("returns UNAUTHORIZED when argon2id verification fails", async () => {
    hasher.verify.mockResolvedValue(false);
    const result = await useCase.execute({ rawKey: "op_dummy_placeholder" });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "UNAUTHORIZED");
  });
});

describe("RotateApiKeyUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let hasher: ReturnType<typeof makeHasher>;
  let useCase: RotateApiKeyUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    hasher = makeHasher();
    useCase = new RotateApiKeyUseCase(repo, hasher);
  });

  it("returns ok with new key and rawKey on successful rotation", async () => {
    const result = await useCase.execute("key-uuid-001");
    assert.ok(result.ok, "Expected ok result");
    assert.ok(result.value.rawKey, "Expected new rawKey to be present");
    assert.strictEqual(result.value.key.id, "key-uuid-001");
  });

  it("returns err when repo.rotate returns not-found", async () => {
    const notFoundErr = { code: "NOT_FOUND", message: "Key not found" };
    repo.rotate.mockResolvedValue(err(notFoundErr));
    const result = await useCase.execute("nonexistent-key");
    assert.ok(!result.ok, "Expected err result");
  });
});
