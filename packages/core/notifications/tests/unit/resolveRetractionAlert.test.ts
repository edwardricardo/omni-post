/**
 * @file resolveRetractionAlert.test.ts
 * @description Unit tests for ResolveRetractionAlertUseCase. The behaviour worth
 *   pinning is EXACTNESS: it deletes the notifications the ledger names and only
 *   those, because membership drifts between a raise and its resolution, and a query
 *   by recipient would delete somebody else's alert or miss a departed member's.
 *
 *   HONEST NOTE ON ORDER: this suite was written AFTER its production code, which the
 *   raise use case takes as a constructor dependency and therefore had to exist for
 *   that use case's own RED to compile. The apply ledger records it as test-after
 *   rather than claiming a RED that never happened.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ResolveRetractionAlertUseCase } from "../../src/ResolveRetractionAlertUseCase.js";
import type {
  RetractionAlertDeliveryLedger,
  RetractionAlertDeliveryRow,
} from "@core/domain/repositories/RetractionAlertDeliveryLedger.js";
import type { NotificationRepository } from "@core/domain/repositories/NotificationRepository.js";
import { ALERT_MEDIA } from "@core/domain/value-objects/AlertMedium.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A readable synthetic key: the use case treats it as opaque, and a hex digest
// literal here reads as a leaked credential to the secret scanners.
const ALERT_KEY = "alert-key:post-b1000000:channel-c1000000:episode-1";

let order: string[] = [];

function makeLedger(rows: RetractionAlertDeliveryRow[]): RetractionAlertDeliveryLedger {
  const remaining = new Map<string, RetractionAlertDeliveryRow[]>([[ALERT_KEY, [...rows]]]);
  return {
    claim: vi.fn(async () => ({ claimed: true })),
    attachNotification: vi.fn(async () => undefined),
    listByAlertKey: vi.fn(async (alertKey: string) => {
      order.push(`list:${alertKey}`);
      return remaining.get(alertKey) ?? [];
    }),
    deleteByAlertKey: vi.fn(async (alertKey: string) => {
      order.push(`deleteRows:${alertKey}`);
      remaining.set(alertKey, []);
    }),
  } as unknown as RetractionAlertDeliveryLedger;
}

function makeNotificationRepo(): NotificationRepository {
  return {
    delete: vi.fn(async (id: string) => {
      order.push(`deleteNotification:${id}`);
    }),
  } as unknown as NotificationRepository;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ResolveRetractionAlertUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    order = [];
  });

  it("deletes exactly the notifications the ledger names", async () => {
    const ledger = makeLedger([
      { target: "member-1", notificationId: "n-1" },
      { target: "member-2", notificationId: "n-2" },
    ]);
    const notifications = makeNotificationRepo();
    const useCase = new ResolveRetractionAlertUseCase(ledger, notifications);

    const result = await useCase.execute({ alertKey: ALERT_KEY, cause: "MANUALLY_REMOVED" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.deletedNotifications, 2);
    assert.ok(order.includes("deleteNotification:n-1"));
    assert.ok(order.includes("deleteNotification:n-2"));
    assert.strictEqual(
      order.filter((o) => o.startsWith("deleteNotification:")).length,
      2,
      "it deleted something the ledger did not name"
    );
  });

  it("reads only the in-app rows — the other media have nothing to unsend", async () => {
    const ledger = makeLedger([{ target: "member-1", notificationId: "n-1" }]);
    const useCase = new ResolveRetractionAlertUseCase(ledger, makeNotificationRepo());

    await useCase.execute({ alertKey: ALERT_KEY });

    assert.deepStrictEqual(vi.mocked(ledger.listByAlertKey).mock.calls, [
      [ALERT_KEY, ALERT_MEDIA.IN_APP],
    ]);
  });

  it("drops the ledger rows AFTER the notifications, so a crash re-tries instead of stranding", async () => {
    const ledger = makeLedger([{ target: "member-1", notificationId: "n-1" }]);
    const useCase = new ResolveRetractionAlertUseCase(ledger, makeNotificationRepo());

    await useCase.execute({ alertKey: ALERT_KEY });

    assert.ok(
      order.indexOf("deleteNotification:n-1") < order.indexOf(`deleteRows:${ALERT_KEY}`),
      `wrong order: ${order.join(" | ")}`
    );
  });

  it("skips a claimed row that never produced a notification", async () => {
    const ledger = makeLedger([{ target: "member-1", notificationId: "n-1" }, { target: "cfg-a" }]);
    const notifications = makeNotificationRepo();
    const useCase = new ResolveRetractionAlertUseCase(ledger, notifications);

    const result = await useCase.execute({ alertKey: ALERT_KEY });

    assert.ok(result.ok);
    assert.strictEqual(result.value.deletedNotifications, 1);
  });

  it("resolves an expired action window the same way as any other cause", async () => {
    const ledger = makeLedger([{ target: "member-1", notificationId: "n-1" }]);
    const useCase = new ResolveRetractionAlertUseCase(ledger, makeNotificationRepo());

    const result = await useCase.execute({
      alertKey: ALERT_KEY,
      cause: "ACTION_WINDOW_EXPIRED",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.deletedNotifications, 1);
    assert.ok(order.includes(`deleteRows:${ALERT_KEY}`));
  });

  it("is idempotent — a second resolution deletes nothing and still succeeds", async () => {
    const ledger = makeLedger([{ target: "member-1", notificationId: "n-1" }]);
    const useCase = new ResolveRetractionAlertUseCase(ledger, makeNotificationRepo());

    const first = await useCase.execute({ alertKey: ALERT_KEY });
    const second = await useCase.execute({ alertKey: ALERT_KEY });

    assert.ok(first.ok && second.ok);
    assert.strictEqual(first.value.deletedNotifications, 1);
    assert.strictEqual(second.value.deletedNotifications, 0);
    assert.strictEqual(
      order.filter((o) => o.startsWith("deleteNotification:")).length,
      1,
      "the same notification was deleted twice"
    );
  });

  it("returns an internal error instead of throwing when the store fails", async () => {
    const ledger = {
      listByAlertKey: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    } as unknown as RetractionAlertDeliveryLedger;
    const useCase = new ResolveRetractionAlertUseCase(ledger, makeNotificationRepo());

    const result = await useCase.execute({ alertKey: ALERT_KEY });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
  });
});
