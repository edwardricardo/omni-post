/**
 * Application Layer - API Key Use Cases Unit Tests
 *
 * Part of FASE H10-B: API Key Management
 * Tests all API key use cases with a mocked ApiKeyRepository.
 * Tier 0: No database required.
 *
 * @file ApiKeyUseCases.test.ts
 * @description Tests for CreateApiKeyUseCase
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import argon2 from "argon2";
import { Argon2PasswordHasher } from "../../../src/infrastructure/adapters/Argon2PasswordHasher.js";

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

function makeMockRepo(): ApiKeyRepository {
  return {
    findById: vi.fn(async () => ok(baseKey())),
    findByAccountId: vi.fn(async () => [baseKey()]),
    findActiveByPrefix: vi.fn(async () => baseKey()),
    create: vi.fn(async () => baseKey()),
    recordUsage: vi.fn(async () => {}),
    deactivate: vi.fn(async () => ok(undefined)),
    rotate: vi.fn(async () => ok(baseKey())),
    deleteByAccountId: vi.fn(async () => {}),
  };
}

// ── CreateApiKeyUseCase ───────────────────────────────────────────────────────

describe("CreateApiKeyUseCase", () => {
  let repo: ApiKeyRepository;
  let useCase: CreateApiKeyUseCase;

  beforeEach(() => {
    repo = makeMockRepo();
    useCase = new CreateApiKeyUseCase(repo, new Argon2PasswordHasher());
  });

  it("creates key with default permissions and rateLimit", async () => {
    const result = await useCase.execute({ accountId: ACCOUNT_ID, name: "My Key" });

    expect(result.ok).toBeTruthy();
    expect(typeof result.value.rawKey === "string").toBeTruthy();
    expect(result.value.rawKey.startsWith("op_")).toBeTruthy();
    expect(result.value.rawKey.length > 20).toBeTruthy();
    expect(result.value.key.id).toBe(KEY_ID);
    expect((repo.create as any).mock.calls.length).toBe(1);
  });

  it("returns validation error when name is empty", async () => {
    const result = await useCase.execute({ accountId: ACCOUNT_ID, name: "" });

    expect(result.ok).toBeFalsy();
    expect(result.error.message).toMatch(/name/i);
    expect((repo.create as any).mock.calls.length).toBe(0);
  });

  it("returns validation error when name exceeds 100 chars", async () => {
    const result = await useCase.execute({ accountId: ACCOUNT_ID, name: "x".repeat(101) });

    expect(result.ok).toBeFalsy();
    expect(result.error.message).toMatch(/100/);
  });

  it("returns validation error when rateLimit is out of range", async () => {
    const result = await useCase.execute({ accountId: ACCOUNT_ID, name: "Key", rateLimit: 0 });

    expect(result.ok).toBeFalsy();
    expect(result.error.message).toMatch(/rate limit/i);
  });

  it("returns validation error when expiresAt is in the past", async () => {
    const result = await useCase.execute({
      accountId: ACCOUNT_ID,
      name: "Key",
      expiresAt: new Date("2020-01-01"),
    });

    expect(result.ok).toBeFalsy();
    expect(result.error.message).toMatch(/future/i);
  });

  it("generates unique rawKey each call", async () => {
    const r1 = await useCase.execute({ accountId: ACCOUNT_ID, name: "Key 1" });
    const r2 = await useCase.execute({ accountId: ACCOUNT_ID, name: "Key 2" });

    expect(r1.ok).toBeTruthy();
    expect(r2.ok).toBeTruthy();
    expect(r1.value.rawKey).not.toBe(r2.value.rawKey);
  });

  it("passes permissions and rateLimit to repo.create", async () => {
    await useCase.execute({
      accountId: ACCOUNT_ID,
      name: "Admin Key",
      permissions: ["read", "write"],
      rateLimit: 500,
    });

    const callRecord = (repo.create as any).mock.calls[0];
    const arg = callRecord?.[0] as { permissions: string[]; rateLimit: number };
    expect(arg.permissions).toEqual(["read", "write"]);
    expect(arg.rateLimit).toBe(500);
  });

  it("returns INTERNAL_ERROR when repo.create throws", async () => {
    (repo.create as any).mockImplementation(async () => {
      throw new Error("DB connection lost");
    });

    const result = await useCase.execute({ accountId: ACCOUNT_ID, name: "Key" });

    expect(result.ok).toBeFalsy();
    expect(result.error.message.toLowerCase()).toMatch(/failed/);
  });
});

// ── ValidateApiKeyUseCase ─────────────────────────────────────────────────────

describe("ValidateApiKeyUseCase", () => {
  let repo: ApiKeyRepository;
  let useCase: ValidateApiKeyUseCase;

  beforeEach(() => {
    repo = makeMockRepo();
    useCase = new ValidateApiKeyUseCase(repo, new Argon2PasswordHasher());
  });

  it("returns UNAUTHORIZED for malformed key (no prefix)", async () => {
    const result = await useCase.execute({ rawKey: "no_underscores_here_at_all" });
    // key doesn't start with "op_"
    expect(result.ok).toBeFalsy();
  });

  it("returns UNAUTHORIZED when prefix not found in repo", async () => {
    (repo.findActiveByPrefix as any).mockImplementation(async () => null);

    const result = await useCase.execute({ rawKey: "op_aabbccdd_secretsecret" });

    expect(result.ok).toBeFalsy();
    expect(result.error.message).toMatch(/inactive|invalid/i);
  });

  it("returns UNAUTHORIZED when key is expired", async () => {
    (repo.findActiveByPrefix as any).mockImplementation(async () =>
      baseKey({ expiresAt: new Date("2020-01-01") })
    );

    const result = await useCase.execute({ rawKey: "op_aabbccdd_secretsecret" });

    expect(result.ok).toBeFalsy();
    expect(result.error.message).toMatch(/expired/i);
  });

  it("returns ok and records usage for a valid key", async () => {
    // Generate a real argon2 hash so verify() succeeds
    const rawKey = "op_aabbccdd_validrawkeymustbelongenoughtoverify12345678";
    const keyHash = await argon2.hash(rawKey);
    (repo.findActiveByPrefix as any).mockImplementation(async () => baseKey({ keyHash }));

    const result = await useCase.execute({ rawKey });

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.key.id).toBe(KEY_ID);
    }
    // recordUsage is fire-and-forget — may not have been called yet
  });

  it("returns error when hash does not match rawKey", async () => {
    // Generate a real argon2 hash for a DIFFERENT key
    const correctKey = "op_aabbccdd_correctsecretcorrectsecretcorrect";
    const wrongKey = "op_aabbccdd_wrongsecretwrongsecretwrongsecret";
    const keyHash = await argon2.hash(correctKey);
    (repo.findActiveByPrefix as any).mockImplementation(async () => baseKey({ keyHash }));

    // Submitting the wrong key — argon2.verify returns false
    const result = await useCase.execute({ rawKey: wrongKey });

    expect(result.ok).toBeFalsy();
  });

  it("returns INTERNAL_ERROR when repo throws", async () => {
    (repo.findActiveByPrefix as any).mockImplementation(async () => {
      throw new Error("DB error");
    });

    const result = await useCase.execute({ rawKey: "op_aabbccdd_secretsecret" });

    expect(result.ok).toBeFalsy();
  });
});

// ── ListApiKeysUseCase ────────────────────────────────────────────────────────

describe("ListApiKeysUseCase", () => {
  let repo: ApiKeyRepository;
  let useCase: ListApiKeysUseCase;

  beforeEach(() => {
    repo = makeMockRepo();
    useCase = new ListApiKeysUseCase(repo);
  });

  it("returns list of keys for account", async () => {
    const result = await useCase.execute(ACCOUNT_ID);

    expect(result.ok).toBeTruthy();
    expect(result.value.length).toBe(1);
    expect(result.value[0]?.id).toBe(KEY_ID);
  });

  it("returns empty array when account has no keys", async () => {
    (repo.findByAccountId as any).mockImplementation(async () => []);

    const result = await useCase.execute(ACCOUNT_ID);

    expect(result.ok).toBeTruthy();
    expect(result.value.length).toBe(0);
  });

  it("returns INTERNAL_ERROR when repo throws", async () => {
    (repo.findByAccountId as any).mockImplementation(async () => {
      throw new Error("DB error");
    });

    const result = await useCase.execute(ACCOUNT_ID);

    expect(result.ok).toBeFalsy();
  });
});

// ── RotateApiKeyUseCase ───────────────────────────────────────────────────────

describe("RotateApiKeyUseCase", () => {
  let repo: ApiKeyRepository;
  let useCase: RotateApiKeyUseCase;

  beforeEach(() => {
    repo = makeMockRepo();
    useCase = new RotateApiKeyUseCase(repo, new Argon2PasswordHasher());
  });

  it("returns ok with updated key and new rawKey", async () => {
    const result = await useCase.execute(KEY_ID);

    expect(result.ok).toBeTruthy();
    expect(typeof result.value.rawKey === "string").toBeTruthy();
    expect(result.value.rawKey.startsWith("op_")).toBeTruthy();
    expect(result.value.key.id).toBe(KEY_ID);
    expect((repo.rotate as any).mock.calls.length).toBe(1);
  });

  it("passes new prefix and hash to repo.rotate", async () => {
    await useCase.execute(KEY_ID);

    const callRecord = (repo.rotate as any).mock.calls[0];
    const args = callRecord as [string, string, string];
    expect(args[0]).toBe(KEY_ID);
    // prefix should start with "op_"
    expect((args[1] as string).startsWith("op_")).toBeTruthy();
    // hash should be non-empty
    expect((args[2] as string).length > 0).toBeTruthy();
  });

  it("propagates ApiKeyNotFoundError from repo", async () => {
    (repo.rotate as any).mockImplementation(async () => err(new ApiKeyNotFoundError(KEY_ID)));

    const result = await useCase.execute(KEY_ID);

    expect(result.ok).toBeFalsy();
    expect(result.error instanceof ApiKeyNotFoundError).toBeTruthy();
  });
});

// ── DeactivateApiKeyUseCase ───────────────────────────────────────────────────

describe("DeactivateApiKeyUseCase", () => {
  let repo: ApiKeyRepository;
  let useCase: DeactivateApiKeyUseCase;

  beforeEach(() => {
    repo = makeMockRepo();
    useCase = new DeactivateApiKeyUseCase(repo);
  });

  it("returns ok when key is deactivated", async () => {
    const result = await useCase.execute(KEY_ID);

    expect(result.ok).toBeTruthy();
    expect((repo.deactivate as any).mock.calls.length).toBe(1);
  });

  it("propagates ApiKeyNotFoundError from repo", async () => {
    (repo.deactivate as any).mockImplementation(async () => err(new ApiKeyNotFoundError(KEY_ID)));

    const result = await useCase.execute(KEY_ID);

    expect(result.ok).toBeFalsy();
    expect(result.error instanceof ApiKeyNotFoundError).toBeTruthy();
  });

  it("returns INTERNAL_ERROR when repo throws", async () => {
    (repo.deactivate as any).mockImplementation(async () => {
      throw new Error("DB error");
    });

    const result = await useCase.execute(KEY_ID);

    expect(result.ok).toBeFalsy();
  });
});
