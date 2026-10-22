/**
 * @file TransactionalEmailAdapter.ts
 * @description Infrastructure adapter implementing the transactional-email role
 *              ports (referral reward, welcome, team invitation, notification,
 *              deleted-account notice).
 *              Renders the Handlebars email templates, builds the plain-text body,
 *              and sends via the EmailPort. For notification emails it maps the
 *              notification type to a template and builds links from the
 *              configured client URL. Application use cases depend on the role
 *              ports, never on the templates.
 * @layer infrastructure
 */

import { type Result } from "@shared/types";
import type { EmailPort } from "@core/domain/repositories/EmailPort.js";
import type {
  ReferralRewardMailer,
  ReferralRewardEmailData,
} from "@core/domain/repositories/ReferralRewardMailer.js";
import type { WelcomeMailer, WelcomeEmailData } from "@core/domain/repositories/WelcomeMailer.js";
import type {
  TeamInvitationMailer,
  TeamInvitationEmailData,
} from "@core/domain/repositories/TeamInvitationMailer.js";
import type {
  NotificationMailer,
  EmailNotificationContext,
} from "@core/domain/repositories/NotificationMailer.js";
import type {
  DeletedAccountNoticeMailer,
  DeletedAccountNoticeData,
} from "@core/domain/repositories/DeletedAccountNoticeMailer.js";
import {
  approvalRequestedEmail,
  approvalDecisionEmail,
  mentionEmail,
  welcomeEmail,
  teamInvitationEmail,
  deletedAccountNoticeEmail,
  referralRewardEmail,
  plainNotificationEmail,
  type RenderedEmail,
} from "../email/templates/emailTemplates.js";

/**
 * @class TransactionalEmailAdapter
 * @description Single adapter backing the five transactional-email role ports.
 */
export class TransactionalEmailAdapter
  implements
    ReferralRewardMailer,
    WelcomeMailer,
    TeamInvitationMailer,
    NotificationMailer,
    DeletedAccountNoticeMailer
{
  constructor(
    private readonly emailPort: EmailPort,
    private readonly clientUrl: string
  ) {}

  /**
   * @method sendReferralReward
   * @description Renders and sends the referral-reward email.
   * @param to - The referrer's address.
   * @param data - The reward the email describes.
   * @returns Ok, the reason the email was refused, or the transport's failure.
   */
  async sendReferralReward(
    to: string,
    data: ReferralRewardEmailData
  ): Promise<Result<void, Error>> {
    return this.deliver(
      to,
      await referralRewardEmail(data),
      `You earned ${data.rewardDays} free days from your referral of ${data.referredCompanyName}.`
    );
  }

  /**
   * @method sendWelcome
   * @description Renders and sends the welcome email.
   * @param to - The new customer's address.
   * @param data - The account name and the links the email points at.
   * @returns Ok, the reason the email was refused, or the transport's failure.
   */
  async sendWelcome(to: string, data: WelcomeEmailData): Promise<Result<void, Error>> {
    return this.deliver(
      to,
      await welcomeEmail(data),
      `Welcome to OmniPost! Get started at ${data.onboardingUrl}`
    );
  }

  /**
   * @method sendTeamInvitation
   * @description Renders and sends the team-invitation email.
   * @param to - The invitee's address.
   * @param data - The inviter, account, role and accept link.
   * @returns Ok, the reason the email was refused, or the transport's failure.
   */
  async sendTeamInvitation(
    to: string,
    data: TeamInvitationEmailData
  ): Promise<Result<void, Error>> {
    return this.deliver(
      to,
      await teamInvitationEmail(data),
      `You've been invited to join a team on OmniPost. Visit ${data.acceptUrl}`
    );
  }

  /**
   * @method sendNotification
   * @description Maps a notification to its template, renders it and sends it.
   * @param ctx - The notification and its recipient.
   * @returns Ok, the reason the email was refused, or the transport's failure.
   */
  async sendNotification(ctx: EmailNotificationContext): Promise<Result<void, Error>> {
    return this.deliver(ctx.recipientEmail, await this.renderNotification(ctx), ctx.body);
  }

  /**
   * @method notifyRegistrationAttemptOnDeletedAccount
   * @description Renders and sends the deleted-account notice: a registration was attempted
   *   with the address, the account it belongs to is deleted, and support can restore it or
   *   complete the deletion.
   * @param to - The address that belongs to the deleted account or deleted user.
   * @param data - The support address the notice names.
   * @returns Ok, the reason the email was refused, or the transport's failure.
   */
  async notifyRegistrationAttemptOnDeletedAccount(
    to: string,
    data: DeletedAccountNoticeData
  ): Promise<Result<void, Error>> {
    const rendered = await deletedAccountNoticeEmail({ supportEmail: data.supportEmail });
    return this.deliver(to, rendered, rendered.ok ? rendered.value.text : "");
  }

  /**
   * Sends a rendered email, or returns the reason it was refused without sending anything: an
   * email the templates refuse never reaches the transport.
   */
  private async deliver(
    to: string,
    rendered: Result<RenderedEmail, Error>,
    body: string
  ): Promise<Result<void, Error>> {
    if (!rendered.ok) return rendered;
    const { subject, html } = rendered.value;
    return this.emailPort.send({ to: [to], subject, body, html });
  }

  private async renderNotification(
    ctx: EmailNotificationContext
  ): Promise<Result<RenderedEmail, Error>> {
    const meta = (ctx.metadata ?? {}) as Record<string, string>;

    switch (ctx.type) {
      case "APPROVAL_REQUESTED":
        return approvalRequestedEmail({
          authorName: meta.authorName ?? "A team member",
          postTitle: meta.postTitle ?? ctx.title,
          postPreview: meta.postPreview ?? ctx.body,
          platforms: meta.platforms ? meta.platforms.split(",") : [],
          reviewUrl: `${this.clientUrl}/dashboard/approvals`,
          accountName: ctx.accountName,
        });

      case "POST_APPROVED":
        return approvalDecisionEmail({
          decision: "approved",
          reviewerName: meta.reviewerName ?? "A reviewer",
          postTitle: meta.postTitle ?? ctx.title,
          postUrl: `${this.clientUrl}/dashboard/posts/${meta.postId ?? ""}`,
          accountName: ctx.accountName,
        });

      case "POST_REJECTED":
        return approvalDecisionEmail({
          decision: "rejected",
          reviewerName: meta.reviewerName ?? "A reviewer",
          postTitle: meta.postTitle ?? ctx.title,
          ...(meta.rejectionReason !== undefined && { rejectionReason: meta.rejectionReason }),
          postUrl: `${this.clientUrl}/dashboard/posts/${meta.postId ?? ""}`,
          accountName: ctx.accountName,
        });

      case "MENTION":
        return mentionEmail({
          mentionerName: meta.mentionerName ?? "Someone",
          context: meta.context ?? "conversation",
          textPreview: ctx.body,
          contextUrl: `${this.clientUrl}/dashboard/inbox`,
          accountName: ctx.accountName,
        });

      default:
        return plainNotificationEmail({ title: ctx.title, body: ctx.body });
    }
  }
}
