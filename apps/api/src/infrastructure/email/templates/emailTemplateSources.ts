/**
 * @file emailTemplateSources.ts
 * @description The Handlebars sources of the transactional emails: the layout every email shares
 *              and the catalogue of email templates, each with the variables it reads. Values are
 *              interpolated with `{{ }}` only, so the engine HTML-escapes every one of them; the
 *              `${…}` placeholders are this file's own style constants, resolved once at load.
 *              The markup is the table layout email clients render consistently, with inline
 *              styles and the Outlook (`mso`) conditional comments of the call-to-action button.
 * @layer infrastructure
 */

import type { Template, TemplateVariable } from "@shared/types";
import { EMAIL_LAYOUT_PARTIAL } from "../EmailTemplateEngine.js";

/** The id of each template of the catalogue. */
export const EMAIL_TEMPLATE_IDS = {
  APPROVAL_REQUESTED: "email.approval-requested",
  APPROVAL_DECISION: "email.approval-decision",
  MENTION: "email.mention",
  PASSWORD_RESET: "email.password-reset",
  WELCOME: "email.welcome",
  TEAM_INVITATION: "email.team-invitation",
  DELETED_ACCOUNT_NOTICE: "email.deleted-account-notice",
  REFERRAL_REWARD: "email.referral-reward",
  PLAIN_NOTIFICATION: "email.plain-notification",
} as const;

/** One template id of the catalogue. */
export type EmailTemplateId = (typeof EMAIL_TEMPLATE_IDS)[keyof typeof EMAIL_TEMPLATE_IDS];

// ---------------------------------------------------------------------------
// Markup constants
// ---------------------------------------------------------------------------

/** The attributes of a layout table: full width, no spacing, read by screen readers as layout. */
const TABLE = `align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation"`;

/**
 * A margin of 0, with its longhands repeated after the shorthand because some clients read only
 * the longhands. The other margins below follow the same pattern.
 */
const NO_MARGIN = "margin:0;margin-top:0;margin-bottom:0;margin-left:0;margin-right:0";
const MARGIN_BELOW_4 = "margin:0 0 4px;margin-top:0;margin-right:0;margin-bottom:4px;margin-left:0";
const MARGIN_BELOW_8 = "margin:0 0 8px;margin-top:0;margin-right:0;margin-bottom:8px;margin-left:0";
const MARGIN_BELOW_12 =
  "margin:0 0 12px;margin-top:0;margin-right:0;margin-bottom:12px;margin-left:0";
const PARAGRAPH_MARGIN = "margin-top:16px;margin-bottom:16px";

const FONT_STACK = "-apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, sans-serif";
const PAGE_BACKGROUND = "background-color:#f4f4f5";

const STYLE = {
  container: "max-width:600px;margin:0 auto;padding:20px 0",
  header: "background-color:#1a1a2e;padding:24px;border-radius:8px 8px 0 0",
  brand: `font-size:20px;line-height:24px;color:#ffffff;font-weight:bold;${NO_MARGIN}`,
  content: "background-color:#ffffff;padding:32px;border-radius:0 0 8px 8px",
  footer: "padding:16px;text-align:center",
  card: "background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0",
  callToAction: "text-align:center;margin-top:32px",
  heading: `font-size:18px;line-height:24px;font-weight:600;color:#111827;${MARGIN_BELOW_12}`,
  paragraph: `font-size:14px;line-height:24px;color:#4b5563;${PARAGRAPH_MARGIN}`,
  cardTitle: `font-size:14px;line-height:24px;font-weight:600;color:#111827;${MARGIN_BELOW_8}`,
  cardText: `font-size:14px;line-height:24px;color:#6b7280;${MARGIN_BELOW_8}`,
  small: `font-size:12px;line-height:24px;color:#9ca3af;${NO_MARGIN}`,
  note: `font-size:13px;line-height:24px;color:#9ca3af;${PARAGRAPH_MARGIN}`,
} as const;

