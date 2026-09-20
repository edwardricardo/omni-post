/**
 * @file SendEmailNotificationService.ts
 * @description Service that sends email notifications after in-app notifications
 *              are created. Gates on the type allow-list and the recipient's
 *              email preferences, then delegates rendering + delivery to the
 *              NotificationMailer. Never throws — a transport failure is returned as
 *              an `err` VALUE, so a caller can decide whether to retry it.
 *
 *              A SKIP is a value too. Both gates end with no message sent, and a
 *              caller that records deliveries cannot tell that ending from a real send
 *              unless the answer says so — which is why `send` reports whether anything
 *              went out rather than only whether anything broke.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { NotificationDeliveryError } from "@core/domain/errors/index.js";
import type { NotificationPreferenceRepository } from "@core/domain/repositories/NotificationRepository.js";
import type { NotificationTypeValue } from "@core/domain/value-objects/NotificationType.js";
import { ALERT_DELIVERY_RESULTS } from "@core/domain/value-objects/AlertMedium.js";
import type {
  NotificationMailer,
  EmailNotificationContext,
} from "@core/domain/repositories/NotificationMailer.js";
import { isTypeEnabled } from "./isTypeEnabled.js";

/**
 * Why a send produced no message. These are NOT a new vocabulary: they are two of the
 * three not-delivered reasons the delivery report already speaks, so a caller that puts
 * a skip into that report carries this answer through instead of translating it — and a
 * translation is exactly where "the customer turned it off" becomes "the transport
 * broke". `TYPE_NOT_EMAILED` is `unavailable` because that is what it says: this
 * application does not carry that notification type on email at all, which is a gap on
 * our side rather than an answer from the recipient.
 */
export const EMAIL_SKIP_REASONS = {
  SUPPRESSED_BY_PREFERENCE: ALERT_DELIVERY_RESULTS.SUPPRESSED_BY_PREFERENCE,
  TYPE_NOT_EMAILED: ALERT_DELIVERY_RESULTS.UNAVAILABLE,
} as const;

export type EmailSkipReason = (typeof EMAIL_SKIP_REASONS)[keyof typeof EMAIL_SKIP_REASONS];

/**
 * What a send produced. Discriminated on `sent` so a caller cannot read the reason of
 * a message that really went out, and cannot forget to ask about one that did not.
 */
export type EmailSendOutcome =
  { readonly sent: true } | { readonly sent: false; readonly reason: EmailSkipReason };

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
   *
   *   But `ok` alone is not enough either, and that gap is the mirror image of the one
   *   above. A bare `ok` made a SKIP and a SEND identical, so the alert medium built on
   *   this service reported a message nobody received as delivered and kept the ledger
   *   claim standing — which is the one state the claim exists to prevent, because the
   *   redelivery then collides with a row recording a message that never existed. The
   *   `ok` therefore CARRIES whether anything went out, and names why when it did not.
   * @param ctx - The notification to send, with the recipient's resolved address
   * @returns ok saying whether a message went out and why not, err naming what the
   *   transport said
   */
  async send(
    ctx: EmailNotificationContext
  ): Promise<Result<EmailSendOutcome, NotificationDeliveryError>> {
    if (!EMAIL_ENABLED_TYPES.includes(ctx.type)) {
      return ok({ sent: false, reason: EMAIL_SKIP_REASONS.TYPE_NOT_EMAILED });
    }

    try {
      const preferences = await this.preferenceRepo.findByMember(ctx.recipientId);
      if (!isTypeEnabled(preferences, ctx.type)) {
        return ok({ sent: false, reason: EMAIL_SKIP_REASONS.SUPPRESSED_BY_PREFERENCE });
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

      return ok({ sent: true });
    } catch (error: unknown) {
      const cause = error instanceof Error ? error : undefined;
      return err(
        new NotificationDeliveryError("email", cause?.message ?? "unknown transport failure", cause)
      );
    }
  }
}
