/**
 * @file SlackTeamsRetractionAlertDelivery.test.ts
 * @description Unit tests for the shared-destination medium of the urgent retraction
 *   alert. Three things are pinned because each is the opposite of the per-member rule:
 *   the fan-out reaches the destinations the CALLER CLAIMED and no others (a retry that
 *   re-queried every active config would tell the already-notified channels a second
 *   time), the config's events filter never gates it (the filter predates this event
 *   name, so honouring it would make the alert invisible on every destination that
 *   exists today), and every claimed destination gets its own outcome so the caller can
 *   release exactly the claims nothing reached.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { SlackTeamsRetractionAlertDelivery } from "../../../../src/infrastructure/adapters/SlackTeamsRetractionAlertDelivery.js";
import { ALERT_MEDIA, ALERT_MEDIUM_KINDS } from "@ports/core";
import { ok } from "@shared/types";
import { ALERT } from "./retractionAlertFixtures.js";

/** What the webhook said when it refused — the dispatcher knows this, and it must travel. */
const REFUSAL_REASON = "403 invalid_token";

/** A fan-out double that reaches exactly the configs it was told to, minus any refusals. */
const makeNotifier = (refusing: readonly string[] = [], missing: readonly string[] = []) => ({
  broadcast: vi.fn(
    async (
      _projectId: string,
      _event: string,
      _payload: unknown,
      options?: { toConfigIds: readonly string[] }
    ) => {
      const asked = options?.toConfigIds ?? [];
      return ok({
        sentConfigIds: asked.filter((id) => !refusing.includes(id) && !missing.includes(id)),
        failedConfigs: asked
          .filter((id) => refusing.includes(id))
          .map((id) => ({ id, reason: REFUSAL_REASON })),
      });
    }
  ),
});

const optionsOf = (notifier: ReturnType<typeof makeNotifier>, call = 0) =>
  notifier.broadcast.mock.calls[call]?.[3] as { toConfigIds: readonly string[] } | undefined;

