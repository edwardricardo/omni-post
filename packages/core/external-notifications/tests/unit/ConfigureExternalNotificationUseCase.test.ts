/**
 * @file ConfigureExternalNotificationUseCase.test.ts
 * @description Unit tests for ConfigureExternalNotificationUseCase — validates
 *   webhook URL format, events requirement, and notification config persistence.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { ConfigureExternalNotificationUseCase } from "../../src/ConfigureExternalNotificationUseCase.js";
import type { ExternalNotificationConfigData } from "@core/domain/repositories/ExternalNotificationConfigRepository.js";

const makeSavedConfig = (
  overrides?: Partial<ExternalNotificationConfigData>
): ExternalNotificationConfigData => ({
  id: "notif-uuid-001",
  projectId: "proj-uuid-001",
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
  delete: vi.fn(),
});

describe("ConfigureExternalNotificationUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let useCase: ConfigureExternalNotificationUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    useCase = new ConfigureExternalNotificationUseCase(repo);
  });

  it("returns ok with config data when input is valid", async () => {
    const result = await useCase.execute({
      projectId: "proj-uuid-001",
      channel: "slack",
      webhookUrl: "https://hooks.slack.com/services/test",
      label: "Alerts",
      events: ["post.published"],
    });
    assert.ok(result.ok, "Expected ok result");
    assert.strictEqual(result.value.projectId, "proj-uuid-001");
    assert.strictEqual(result.value.channel, "slack");
    assert.strictEqual(result.value.isActive, true);
  });

  it("returns VALIDATION_FAILED when webhookUrl does not use HTTPS", async () => {
    const result = await useCase.execute({
      projectId: "proj-uuid-001",
      channel: "slack",
      webhookUrl: "http://insecure.example.com/webhook",
      label: "Alerts",
      events: ["post.published"],
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns VALIDATION_FAILED when events array is empty", async () => {
    const result = await useCase.execute({
      projectId: "proj-uuid-001",
      channel: "teams",
      webhookUrl: "https://outlook.office.com/webhook/test",
      label: "Alerts",
      events: [],
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns INTERNAL_ERROR when repository save fails", async () => {
    repo.save.mockResolvedValue(err(new Error("DB write failed")));
    const result = await useCase.execute({
      projectId: "proj-uuid-001",
      channel: "slack",
      webhookUrl: "https://hooks.slack.com/services/test",
      label: "Alerts",
      events: ["post.published"],
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "INTERNAL_ERROR");
  });
});
