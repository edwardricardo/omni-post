/**
 * @file emailTemplates.ts
 * @description The transactional emails: each one's subject, the view its template reads, and its
 *              HTML, rendered by the email Handlebars engine from `emailTemplateSources.ts`. Every
 *              value reaches the HTML escaped; subjects and plain-text parts are not HTML and carry
 *              the values as they are. Rendering returns a `Result`: an email whose call to action
 *              is not an absolute http(s) link, or a view the template cannot render, is refused
 *              and never rendered.
 * @layer infrastructure
 */

import { err, ok, type Result } from "@shared/types";
import { EmailTemplateEngine } from "../EmailTemplateEngine.js";
import {
  EMAIL_LAYOUT,
  EMAIL_TEMPLATES,
  EMAIL_TEMPLATE_IDS,
  type EmailTemplateId,
} from "./emailTemplateSources.js";

/** The engine every email renders through; compiling the catalogue is cheap and done once. */
const engine = new EmailTemplateEngine(EMAIL_TEMPLATES, EMAIL_LAYOUT);

/** A rendered email: its subject line and its HTML body. */
export interface RenderedEmail {
  subject: string;
  html: string;
}

/** An email rendered, or the reason it was refused. */
type EmailRender<T extends RenderedEmail = RenderedEmail> = Result<T, Error>;

// ---------------------------------------------------------------------------
// Layout view
// ---------------------------------------------------------------------------

/** The inbox preview shows at most this many characters. */
const PREVIEW_MAX_LENGTH = 150;

/**
 * Invisible characters (no-break space, zero-width non-joiner, zero-width space, zero-width
 * joiner, left-to-right mark, right-to-left mark, zero-width no-break space). The preview is
 * padded with them up to its length, so a client does not pull the email's first lines into the
 * preview after a short text.
 */
const PREVIEW_PADDING_CHARACTERS = [0x00a0, 0x200c, 0x200b, 0x200d, 0x200e, 0x200f, 0xfeff]
  .map((codePoint) => String.fromCodePoint(codePoint))
  .join("");

/** The only schemes a call-to-action link may use: an email needs an absolute web link. */
const LINK_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/** The variables the shared layout reads. */
interface LayoutView {
  preview: string;
  previewPadding: string | null;
  ctaText: string | null;
  ctaUrl: string | null;
  footerText: string;
}

/** The call to action an email ends with: a button text and the link it opens. */
interface CallToAction {
  text: string;
  url: string;
}

/** What the layout shows around an email's own content. */
interface LayoutInput {
  preview: string;
  footerText: string;
  cta: CallToAction | null;
}

/** The footer of an email sent to a member of an account. */
function memberFooter(accountName: string): string {
  return `You are receiving this because you are a member of ${accountName}.`;
}

/** The invisible padding that fills the preview up to its length, or null when it is full. */
function previewPadding(shown: string): string | null {
  const missing = PREVIEW_MAX_LENGTH - shown.length;
  if (missing <= 0) return null;
  const cycles = Math.ceil(missing / PREVIEW_PADDING_CHARACTERS.length);
  return PREVIEW_PADDING_CHARACTERS.repeat(cycles).slice(0, missing);
}

/**
 * The layout's button: both its text and its link, or neither. The link must parse as an
 * absolute http(s) URL, and the parsed form is what is rendered, so the link a mail client opens
 * is the one that was checked. The refusal names no part of the link, which can carry a token.
 */
function callToAction(
  cta: CallToAction | null
): Result<Pick<LayoutView, "ctaText" | "ctaUrl">, Error> {
  if (cta === null) return ok({ ctaText: null, ctaUrl: null });
  if (cta.text.trim() === "" || cta.url.trim() === "") {
    return err(new Error("An email call to action needs both a text and a link"));
  }
  const url = URL.canParse(cta.url) ? new URL(cta.url) : null;
  if (url === null || !LINK_PROTOCOLS.has(url.protocol)) {
    return err(new Error("An email call to action links only to an absolute http(s) URL"));
  }
  return ok({ ctaText: cta.text, ctaUrl: url.href });
}

/**
 * Renders one template of the catalogue inside the layout: the layout's variables are checked
 * here, once for every email, before anything is rendered.
 */
