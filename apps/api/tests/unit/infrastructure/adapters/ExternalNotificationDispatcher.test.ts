/**
 * @file externalNotificationDispatcherBroadcast.test.ts
 * @description Unit tests for the promoted `broadcast` on ExternalNotifierPort. The
 *   method existed on the dispatcher CLASS before; promoting it to the port is what
 *   lets a caller fan out to a project's destinations without importing an
 *   infrastructure class, and the new `toEveryActiveConfig` option is what lets one
 *   caller reach configs whose `events` filter predates the event being announced.
 *
 *   Both branches are pinned here because they are opposites: the default keeps the
 *   filter (every existing caller depends on it), and the option deliberately ignores
 *   it (an alert nobody's filter names would otherwise be invisible on every config
 *   that exists today).
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ExternalNotificationDispatcher } from "../../../../src/infrastructure/adapters/ExternalNotificationDispatcher.js";
import type { ExternalNotificationConfigRepository } from "@core/domain/repositories/ExternalNotificationConfigRepository.js";
import type { NotificationPayload } from "@core/domain/repositories/ExternalNotifierPort.js";
import { ok } from "@shared/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = "p1000000-0000-4000-8000-000000000001";

const makeConfig = (id: string, isActive: boolean, events: string[], channel = "slack") => ({
  id,
  accountId: "a1",
  projectId: PROJECT_ID,
  channel,
  webhookUrl: `https://hooks.example.test/${id}`,
  label: id,
  events,
  isActive,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
});

function makeConfigRepo(configs: ReturnType<typeof makeConfig>[]) {
  return {
    findByProjectId: vi.fn(async () => ok(configs)),
    findActiveByProjectAndEvent: vi.fn(async (_projectId: string, event: string) =>
      ok(configs.filter((c) => c.isActive && c.events.includes(event)))
    ),
  } as unknown as ExternalNotificationConfigRepository;
}

const makeAdapter = (behaviour: "ok" | "fail" = "ok") => ({
  send: vi.fn(async () =>
    behaviour === "ok" ? ok(undefined) : { ok: false as const, error: new Error("refused") }
  ),
});

const PAYLOAD: NotificationPayload = {
  title: "Content is still live on Acme on X: manual removal required",
  message: "Two fragments are still published.",
  event: "post.retraction_pending",
  projectId: PROJECT_ID,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExternalNotificationDispatcher.broadcast", () => {
  let slack: ReturnType<typeof makeAdapter>;
  let teams: ReturnType<typeof makeAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    slack = makeAdapter();
    teams = makeAdapter();
  });

  describe("default — the config's events filter decides", () => {
    it("reaches only the active configs whose filter names the event", async () => {
      const repo = makeConfigRepo([
        makeConfig("cfg-named", true, ["post.retraction_pending"]),
        makeConfig("cfg-other", true, ["post.published"]),
      ]);
      const dispatcher = new ExternalNotificationDispatcher(repo, slack, teams);

      const result = await dispatcher.broadcast(PROJECT_ID, "post.retraction_pending", PAYLOAD);

      assert.ok(result.ok);
      assert.strictEqual(result.value.sent, 1);
      expect(slack.send).toHaveBeenCalledOnce();
      expect(repo.findActiveByProjectAndEvent).toHaveBeenCalledOnce();
    });
  });

  describe("toEveryActiveConfig — the ACTIVE config is the switch", () => {
    it("reaches every active config even when no filter names the event", async () => {
      const repo = makeConfigRepo([
        makeConfig("cfg-a", true, ["post.published"]),
        makeConfig("cfg-b", true, []),
      ]);
      const dispatcher = new ExternalNotificationDispatcher(repo, slack, teams);

      const result = await dispatcher.broadcast(PROJECT_ID, "post.retraction_pending", PAYLOAD, {
        toEveryActiveConfig: true,
      });

      assert.ok(result.ok);
      assert.strictEqual(result.value.sent, 2);
      assert.strictEqual(slack.send.mock.calls.length, 2);
      expect(repo.findActiveByProjectAndEvent).not.toHaveBeenCalled();
    });

    it("skips a DEACTIVATED config — deactivating it is the only off switch", async () => {
      const repo = makeConfigRepo([
        makeConfig("cfg-off", false, []),
        makeConfig("cfg-on", true, []),
      ]);
      const dispatcher = new ExternalNotificationDispatcher(repo, slack, teams);

      const result = await dispatcher.broadcast(PROJECT_ID, "post.retraction_pending", PAYLOAD, {
        toEveryActiveConfig: true,
      });

      assert.ok(result.ok);
      assert.strictEqual(result.value.sent, 1);
      assert.strictEqual(slack.send.mock.calls[0]?.[0], "https://hooks.example.test/cfg-on");
    });

    it("routes each config to its own channel adapter", async () => {
      const repo = makeConfigRepo([
        makeConfig("cfg-slack", true, [], "slack"),
        makeConfig("cfg-teams", true, [], "teams"),
      ]);
      const dispatcher = new ExternalNotificationDispatcher(repo, slack, teams);

      await dispatcher.broadcast(PROJECT_ID, "post.retraction_pending", PAYLOAD, {
        toEveryActiveConfig: true,
      });

      expect(slack.send).toHaveBeenCalledOnce();
      expect(teams.send).toHaveBeenCalledOnce();
    });

    it("counts a failed destination without suppressing its siblings", async () => {
      const failing = makeAdapter("fail");
      const repo = makeConfigRepo([
        makeConfig("cfg-slack", true, [], "slack"),
        makeConfig("cfg-teams", true, [], "teams"),
      ]);
      const dispatcher = new ExternalNotificationDispatcher(repo, failing, teams);

      const result = await dispatcher.broadcast(PROJECT_ID, "post.retraction_pending", PAYLOAD, {
        toEveryActiveConfig: true,
      });

      assert.ok(result.ok);
      assert.strictEqual(result.value.sent, 1);
      assert.strictEqual(result.value.failed, 1);
      expect(teams.send).toHaveBeenCalledOnce();
    });

    it("propagates a repository failure instead of reporting a silent zero", async () => {
      const repo = {
        findByProjectId: vi.fn(async () => ({
          ok: false as const,
          error: new Error("read failed"),
        })),
        findActiveByProjectAndEvent: vi.fn(),
      } as unknown as ExternalNotificationConfigRepository;
      const dispatcher = new ExternalNotificationDispatcher(repo, slack, teams);

      const result = await dispatcher.broadcast(PROJECT_ID, "post.retraction_pending", PAYLOAD, {
        toEveryActiveConfig: true,
      });

      assert.ok(!result.ok);
      expect(slack.send).not.toHaveBeenCalled();
    });
  });
});
