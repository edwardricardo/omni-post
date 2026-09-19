/**
 * @file SendEmailNotificationService.ts
 * @description Service that sends email notifications after in-app notifications
 *              are created. Gates on the type allow-list and the recipient's
 *              email preferences, then delegates rendering + delivery to the
 *              NotificationMailer. Never throws — a transport failure is returned as
 *              an `err` VALUE, so a caller can decide whether to retry it.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { NotificationDeliveryError } from "@core/domain/errors/index.js";
import type { NotificationPreferenceRepository } from "@core/domain/repositories/NotificationRepository.js";
import type { NotificationTypeValue } from "@core/domain/value-objects/NotificationType.js";
import type {
  NotificationMailer,
  EmailNotificationContext,
} from "@core/domain/repositories/NotificationMailer.js";
import { isTypeEnabled } from "./isTypeEnabled.js";

const EMAIL_ENABLED_TYPES: NotificationTypeValue[] = [
  "APPROVAL_REQUESTED",
  "POST_APPROVED",
  "POST_REJECTED",
  "MENTION",
  // Admitted because email is the one contact datum the platform holds from signup,
  // and the default for this type has to be a DELIVERED email rather than a silently
  // dropped one: the customer is being asked to remove content from a platform this
  // application cannot reach, and a dashboard they may not open that day is not a
  // reliable way to ask. The recipient's per-type row still decides — see
  // isTypeEnabled below.
  "PUBLICATION_RETRACTION_PENDING",
];

export class SendEmailNotificationService {
  constructor(
    private readonly mailer: NotificationMailer,
    private readonly preferenceRepo: NotificationPreferenceRepository
  ) {}

  /**
   * @method send
   * @description Sends the email for one notification, when the type is admitted and
   *   the recipient has not opted it out.
   *
   *   It reports the transport's outcome instead of hiding it. The earlier shape —
   *   `Promise<void>` around an empty catch — made three different endings look
   *   identical to a caller: sent, deliberately skipped, and FAILED. That mattered the
   *   moment a caller recorded a delivery in a ledger: a silently failed send left a
   *   claimed row, so the redelivery collided and the customer was never reached while
   *   the counter read "delivered".
   *
   *   A deliberate skip is `ok`, not `err`: the customer's own opt-out and a type that
   *   carries no email are not failures, and reporting them as failures would make a
   *   caller retry something nobody wants sent.
   * @param ctx - The notification to send, with the recipient's resolved address
   * @returns ok when sent or deliberately skipped, err naming what the transport said
   */
  async send(ctx: EmailNotificationContext): Promise<Result<void, NotificationDeliveryError>> {
    if (!EMAIL_ENABLED_TYPES.includes(ctx.type)) {
      return ok(undefined);
    }

    try {
      const preferences = await this.preferenceRepo.findByMember(ctx.recipientId);
      if (!isTypeEnabled(preferences, ctx.type)) {
        return ok(undefined);
      }

      // The mailer reports failure as a VALUE as well as by throwing, and the previous
      // shape discarded the value: a provider that correctly answered `err` was
      // ignored exactly as completely as one that blew up.
      const delivered = await this.mailer.sendNotification(ctx);
      if (!delivered.ok) {
        return err(
          new NotificationDeliveryError("email", delivered.error.message, delivered.error)
        );
      }

      return ok(undefined);
    } catch (error: unknown) {
      const cause = error instanceof Error ? error : undefined;
      return err(
        new NotificationDeliveryError("email", cause?.message ?? "unknown transport failure", cause)
      );
    }
  }
}
