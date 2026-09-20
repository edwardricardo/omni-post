/**
 * @file EmailRetractionAlertDelivery.test.ts
 * @description Unit tests for the email medium of the urgent retraction alert — the
 *   first production caller of the email notification service. What is pinned: the
 *   message goes to the recipient's OWN address with this alert's type, and a member
 *   with no address is reported as a failure rather than skipped in silence, because a
 *   customer who is never reached is exactly the state this alert exists to prevent.
 *
 *   The third pinned property is the one the medium cannot express without help from
 *   the service: a message the service DECLINED to send is reported as a suppression,
 *   so the caller releases the ledger claim instead of counting a customer as reached
 *   who was never written to.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { EmailRetractionAlertDelivery } from "../../../../src/infrastructure/adapters/EmailRetractionAlertDelivery.js";
import { ALERT_MEDIA, ALERT_MEDIUM_KINDS } from "@ports/core";
import { ok } from "@shared/types";
import { NotificationDeliveryError } from "@core/domain/errors/index.js";
import { EMAIL_SKIP_REASONS } from "@core/notifications/SendEmailNotificationService.js";
import { ALERT, TARGET } from "./retractionAlertFixtures.js";

/** The service's answer when the message really went out. */
const SENT = ok({ sent: true as const });

describe("EmailRetractionAlertDelivery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("declares itself a per-member medium", () => {
    const adapter = new EmailRetractionAlertDelivery({ send: vi.fn() } as never);

    assert.strictEqual(adapter.medium, ALERT_MEDIA.EMAIL);
    assert.strictEqual(adapter.kind, ALERT_MEDIUM_KINDS.PER_MEMBER);
  });

  it("sends to the recipient's own address with the alert's type and text", async () => {
    const emails = { send: vi.fn(async () => SENT) };
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
    const emails = { send: vi.fn(async () => SENT) };
    const adapter = new EmailRetractionAlertDelivery(emails as never);

    const result = await adapter.deliver(ALERT, [{ id: TARGET.id }]);

    assert.ok(!result.ok);
    assert.match(result.error, /address/i);
    expect(emails.send).not.toHaveBeenCalled();
  });

  it("succeeds without work when handed no target", async () => {
    const emails = { send: vi.fn(async () => SENT) };
    const adapter = new EmailRetractionAlertDelivery(emails as never);

    const result = await adapter.deliver(ALERT, []);

    assert.ok(result.ok);
    expect(emails.send).not.toHaveBeenCalled();
  });

  describe("a transport failure is reported, not absorbed", () => {
    it("reports FAILED when the service returns err, naming what the transport said", async () => {
      const emails = {
        send: vi.fn(async () => ({
          ok: false as const,
          error: new NotificationDeliveryError("email", "SMTP 421 service unavailable"),
        })),
      };
      const adapter = new EmailRetractionAlertDelivery(emails as never);

      const result = await adapter.deliver(ALERT, [TARGET]);

      assert.ok(!result.ok, "a mailer outage was reported as a delivered alert");
      assert.match(result.error, /SMTP 421/);
    });

    it("reports ok when the service reports ok", async () => {
      const emails = { send: vi.fn(async () => SENT) };
      const adapter = new EmailRetractionAlertDelivery(emails as never);

      const result = await adapter.deliver(ALERT, [TARGET]);

      assert.ok(result.ok);
    });
  });

  describe("a message that was never sent is not a delivery", () => {
    it("a member whose email preference is off is reported suppressed, not delivered", async () => {
      const emails = {
        send: vi.fn(async () =>
          ok({ sent: false as const, reason: EMAIL_SKIP_REASONS.SUPPRESSED_BY_PREFERENCE })
        ),
      };
      const adapter = new EmailRetractionAlertDelivery(emails as never);

      const result = await adapter.deliver(ALERT, [TARGET]);

      assert.ok(result.ok);
      assert.deepStrictEqual(
        result.value.suppressedTargets?.map((suppression) => suppression.targetId),
        [TARGET.id],
        "an email nobody was written to was reported as a plain delivery, so the caller keeps the claim and the member can never be reached again"
      );
      assert.match(result.value.suppressedTargets?.[0]?.reason ?? "", /preference/i);
    });

    it("names NO suppression when the message really went out", async () => {
      const emails = { send: vi.fn(async () => SENT) };
      const adapter = new EmailRetractionAlertDelivery(emails as never);

      const result = await adapter.deliver(ALERT, [TARGET]);

      assert.ok(result.ok);
      assert.strictEqual(
        result.value.suppressedTargets,
        undefined,
        "a delivered email released its own claim, so a redelivery would send it twice"
      );
    });

    it("refuses when the type is not carried on email at all — our gap, not the customer's answer", async () => {
      const emails = {
        send: vi.fn(async () =>
          ok({ sent: false as const, reason: EMAIL_SKIP_REASONS.TYPE_NOT_EMAILED })
        ),
      };
      const adapter = new EmailRetractionAlertDelivery(emails as never);

      const result = await adapter.deliver(ALERT, [TARGET]);

      assert.ok(
        !result.ok,
        "the alert's own type falling off the email allow-list would report as the recipient's preference and vanish"
      );
      assert.match(result.error, /email/i);
    });
  });
});