/**
 * The call-to-action button. The empty `<i>` elements inside Outlook's conditional comments
 * stand in for the horizontal padding Outlook ignores on a link.
 */
const BUTTON =
  `<a href="{{ctaUrl}}" style="line-height:100%;text-decoration:none;display:inline-block;` +
  `max-width:100%;mso-padding-alt:0px;background-color:#6366f1;color:#ffffff;padding:12px 32px;` +
  `border-radius:6px;font-weight:600;padding-top:12px;padding-right:32px;padding-bottom:12px;` +
  `padding-left:32px" target="_blank">` +
  `<span><!--[if mso]><i style="mso-font-width:400%;mso-text-raise:18" hidden>` +
  `&#8202;&#8202;&#8202;&#8202;</i><![endif]--></span>` +
  `<span style="max-width:100%;display:inline-block;line-height:120%;mso-padding-alt:0px;` +
  `mso-text-raise:9px">{{ctaText}}</span>` +
  `<span><!--[if mso]><i style="mso-font-width:400%" hidden>` +
  `&#8202;&#8202;&#8202;&#8202;&#8203;</i><![endif]--></span></a>`;

/** Opens a one-cell layout table with a style; `END_SECTION` closes it. */
function section(style: string): string {
  return `<table ${TABLE} style="${style}"><tbody><tr><td>`;
}
const END_SECTION = "</td></tr></tbody></table>";

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * The document every email but the plain notification renders in: the hidden inbox preview, the
 * brand header, the email's own content, its call to action when it has one, and the footer that
 * says why the recipient receives it.
 */
