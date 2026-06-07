/**
 * @file CreateRecurringPostUseCase.test.ts
 * @description Unit tests for CreateRecurringPostUseCase.
 *   Tier 3 — mocks RecurringPostRepository; verifies cron validation + Result shapes.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { CreateRecurringPostUseCase } from "../../src/CreateRecurringPostUseCase.js";
import type { RecurringPostRepository } from "@core/domain/repositories/RecurringPostRepository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = "b1000000-0000-4000-8000-000000000001";
const TEMPLATE_POST_ID = "t1000000-0000-4000-8000-000000000001";
const REC_POST_ID = "r1000000-0000-4000-8000-000000000001";

function makeRecurringPostRepo(
  overrides?: Partial<RecurringPostRepository>
): RecurringPostRepository {
  return {
    save: vi.fn(async (data) => ({
      ok: true,
      value: {
        id: REC_POST_ID,
        projectId: data.projectId,
        templatePostId: data.templatePostId,
        name: data.name,
        cronExpression: data.cronExpression,
        timezone: data.timezone ?? "UTC",
        startDate: data.startDate,
        occurrenceCount: data.occurrenceCount,
        isActive: data.isActive,
        channels: data.channels,
        contentVariation: data.contentVariation,
        createdAt: data.createdAt ?? new Date(),
        updatedAt: data.updatedAt ?? new Date(),
      },
    })),
    findById: vi.fn(async () => null),
    findByProjectId: vi.fn(async () => []),
    delete: vi.fn(async () => ({ ok: true, value: undefined })),
    update: vi.fn(async () => ({ ok: true, value: undefined })),
    ...overrides,
  } as unknown as RecurringPostRepository;
}

const VALID_COMMAND = {
  projectId: PROJECT_ID,
  templatePostId: TEMPLATE_POST_ID,
  name: "Weekly post",
  cronExpression: "0 9 * * MON",
  startDate: "2025-01-01T00:00:00.000Z",
  channels: ["ch-001"],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CreateRecurringPostUseCase", () => {
  let repo: ReturnType<typeof makeRecurringPostRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRecurringPostRepo();
  });

  describe("happy path — valid cron and project", () => {
    it("returns ok with recurring post id when cron and projectId are valid", async () => {
      const useCase = new CreateRecurringPostUseCase(repo);

      const result = await useCase.execute(VALID_COMMAND);

      assert.ok(result.ok, `Expected ok, got: ${!result.ok ? result.error.message : ""}`);
      assert.strictEqual(result.value.cronExpression, "0 9 * * MON");
      assert.strictEqual(result.value.isActive, true);
    });
  });

  describe("validation failed — invalid cron expression", () => {
    it("returns VALIDATION_FAILED error when cron expression is malformed", async () => {
      const useCase = new CreateRecurringPostUseCase(repo);

      const result = await useCase.execute({
        ...VALID_COMMAND,
        cronExpression: "not-a-cron",
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });

  describe("validation failed — invalid project ID", () => {
    it("returns VALIDATION_FAILED error when projectId is not a valid UUID", async () => {
      const useCase = new CreateRecurringPostUseCase(repo);

      const result = await useCase.execute({
        ...VALID_COMMAND,
        projectId: "not-a-uuid",
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });

  describe("internal error — repository save fails", () => {
    it("returns INTERNAL_ERROR when repository save returns an error", async () => {
      const failingRepo = makeRecurringPostRepo({
        save: vi.fn(async () => ({ ok: false, error: new Error("DB write failed") })),
      });
      const useCase = new CreateRecurringPostUseCase(failingRepo);

      const result = await useCase.execute(VALID_COMMAND);

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
    });
  });
});
