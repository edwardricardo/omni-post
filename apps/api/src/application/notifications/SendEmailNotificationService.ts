/**
 * @file SendEmailNotificationService.ts
 * @description Service that sends email notifications after in-app notifications
 *              are created. Checks user email preferences before sending.
 *              Never throws — email is a non-blocking side effect.
 * @layer application
 */

import type { EmailPort } from "../../domain/repositories/EmailPort.js";
import type { NotificationPreferenceRepository } from "../../domain/repositories/NotificationRepository.js";
import type { NotificationTypeValue } from "../../domain/value-objects/NotificationType.js";
import { approvalRequestedEmail, approvalDecisionEmail, mentionEmail } from "./emailTemplates.js";
import { env } from "../../config/env.js";

const EMAIL_ENABLED_TYPES: NotificationTypeValue[] = [
  "APPROVAL_REQUESTED",
  "POST_APPROVED",
  "POST_REJECTED",
  "MENTION",
];

export interface EmailNotificationContext {
  recipientId: string;
  recipientEmail: string;
  type: NotificationTypeValue;
  title: string;
  body: string;
  accountName: string;
  metadata?: Record<string, unknown>;
}

export class SendEmailNotificationService {
  constructor(
    private readonly emailPort: EmailPort,
    private readonly preferenceRepo: NotificationPreferenceRepository
  ) {}

  async send(ctx: EmailNotificationContext): Promise<void> {
    try {
      if (!EMAIL_ENABLED_TYPES.includes(ctx.type)) {
        return;
      }

      const preferences = await this.preferenceRepo.findByMember(ctx.recipientId);
      const pref = preferences.find((p) => p.type === ctx.type);
      if (pref && !pref.enabled) {
        return;
      }

      const clientUrl = env.CLIENT_URL ?? "http://localhost:3002";
      const { subject, html } = await this.renderTemplate(ctx, clientUrl);

      await this.emailPort.send({
        to: [ctx.recipientEmail],
        subject,
        body: ctx.body,
        html,
      });
    } catch {
      // Email is non-blocking — log handled by EmailPort adapter
    }
  }

  private async renderTemplate(
    ctx: EmailNotificationContext,
    clientUrl: string
  ): Promise<{ subject: string; html: string }> {
    const meta = (ctx.metadata ?? {}) as Record<string, string>;

    switch (ctx.type) {
      case "APPROVAL_REQUESTED":
        return approvalRequestedEmail({
          authorName: meta.authorName ?? "A team member",
          postTitle: meta.postTitle ?? ctx.title,
          postPreview: meta.postPreview ?? ctx.body,
          platforms: meta.platforms ? meta.platforms.split(",") : [],
          reviewUrl: `${clientUrl}/dashboard/approvals`,
          accountName: ctx.accountName,
        });

      case "POST_APPROVED":
        return approvalDecisionEmail({
          decision: "approved",
          reviewerName: meta.reviewerName ?? "A reviewer",
          postTitle: meta.postTitle ?? ctx.title,
          postUrl: `${clientUrl}/dashboard/posts/${meta.postId ?? ""}`,
          accountName: ctx.accountName,
        });

      case "POST_REJECTED":
        return approvalDecisionEmail({
          decision: "rejected",
          reviewerName: meta.reviewerName ?? "A reviewer",
          postTitle: meta.postTitle ?? ctx.title,
          ...(meta.rejectionReason !== undefined && { rejectionReason: meta.rejectionReason }),
          postUrl: `${clientUrl}/dashboard/posts/${meta.postId ?? ""}`,
          accountName: ctx.accountName,
        });

      case "MENTION":
        return mentionEmail({
          mentionerName: meta.mentionerName ?? "Someone",
          context: meta.context ?? "conversation",
          textPreview: ctx.body,
          contextUrl: `${clientUrl}/dashboard/inbox`,
          accountName: ctx.accountName,
        });

      default:
        return { subject: ctx.title, html: `<p>${ctx.body}</p>` };
    }
  }
}
