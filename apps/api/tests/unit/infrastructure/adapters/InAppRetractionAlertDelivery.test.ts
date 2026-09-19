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
import { ALERT, TARGET } from "./retractionAlertFixtures.js";

describe("InAppRetractionAlertDelivery", () => {
  beforeEach(() => vi.clearAllMocks());

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