function renderInLayout(
  templateId: EmailTemplateId,
  subject: string,
  layout: LayoutInput,
  view: object
): EmailRender {
  const action = callToAction(layout.cta);
  if (!action.ok) return action;
  const shown = layout.preview.substring(0, PREVIEW_MAX_LENGTH);
  const layoutView: LayoutView = {
    preview: shown,
    previewPadding: previewPadding(shown),
    ...action.value,
    footerText: layout.footerText,
  };
  // The checked layout variables come last, so no email's own view can replace them.
  const html = engine.renderEmail(templateId, { ...view, ...layoutView });
  return html.ok ? ok({ subject, html: html.value }) : html;
}

// ---------------------------------------------------------------------------
// Approval requested
// ---------------------------------------------------------------------------

interface ApprovalRequestedProps {
  authorName: string;
  postTitle: string;
  postPreview: string;
  platforms: string[];
  reviewUrl: string;
  accountName: string;
}

/** The post preview shows at most this many characters, followed by "..." when cut. */
const POST_PREVIEW_MAX_LENGTH = 140;

/**
 * @function approvalRequestedEmail
 * @description Renders the "approval requested" notification email.
 * @param params - The author, the post, its platforms, the review link and the account.
 * @returns Subject line and rendered HTML body, or the reason the email was refused
 */
export async function approvalRequestedEmail(params: ApprovalRequestedProps): Promise<EmailRender> {
  return renderInLayout(
    EMAIL_TEMPLATE_IDS.APPROVAL_REQUESTED,
    `Action required: "${params.postTitle}" needs your approval`,
    {
      preview: `${params.authorName} submitted a post for your approval`,
      footerText: memberFooter(params.accountName),
      cta: { text: "Review Post", url: params.reviewUrl },
    },
    {
      authorName: params.authorName,
      postTitle: params.postTitle,
      postPreview: params.postPreview.slice(0, POST_PREVIEW_MAX_LENGTH),
      postPreviewTruncated: params.postPreview.length > POST_PREVIEW_MAX_LENGTH,
      platforms: params.platforms.join(", "),
    }
  );
}

// ---------------------------------------------------------------------------
// Approval decision
// ---------------------------------------------------------------------------

interface ApprovalDecisionProps {
  decision: "approved" | "rejected";
  reviewerName: string;
  postTitle: string;
  rejectionReason?: string;
  postUrl: string;
  accountName: string;
}

/**
 * @function approvalDecisionEmail
 * @description Renders the "approval decision" notification email (approved or rejected).
 * @param params - The decision, the reviewer, the post, the reason of a rejection and the link.
 * @returns Subject line and rendered HTML body, or the reason the email was refused
 */
export async function approvalDecisionEmail(params: ApprovalDecisionProps): Promise<EmailRender> {
  const isApproved = params.decision === "approved";
  return renderInLayout(
    EMAIL_TEMPLATE_IDS.APPROVAL_DECISION,
    isApproved
      ? `Your post "${params.postTitle}" has been approved`
      : `Changes requested: "${params.postTitle}"`,
    {
      preview: `${params.reviewerName} ${params.decision} your post`,
      footerText: memberFooter(params.accountName),
      cta: { text: "View Post", url: params.postUrl },
    },
    {
      title: isApproved ? "Your post has been approved" : "Your post needs changes",
      accentColor: isApproved ? "#10b981" : "#f59e0b",
      reviewerName: params.reviewerName,
      decision: params.decision,
      postTitle: params.postTitle,
      rejectionReason: params.rejectionReason ?? null,
    }
  );
}

// ---------------------------------------------------------------------------
// Mention
// ---------------------------------------------------------------------------

interface MentionProps {
  mentionerName: string;
  context: string;
  textPreview: string;
  contextUrl: string;
  accountName: string;
}

/** The mention preview shows at most this many characters. */
const MENTION_PREVIEW_MAX_LENGTH = 200;

/**
 * @function mentionEmail
 * @description Renders the "you were mentioned" notification email.
 * @param params - The mentioner, where the mention is, its text and the link to it.
 * @returns Subject line and rendered HTML body, or the reason the email was refused
 */
export async function mentionEmail(params: MentionProps): Promise<EmailRender> {
  return renderInLayout(
    EMAIL_TEMPLATE_IDS.MENTION,
    `${params.mentionerName} mentioned you in a ${params.context}`,
    {
      preview: `${params.mentionerName} mentioned you`,
      footerText: memberFooter(params.accountName),
      cta: { text: "View", url: params.contextUrl },
    },
    {
      mentionerName: params.mentionerName,
      context: params.context,
      textPreview: params.textPreview.slice(0, MENTION_PREVIEW_MAX_LENGTH),
    }
  );
}