describe("SlackTeamsRetractionAlertDelivery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("declares itself a shared destination", () => {
    const adapter = new SlackTeamsRetractionAlertDelivery({ broadcast: vi.fn() } as never);

    assert.strictEqual(adapter.medium, ALERT_MEDIA.SLACK_TEAMS);
    assert.strictEqual(adapter.kind, ALERT_MEDIUM_KINDS.SHARED);
  });

  it("fans out to exactly the CLAIMED destinations, not to every active config", async () => {
    const notifier = makeNotifier();
    const adapter = new SlackTeamsRetractionAlertDelivery(notifier as never);

    const result = await adapter.deliver(ALERT, [{ id: "cfg-b" }]);

    assert.ok(result.ok);
    assert.deepStrictEqual(
      optionsOf(notifier)?.toConfigIds,
      ["cfg-b"],
      "the fan-out was not scoped to the claimed destination, so a retry re-sends to its siblings"
    );
    const [projectId, event, payload] = notifier.broadcast.mock.calls[0] as [
      string,
      string,
      { title: string; metadata?: Record<string, string> },
    ];
    assert.strictEqual(projectId, ALERT.projectId);
    assert.strictEqual(event, "post.retraction_pending");
    assert.strictEqual(payload.title, ALERT.title);
  });

  it("calls the fan-out ONCE for all destinations, not once per destination", async () => {
    const notifier = makeNotifier();
    const adapter = new SlackTeamsRetractionAlertDelivery(notifier as never);

    await adapter.deliver(ALERT, [{ id: "cfg-a" }, { id: "cfg-b" }]);

    expect(notifier.broadcast).toHaveBeenCalledOnce();
    assert.deepStrictEqual(optionsOf(notifier)?.toConfigIds, ["cfg-a", "cfg-b"]);
  });

  it("carries identities in metadata and no webhook url", async () => {
    const notifier = makeNotifier();
    const adapter = new SlackTeamsRetractionAlertDelivery(notifier as never);

    await adapter.deliver(ALERT, [{ id: "cfg-a" }]);

    const payload = notifier.broadcast.mock.calls[0]?.[2] as { metadata?: Record<string, string> };
    assert.strictEqual(payload.metadata?.postId, ALERT.postId);
    assert.strictEqual(payload.metadata?.channelId, ALERT.channelId);
    assert.ok(!JSON.stringify(payload).toLowerCase().includes("webhook"));
  });

  it("reports failure when every destination refused", async () => {
    const notifier = makeNotifier(["cfg-a", "cfg-b"]);
    const adapter = new SlackTeamsRetractionAlertDelivery(notifier as never);

    const result = await adapter.deliver(ALERT, [{ id: "cfg-a" }, { id: "cfg-b" }]);

    assert.ok(!result.ok);
    assert.match(result.error, /2/);
  });

  it("succeeds when at least one destination took it", async () => {
    const notifier = makeNotifier(["cfg-b"]);
    const adapter = new SlackTeamsRetractionAlertDelivery(notifier as never);

    const result = await adapter.deliver(ALERT, [{ id: "cfg-a" }, { id: "cfg-b" }]);

    assert.ok(result.ok);
  });

  it("NAMES the destination a partial fan-out could not reach", async () => {
    const notifier = makeNotifier(["cfg-b"]);
    const adapter = new SlackTeamsRetractionAlertDelivery(notifier as never);

    const result = await adapter.deliver(ALERT, [{ id: "cfg-a" }, { id: "cfg-b" }]);

    assert.ok(result.ok);
    assert.deepStrictEqual(
      result.value.failedTargets?.map((failure) => failure.targetId),
      ["cfg-b"],
      "a refused destination was reported as reached, so its ledger claim stands forever"
    );
  });

  it("carries the dispatcher's OWN reason for a destination that refused", async () => {
    const notifier = makeNotifier(["cfg-b"]);
    const adapter = new SlackTeamsRetractionAlertDelivery(notifier as never);

    const result = await adapter.deliver(ALERT, [{ id: "cfg-a" }, { id: "cfg-b" }]);

    assert.ok(result.ok);
    assert.strictEqual(
      result.value.failedTargets?.[0]?.reason,
      REFUSAL_REASON,
      "the webhook said why it refused, the dispatcher knew, and the alert report replaced it with a generic sentence — so the operator WARN cannot tell a revoked token from an outage"
    );
  });

  it("names NO failed target when every destination took it", async () => {
    const notifier = makeNotifier();
    const adapter = new SlackTeamsRetractionAlertDelivery(notifier as never);

    const result = await adapter.deliver(ALERT, [{ id: "cfg-a" }, { id: "cfg-b" }]);

    assert.ok(result.ok);
    assert.deepStrictEqual(result.value.failedTargets ?? [], []);
  });

  it("names a destination DEACTIVATED between the claim and the send as unreached", async () => {
    // Not a refusal — the fan-out never attempted it, because it stopped being an
    // active config after the caller claimed it. Unreached either way, so its claim
    // must come back rather than standing for an alert nobody received.
    const notifier = makeNotifier([], ["cfg-b"]);
    const adapter = new SlackTeamsRetractionAlertDelivery(notifier as never);

    const result = await adapter.deliver(ALERT, [{ id: "cfg-a" }, { id: "cfg-b" }]);

    assert.ok(result.ok);
    assert.deepStrictEqual(
      result.value.failedTargets?.map((failure) => failure.targetId),
      ["cfg-b"],
      "a destination that silently stopped being a destination was counted as delivered"
    );
    assert.match(
      result.value.failedTargets?.[0]?.reason ?? "",
      /active/i,
      "the reason does not say the destination is no longer active"
    );
  });

  it("does not call the fan-out when nothing was claimed", async () => {
    const notifier = makeNotifier();
    const adapter = new SlackTeamsRetractionAlertDelivery(notifier as never);

    const result = await adapter.deliver(ALERT, []);

    assert.ok(result.ok);
    expect(notifier.broadcast).not.toHaveBeenCalled();
  });
});
