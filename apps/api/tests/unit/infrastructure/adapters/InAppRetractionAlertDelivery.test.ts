/**
 * @file InAppRetractionAlertDelivery.test.ts
 * @description Unit tests for the dashboard medium of the urgent retraction alert.
 *   The adapter is a thin seam over machinery that already existed, so what is pinned
 *   here is the WIRING: the notification row is created for the right recipient, it is
 *   pushed live to that recipient, and its id comes back — the ledger needs that id, or
 *   resolving the alert later has to guess which notifications it created.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { InAppRetractionAlertDelivery } from "../../../../src/infrastructure/adapters/InAppRetractionAlertDelivery.js";
import { ALERT_MEDIA, ALERT_MEDIUM_KINDS } from "@ports/core";
import { ok } from "@shared/types";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import client from "prom-client";
import { ALERT, TARGET } from "./retractionAlertFixtures.js";

describe("InAppRetractionAlertDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.register.getSingleMetric("retraction_alert_realtime_push_failed_total")?.reset();
  });

  it("declares itself a per-member medium", () => {
    const adapter = new InAppRetractionAlertDelivery(
      { execute: vi.fn() } as never,
      { broadcast: vi.fn() } as never
    );

    assert.strictEqual(adapter.medium, ALERT_MEDIA.IN_APP);
    assert.strictEqual(adapter.kind, ALERT_MEDIUM_KINDS.PER_MEMBER);
  });

  it("creates the notification, broadcasts it, and returns its id for the ledger", async () => {
    const create = { execute: vi.fn(async () => ok({ id: "n-1" })) };
    const broadcaster = { broadcast: vi.fn(async () => undefined) };
    const adapter = new InAppRetractionAlertDelivery(create as never, broadcaster as never);

    const result = await adapter.deliver(ALERT, [TARGET]);

    assert.ok(result.ok);
    assert.strictEqual(result.value.notificationId, "n-1");
    const created = create.execute.mock.calls[0]?.[0] as { recipientId: string; type: string };
    assert.strictEqual(created.recipientId, TARGET.id);
    assert.strictEqual(created.type, "PUBLICATION_RETRACTION_PENDING");
    expect(broadcaster.broadcast).toHaveBeenCalledOnce();
    assert.strictEqual(broadcaster.broadcast.mock.calls[0]?.[1], TARGET.id);
  });

  it("returns NO notification id when the recipient's own preference skipped the row", async () => {
    const create = { execute: vi.fn(async () => ok({ id: "" })) };
    const broadcaster = { broadcast: vi.fn(async () => undefined) };
    const adapter = new InAppRetractionAlertDelivery(create as never, broadcaster as never);

    const result = await adapter.deliver(ALERT, [TARGET]);

    assert.ok(result.ok);
    assert.strictEqual(result.value.notificationId, undefined);
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
  });

  it("SAYS the target was suppressed when the notification use case skipped its row", async () => {
    // Without this the caller reads a bare `ok` as a delivery: it reports DELIVERED and
    // keeps the claim while no notification exists anywhere — a member who never got
    // the alert, counted as reached, and never retried.
    const create = { execute: vi.fn(async () => ok({ id: "" })) };
    const broadcaster = { broadcast: vi.fn(async () => undefined) };
    const adapter = new InAppRetractionAlertDelivery(create as never, broadcaster as never);

    const result = await adapter.deliver(ALERT, [TARGET]);

    assert.ok(result.ok);
    assert.deepStrictEqual(
      result.value.suppressedTargets?.map((suppression) => suppression.targetId),
      [TARGET.id],
      "a row nothing was written for was reported as a delivery"
    );
    assert.match(result.value.suppressedTargets?.[0]?.reason ?? "", /preference/i);
  });

  it("suppresses NOTHING when the row was written", async () => {
    const create = { execute: vi.fn(async () => ok({ id: "n-1" })) };
    const broadcaster = { broadcast: vi.fn(async () => undefined) };
    const adapter = new InAppRetractionAlertDelivery(create as never, broadcaster as never);

    const result = await adapter.deliver(ALERT, [TARGET]);

    assert.ok(result.ok);
    assert.deepStrictEqual(result.value.suppressedTargets ?? [], []);
  });

  it("reports the use case's failure instead of throwing", async () => {
    const create = {
      execute: vi.fn(async () => ({
        ok: false as const,
        error: new UseCaseError("boom", USE_CASE_ERRORS.INTERNAL_ERROR),
      })),
    };
    const adapter = new InAppRetractionAlertDelivery(
      create as never,
      {
        broadcast: vi.fn(),
      } as never
    );

    const result = await adapter.deliver(ALERT, [TARGET]);

    assert.ok(!result.ok);
    assert.match(result.error, /boom/);
  });

  describe("the stored notification IS the delivery; the live push is an accelerator", () => {
    it("still reports the alert delivered when the realtime push fails", async () => {
      const create = { execute: vi.fn(async () => ok({ id: "n-1" })) };
      const broadcaster = {
        broadcast: vi.fn(async () => {
          throw new Error("redis is down");
        }),
      };
      const adapter = new InAppRetractionAlertDelivery(create as never, broadcaster as never);

      const result = await adapter.deliver(ALERT, [TARGET]);

      assert.ok(
        result.ok,
        "a failed push released the ledger claim, so the redelivery will create a SECOND row"
      );
      assert.strictEqual(result.value.notificationId, "n-1");
      assert.deepStrictEqual(result.value.failedTargets ?? [], []);
    });

    it("COUNTS the degraded push instead of letting it pass unobserved", async () => {
      const create = { execute: vi.fn(async () => ok({ id: "n-1" })) };
      const broadcaster = {
        broadcast: vi.fn(async () => {
          throw new Error("redis is down");
        }),
      };
      const adapter = new InAppRetractionAlertDelivery(create as never, broadcaster as never);

      await adapter.deliver(ALERT, [TARGET]);

      const metric = client.register.getSingleMetric("retraction_alert_realtime_push_failed_total");
      assert.ok(metric, "retraction_alert_realtime_push_failed_total is not registered");
      const [series] = (await metric.get()).values;
      assert.strictEqual(series?.value, 1);
    });

    it("counts nothing when the push succeeded", async () => {
      const create = { execute: vi.fn(async () => ok({ id: "n-1" })) };
      const broadcaster = { broadcast: vi.fn(async () => undefined) };
      const adapter = new InAppRetractionAlertDelivery(create as never, broadcaster as never);

      await adapter.deliver(ALERT, [TARGET]);

      const metric = client.register.getSingleMetric("retraction_alert_realtime_push_failed_total");
      const [series] = (await metric!.get()).values;
      assert.strictEqual(series?.value ?? 0, 0);
    });
  });

  it("succeeds without work when handed no target", async () => {
    const create = { execute: vi.fn() };
    const adapter = new InAppRetractionAlertDelivery(
      create as never,
      {
        broadcast: vi.fn(),
      } as never
    );

    const result = await adapter.deliver(ALERT, []);

    assert.ok(result.ok);
    expect(create.execute).not.toHaveBeenCalled();
  });
});
