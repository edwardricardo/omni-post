/**
 * @file EmailRetractionAlertDelivery.ts
 * @description Carries an urgent retraction alert to the recipient's inbox.
 *
 *   This is the FIRST production caller of `SendEmailNotificationService`, which has
 *   existed unwired: the customer is being asked to remove content from a platform
 *   this application cannot reach, and a dashboard they may not open that day is not a
 *   reliable way to ask. The service applies the type allow-list and the recipient's
 *   per-type preference itself; that second check is kept, because this adapter is not
 *   the only thing that will ever call it.
 *
 *   Because the service decides, this adapter has to REPORT what it decided. A send the
 *   service declined is not a delivery: nothing was written, nobody can read it, and
 *   saying `ok` for it would count a customer as reached and leave their ledger claim
 *   standing forever. The two declines are reported differently on purpose — the
 *   recipient's own opt-out is a suppression, which releases the claim so a member who
 *   switches the type back on is reached by the next redelivery, while the alert's type
 *   falling off the email allow-list is a gap on our side and is reported as a failure,
 *   the same answer a member with no address gets.
 * @layer infrastructure
 */

import { type Result, ok, err } from "@shared/types";
import {
  ALERT_MEDIA,
  ALERT_MEDIUM_KINDS,
  type AlertDeliveryOutcome,
  type AlertTarget,
  type RetractionAlertDelivery,
  type RetractionAlertView,
} from "@ports/core";
import {
  EMAIL_SKIP_REASONS,
  type SendEmailNotificationService,
} from "@core/notifications/SendEmailNotificationService.js";
import { NOTIFICATION_TYPES } from "@core/domain/value-objects/NotificationType.js";

/** The recipient's own answer, worded exactly as the in-app medium words it. */
const PREFERENCE_IS_OFF = "the recipient's per-type preference is off";

export class EmailRetractionAlertDelivery implements RetractionAlertDelivery {
  readonly medium = ALERT_MEDIA.EMAIL;
  readonly kind = ALERT_MEDIUM_KINDS.PER_MEMBER;

  constructor(private readonly emails: SendEmailNotificationService) {}

  /**
   * @method deliver
   * @description Emails ONE recipient about the stranded content.
   * @param alert - The resolved alert view
   * @param targets - Exactly one member; the caller sends per-member media one at a time
   * @returns ok once handed to the mailer — naming the target as suppressed when the
   *   recipient's preference stopped it — or err when nothing could be reached
   */
  async deliver(
    alert: RetractionAlertView,
    targets: readonly AlertTarget[]
  ): Promise<Result<AlertDeliveryOutcome, string>> {
    const target = targets[0];
    if (target === undefined) return ok({});

    // A member without an address is a real gap, not a silent skip: reporting it as a
    // failure is what puts it in the alert's own telemetry instead of nowhere.
    if (target.email === undefined || target.email.length === 0) {
      return err(`recipient ${target.id} has no email address`);
    }

    const sent = await this.emails.send({
      recipientId: target.id,
      recipientEmail: target.email,
      type: NOTIFICATION_TYPES.PUBLICATION_RETRACTION_PENDING,
      title: alert.title,
      body: alert.body,
      accountName: alert.accountName,
      metadata: alert.metadata,
    });

    // A mailer outage is reported, never absorbed. Until the service returned a
    // Result this branch did not exist, so a provider refusing every message still
    // counted as `delivered` — and the caller's ledger claim then blocked the
    // redelivery that would have retried it.
    if (!sent.ok) return err(sent.error.message);

    if (sent.value.sent) return ok({});

    // The recipient's own answer. Nothing was written, so the caller releases the claim
    // and a redelivery re-evaluates the preference — which is what lets a member who
    // switches the type back on be reached, instead of being blocked forever by a row
    // recording a message that never existed.
    if (sent.value.reason === EMAIL_SKIP_REASONS.SUPPRESSED_BY_PREFERENCE) {
      return ok({ suppressedTargets: [{ targetId: target.id, reason: PREFERENCE_IS_OFF }] });
    }

    // The alert's own type is on the email allow-list today, so this is unreachable
    // while it stays there — and it is written out rather than folded into the
    // suppression above precisely so that removing it goes loudly red instead of
    // reporting every recipient as having opted out.
    return err(
      `${NOTIFICATION_TYPES.PUBLICATION_RETRACTION_PENDING} is not carried on email, so ` +
        `recipient ${target.id} was never written to`
    );
  }
}
