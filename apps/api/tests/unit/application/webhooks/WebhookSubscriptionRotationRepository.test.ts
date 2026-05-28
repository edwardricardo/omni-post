/**
 * @file WebhookSubscriptionRotationRepository.test.ts
 * @description Type-shape test for the rotation port. The file exports only
 *              TypeScript interfaces, so the test verifies that a minimal
 *              implementation compiles and obeys the contract at runtime
 *              (findById returns null shape, rotateSecret resolves boolean).
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type {
  WebhookSubscriptionRotationRepository,
  WebhookSubscriptionForRotation,
  RotateWebhookSecretArgs,
} from "@core/webhooks/WebhookSubscriptionRotationRepository.js";

describe("WebhookSubscriptionRotationRepository (port contract)", () => {
  it("accepts a minimal in-memory implementation that satisfies the interface", async () => {
    const store = new Map<string, WebhookSubscriptionForRotation>();
    store.set("s1", { id: "s1", secretKey: "old" });

    const impl: WebhookSubscriptionRotationRepository = {
      async findById(id) {
        return store.get(id) ?? null;
      },
      async rotateSecret(args: RotateWebhookSecretArgs) {
        const current = store.get(args.id);
        if (!current) return false;
        store.set(args.id, { id: args.id, secretKey: args.newSecretKey });
        return true;
      },
    };

    const found = await impl.findById("s1");
    assert.equal(found?.secretKey, "old");

    const missing = await impl.findById("nope");
    assert.equal(missing, null);

    const rotated = await impl.rotateSecret({
      id: "s1",
      newSecretKey: "new",
      previousSecretKey: "old",
      previousSecretKeyExpiresAt: new Date(),
    });
    assert.equal(rotated, true);
    assert.equal((await impl.findById("s1"))?.secretKey, "new");

    const failed = await impl.rotateSecret({
      id: "missing",
      newSecretKey: "x",
      previousSecretKey: "y",
      previousSecretKeyExpiresAt: new Date(),
    });
    assert.equal(failed, false);
  });
});
