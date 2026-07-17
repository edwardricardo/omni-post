/**
 * @file ConfigureExternalNotificationUseCase.test.ts
 * @description Unit tests for ConfigureExternalNotificationUseCase — validates
 *   webhook URL format, events requirement, project-ownership resolution
 *   (foreign/missing project → NOT_FOUND), accountId threading, and
 *   notification config persistence.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { ConfigureExternalNotificationUseCase } from "../../src/ConfigureExternalNotificationUseCase.js";
import type { ExternalNotificationConfigData } from "@core/domain/repositories/ExternalNotificationConfigRepository.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import { Project } from "@core/domain/entities/Project.js";
import { AccountId } from "@core/domain/value-objects/EntityId.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

const makeProject = (): Project => {
  const result = Project.create({
    accountId: AccountId.fromStringUnsafe(ACCOUNT_ID),
    name: "Test Project",
  });
  if (!result.ok) throw new Error("fixture: Project.create failed");
  return result.value;
};

const makeSavedConfig = (
  overrides?: Partial<ExternalNotificationConfigData>
): ExternalNotificationConfigData => ({
  id: "notif-uuid-001",
  accountId: ACCOUNT_ID,
  projectId: PROJECT_ID,
  channel: "slack",
  webhookUrl: "https://hooks.slack.com/services/test",
  label: "Alerts",
  events: ["post.published"],
  isActive: true,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
  ...overrides,
});

const makeRepo = () => ({
  save: vi.fn().mockResolvedValue(ok(makeSavedConfig())),
  findByProjectId: vi.fn(),
  findById: vi.fn(),
  findActiveByProjectAndEvent: vi.fn(),
  delete: vi.fn(),
});

// Narrow mock — the use case only calls findById. Cast to the port for the ctor.
const makeProjectRepo = (found = true) =>
  ({
    findById: vi
      .fn()
      .mockResolvedValue(
        found ? ok(makeProject()) : err(new EntityNotFoundError("Project", PROJECT_ID))
      ),
  }) as unknown as ProjectRepositoryPort & { findById: ReturnType<typeof vi.fn> };

const validInput = (overrides: Record<string, unknown> = {}) => ({
  projectId: PROJECT_ID,
  channel: "slack" as const,
  webhookUrl: "https://hooks.slack.com/services/test",
  label: "Alerts",
  events: ["post.published"],
  ...overrides,
});

describe("ConfigureExternalNotificationUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let projectRepo: ReturnType<typeof makeProjectRepo>;
  let useCase: ConfigureExternalNotificationUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    projectRepo = makeProjectRepo(true);
    useCase = new ConfigureExternalNotificationUseCase(repo, projectRepo);
  });

  it("returns ok with config data when input is valid", async () => {
    const result = await useCase.execute(validInput());
    assert.ok(result.ok, "Expected ok result");
    assert.strictEqual(result.value.projectId, PROJECT_ID);
    assert.strictEqual(result.value.channel, "slack");
    assert.strictEqual(result.value.isActive, true);
  });

  it("threads the resolved project's accountId into the saved config data", async () => {
    await useCase.execute(validInput());
    assert.strictEqual(repo.save.mock.calls.length, 1, "save should be called once");
    const savedData = repo.save.mock.calls[0]?.[0] as ExternalNotificationConfigData;
    assert.strictEqual(savedData.accountId, ACCOUNT_ID, "accountId must come from the project");
    assert.strictEqual(savedData.projectId, PROJECT_ID);
  });

  it("resolves the project via the guard-scoped ProjectRepositoryPort", async () => {
    await useCase.execute(validInput());
    assert.strictEqual(projectRepo.findById.mock.calls.length, 1, "findById called once");
    const idArg = projectRepo.findById.mock.calls[0]?.[0] as { value: string };
    assert.strictEqual(idArg.value, PROJECT_ID);
  });

  it("returns NOT_FOUND when the project does not resolve under the caller (foreign project)", async () => {
    projectRepo = makeProjectRepo(false);
    useCase = new ConfigureExternalNotificationUseCase(repo, projectRepo);
    const result = await useCase.execute(validInput());
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "NOT_FOUND");
    assert.strictEqual(repo.save.mock.calls.length, 0, "no row should be persisted");
  });

  it("returns VALIDATION_FAILED when projectId is not a valid UUID", async () => {
    const result = await useCase.execute(validInput({ projectId: "not-a-uuid" }));
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns VALIDATION_FAILED when webhookUrl does not use HTTPS", async () => {
    const result = await useCase.execute(
      validInput({ webhookUrl: "http://insecure.example.com/webhook" })
    );
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns VALIDATION_FAILED when events array is empty", async () => {
    const result = await useCase.execute(validInput({ channel: "teams", events: [] }));
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns INTERNAL_ERROR when repository save fails", async () => {
    repo.save.mockResolvedValue(err(new Error("DB write failed")));
    const result = await useCase.execute(validInput());
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "INTERNAL_ERROR");
  });
});
