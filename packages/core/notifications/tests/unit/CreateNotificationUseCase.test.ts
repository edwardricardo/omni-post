/**
 * @file CreateNotificationUseCase.test.ts
 * @description Unit tests for CreateNotificationUseCase.
 *   Tier 3 — mocks NotificationRepository and NotificationPreferenceRepository.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { CreateNotificationUseCase } from "../../src/CreateNotificationUseCase.js";
import type {
  NotificationRepository,
  NotificationPreferenceRepository,
} from "@core/domain/repositories/NotificationRepository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RECIPIENT_ID = "r1000000-0000-4000-8000-000000000001";

function makeNotificationRepo(): NotificationRepository {
  return {
    save: vi.fn(async () => undefined),
    findById: vi.fn(async () => null),
    findByRecipientId: vi.fn(async () => []),
    markAsRead: vi.fn(async () => undefined),
    markAllAsRead: vi.fn(async () => undefined),
    countUnread: vi.fn(async () => 0),
  } as unknown as NotificationRepository;
}

function makePreferenceRepo(disabledType?: string): NotificationPreferenceRepository {
  return {
    findByMember: vi.fn(async () => {
      if (disabledType) {
        return [{ type: disabledType, enabled: false }];
      }
      return [];
    }),
  } as unknown as NotificationPreferenceRepository;
}

const VALID_INPUT = {
  recipientId: RECIPIENT_ID,
  type: "MENTION" as const,
  title: "You were mentioned",
  body: "Someone mentioned you in a post",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CreateNotificationUseCase", () => {
  let notificationRepo: ReturnType<typeof makeNotificationRepo>;
  let preferenceRepo: ReturnType<typeof makePreferenceRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    notificationRepo = makeNotificationRepo();
    preferenceRepo = makePreferenceRepo();
  });

  describe("happy path — notification created", () => {
    it("returns ok with notification id when type is enabled and inputs are valid", async () => {
      const useCase = new CreateNotificationUseCase(notificationRepo, preferenceRepo);

      const result = await useCase.execute(VALID_INPUT);

      assert.ok(result.ok, `Expected ok, got: ${!result.ok ? result.error.message : ""}`);
      assert.strictEqual(typeof result.value.id, "string");
    });
  });

  describe("preference disabled — silently skipped", () => {
    it("returns ok with empty id when recipient has disabled this notification type", async () => {
      const disabledPreferenceRepo = makePreferenceRepo("MENTION");
      const useCase = new CreateNotificationUseCase(notificationRepo, disabledPreferenceRepo);

      const result = await useCase.execute(VALID_INPUT);

      assert.ok(result.ok);
      assert.strictEqual(result.value.id, "");
    });
  });

  describe("validation failed — missing title", () => {
    it("returns VALIDATION_FAILED error when title is empty", async () => {
      const useCase = new CreateNotificationUseCase(notificationRepo, preferenceRepo);

      const result = await useCase.execute({ ...VALID_INPUT, title: "" });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });

  describe("internal error — save fails", () => {
    it("returns INTERNAL_ERROR when repository save throws", async () => {
      const failingRepo: NotificationRepository = {
        ...notificationRepo,
        save: vi.fn(async () => {
          throw new Error("DB write failed");
        }),
      } as unknown as NotificationRepository;
      const useCase = new CreateNotificationUseCase(failingRepo, preferenceRepo);

      const result = await useCase.execute(VALID_INPUT);

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
    });
  });
});
