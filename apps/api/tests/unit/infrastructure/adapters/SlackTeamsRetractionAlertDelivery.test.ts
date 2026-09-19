/**
 * @file SlackTeamsRetractionAlertDelivery.test.ts
 * @description Unit tests for the shared-destination medium of the urgent retraction
 *   alert. Two things are pinned because they are the opposite of the per-member rule:
 *   the fan-out asks for EVERY active config (the config's events filter predates this
 *   event name, so honouring it would make the alert invisible on every destination
 *   that exists today), and it is called ONCE for all destinations rather than once per
 *   destination, which would multiply the message.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { SlackTeamsRetractionAlertDelivery } from "../../../../src/infrastructure/adapters/SlackTeamsRetractionAlertDelivery.js";
import { ALERT_MEDIA, ALERT_MEDIUM_KINDS } from "@ports/core";
import { ok } from "@shared/types";
import { ALERT } from "./retractionAlertFixtures.js";

describe("SlackTeamsRetractionAlertDelivery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("declares itself a shared destination", () => {
    const adapter = new SlackTeamsRetractionAlertDelivery({ broadcast: vi.fn() } as never);

    assert.strictEqual(adapter.medium, ALERT_MEDIA.SLACK_TEAMS);
    assert.strictEqual(adapter.kind, ALERT_MEDIUM_KINDS.SHARED);
  });

  it("fans out to EVERY active config, bypassing the events filter", async () => {
    const notifier = { broadcast: vi.fn(async () => ok({ sent: 2, failed: 0 })) };
    const adapter = new SlackTeamsRetractionAlertDelivery(notifier as never);

    const result = await adapter.deliver(ALERT, [{ id: "cfg-a" }, { id: "cfg-b" }]);

    assert.ok(result.ok);
    const [projectId, event, payload, options] = notifier.broadcast.mock.calls[0] as [
      string,
      string,
      { title: string; metadata?: Record<string, string> },
      { toEveryActiveConfig: boolean },
    ];
    assert.strictEqual(projectId, ALERT.projectId);
    assert.strictEqual(event, "post.retraction_pending");
    assert.strictEqual(payload.title, ALERT.title);
    assert.strictEqual(options.toEveryActiveConfig, true);
  });

  it("calls the fan-out ONCE for all destinations, not once per destination", async () => {
    const notifier = { broadcast: vi.fn(async () => ok({ sent: 2, failed: 0 })) };
    const adapter = new SlackTeamsRetractionAlertDelivery(notifier as never);

    await adapter.deliver(ALERT, [{ id: "cfg-a" }, { id: "cfg-b" }]);

    expect(notifier.broadcast).toHaveBeenCalledOnce();
  });

  it("carries identities in metadata and no webhook url", async () => {
    const notifier = { broadcast: vi.fn(async () => ok({ sent: 1, failed: 0 })) };
    const adapter = new SlackTeamsRetractionAlertDelivery(notifier as never);

    await adapter.deliver(ALERT, [{ id: "cfg-a" }]);

    const payload = notifier.broadcast.mock.calls[0]?.[2] as { metadata?: Record<string, string> };
    assert.strictEqual(payload.metadata?.postId, ALERT.postId);
    assert.strictEqual(payload.metadata?.channelId, ALERT.channelId);
    assert.ok(!JSON.stringify(payload).toLowerCase().includes("webhook"));
  });

  it("reports failure when every destination refused", async () => {
    const notifier = { broadcast: vi.fn(async () => ok({ sent: 0, failed: 2 })) };
    const adapter = new SlackTeamsRetractionAlertDelivery(notifier as never);

    const result = await adapter.deliver(ALERT, [{ id: "cfg-a" }, { id: "cfg-b" }]);

    assert.ok(!result.ok);
    assert.match(result.error, /2/);
  });

  it("succeeds when at least one destination took it", async () => {
    const notifier = { broadcast: vi.fn(async () => ok({ sent: 1, failed: 1 })) };
    const adapter = new SlackTeamsRetractionAlertDelivery(notifier as never);

    const result = await adapter.deliver(ALERT, [{ id: "cfg-a" }, { id: "cfg-b" }]);

    assert.ok(result.ok);
  });

  it("does not call the fan-out when nothing was claimed", async () => {
    const notifier = { broadcast: vi.fn(async () => ok({ sent: 0, failed: 0 })) };
    const adapter = new SlackTeamsRetractionAlertDelivery(notifier as never);

    const result = await adapter.deliver(ALERT, []);

    assert.ok(result.ok);
    expect(notifier.broadcast).not.toHaveBeenCalled();
  });
});
