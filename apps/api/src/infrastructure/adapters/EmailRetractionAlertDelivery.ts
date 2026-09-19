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
import type { SendEmailNotificationService } from "@core/notifications/SendEmailNotificationService.js";
import { NOTIFICATION_TYPES } from "@core/domain/value-objects/NotificationType.js";

export class EmailRetractionAlertDelivery implements RetractionAlertDelivery {
  readonly medium = ALERT_MEDIA.EMAIL;
  readonly kind = ALERT_MEDIUM_KINDS.PER_MEMBER;

  constructor(private readonly emails: SendEmailNotificationService) {}

  /**
   * @method deliver
   * @description Emails ONE recipient about the stranded content.
   * @param alert - The resolved alert view
   * @param targets - Exactly one member; the caller sends per-member media one at a time
   * @returns ok once handed to the mailer, err when the target has no address to reach
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

    await this.emails.send({
      recipientId: target.id,
      recipientEmail: target.email,
      type: NOTIFICATION_TYPES.PUBLICATION_RETRACTION_PENDING,
      title: alert.title,
      body: alert.body,
      accountName: alert.accountName,
      metadata: alert.metadata,
    });

    return ok({});
  }
}
