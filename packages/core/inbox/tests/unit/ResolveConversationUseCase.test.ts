/**
 * @file ResolveConversationUseCase.test.ts
 * @description Unit tests for ResolveConversationUseCase — happy path,
 *   invalid conversationId, empty resolvedById, and conversation not found.
 * @layer infrastructure
 */
import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { ResolveConversationUseCase } from "../../src/ResolveConversationUseCase.js";
import type { SocialConversationRepository } from "@core/domain/repositories/SocialConversationRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

const VALID_ID = "550e8400-e29b-41d4-a716-446655440000";

const passthroughUow: UnitOfWork = {
  executeInTransaction: async (fn) => fn(),
};

function makeConversationStub() {
  return {
    id: VALID_ID,
    resolve: vi.fn(() => ok(undefined)),
  };
}

function makeMockRepo(
  opts: {
    findById?: unknown;
    save?: unknown;
  } = {}
): SocialConversationRepository {
  const conv = makeConversationStub();
  return {
    findById: vi.fn(async () => opts.findById ?? ok(conv)),
    save: vi.fn(async () => opts.save ?? ok(undefined)),
  } as unknown as SocialConversationRepository;
}

const BASE_INPUT = {
  conversationId: VALID_ID,
  resolvedById: "user-uuid-001",
};

describe("ResolveConversationUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns void ok when the conversation exists and can be resolved", async () => {
    const uc = new ResolveConversationUseCase(makeMockRepo(), passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok but got err: ${r.ok ? "" : r.error.message}`);
  });

  it("returns VALIDATION_FAILED when resolvedById is empty", async () => {
    const uc = new ResolveConversationUseCase(makeMockRepo(), passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, resolvedById: "" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns VALIDATION_FAILED when conversationId is not a valid UUID", async () => {
    const uc = new ResolveConversationUseCase(makeMockRepo(), passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, conversationId: "not-a-uuid" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns NOT_FOUND when the conversation does not exist in the repository", async () => {
    const uc = new ResolveConversationUseCase(
      makeMockRepo({ findById: err(new Error("not found")) }),
      passthroughUow
    );
    const r = await uc.execute(BASE_INPUT);
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.NOT_FOUND);
  });
});
