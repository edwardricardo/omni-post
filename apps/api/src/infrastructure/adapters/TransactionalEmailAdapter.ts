/**
 * @file TransactionalEmailAdapter.ts
 * @description Infrastructure adapter implementing the transactional-email role
 *              ports (referral reward, welcome, team invitation, notification).
 *              Renders the @react-email templates, builds the plain-text body,
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
import {
  approvalRequestedEmail,
  approvalDecisionEmail,
  mentionEmail,
  retractionPendingEmail,
  welcomeEmail,
  teamInvitationEmail,
} from "../email/templates/emailTemplates.js";
import { referralRewardEmail } from "../email/templates/referralRewardEmail.js";
import { readAlertFragments } from "@core/notifications/readAlertFragments.js";

/**
 * @class TransactionalEmailAdapter
 * @description Single adapter backing the four transactional-email role ports.
 */
export class TransactionalEmailAdapter
  implements ReferralRewardMailer, WelcomeMailer, TeamInvitationMailer, NotificationMailer
{
  constructor(
    private readonly emailPort: EmailPort,
    private readonly clientUrl: string
  ) {}

  async sendReferralReward(
    to: string,
    data: ReferralRewardEmailData
  ): Promise<Result<void, Error>> {
    const { subject, html } = await referralRewardEmail(data);
    return this.emailPort.send({
      to: [to],
      subject,
      body: `You earned ${data.rewardDays} free days from your referral of ${data.referredCompanyName}.`,
      html,
    });
  }

  async sendWelcome(to: string, data: WelcomeEmailData): Promise<Result<void, Error>> {
    const { subject, html } = await welcomeEmail(data);
    return this.emailPort.send({
      to: [to],
      subject,
      body: `Welcome to OmniPost! Get started at ${data.onboardingUrl}`,
      html,
    });
  }

  async sendTeamInvitation(
    to: string,
    data: TeamInvitationEmailData
  ): Promise<Result<void, Error>> {
    const { subject, html } = await teamInvitationEmail(data);
    return this.emailPort.send({
      to: [to],
      subject,
      body: `You've been invited to join a team on OmniPost. Visit ${data.acceptUrl}`,
      html,
    });
  }

  async sendNotification(ctx: EmailNotificationContext): Promise<Result<void, Error>> {
    const { subject, html } = await this.renderNotification(ctx);
    return this.emailPort.send({ to: [ctx.recipientEmail], subject, body: ctx.body, html });
  }

  private async renderNotification(
    ctx: EmailNotificationContext
  ): Promise<{ subject: string; html: string }> {
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

      case "PUBLICATION_RETRACTION_PENDING": {
        // The only notification type whose metadata is structured rather than flat:
        // the customer has to be told WHICH fragments are still live, one by one, so
        // the array is read back here rather than flattened into a sentence upstream.
        const raw = (ctx.metadata ?? {}) as Record<string, unknown>;
        const channelName = typeof raw.channelName === "string" ? raw.channelName : "the channel";
        const actionWindowEndsAt =
          typeof raw.actionWindowEndsAt === "string" ? raw.actionWindowEndsAt : undefined;
        return retractionPendingEmail({
          channelName,
          postExcerpt: typeof raw.postExcerpt === "string" ? raw.postExcerpt : ctx.body,
          cause: typeof raw.cause === "string" ? raw.cause : "NO_CAPABILITY",
          liveFragments: readAlertFragments(raw.liveFragments),
          ...(actionWindowEndsAt !== undefined && { actionWindowEndsAt }),
          postUrl: `${this.clientUrl}/dashboard/posts/${typeof raw.postId === "string" ? raw.postId : ""}`,
          accountName: ctx.accountName,
        });
      }

      default:
        return { subject: ctx.title, html: `<p>${ctx.body}</p>` };
    }
  }
}
