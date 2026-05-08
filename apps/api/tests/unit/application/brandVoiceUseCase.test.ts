/**
 * @file brandVoiceUseCase.test.ts
 * @description Tests for UpsertBrandVoiceUseCase — validation, upsert, defaults.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { UpsertBrandVoiceUseCase } from "../../../src/application/brand-voice/UpsertBrandVoiceUseCase.js";

function makeRepo() {
  return {
    upsert: vi.fn(async (data: any) => ({ id: "bv-1", ...data })),
    findByAccountId: vi.fn(async () => null),
    deleteByAccountId: vi.fn(async () => undefined),
  };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acc-1",
    name: "Brand Voice",
    systemPrompt: "You are a professional social media manager.",
    ...overrides,
  };
}

describe("UpsertBrandVoiceUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let uc: UpsertBrandVoiceUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    uc = new UpsertBrandVoiceUseCase(repo as any);
  });

  it("upserts brand voice with valid input", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    assert.equal(r.value.name, "Brand Voice");
    expect(repo.upsert).toHaveBeenCalledOnce();
  });

  it("trims name and systemPrompt", async () => {
    await uc.execute(makeInput({ name: "  Trimmed  ", systemPrompt: "  Prompt  " }));
    const call = repo.upsert.mock.calls[0]?.[0];
    assert.equal(call?.name, "Trimmed");
    assert.equal(call?.systemPrompt, "Prompt");
  });

  it("defaults tone to empty array", async () => {
    await uc.execute(makeInput());
    const call = repo.upsert.mock.calls[0]?.[0];
    assert.deepEqual(call?.tone, []);
  });

  it("defaults examples to empty array", async () => {
    await uc.execute(makeInput());
    assert.deepEqual(repo.upsert.mock.calls[0]?.[0]?.examples, []);
  });

  it("defaults isActive to true", async () => {
    await uc.execute(makeInput());
    assert.equal(repo.upsert.mock.calls[0]?.[0]?.isActive, true);
  });

  it("passes tone when provided", async () => {
    await uc.execute(makeInput({ tone: ["professional", "friendly"] }));
    assert.deepEqual(repo.upsert.mock.calls[0]?.[0]?.tone, ["professional", "friendly"]);
  });

  it("rejects empty accountId", async () => {
    assert.ok(!(await uc.execute(makeInput({ accountId: "" }))).ok);
  });

  it("rejects empty name", async () => {
    assert.ok(!(await uc.execute(makeInput({ name: "" }))).ok);
  });

  it("rejects whitespace-only name", async () => {
    assert.ok(!(await uc.execute(makeInput({ name: "   " }))).ok);
  });

  it("rejects name > 100 chars", async () => {
    assert.ok(!(await uc.execute(makeInput({ name: "a".repeat(101) }))).ok);
  });

  it("accepts name of exactly 100 chars", async () => {
    assert.ok((await uc.execute(makeInput({ name: "a".repeat(100) }))).ok);
  });

  it("rejects empty systemPrompt", async () => {
    assert.ok(!(await uc.execute(makeInput({ systemPrompt: "" }))).ok);
  });

  it("rejects systemPrompt > 2000 chars", async () => {
    assert.ok(!(await uc.execute(makeInput({ systemPrompt: "a".repeat(2001) }))).ok);
  });

  it("accepts systemPrompt of exactly 2000 chars", async () => {
    assert.ok((await uc.execute(makeInput({ systemPrompt: "a".repeat(2000) }))).ok);
  });
});
