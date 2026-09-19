/**
 * @file EmailRetractionAlertDelivery.test.ts
 * @description Unit tests for the email medium of the urgent retraction alert — the
 *   first production caller of the email notification service. What is pinned: the
 *   message goes to the recipient's OWN address with this alert's type, and a member
 *   with no address is reported as a failure rather than skipped in silence, because a
 *   customer who is never reached is exactly the state this alert exists to prevent.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { EmailRetractionAlertDelivery } from "../../../../src/infrastructure/adapters/EmailRetractionAlertDelivery.js";
import { ALERT_MEDIA, ALERT_MEDIUM_KINDS } from "@ports/core";
import { ALERT, TARGET } from "./retractionAlertFixtures.js";

describe("EmailRetractionAlertDelivery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("declares itself a per-member medium", () => {
    const adapter = new EmailRetractionAlertDelivery({ send: vi.fn() } as never);

    assert.strictEqual(adapter.medium, ALERT_MEDIA.EMAIL);
    assert.strictEqual(adapter.kind, ALERT_MEDIUM_KINDS.PER_MEMBER);
  });

  it("sends to the recipient's own address with the alert's type and text", async () => {
    const emails = { send: vi.fn(async () => undefined) };
    const adapter = new EmailRetractionAlertDelivery(emails as never);

    const result = await adapter.deliver(ALERT, [TARGET]);

    assert.ok(result.ok);
    const ctx = emails.send.mock.calls[0]?.[0] as {
      recipientEmail: string;
      type: string;
      accountName: string;
      title: string;
    };
    assert.strictEqual(ctx.recipientEmail, TARGET.email);
    assert.strictEqual(ctx.type, "PUBLICATION_RETRACTION_PENDING");
    assert.strictEqual(ctx.accountName, "Acme Corp");
    assert.strictEqual(ctx.title, ALERT.title);
  });

  it("refuses a target with no address rather than sending nowhere", async () => {
    const emails = { send: vi.fn(async () => undefined) };
    const adapter = new EmailRetractionAlertDelivery(emails as never);

    const result = await adapter.deliver(ALERT, [{ id: TARGET.id }]);

    assert.ok(!result.ok);
    assert.match(result.error, /address/i);
    expect(emails.send).not.toHaveBeenCalled();
  });

  it("succeeds without work when handed no target", async () => {
    const emails = { send: vi.fn(async () => undefined) };
    const adapter = new EmailRetractionAlertDelivery(emails as never);

    const result = await adapter.deliver(ALERT, []);

    assert.ok(result.ok);
    expect(emails.send).not.toHaveBeenCalled();
  });
});
