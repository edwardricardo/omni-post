/**
 * @file externalNotificationUseCase.test.ts
 * @description Tests for ConfigureExternalNotificationUseCase — URL validation,
 *   events, project-ownership resolution (foreign/missing → NOT_FOUND),
 *   accountId threading, and persistence.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { ConfigureExternalNotificationUseCase } from "@core/external-notifications/ConfigureExternalNotificationUseCase.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { ExternalNotificationConfigData } from "@core/domain/repositories/ExternalNotificationConfigRepository.js";
import { Project } from "@core/domain/entities/Project.js";
import { AccountId } from "@core/domain/value-objects/EntityId.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

const ACCOUNT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeProject(): Project {
  const result = Project.create({
    accountId: AccountId.fromStringUnsafe(ACCOUNT_ID),
    name: "Test Project",
  });
  if (!result.ok) throw new Error("fixture: Project.create failed");
  return result.value;
}

function makeRepo() {
  return {
    save: vi.fn(async (data: ExternalNotificationConfigData) => ok(data)),
    findByProjectId: vi.fn(async () => ok([])),
    findById: vi.fn(),
    findActiveByProjectAndEvent: vi.fn(),
    delete: vi.fn(async () => ok(undefined)),
  };
}

function makeProjectRepo(found = true) {
  return {
    findById: vi
      .fn()
      .mockResolvedValue(
        found ? ok(makeProject()) : err(new EntityNotFoundError("Project", PROJECT_ID))
      ),
  } as unknown as ProjectRepositoryPort & { findById: ReturnType<typeof vi.fn> };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT_ID,
    channel: "slack" as const,
    webhookUrl: "https://hooks.slack.com/services/T00/B00/xxx",
    label: "My Slack Webhook",
    events: ["POST_PUBLISHED", "POST_FAILED"],
    ...overrides,
  };
}

describe("ConfigureExternalNotificationUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let projectRepo: ReturnType<typeof makeProjectRepo>;
  let uc: ConfigureExternalNotificationUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    projectRepo = makeProjectRepo(true);
    uc = new ConfigureExternalNotificationUseCase(repo as never, projectRepo);
  });

  it("saves valid Slack webhook config", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    assert.equal(r.value.projectId, PROJECT_ID);
    assert.equal(r.value.channel, "slack");
    assert.equal(r.value.webhookUrl, "https://hooks.slack.com/services/T00/B00/xxx");
    assert.equal(r.value.label, "My Slack Webhook");
    assert.deepEqual(r.value.events, ["POST_PUBLISHED", "POST_FAILED"]);
    assert.equal(r.value.isActive, true);
  });

  it("threads the resolved project's accountId into the saved config", async () => {
    await uc.execute(makeInput());
    const savedData = repo.save.mock.calls[0]?.[0] as ExternalNotificationConfigData;
    assert.equal(savedData.accountId, ACCOUNT_ID);
  });

  it("returns NOT_FOUND when the project belongs to another tenant (foreign project)", async () => {
    projectRepo = makeProjectRepo(false);
    uc = new ConfigureExternalNotificationUseCase(repo as never, projectRepo);
    const r = await uc.execute(makeInput());
    assert.ok(!r.ok);
    assert.equal(r.error.code, "NOT_FOUND");
    assert.equal(repo.save.mock.calls.length, 0);
  });

  it("defaults isActive to true when not specified", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    assert.equal(r.value.isActive, true);
  });

  it("uses provided isActive value", async () => {
    const r = await uc.execute(makeInput({ isActive: false }));
    assert.ok(r.ok);
    assert.equal(r.value.isActive, false);
  });

  it("uses provided ID when specified", async () => {
    const r = await uc.execute(makeInput({ id: "custom-id-123" }));
    assert.ok(r.ok);
    assert.equal(r.value.id, "custom-id-123");
  });

  it("generates UUID when ID not specified", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    assert.ok(r.value.id);
    assert.ok(r.value.id.length > 10);
  });

  it("rejects non-HTTPS webhook URL", async () => {
    const r = await uc.execute(makeInput({ webhookUrl: "http://hooks.slack.com/services/xxx" }));
    assert.ok(!r.ok);
    expect(r.error.message).toContain("HTTPS");
  });

  it("rejects plain text webhook URL", async () => {
    const r = await uc.execute(makeInput({ webhookUrl: "not-a-url" }));
    assert.ok(!r.ok);
  });

  it("rejects empty events array", async () => {
    const r = await uc.execute(makeInput({ events: [] }));
    assert.ok(!r.ok);
    expect(r.error.message).toContain("event");
  });

  it("returns error when repository save fails", async () => {
    repo.save.mockResolvedValueOnce(err(new Error("DB error")));
    const r = await uc.execute(makeInput());
    assert.ok(!r.ok);
  });

  it("includes createdAt and updatedAt timestamps", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    assert.ok(r.value.createdAt instanceof Date);
    assert.ok(r.value.updatedAt instanceof Date);
  });
});
