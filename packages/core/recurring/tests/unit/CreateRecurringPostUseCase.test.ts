/**
 * @file CreateRecurringPostUseCase.test.ts
 * @description Unit tests for CreateRecurringPostUseCase.
 *   Mocks RecurringPostRepository + ProjectRepositoryPort + PostRepository +
 *   ChannelRepository; verifies cron validation, TRIPLE parent-ownership
 *   (project guarded, template + channels project-consistent), and accountId
 *   threading from the guard-resolved project.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { CreateRecurringPostUseCase } from "../../src/CreateRecurringPostUseCase.js";
import type { RecurringPostRepository } from "@core/domain/repositories/RecurringPostRepository.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { PostRepository } from "@core/domain/repositories/PostRepository.js";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { Project } from "@core/domain/entities/Project.js";
import { AccountId, ChannelId } from "@core/domain/value-objects/EntityId.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "b1000000-0000-4000-8000-000000000001";
const FOREIGN_PROJECT_ID = "c1000000-0000-4000-8000-000000000009";
const TEMPLATE_POST_ID = "d1000000-0000-4000-8000-000000000001";
const CHANNEL_ID = "e1000000-0000-4000-8000-000000000001";
const REC_POST_ID = "f1000000-0000-4000-8000-000000000001";

const passthroughUow: UnitOfWork = {
  executeInTransaction: async (fn) => fn(),
};

function makeRecurringPostRepo(
  overrides?: Partial<RecurringPostRepository>
): RecurringPostRepository & { save: ReturnType<typeof vi.fn> } {
  return {
    save: vi.fn(async (data) => ({
      ok: true,
      value: {
        id: REC_POST_ID,
        accountId: data.accountId,
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
    findById: vi.fn(async () => err(new EntityNotFoundError("RecurringPost", REC_POST_ID))),
    findByProjectId: vi.fn(async () => ok([])),
    findActiveByNextScheduled: vi.fn(async () => ok([])),
    delete: vi.fn(async () => ok(undefined)),
    ...overrides,
  } as unknown as RecurringPostRepository & { save: ReturnType<typeof vi.fn> };
}

const makeProject = (): Project => {
  const result = Project.create({
    accountId: AccountId.fromStringUnsafe(ACCOUNT_ID),
    name: "Test Project",
  });
  if (!result.ok) throw new Error("fixture: Project.create failed");
  return result.value;
};

const makeProjectRepo = (found = true) =>
  ({
    findById: vi
      .fn()
      .mockResolvedValue(
        found ? ok(makeProject()) : err(new EntityNotFoundError("Project", PROJECT_ID))
      ),
  }) as unknown as ProjectRepositoryPort & { findById: ReturnType<typeof vi.fn> };

// Post/Channel are UNENROLLED (not guard-scoped) — the ownership control is an
// app-level project-consistency check against the already-guard-validated
// projectId. The mocks only need a `projectId.value` getter.
const makePostRepo = (projectIdValue: string = PROJECT_ID, found = true) =>
  ({
    findById: vi
      .fn()
      .mockResolvedValue(
        found
          ? ok({ projectId: { value: projectIdValue } })
          : err(new EntityNotFoundError("Post", TEMPLATE_POST_ID))
      ),
  }) as unknown as PostRepository & { findById: ReturnType<typeof vi.fn> };

// Channel ownership is checked via the decryption-free `findIdsByProjectId`
// (the documented "does channel X belong to project Y?" lookup). `owns=true`
// means the requested channel is in the project's owned set; `owns=false`
// (foreign OR nonexistent) yields an empty set → rejection.
const makeChannelRepo = (owns = true) =>
  ({
    findIdsByProjectId: vi
      .fn()
      .mockResolvedValue(owns ? [ChannelId.fromStringUnsafe(CHANNEL_ID)] : []),
  }) as unknown as ChannelRepository & { findIdsByProjectId: ReturnType<typeof vi.fn> };

const VALID_COMMAND = {
  projectId: PROJECT_ID,
  templatePostId: TEMPLATE_POST_ID,
  name: "Weekly post",
  cronExpression: "0 9 * * MON",
  startDate: "2025-01-01T00:00:00.000Z",
  channels: [CHANNEL_ID],
};

function makeUseCase(opts?: {
  recurringRepo?: RecurringPostRepository & { save: ReturnType<typeof vi.fn> };
  projectFound?: boolean;
  postProjectId?: string;
  postFound?: boolean;
  channelOwns?: boolean;
}) {
  const recurringRepo = opts?.recurringRepo ?? makeRecurringPostRepo();
  return {
    recurringRepo,
    useCase: new CreateRecurringPostUseCase(
      recurringRepo,
      makeProjectRepo(opts?.projectFound ?? true),
      makePostRepo(opts?.postProjectId ?? PROJECT_ID, opts?.postFound ?? true),
      makeChannelRepo(opts?.channelOwns ?? true),
      passthroughUow
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CreateRecurringPostUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("happy path — valid cron and own parent refs", () => {
    it("returns ok with recurring post id when cron, project, template, and channels are own", async () => {
      const { useCase } = makeUseCase();
      const result = await useCase.execute(VALID_COMMAND);
      assert.ok(result.ok, `Expected ok, got: ${!result.ok ? result.error.message : ""}`);
      assert.strictEqual(result.value.cronExpression, "0 9 * * MON");
      assert.strictEqual(result.value.isActive, true);
    });

    it("threads the resolved project's accountId onto the persisted recurrence", async () => {
      const { useCase, recurringRepo } = makeUseCase();
      const result = await useCase.execute(VALID_COMMAND);
      assert.ok(result.ok, `expected ok: ${result.ok ? "" : result.error.message}`);
      assert.strictEqual(recurringRepo.save.mock.calls.length, 1);
      const saved = recurringRepo.save.mock.calls[0]?.[0] as { accountId: string };
      assert.strictEqual(saved.accountId, ACCOUNT_ID, "accountId must come from the project");
    });
  });

  describe("validation failed — invalid cron expression", () => {
    it("returns VALIDATION_FAILED error when cron expression is malformed", async () => {
      const { useCase } = makeUseCase();
      const result = await useCase.execute({ ...VALID_COMMAND, cronExpression: "not-a-cron" });
      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });

  describe("validation failed — invalid project ID", () => {
    it("returns VALIDATION_FAILED error when projectId is not a valid UUID", async () => {
      const { useCase } = makeUseCase();
      const result = await useCase.execute({ ...VALID_COMMAND, projectId: "not-a-uuid" });
      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });

  describe("ownership — foreign/missing project", () => {
    it("returns NOT_FOUND (never persisting) when the project is foreign/missing", async () => {
      const { useCase, recurringRepo } = makeUseCase({ projectFound: false });
      const result = await useCase.execute(VALID_COMMAND);
      assert.ok(!result.ok, "foreign project must fail");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      assert.strictEqual(recurringRepo.save.mock.calls.length, 0);
    });
  });

  describe("ownership — foreign templatePostId (content-exfil closed)", () => {
    it("returns NOT_FOUND when the template post belongs to another project", async () => {
      const { useCase, recurringRepo } = makeUseCase({ postProjectId: FOREIGN_PROJECT_ID });
      const result = await useCase.execute(VALID_COMMAND);
      assert.ok(!result.ok, "foreign template must fail");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      assert.strictEqual(recurringRepo.save.mock.calls.length, 0);
    });

    it("returns NOT_FOUND when the template post does not exist", async () => {
      const { useCase } = makeUseCase({ postFound: false });
      const result = await useCase.execute(VALID_COMMAND);
      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
    });
  });

  describe("ownership — foreign/missing channel (cross-tenant publish targeting closed)", () => {
    it("returns NOT_FOUND when a channel is not owned by the project (foreign or missing)", async () => {
      const { useCase, recurringRepo } = makeUseCase({ channelOwns: false });
      const result = await useCase.execute(VALID_COMMAND);
      assert.ok(!result.ok, "foreign/missing channel must fail");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      assert.strictEqual(recurringRepo.save.mock.calls.length, 0);
    });
  });

  describe("internal error — repository save fails", () => {
    it("returns INTERNAL_ERROR when repository save returns an error", async () => {
      const failingRepo = makeRecurringPostRepo({
        save: vi.fn(async () => err(new Error("DB write failed"))),
      });
      const { useCase } = makeUseCase({ recurringRepo: failingRepo });
      const result = await useCase.execute(VALID_COMMAND);
      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
    });
  });
});