export const EMAIL_LAYOUT = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">
<head>
<meta content="text/html; charset=UTF-8" http-equiv="Content-Type"/>
<meta name="x-apple-disable-message-reformatting"/>
</head>
<body style="${PAGE_BACKGROUND};margin:0;padding:0">
<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">{{preview}}{{#if previewPadding}}<div>{{previewPadding}}</div>{{/if}}</div>
<table border="0" width="100%" cellPadding="0" cellSpacing="0" role="presentation" align="center"><tbody><tr><td style="${PAGE_BACKGROUND};font-family:${FONT_STACK};margin:0;padding:0">
<table ${TABLE} style="${STYLE.container}"><tbody><tr style="width:100%"><td>
${section(STYLE.header)}<p style="${STYLE.brand}">OmniPost</p>${END_SECTION}
${section(STYLE.content)}
{{> @partial-block}}
{{#if ctaUrl}}
${section(STYLE.callToAction)}${BUTTON}${END_SECTION}
{{/if}}
${END_SECTION}
${section(STYLE.footer)}<p style="${STYLE.small}">{{footerText}}</p>${END_SECTION}
</td></tr></tbody></table>
</td></tr></tbody></table>
</body>
</html>`;

/** Wraps an email's content in the layout. */
function inLayout(content: string): string {
  return `{{#> ${EMAIL_LAYOUT_PARTIAL}}}\n${content}\n{{/${EMAIL_LAYOUT_PARTIAL}}}`;
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

function text(name: string): TemplateVariable {
  return { name, type: "string", required: true };
}
function optionalText(name: string): TemplateVariable {
  return { name, type: "string", required: false };
}
function flag(name: string): TemplateVariable {
  return { name, type: "boolean", required: true };
}

/** The variables the layout reads, which every email in the layout carries. */
const LAYOUT_VARIABLES: readonly TemplateVariable[] = [
  text("preview"),
  optionalText("previewPadding"),
  optionalText("ctaText"),
  optionalText("ctaUrl"),
  text("footerText"),
];

/** A template of the catalogue that renders in the layout. */
function emailTemplate(
  id: EmailTemplateId,
  name: string,
  variables: readonly TemplateVariable[],
  content: string
): Template {
  return {
    id,
    name,
    category: "email",
    content: inLayout(content),
    variables: [...LAYOUT_VARIABLES, ...variables],
    platforms: [],
  };
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

const APPROVAL_REQUESTED = emailTemplate(
  EMAIL_TEMPLATE_IDS.APPROVAL_REQUESTED,
  "Approval requested",
  [
    text("authorName"),
    text("postTitle"),
    text("postPreview"),
    flag("postPreviewTruncated"),
    text("platforms"),
  ],
  `<p style="${STYLE.heading}">Action required</p>
<p style="${STYLE.paragraph}"><strong>{{authorName}}</strong> submitted a post for your approval.</p>
${section(STYLE.card)}
<p style="${STYLE.cardTitle}">{{postTitle}}</p>
<p style="${STYLE.cardText}">{{postPreview}}{{#if postPreviewTruncated}}...{{/if}}</p>
<p style="${STYLE.small}">Platforms: {{platforms}}</p>
${END_SECTION}`
);

const APPROVAL_DECISION = emailTemplate(
  EMAIL_TEMPLATE_IDS.APPROVAL_DECISION,
  "Approval decision",
  [
    text("title"),
    text("accentColor"),
    text("reviewerName"),
    text("decision"),
    text("postTitle"),
    optionalText("rejectionReason"),
  ],
  `${section("border-left:4px solid {{accentColor}};padding-left:16px;margin-bottom:16px")}
<p style="font-size:18px;line-height:24px;font-weight:600;color:#111827;${MARGIN_BELOW_8}">{{title}}</p>
<p style="font-size:14px;line-height:24px;color:#4b5563;${NO_MARGIN}"><strong>{{reviewerName}}</strong> {{decision}} your post &quot;{{postTitle}}&quot;.</p>
${END_SECTION}
{{#if rejectionReason}}
${section("background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px;margin:12px 0")}
<p style="font-size:14px;line-height:24px;color:#92400e;${NO_MARGIN}"><strong>Reason:</strong> {{rejectionReason}}</p>
${END_SECTION}
{{/if}}`
);

const MENTION = emailTemplate(
  EMAIL_TEMPLATE_IDS.MENTION,
  "Mention",
  [text("mentionerName"), text("context"), text("textPreview")],
  `<p style="${STYLE.heading}">You were mentioned</p>
<p style="${STYLE.paragraph}"><strong>{{mentionerName}}</strong> mentioned you in a {{context}}.</p>
${section(STYLE.card)}
<p style="font-size:14px;line-height:24px;color:#4b5563;${NO_MARGIN}">{{textPreview}}</p>
${END_SECTION}`
);

const PASSWORD_RESET = emailTemplate(
  EMAIL_TEMPLATE_IDS.PASSWORD_RESET,
  "Password reset",
  [text("userName")],
  `<p style="${STYLE.heading}">Password Reset</p>
<p style="${STYLE.paragraph}">Hi {{userName}}, an administrator has initiated a password reset for your account. Click the button below to set a new password. This link expires in 1 hour.</p>
<p style="font-size:13px;line-height:24px;color:#9ca3af;margin-top:24px;margin-bottom:16px">If you did not expect this, you can safely ignore this email.</p>`
);

const WELCOME = emailTemplate(
  EMAIL_TEMPLATE_IDS.WELCOME,
  "Welcome",
  [text("accountName"), text("supportEmail")],
  `<p style="${STYLE.heading}">Welcome to OmniPost!</p>
<p style="${STYLE.paragraph}">Your account <strong>{{accountName}}</strong> is ready. Here are three quick steps to get the most out of OmniPost:</p>
${section(STYLE.card)}
<p style="${STYLE.cardTitle}">1. Connect your first social account</p>
<p style="font-size:14px;line-height:24px;color:#6b7280;${MARGIN_BELOW_12}">Link your social media profiles to start managing content from one place.</p>
<p style="${STYLE.cardTitle}">2. Create your first post</p>
<p style="font-size:14px;line-height:24px;color:#6b7280;${MARGIN_BELOW_12}">Write, schedule, and publish across all your connected platforms.</p>
<p style="${STYLE.cardTitle}">3. Invite your team</p>
<p style="font-size:14px;line-height:24px;color:#6b7280;${NO_MARGIN}">Collaborate with your team using roles and approval workflows.</p>
${END_SECTION}
<p style="${STYLE.note}">Questions? Reach us at {{supportEmail}}.</p>`
);

const TEAM_INVITATION = emailTemplate(
  EMAIL_TEMPLATE_IDS.TEAM_INVITATION,
  "Team invitation",
  [text("inviterName"), text("accountName"), text("role")],
  `<p style="${STYLE.heading}">You've been invited!</p>
<p style="${STYLE.paragraph}"><strong>{{inviterName}}</strong> invited you to join <strong>{{accountName}}</strong> as a <strong>{{role}}</strong> on OmniPost.</p>
<p style="${STYLE.note}">This invitation expires in 48 hours. If you did not expect this, you can ignore it.</p>`
);

const DELETED_ACCOUNT_NOTICE = emailTemplate(
  EMAIL_TEMPLATE_IDS.DELETED_ACCOUNT_NOTICE,
  "Deleted-account notice",
  [text("heading"), text("attempt"), text("options"), text("contact"), text("ignore")],
  `<p style="${STYLE.heading}">{{heading}}</p>
<p style="${STYLE.paragraph}">{{attempt}}</p>
<p style="${STYLE.paragraph}">{{options}}</p>
<p style="${STYLE.paragraph}">{{contact}}</p>
<p style="${STYLE.note}">{{ignore}}</p>`
);

const REFERRAL_REWARD = emailTemplate(
  EMAIL_TEMPLATE_IDS.REFERRAL_REWARD,
  "Referral reward",
  [
    text("referrerName"),
    text("referredCompanyName"),
    text("rewardDays"),
    text("newExpiryDate"),
    flag("hasSeveralConversions"),
    text("totalConversions"),
    text("totalDaysEarned"),
  ],
  `<p style="${STYLE.heading}">{{referrerName}}, great news!</p>
<p style="${STYLE.paragraph}"><strong>{{referredCompanyName}}</strong> signed up using your referral link and just started their paid subscription.</p>
${section("background-color:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:16px;margin:16px 0;text-align:center")}
<p style="font-size:24px;line-height:24px;font-weight:bold;color:#059669;${MARGIN_BELOW_4}">+{{rewardDays}} free days</p>
<p style="font-size:14px;line-height:24px;color:#065f46;${NO_MARGIN}">Added to your account</p>
${END_SECTION}
<p style="${STYLE.paragraph}">Your plan is now active until <strong>{{newExpiryDate}}</strong>.</p>
{{#if hasSeveralConversions}}
<p style="font-size:14px;line-height:24px;color:#6b7280;${PARAGRAPH_MARGIN}">You have now referred {{totalConversions}} paying customers. That is {{totalDaysEarned}} free days earned!</p>
{{/if}}`
);

/** An unmapped notification's body in a bare paragraph, as the notification fallback sends it. */
const PLAIN_NOTIFICATION: Template = {
  id: EMAIL_TEMPLATE_IDS.PLAIN_NOTIFICATION,
  name: "Plain notification",
  category: "email",
  content: "<p>{{body}}</p>",
  variables: [text("body")],
  platforms: [],
};

/** Every email template, the catalogue the email engine renders from. */
export const EMAIL_TEMPLATES: readonly Template[] = [
  APPROVAL_REQUESTED,
  APPROVAL_DECISION,
  MENTION,
  PASSWORD_RESET,
  WELCOME,
  TEAM_INVITATION,
  DELETED_ACCOUNT_NOTICE,
  REFERRAL_REWARD,
  PLAIN_NOTIFICATION,
];
