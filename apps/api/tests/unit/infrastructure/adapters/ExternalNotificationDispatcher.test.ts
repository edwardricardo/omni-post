/**
 * @file ExternalNotificationDispatcher.test.ts
 * @description Unit tests for the promoted `broadcast` on ExternalNotifierPort. The
 *   method existed on the dispatcher CLASS before; promoting it to the port is what
 *   lets a caller fan out to a project's destinations without importing an
 *   infrastructure class, and the `toConfigIds` option is what lets one caller reach
 *   configs whose `events` filter predates the event being announced.
 *
 *   Both branches are pinned here because they are opposites: the default keeps the
 *   filter (every existing caller depends on it), and naming destinations deliberately
 *   ignores it (an alert nobody's filter names would otherwise be invisible on every
 *   config that exists today).
 *
 *   `toConfigIds` is a LIST rather than a "reach everything" flag, and that is the
 *   property with teeth: a caller holding a per-destination claim retries the ONE
 *   destination a previous run missed, so the channels that already got the alert are
 *   not told a second time. The report names both sides for the same reason — a count
 *   cannot say which claim to release.
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
      assert.deepStrictEqual(result.value.sentConfigIds, ["cfg-named"]);
      expect(slack.send).toHaveBeenCalledOnce();
      expect(repo.findActiveByProjectAndEvent).toHaveBeenCalledOnce();
    });
  });

  describe("toConfigIds — the caller NAMES the destinations, and gets each one's outcome", () => {
    it("reaches only the named configs, leaving an active sibling alone", async () => {
      const repo = makeConfigRepo([
        makeConfig("cfg-a", true, ["post.published"]),
        makeConfig("cfg-b", true, []),
      ]);
      const dispatcher = new ExternalNotificationDispatcher(repo, slack, teams);

      const result = await dispatcher.broadcast(PROJECT_ID, "post.retraction_pending", PAYLOAD, {
        toConfigIds: ["cfg-b"],
      });

      assert.ok(result.ok);
      assert.deepStrictEqual(
        result.value.sentConfigIds,
        ["cfg-b"],
        "a caller retrying ONE destination reached its siblings too, telling them twice"
      );
      assert.strictEqual(slack.send.mock.calls.length, 1);
      assert.strictEqual(slack.send.mock.calls[0]?.[0], "https://hooks.example.test/cfg-b");
      expect(repo.findActiveByProjectAndEvent).not.toHaveBeenCalled();
    });

    it("reaches every named config even when no filter names the event", async () => {
      const repo = makeConfigRepo([
        makeConfig("cfg-a", true, ["post.published"]),
        makeConfig("cfg-b", true, []),
      ]);
      const dispatcher = new ExternalNotificationDispatcher(repo, slack, teams);

      const result = await dispatcher.broadcast(PROJECT_ID, "post.retraction_pending", PAYLOAD, {
        toConfigIds: ["cfg-a", "cfg-b"],
      });

      assert.ok(result.ok);
      assert.deepStrictEqual(result.value.sentConfigIds, ["cfg-a", "cfg-b"]);
      assert.strictEqual(slack.send.mock.calls.length, 2);
    });

    it("skips a DEACTIVATED config even when the caller named it — deactivating is the only off switch", async () => {
      const repo = makeConfigRepo([
        makeConfig("cfg-off", false, []),
        makeConfig("cfg-on", true, []),
      ]);
      const dispatcher = new ExternalNotificationDispatcher(repo, slack, teams);

      const result = await dispatcher.broadcast(PROJECT_ID, "post.retraction_pending", PAYLOAD, {
        toConfigIds: ["cfg-off", "cfg-on"],
      });

      assert.ok(result.ok);
      assert.deepStrictEqual(result.value.sentConfigIds, ["cfg-on"]);
      assert.deepStrictEqual(
        result.value.failedConfigIds,
        [],
        "a deactivated config did not refuse anything — it was never a destination"
      );
      assert.strictEqual(slack.send.mock.calls[0]?.[0], "https://hooks.example.test/cfg-on");
    });

    it("routes each config to its own channel adapter", async () => {
      const repo = makeConfigRepo([
        makeConfig("cfg-slack", true, [], "slack"),
        makeConfig("cfg-teams", true, [], "teams"),
      ]);
      const dispatcher = new ExternalNotificationDispatcher(repo, slack, teams);

      await dispatcher.broadcast(PROJECT_ID, "post.retraction_pending", PAYLOAD, {
        toConfigIds: ["cfg-slack", "cfg-teams"],
      });

      expect(slack.send).toHaveBeenCalledOnce();
      expect(teams.send).toHaveBeenCalledOnce();
    });

    it("NAMES both sides — what was reached and what refused", async () => {
      const failing = makeAdapter("fail");
      const repo = makeConfigRepo([
        makeConfig("cfg-slack", true, [], "slack"),
        makeConfig("cfg-teams", true, [], "teams"),
      ]);
      const dispatcher = new ExternalNotificationDispatcher(repo, failing, teams);

      const result = await dispatcher.broadcast(PROJECT_ID, "post.retraction_pending", PAYLOAD, {
        toConfigIds: ["cfg-slack", "cfg-teams"],
      });

      assert.ok(result.ok);
      assert.deepStrictEqual(result.value.sentConfigIds, ["cfg-teams"]);
      assert.deepStrictEqual(
        result.value.failedConfigIds,
        ["cfg-slack"],
        "a count alone cannot tell a caller which destination to retry"
      );
      expect(teams.send).toHaveBeenCalledOnce();
    });

    it("names nothing as failed when every destination took it", async () => {
      const repo = makeConfigRepo([makeConfig("cfg-slack", true, [], "slack")]);
      const dispatcher = new ExternalNotificationDispatcher(repo, slack, teams);

      const result = await dispatcher.broadcast(PROJECT_ID, "post.retraction_pending", PAYLOAD, {
        toConfigIds: ["cfg-slack"],
      });

      assert.ok(result.ok);
      assert.deepStrictEqual(result.value.failedConfigIds, []);
      assert.deepStrictEqual(result.value.sentConfigIds, ["cfg-slack"]);
    });

    it("reports a config that no longer exists as neither sent nor failed", async () => {
      const repo = makeConfigRepo([makeConfig("cfg-slack", true, [], "slack")]);
      const dispatcher = new ExternalNotificationDispatcher(repo, slack, teams);

      const result = await dispatcher.broadcast(PROJECT_ID, "post.retraction_pending", PAYLOAD, {
        toConfigIds: ["cfg-slack", "cfg-deleted"],
      });

      assert.ok(result.ok);
      assert.deepStrictEqual(result.value.sentConfigIds, ["cfg-slack"]);
      assert.deepStrictEqual(result.value.failedConfigIds, []);
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
        toConfigIds: ["cfg-a"],
      });

      assert.ok(!result.ok);
      expect(slack.send).not.toHaveBeenCalled();
    });
  });
});
