/**
 * @file PrismaRetractionAlertDeliveryLedger.test.ts
 * @description Unit tests for the delivery ledger adapter. The load-bearing behaviour
 *   is one line: a unique-constraint violation on the claim is NOT an error, it is the
 *   answer "somebody already delivered this". Getting that wrong in either direction
 *   is a real defect — throwing would abort a redelivered event mid-fan-out, and
 *   swallowing every error would report a claim on a write that never landed.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { PrismaRetractionAlertDeliveryLedger } from "../../../../src/infrastructure/repositories/PrismaRetractionAlertDeliveryLedger.js";
import { ALERT_MEDIA } from "@core/domain/value-objects/AlertMedium.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALERT_KEY = "alert-key-1";

const uniqueViolation = (): Error => {
  const error = new Error("Unique constraint failed") as Error & {
    code: string;
    meta: { target: string[] };
  };
  error.code = "P2002";
  error.meta = { target: ["alertKey", "medium", "target"] };
  return error;
};

function makePrisma(overrides?: Record<string, unknown>) {
  return {
    retractionAlertDelivery: {
      create: vi.fn(async () => ({ id: "row-1" })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PrismaRetractionAlertDeliveryLedger", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("claim", () => {
    it("claims by INSERT and reports ownership of the delivery", async () => {
      const prisma = makePrisma();
      const ledger = new PrismaRetractionAlertDeliveryLedger(prisma as never);

      const result = await ledger.claim({
        alertKey: ALERT_KEY,
        medium: ALERT_MEDIA.IN_APP,
        target: "member-1",
      });

      assert.deepStrictEqual(result, { claimed: true });
      const data = prisma.retractionAlertDelivery.create.mock.calls[0]?.[0] as {
        data: { alertKey: string; medium: string; target: string };
      };
      assert.strictEqual(data.data.alertKey, ALERT_KEY);
      assert.strictEqual(data.data.medium, "IN_APP");
      assert.strictEqual(data.data.target, "member-1");
    });

    it("returns claimed:false on a unique violation rather than throwing", async () => {
      const prisma = makePrisma({
        create: vi.fn(async () => {
          throw uniqueViolation();
        }),
      });
      const ledger = new PrismaRetractionAlertDeliveryLedger(prisma as never);

      const result = await ledger.claim({
        alertKey: ALERT_KEY,
        medium: ALERT_MEDIA.EMAIL,
        target: "member-1",
      });

      assert.deepStrictEqual(result, { claimed: false });
    });

    it("rethrows any OTHER failure — a claim reported over a write that never landed would lose the alert", async () => {
      const prisma = makePrisma({
        create: vi.fn(async () => {
          throw new Error("connection reset");
        }),
      });
      const ledger = new PrismaRetractionAlertDeliveryLedger(prisma as never);

      await assert.rejects(
        () =>
          ledger.claim({
            alertKey: ALERT_KEY,
            medium: ALERT_MEDIA.EMAIL,
            target: "member-1",
          }),
        /connection reset/
      );
    });

    it("maps every medium of the union onto its stored spelling", async () => {
      const prisma = makePrisma();
      const ledger = new PrismaRetractionAlertDeliveryLedger(prisma as never);

      await ledger.claim({
        alertKey: ALERT_KEY,
        medium: ALERT_MEDIA.SLACK_TEAMS,
        target: "cfg-a",
      });

      const data = prisma.retractionAlertDelivery.create.mock.calls[0]?.[0] as {
        data: { medium: string };
      };
      assert.strictEqual(data.data.medium, "SLACK_TEAMS");
    });
  });

  describe("attachNotification", () => {
    it("completes the claimed row without creating a second one", async () => {
      const prisma = makePrisma();
      const ledger = new PrismaRetractionAlertDeliveryLedger(prisma as never);

      await ledger.attachNotification({
        alertKey: ALERT_KEY,
        target: "member-1",
        notificationId: "n-1",
      });

      expect(prisma.retractionAlertDelivery.create).not.toHaveBeenCalled();
      const call = prisma.retractionAlertDelivery.updateMany.mock.calls[0]?.[0] as {
        where: { alertKey: string; target: string; medium: string };
        data: { notificationId: string };
      };
      assert.strictEqual(call.where.alertKey, ALERT_KEY);
      assert.strictEqual(call.where.target, "member-1");
      assert.strictEqual(call.where.medium, "IN_APP");
      assert.strictEqual(call.data.notificationId, "n-1");
    });
  });

  describe("listByAlertKey", () => {
    it("returns the claimed targets with the notifications they produced", async () => {
      const prisma = makePrisma({
        findMany: vi.fn(async () => [
          { target: "member-1", notificationId: "n-1" },
          { target: "member-2", notificationId: null },
        ]),
      });
      const ledger = new PrismaRetractionAlertDeliveryLedger(prisma as never);

      const rows = await ledger.listByAlertKey(ALERT_KEY, ALERT_MEDIA.IN_APP);

      assert.deepStrictEqual(rows, [
        { target: "member-1", notificationId: "n-1" },
        { target: "member-2" },
      ]);
    });
  });

  describe("deleteByAlertKey", () => {
    it("removes every row of the alert and does not mind an empty result", async () => {
      const prisma = makePrisma();
      const ledger = new PrismaRetractionAlertDeliveryLedger(prisma as never);

      await ledger.deleteByAlertKey(ALERT_KEY);

      const call = prisma.retractionAlertDelivery.deleteMany.mock.calls[0]?.[0] as {
        where: { alertKey: string };
      };
      assert.strictEqual(call.where.alertKey, ALERT_KEY);
    });
  });
});
