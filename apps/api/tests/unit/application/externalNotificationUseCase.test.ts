/**
 * @file externalNotificationUseCase.test.ts
 * @description Tests for ConfigureExternalNotificationUseCase — URL validation, events, persistence.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { ConfigureExternalNotificationUseCase } from "@core/external-notifications/ConfigureExternalNotificationUseCase.js";

function makeRepo() {
  return {
    save: vi.fn(async (data: any) => ({ ok: true as const, value: data })),
    findByProjectId: vi.fn(async () => []),
    deleteById: vi.fn(async () => undefined),
  };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "proj-1",
    channel: "SLACK" as const,
    webhookUrl: "https://hooks.slack.com/services/T00/B00/xxx",
    label: "My Slack Webhook",
    events: ["POST_PUBLISHED", "POST_FAILED"],
    ...overrides,
  };
}

describe("ConfigureExternalNotificationUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let uc: ConfigureExternalNotificationUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    uc = new ConfigureExternalNotificationUseCase(repo as any);
  });

  it("saves valid Slack webhook config", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    assert.equal(r.value.projectId, "proj-1");
    assert.equal(r.value.channel, "SLACK");
    assert.equal(r.value.webhookUrl, "https://hooks.slack.com/services/T00/B00/xxx");
    assert.equal(r.value.label, "My Slack Webhook");
    assert.deepEqual(r.value.events, ["POST_PUBLISHED", "POST_FAILED"]);
    assert.equal(r.value.isActive, true);
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
    repo.save.mockResolvedValueOnce({ ok: false, error: new Error("DB error") });
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