// ---------------------------------------------------------------------------
// Password reset (admin)
// ---------------------------------------------------------------------------

interface PasswordResetProps {
  userName: string;
  resetUrl: string;
}

/**
 * @function passwordResetEmail
 * @description Renders the admin password-reset email. Its two callers, the admin password-reset
 *   routes, read the subject and the HTML directly and wrap the call in their own try/catch, so
 *   this one function keeps that shape: a refused email rejects instead of resolving to an error.
 * @param params - The user's name and the reset link.
 * @returns Subject line and rendered HTML body; rejects when the email is refused
 */
export async function passwordResetEmail(params: PasswordResetProps): Promise<RenderedEmail> {
  const rendered = renderInLayout(
    EMAIL_TEMPLATE_IDS.PASSWORD_RESET,
    "Password reset requested — OmniPost Admin",
    {
      preview: "Password reset requested for your account",
      footerText: memberFooter("OmniPost Admin"),
      cta: { text: "Reset Password", url: params.resetUrl },
    },
    { userName: params.userName }
  );
  if (!rendered.ok) throw rendered.error;
  return rendered.value;
}

// ---------------------------------------------------------------------------
// Welcome (client registration)
// ---------------------------------------------------------------------------

interface WelcomeProps {
  accountName: string;
  onboardingUrl: string;
  supportEmail: string;
}

/**
 * @function welcomeEmail
 * @description Renders the welcome email sent on client registration.
 * @param params - The account name, the onboarding link and the support address.
 * @returns Subject line and rendered HTML body, or the reason the email was refused
 */
export async function welcomeEmail(params: WelcomeProps): Promise<EmailRender> {
  return renderInLayout(
    EMAIL_TEMPLATE_IDS.WELCOME,
    "Welcome to OmniPost — let's get you set up",
    {
      preview: `Welcome to OmniPost, ${params.accountName}!`,
      footerText: memberFooter(params.accountName),
      cta: { text: "Get Started", url: params.onboardingUrl },
    },
    { accountName: params.accountName, supportEmail: params.supportEmail }
  );
}

// ---------------------------------------------------------------------------
// Team invitation
// ---------------------------------------------------------------------------

interface TeamInvitationProps {
  inviterName: string;
  accountName: string;
  role: string;
  acceptUrl: string;
}

/**
 * @function teamInvitationEmail
 * @description Renders the team-invitation email.
 * @param params - The inviter, the account, the role and the accept link.
 * @returns Subject line and rendered HTML body, or the reason the email was refused
 */
export async function teamInvitationEmail(params: TeamInvitationProps): Promise<EmailRender> {
  return renderInLayout(
    EMAIL_TEMPLATE_IDS.TEAM_INVITATION,
    `${params.inviterName} invited you to ${params.accountName}`,
    {
      preview: `${params.inviterName} invited you to ${params.accountName}`,
      footerText: memberFooter(params.accountName),
      cta: { text: "Accept Invitation", url: params.acceptUrl },
    },
    { inviterName: params.inviterName, accountName: params.accountName, role: params.role }
  );
}

// ---------------------------------------------------------------------------
// Deleted-account notice
// ---------------------------------------------------------------------------

interface DeletedAccountNoticeProps {
  supportEmail: string;
}

const DELETED_ACCOUNT_NOTICE_SUBJECT =
  "A registration was attempted with your OmniPost email address";

const DELETED_ACCOUNT_NOTICE_HEADING = "Someone tried to register with this email address";

const DELETED_ACCOUNT_NOTICE_ATTEMPT =
  "A new OmniPost registration was attempted with this email address. The address belongs " +
  "to an account that was deleted, so no new account was created.";

const DELETED_ACCOUNT_NOTICE_OPTIONS =
  "The deleted account can be restored, or its deletion can be completed so that the " +
  "address can be registered again. Completing the deletion permanently erases all of the " +
  "account's data and cannot be undone.";

const DELETED_ACCOUNT_NOTICE_IGNORE =
  "If you did not try to register, you can ignore this email. Nothing has changed.";

const DELETED_ACCOUNT_NOTICE_FOOTER =
  "You are receiving this because this email address belongs to a deleted OmniPost account.";

