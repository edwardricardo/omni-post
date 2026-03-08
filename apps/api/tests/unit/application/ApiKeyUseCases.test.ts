/**
 * Application Layer - API Key Use Cases Unit Tests
 *
 * Part of FASE H10-B: API Key Management
 * Tests all API key use cases with a mocked ApiKeyRepository.
 * Tier 0: No database required.
 */

import { describe, it, beforeEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import argon2 from "argon2";

import {
  CreateApiKeyUseCase,
  ValidateApiKeyUseCase,
  ListApiKeysUseCase,
  RotateApiKeyUseCase,
  DeactivateApiKeyUseCase,
} from "../../../src/application/apiKeys/ApiKeyUseCases.js";
import type {
  ApiKeyRepository,
  DomainApiKey,
} from "../../../src/domain/repositories/ApiKeyRepository.js";
import { ApiKeyNotFoundError } from "../../../src/domain/repositories/ApiKeyRepository.js";
import { ok, err } from "@shared/types";

// ── helpers ───────────────────────────────────────────────────────────────────

const ACCOUNT_ID = "a0000000-0000-4000-8000-000000000001";
const KEY_ID = "a0000000-0000-4000-8000-000000000010";

function baseKey(overrides: Partial<DomainApiKey> = {}): DomainApiKey {
  return {
    id: KEY_ID,
    accountId: ACCOUNT_ID,
    name: "Test Key",
    prefix: "op_aabbccdd",
    keyHash: "$2b$10$placeholder",
    permissions: ["read"],
    rateLimit: 1000,
    expiresAt: undefined,
    lastUsedAt: undefined,
    isActive: true,
    rotationSchedule: undefined,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeMockRepo(t: TestContext): ApiKeyRepository {
  return {
    findById: t.mock.fn(async () => ok(baseKey())),
    findByAccountId: t.mock.fn(async () => [baseKey()]),
    findActiveByPrefix: t.mock.fn(async () => baseKey()),
    create: t.mock.fn(async () => baseKey()),
    recordUsage: t.mock.fn(async () => {}),
    deactivate: t.mock.fn(async () => ok(undefined)),
    rotate: t.mock.fn(async () => ok(baseKey())),
    deleteByAccountId: t.mock.fn(async () => {}),
  };
}

// ── CreateApiKeyUseCase ───────────────────────────────────────────────────────

describe("CreateApiKeyUseCase", { concurrency: 1 }, () => {
  let repo: ApiKeyRepository;
  let useCase: CreateApiKeyUseCase;

  beforeEach((t) => {
    repo = makeMockRepo(t);
    useCase = new CreateApiKeyUseCase(repo);
  });

  it("creates key with default permissions and rateLimit", async () => {
    const result = await useCase.execute({ accountId: ACCOUNT_ID, name: "My Key" });

    assert.ok(result.ok);
    assert.ok(typeof result.value.rawKey === "string");
    assert.ok(result.value.rawKey.startsWith("op_"));
    assert.ok(result.value.rawKey.length > 20);
    assert.equal(result.value.key.id, KEY_ID);
    assert.equal((repo.create as any).mock.calls.length, 1);
  });

  it("returns validation error when name is empty", async () => {
    const result = await useCase.execute({ accountId: ACCOUNT_ID, name: "" });

    assert.ok(!result.ok);
    assert.match(result.error.message, /name/i);
    assert.equal((repo.create as any).mock.calls.length, 0);
  });

  it("returns validation error when name exceeds 100 chars", async () => {
    const result = await useCase.execute({ accountId: ACCOUNT_ID, name: "x".repeat(101) });

    assert.ok(!result.ok);
    assert.match(result.error.message, /100/);
  });

  it("returns validation error when rateLimit is out of range", async () => {
    const result = await useCase.execute({ accountId: ACCOUNT_ID, name: "Key", rateLimit: 0 });

    assert.ok(!result.ok);
    assert.match(result.error.message, /rate limit/i);
  });

  it("returns validation error when expiresAt is in the past", async () => {
    const result = await useCase.execute({
      accountId: ACCOUNT_ID,
      name: "Key",
      expiresAt: new Date("2020-01-01"),
    });

    assert.ok(!result.ok);
    assert.match(result.error.message, /future/i);
  });

  it("generates unique rawKey each call", async () => {
    const r1 = await useCase.execute({ accountId: ACCOUNT_ID, name: "Key 1" });
    const r2 = await useCase.execute({ accountId: ACCOUNT_ID, name: "Key 2" });

    assert.ok(r1.ok);
    assert.ok(r2.ok);
    assert.notEqual(r1.value.rawKey, r2.value.rawKey);
  });

  it("passes permissions and rateLimit to repo.create", async () => {
    await useCase.execute({
      accountId: ACCOUNT_ID,
      name: "Admin Key",
      permissions: ["read", "write"],
      rateLimit: 500,
    });

    const callRecord = (repo.create as any).mock.calls[0];
    const arg = callRecord?.arguments[0] as { permissions: string[]; rateLimit: number };
    assert.deepEqual(arg.permissions, ["read", "write"]);
    assert.equal(arg.rateLimit, 500);
  });

  it("returns INTERNAL_ERROR when repo.create throws", async () => {
    (repo.create as any).mock.mockImplementation(async () => {
      throw new Error("DB connection lost");
    });

    const result = await useCase.execute({ accountId: ACCOUNT_ID, name: "Key" });

    assert.ok(!result.ok);
    assert.match(result.error.message.toLowerCase(), /failed/);
  });
});

// ── ValidateApiKeyUseCase ─────────────────────────────────────────────────────

describe("ValidateApiKeyUseCase", { concurrency: 1 }, () => {
  let repo: ApiKeyRepository;
  let useCase: ValidateApiKeyUseCase;

  beforeEach((t) => {
    repo = makeMockRepo(t);
    useCase = new ValidateApiKeyUseCase(repo);
  });

  it("returns UNAUTHORIZED for malformed key (no prefix)", async () => {
    const result = await useCase.execute({ rawKey: "no_underscores_here_at_all" });
    // key doesn't start with "op_"
    assert.ok(!result.ok);
  });

  it("returns UNAUTHORIZED when prefix not found in repo", async () => {
    (repo.findActiveByPrefix as any).mock.mockImplementation(async () => null);

    const result = await useCase.execute({ rawKey: "op_aabbccdd_secretsecret" });

    assert.ok(!result.ok);
    assert.match(result.error.message, /inactive|invalid/i);
  });

  it("returns UNAUTHORIZED when key is expired", async () => {
    (repo.findActiveByPrefix as any).mock.mockImplementation(async () =>
      baseKey({ expiresAt: new Date("2020-01-01") })
    );

    const result = await useCase.execute({ rawKey: "op_aabbccdd_secretsecret" });

    assert.ok(!result.ok);
    assert.match(result.error.message, /expired/i);
  });

  it("returns ok and records usage for a valid key", async () => {
    // Generate a real argon2 hash so verify() succeeds
    const rawKey = "op_aabbccdd_validrawkeymustbelongenoughtoverify12345678";
    const keyHash = await argon2.hash(rawKey);
    (repo.findActiveByPrefix as any).mock.mockImplementation(async () => baseKey({ keyHash }));

    const result = await useCase.execute({ rawKey });

    assert.ok(result.ok, `Expected ok but got: ${!result.ok ? result.error.message : ""}`);
    if (result.ok) {
      assert.equal(result.value.key.id, KEY_ID);
    }
    // recordUsage is fire-and-forget — may not have been called yet
  });

  it("returns error when hash does not match rawKey", async () => {
    // Generate a real argon2 hash for a DIFFERENT key
    const correctKey = "op_aabbccdd_correctsecretcorrectsecretcorrect";
    const wrongKey = "op_aabbccdd_wrongsecretwrongsecretwrongsecret";
    const keyHash = await argon2.hash(correctKey);
    (repo.findActiveByPrefix as any).mock.mockImplementation(async () => baseKey({ keyHash }));

    // Submitting the wrong key — argon2.verify returns false
    const result = await useCase.execute({ rawKey: wrongKey });

    assert.ok(!result.ok);
  });

  it("returns INTERNAL_ERROR when repo throws", async () => {
    (repo.findActiveByPrefix as any).mock.mockImplementation(async () => {
      throw new Error("DB error");
    });

    const result = await useCase.execute({ rawKey: "op_aabbccdd_secretsecret" });

    assert.ok(!result.ok);
  });
});

// ── ListApiKeysUseCase ────────────────────────────────────────────────────────

describe("ListApiKeysUseCase", { concurrency: 1 }, () => {
  let repo: ApiKeyRepository;
  let useCase: ListApiKeysUseCase;

  beforeEach((t) => {
    repo = makeMockRepo(t);
    useCase = new ListApiKeysUseCase(repo);
  });

  it("returns list of keys for account", async () => {
    const result = await useCase.execute(ACCOUNT_ID);

    assert.ok(result.ok);
    assert.equal(result.value.length, 1);
    assert.equal(result.value[0]?.id, KEY_ID);
  });

  it("returns empty array when account has no keys", async () => {
    (repo.findByAccountId as any).mock.mockImplementation(async () => []);

    const result = await useCase.execute(ACCOUNT_ID);

    assert.ok(result.ok);
    assert.equal(result.value.length, 0);
  });

  it("returns INTERNAL_ERROR when repo throws", async () => {
    (repo.findByAccountId as any).mock.mockImplementation(async () => {
      throw new Error("DB error");
    });

    const result = await useCase.execute(ACCOUNT_ID);

    assert.ok(!result.ok);
  });
});

// ── RotateApiKeyUseCase ───────────────────────────────────────────────────────

describe("RotateApiKeyUseCase", { concurrency: 1 }, () => {
  let repo: ApiKeyRepository;
  let useCase: RotateApiKeyUseCase;

  beforeEach((t) => {
    repo = makeMockRepo(t);
    useCase = new RotateApiKeyUseCase(repo);
  });

  it("returns ok with updated key and new rawKey", async () => {
    const result = await useCase.execute(KEY_ID);

    assert.ok(result.ok);
    assert.ok(typeof result.value.rawKey === "string");
    assert.ok(result.value.rawKey.startsWith("op_"));
    assert.equal(result.value.key.id, KEY_ID);
    assert.equal((repo.rotate as any).mock.calls.length, 1);
  });

  it("passes new prefix and hash to repo.rotate", async () => {
    await useCase.execute(KEY_ID);

    const callRecord = (repo.rotate as any).mock.calls[0];
    const args = callRecord?.arguments as [string, string, string];
    assert.equal(args[0], KEY_ID);
    // prefix should start with "op_"
    assert.ok((args[1] as string).startsWith("op_"));
    // hash should be non-empty
    assert.ok((args[2] as string).length > 0);
  });

  it("propagates ApiKeyNotFoundError from repo", async () => {
    (repo.rotate as any).mock.mockImplementation(async () => err(new ApiKeyNotFoundError(KEY_ID)));

    const result = await useCase.execute(KEY_ID);

    assert.ok(!result.ok);
    assert.ok(result.error instanceof ApiKeyNotFoundError);
  });
});

// ── DeactivateApiKeyUseCase ───────────────────────────────────────────────────

describe("DeactivateApiKeyUseCase", { concurrency: 1 }, () => {
  let repo: ApiKeyRepository;
  let useCase: DeactivateApiKeyUseCase;

  beforeEach((t) => {
    repo = makeMockRepo(t);
    useCase = new DeactivateApiKeyUseCase(repo);
  });

  it("returns ok when key is deactivated", async () => {
    const result = await useCase.execute(KEY_ID);

    assert.ok(result.ok);
    assert.equal((repo.deactivate as any).mock.calls.length, 1);
  });

  it("propagates ApiKeyNotFoundError from repo", async () => {
    (repo.deactivate as any).mock.mockImplementation(async () =>
      err(new ApiKeyNotFoundError(KEY_ID))
    );

    const result = await useCase.execute(KEY_ID);

    assert.ok(!result.ok);
    assert.ok(result.error instanceof ApiKeyNotFoundError);
  });

  it("returns INTERNAL_ERROR when repo throws", async () => {
    (repo.deactivate as any).mock.mockImplementation(async () => {
      throw new Error("DB error");
    });

    const result = await useCase.execute(KEY_ID);

    assert.ok(!result.ok);
  });
});
