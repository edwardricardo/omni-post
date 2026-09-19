/**
 * @file SendEmailNotificationService.ts
 * @description Service that sends email notifications after in-app notifications
 *              are created. Gates on the type allow-list and the recipient's
 *              email preferences, then delegates rendering + delivery to the
 *              NotificationMailer. Never throws — email is a non-blocking side
 *              effect.
 * @layer application
 */

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

  async send(ctx: EmailNotificationContext): Promise<void> {
    try {
      if (!EMAIL_ENABLED_TYPES.includes(ctx.type)) {
        return;
      }

      const preferences = await this.preferenceRepo.findByMember(ctx.recipientId);
      if (!isTypeEnabled(preferences, ctx.type)) {
        return;
      }

      await this.mailer.sendNotification(ctx);
    } catch {
      // Email is non-blocking — delivery failures are logged by the mailer adapter.
    }
  }
}
