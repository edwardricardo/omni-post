/**
 * @file UpsertBrandVoiceUseCase.test.ts
 * @description Unit tests for UpsertBrandVoiceUseCase — validates name/systemPrompt
 *   constraints and upsert persistence.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { UpsertBrandVoiceUseCase } from "../../src/UpsertBrandVoiceUseCase.js";
import type { BrandVoiceData } from "@core/domain/repositories/BrandVoiceRepository.js";

const makeBrandVoiceData = (overrides?: Partial<BrandVoiceData>): BrandVoiceData => ({
  id: "bv-uuid-001",
  accountId: "acct-uuid-001",
  name: "Professional Tone",
  systemPrompt: "Write in a professional and authoritative tone.",
  tone: ["professional", "authoritative"],
  examples: [],
  isActive: true,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
  ...overrides,
});

const makeRepo = () => ({
  upsert: vi.fn().mockResolvedValue(makeBrandVoiceData()),
  findByAccountId: vi.fn(),
  delete: vi.fn(),
});

describe("UpsertBrandVoiceUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let useCase: UpsertBrandVoiceUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    useCase = new UpsertBrandVoiceUseCase(repo);
  });

  it("returns ok with brand voice data on successful create", async () => {
    const result = await useCase.execute({
      accountId: "acct-uuid-001",
      name: "Professional Tone",
      systemPrompt: "Write in a professional and authoritative tone.",
    });
    assert.ok(result.ok, "Expected ok result");
    assert.strictEqual(result.value.name, "Professional Tone");
    assert.strictEqual(result.value.isActive, true);
  });

  it("returns ok when updating existing brand voice with new prompt", async () => {
    repo.upsert.mockResolvedValue(
      makeBrandVoiceData({ systemPrompt: "Updated: Use a casual tone." })
    );
    const result = await useCase.execute({
      accountId: "acct-uuid-001",
      name: "Casual Voice",
      systemPrompt: "Updated: Use a casual tone.",
    });
    assert.ok(result.ok, "Expected ok result");
    assert.strictEqual(result.value.systemPrompt, "Updated: Use a casual tone.");
  });

  it("returns VALIDATION_FAILED when name is empty", async () => {
    const result = await useCase.execute({
      accountId: "acct-uuid-001",
      name: "   ",
      systemPrompt: "Some prompt",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns VALIDATION_FAILED when systemPrompt is empty", async () => {
    const result = await useCase.execute({
      accountId: "acct-uuid-001",
      name: "Valid Name",
      systemPrompt: "",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns VALIDATION_FAILED when systemPrompt exceeds 2000 characters", async () => {
    const result = await useCase.execute({
      accountId: "acct-uuid-001",
      name: "Valid Name",
      systemPrompt: "x".repeat(2001),
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });
});
