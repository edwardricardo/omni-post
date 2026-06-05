/**
 * @file UpsertBrandKitUseCase.test.ts
 * @description Unit tests for UpsertBrandKitUseCase — validates hex color
 *   format, accountId presence, and upsert persistence.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok } from "@shared/types";
import { UpsertBrandKitUseCase } from "../../src/UpsertBrandKitUseCase.js";
import type { BrandKitData } from "@core/domain/repositories/BrandKitRepository.js";

const makeBrandKitData = (overrides?: Partial<BrandKitData>): BrandKitData => ({
  id: "bk-uuid-001",
  accountId: "acct-uuid-001",
  primaryColor: "#1a2b3c",
  secondaryColor: null,
  accentColor: null,
  logoUrl: null,
  logoStorageKey: null,
  fontPrimary: null,
  fontSecondary: null,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
  ...overrides,
});

const makeRepo = () => ({
  upsert: vi.fn().mockResolvedValue(makeBrandKitData()),
  findByAccountId: vi.fn(),
  delete: vi.fn(),
});

describe("UpsertBrandKitUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let useCase: UpsertBrandKitUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    useCase = new UpsertBrandKitUseCase(repo);
  });

  it("returns ok with brand kit data on successful upsert", async () => {
    const result = await useCase.execute({
      accountId: "acct-uuid-001",
      primaryColor: "#1a2b3c",
    });
    assert.ok(result.ok, "Expected ok result");
    assert.strictEqual(result.value.accountId, "acct-uuid-001");
    assert.strictEqual(result.value.primaryColor, "#1a2b3c");
  });

  it("returns ok when upserting with no colors (update metadata only)", async () => {
    const result = await useCase.execute({
      accountId: "acct-uuid-001",
      fontPrimary: "Inter",
    });
    assert.ok(result.ok, "Expected ok result");
  });

  it("returns VALIDATION_FAILED when accountId is empty", async () => {
    const result = await useCase.execute({ accountId: "" });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns VALIDATION_FAILED when primaryColor is not valid hex format", async () => {
    const result = await useCase.execute({
      accountId: "acct-uuid-001",
      primaryColor: "red",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns INTERNAL_ERROR when repository throws", async () => {
    repo.upsert.mockRejectedValue(new Error("DB error"));
    const result = await useCase.execute({
      accountId: "acct-uuid-001",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "INTERNAL_ERROR");
  });
});
