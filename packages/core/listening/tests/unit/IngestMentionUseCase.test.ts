/**
 * @file IngestMentionUseCase.test.ts
 * @description Unit tests for IngestMentionUseCase.
 *   Tier 3 — mocks MentionRepository; verifies dedup + validation contract.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { IngestMentionUseCase } from "../../src/IngestMentionUseCase.js";
import type { MentionRepository } from "@core/domain/repositories/MentionRepository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCOUNT_ID = "a1000000-0000-4000-8000-000000000001";
const PROJECT_ID = "b1000000-0000-4000-8000-000000000001";
const MENTION_ID = "m1000000-0000-4000-8000-000000000001";
const EXTERNAL_ID = "tweet-ext-001";

function makeMentionRepo(existingId?: string): MentionRepository {
  return {
    findByProviderExternalId: vi.fn(async () => {
      if (existingId) {
        return { id: { value: existingId } } as unknown as ReturnType<typeof vi.fn>;
      }
      return null;
    }),
    save: vi.fn(async () => ({ ok: true, value: undefined })),
  } as unknown as MentionRepository;
}

const VALID_INPUT = {
  accountId: ACCOUNT_ID,
  projectId: PROJECT_ID,
  provider: "TWITTER" as const,
  externalId: EXTERNAL_ID,
  source: "SEARCH" as const,
  authorName: "Test User",
  authorProviderId: "twitter-user-001",
  body: "This is a test mention about @omnipost",
  providerCreatedAt: new Date("2025-01-01T00:00:00.000Z"),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IngestMentionUseCase", () => {
  let repo: ReturnType<typeof makeMentionRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMentionRepo();
  });

  describe("happy path — new mention ingested", () => {
    it("returns ok with isNew=true when mention does not already exist", async () => {
      const useCase = new IngestMentionUseCase(repo);

      const result = await useCase.execute(VALID_INPUT);

      assert.ok(result.ok, `Expected ok, got: ${!result.ok ? result.error.message : ""}`);
      assert.strictEqual(result.value.isNew, true);
      assert.strictEqual(typeof result.value.id, "string");
      assert.ok(result.value.id.length > 0);
    });
  });

  describe("idempotent — duplicate mention", () => {
    it("returns ok with isNew=false when mention with same provider+externalId already exists", async () => {
      const dedupRepo = makeMentionRepo(MENTION_ID);
      const useCase = new IngestMentionUseCase(dedupRepo);

      const result = await useCase.execute(VALID_INPUT);

      assert.ok(result.ok);
      assert.strictEqual(result.value.isNew, false);
      assert.strictEqual(result.value.id, MENTION_ID);
    });
  });

  describe("validation failed — invalid accountId", () => {
    it("returns VALIDATION_FAILED error when accountId is not a valid UUID", async () => {
      const useCase = new IngestMentionUseCase(repo);

      const result = await useCase.execute({ ...VALID_INPUT, accountId: "not-a-uuid" });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });

  describe("validation failed — invalid projectId", () => {
    it("returns VALIDATION_FAILED error when projectId is not a valid UUID", async () => {
      const useCase = new IngestMentionUseCase(repo);

      const result = await useCase.execute({ ...VALID_INPUT, projectId: "bad-id" });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });
});