/**
 * @param supportEmail - Where the owner asks for the restore or the completed deletion.
 * @returns The sentence that sends the owner to support. Both owner actions are done by
 *   support today: a deleted account cannot sign in to restore itself, and completing the
 *   deletion is an administrator's operation.
 */
function deletedAccountNoticeContact(supportEmail: string): string {
  return `To restore the account or complete its deletion, contact us at ${supportEmail}.`;
}

/**
 * @function deletedAccountNoticeEmail
 * @description Renders the notice sent to the owner of an address when a registration is
 *   attempted with it while it still belongs to a deleted account. It carries no link and no
 *   secret: the only variable it names is the support address. The HTML and the plain-text part
 *   read the same sentences.
 * @param params - Template parameters (support email)
 * @returns Subject line, rendered HTML body and the plain-text body, or the reason the email
 *   was refused
 */
export async function deletedAccountNoticeEmail(
  params: DeletedAccountNoticeProps
): Promise<EmailRender<RenderedEmail & { text: string }>> {
  const contact = deletedAccountNoticeContact(params.supportEmail);
  const rendered = renderInLayout(
    EMAIL_TEMPLATE_IDS.DELETED_ACCOUNT_NOTICE,
    DELETED_ACCOUNT_NOTICE_SUBJECT,
    {
      preview: DELETED_ACCOUNT_NOTICE_HEADING,
      footerText: DELETED_ACCOUNT_NOTICE_FOOTER,
      cta: null,
    },
    {
      heading: DELETED_ACCOUNT_NOTICE_HEADING,
      attempt: DELETED_ACCOUNT_NOTICE_ATTEMPT,
      options: DELETED_ACCOUNT_NOTICE_OPTIONS,
      contact,
      ignore: DELETED_ACCOUNT_NOTICE_IGNORE,
    }
  );
  if (!rendered.ok) return rendered;
  return ok({
    ...rendered.value,
    text: [
      DELETED_ACCOUNT_NOTICE_HEADING,
      DELETED_ACCOUNT_NOTICE_ATTEMPT,
      DELETED_ACCOUNT_NOTICE_OPTIONS,
      contact,
      DELETED_ACCOUNT_NOTICE_IGNORE,
    ].join("\n\n"),
  });
}

// ---------------------------------------------------------------------------
// Referral reward
// ---------------------------------------------------------------------------

interface ReferralRewardEmailProps {
  referrerName: string;
  referredCompanyName: string;
  rewardDays: number;
  newExpiryDate: string;
  totalConversions: number;
  billingUrl: string;
  accountName: string;
}

/**
 * @function referralRewardEmail
 * @description Renders the referral-reward notification email shown when a referred account
 *              becomes a paying customer.
 * @param params - The referrer, the referred company, the reward and the billing link.
 * @returns Subject line and rendered HTML body, or the reason the email was refused
 */
export async function referralRewardEmail(params: ReferralRewardEmailProps): Promise<EmailRender> {
  return renderInLayout(
    EMAIL_TEMPLATE_IDS.REFERRAL_REWARD,
    `You earned ${params.rewardDays} free days! ${params.referredCompanyName} just became a customer.`,
    {
      preview: `You earned ${String(params.rewardDays)} free days!`,
      footerText: memberFooter(params.accountName),
      cta: { text: "View your account", url: params.billingUrl },
    },
    {
      referrerName: params.referrerName,
      referredCompanyName: params.referredCompanyName,
      rewardDays: params.rewardDays,
      newExpiryDate: params.newExpiryDate,
      hasSeveralConversions: params.totalConversions > 1,
      totalConversions: params.totalConversions,
      totalDaysEarned: params.totalConversions * params.rewardDays,
    }
  );
}

// ---------------------------------------------------------------------------
// Plain notification
// ---------------------------------------------------------------------------

interface PlainNotificationProps {
  title: string;
  body: string;
}

/**
 * @function plainNotificationEmail
 * @description Renders a notification that has no template of its own: its title as the
 *   subject and its body, escaped, in a bare paragraph.
 * @param params - The notification's title and body.
 * @returns Subject line and rendered HTML body, or the reason the email was refused
 */
export async function plainNotificationEmail(params: PlainNotificationProps): Promise<EmailRender> {
  const html = engine.renderEmail(EMAIL_TEMPLATE_IDS.PLAIN_NOTIFICATION, { body: params.body });
  return html.ok ? ok({ subject: params.title, html: html.value }) : html;
}
