/**
 * @file CreateAIPromptTemplateUseCase.test.ts
 * @description Unit tests for CreateAIPromptTemplateUseCase — happy path and
 *   validation errors (empty name, empty prompt, missing account id) against a
 *   mocked AIPromptTemplateRepository.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { CreateAIPromptTemplateUseCase } from "../../src/CreateAIPromptTemplateUseCase.js";
import type { AIPromptTemplateRepository } from "@core/domain/repositories/AIPromptTemplateRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

const ACCOUNT_ID = "acc-0000-0000-0000-0001";
const TEMPLATE_ID = "tpl-0000-0000-0000-0001";

const passthroughUow: UnitOfWork = {
  executeInTransaction: async (fn) => fn(),
};

function makeMockRepo(): AIPromptTemplateRepository {
  return {
    create: vi.fn(async () => ({
      id: TEMPLATE_ID,
      accountId: ACCOUNT_ID,
      name: "Test Template",
      category: "Custom",
      platforms: [],
      prompt: "Write a post about {topic}",
      variables: [],
      tone: [],
      isSystem: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    findById: vi.fn(async () => null),
    list: vi.fn(async () => []),
    update: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  } as unknown as AIPromptTemplateRepository;
}

const BASE_INPUT = {
  accountId: ACCOUNT_ID,
  name: "Test Template",
  category: "Social",
  platforms: ["TWITTER"],
  prompt: "Write a post about {topic}",
  variables: [],
  tone: ["professional"],
};

describe("CreateAIPromptTemplateUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the new template id when all fields are valid", async () => {
    const repo = makeMockRepo();
    const uc = new CreateAIPromptTemplateUseCase(repo, passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    assert.strictEqual(r.value.id, TEMPLATE_ID);
  });

  it("returns VALIDATION_FAILED when the template name is empty", async () => {
    const repo = makeMockRepo();
    const uc = new CreateAIPromptTemplateUseCase(repo, passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, name: "   " });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns VALIDATION_FAILED when the prompt text is empty", async () => {
    const repo = makeMockRepo();
    const uc = new CreateAIPromptTemplateUseCase(repo, passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, prompt: "" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns VALIDATION_FAILED when the account id is missing", async () => {
    const repo = makeMockRepo();
    const uc = new CreateAIPromptTemplateUseCase(repo, passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, accountId: "" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });
});
