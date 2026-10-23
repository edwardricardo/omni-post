/**
 * @file emailTemplates.test.ts
 * @description Unit tests for the transactional email templates and the Handlebars engine that
 *              renders them: each email's subject, its links, the values it names, the escaping of
 *              every value a user controls, and the engine's strict, read-only catalogue.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect } from "vitest";
import assert from "node:assert/strict";
import type { Result } from "@shared/types";
import {
  approvalRequestedEmail,
  approvalDecisionEmail,
  mentionEmail,
  passwordResetEmail,
  welcomeEmail,
  teamInvitationEmail,
  deletedAccountNoticeEmail,
  referralRewardEmail,
  plainNotificationEmail,
} from "../../../src/infrastructure/email/templates/emailTemplates.js";
import {
  EMAIL_LAYOUT,
  EMAIL_TEMPLATES,
} from "../../../src/infrastructure/email/templates/emailTemplateSources.js";
import { EmailTemplateEngine } from "../../../src/infrastructure/email/EmailTemplateEngine.js";

/** Every character HTML escaping must neutralise, in one value a user could type. */
const HOSTILE = `<img src=x onerror="alert('1')"> & \`tick\``;
/** How HOSTILE reads once escaped by the engine. */
const HOSTILE_ESCAPED =
  "&lt;img src&#x3D;x onerror&#x3D;&quot;alert(&#x27;1&#x27;)&quot;&gt; &amp; &#x60;tick&#x60;";

/** Decodes the character references an HTML parser decodes in an attribute value. */
function decodeAttribute(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

/** The targets of every link of an email, decoded as a mail client reads them. */
function linkTargets(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => decodeAttribute(match[1] ?? ""));
}

/** The rendered email of a render that must succeed. */
function rendered<T>(result: Result<T, Error>): T {
  if (!result.ok) throw new Error(`expected the email to render: ${result.error.message}`);
  return result.value;
}

/** The refusal of a render that must be refused. */
function refusal<T>(result: Result<T, Error>): Error {
  if (result.ok) throw new Error("expected the email to be refused");
  return result.error;
}

/** Asserts the hostile value reached the HTML escaped and never as markup. */
function assertEscaped(html: string): void {
  assert.ok(html.includes(HOSTILE_ESCAPED), "the hostile value is rendered, escaped");
  assert.ok(!html.includes("<img"), "no tag of the hostile value survives");
}

describe("approvalRequestedEmail", () => {
  it("names the post in the subject and links the reviewer to the approvals page", async () => {
    const { subject, html } = rendered(
      await approvalRequestedEmail({
        authorName: "Alice",
        postTitle: "Spring Campaign",
        postPreview: "Check out our new spring collection",
        platforms: ["Instagram", "LinkedIn"],
        reviewUrl: "https://app.omnipost.com/dashboard/approvals",
        accountName: "Acme Corp",
      })
    );

    assert.strictEqual(subject, 'Action required: "Spring Campaign" needs your approval');
    assert.deepStrictEqual(linkTargets(html), ["https://app.omnipost.com/dashboard/approvals"]);
    assert.ok(html.includes("<strong>Alice</strong> submitted a post for your approval."));
    assert.ok(html.includes("Platforms: Instagram, LinkedIn"));
    assert.ok(html.includes("member of Acme Corp."));
  });

  it("cuts the preview at 140 characters and marks the cut", async () => {
    const { html } = rendered(
      await approvalRequestedEmail({
        authorName: "Bob",
        postTitle: "Test Post",
        postPreview: `${"a".repeat(140)}b`,
        platforms: ["X"],
        reviewUrl: "http://localhost:3002/dashboard/approvals",
        accountName: "Test Corp",
      })
    );

    assert.ok(html.includes(`${"a".repeat(140)}...`));
    assert.ok(!html.includes(`${"a".repeat(140)}b`));
  });

  it("escapes every value the author and the account control", async () => {
    const { html } = rendered(
      await approvalRequestedEmail({
        authorName: HOSTILE,
        postTitle: HOSTILE,
        postPreview: HOSTILE,
        platforms: [HOSTILE],
        reviewUrl: "https://app.test/dashboard/approvals",
        accountName: HOSTILE,
      })
    );

    assertEscaped(html);
  });
});

describe("approvalDecisionEmail", () => {
  it("announces an approval and links to the post", async () => {
    const { subject, html } = rendered(
      await approvalDecisionEmail({
        decision: "approved",
        reviewerName: "Jane",
        postTitle: "Q2 Campaign",
        postUrl: "http://localhost:3002/dashboard/posts/123",
        accountName: "Acme",
      })
    );

    assert.strictEqual(subject, 'Your post "Q2 Campaign" has been approved');
    assert.ok(html.includes("Your post has been approved"));
    assert.ok(html.includes("<strong>Jane</strong> approved your post &quot;Q2 Campaign&quot;."));
    assert.deepStrictEqual(linkTargets(html), ["http://localhost:3002/dashboard/posts/123"]);
    assert.ok(!html.includes("Reason:"));
  });

  it("asks for changes and names the reason of a rejection", async () => {
    const { subject, html } = rendered(
      await approvalDecisionEmail({
        decision: "rejected",
        reviewerName: "Admin",
        postTitle: "Draft Post",
        rejectionReason: "Needs more context about the product",
        postUrl: "http://localhost:3002/dashboard/posts/456",
        accountName: "Beta Inc",
      })
    );

    assert.strictEqual(subject, 'Changes requested: "Draft Post"');
    assert.ok(html.includes("Your post needs changes"));
    assert.ok(html.includes("<strong>Reason:</strong> Needs more context about the product"));
  });

  it("escapes the reviewer, the title and the reason", async () => {
    const { html } = rendered(
      await approvalDecisionEmail({
        decision: "rejected",
        reviewerName: HOSTILE,
        postTitle: HOSTILE,
        rejectionReason: HOSTILE,
        postUrl: "https://app.test/dashboard/posts/1",
        accountName: HOSTILE,
      })
    );

    assertEscaped(html);
  });
});

describe("mentionEmail", () => {
  it("names who mentioned the recipient and where, and links to the inbox", async () => {
    const { subject, html } = rendered(
      await mentionEmail({
        mentionerName: "Alice",
        context: "task",
        textPreview: "Hey @bob, can you review this?",
        contextUrl: "http://localhost:3002/dashboard/inbox",
        accountName: "Acme Corp",
      })
    );

    assert.strictEqual(subject, "Alice mentioned you in a task");
    assert.ok(html.includes("<strong>Alice</strong> mentioned you in a task."));
    assert.ok(html.includes("Hey @bob, can you review this?"));
    assert.deepStrictEqual(linkTargets(html), ["http://localhost:3002/dashboard/inbox"]);
  });

  it("cuts the preview at 200 characters and escapes it", async () => {
    const { html } = rendered(
      await mentionEmail({
        mentionerName: HOSTILE,
        context: HOSTILE,
        textPreview: `${HOSTILE}${"m".repeat(250)}`,
        contextUrl: "https://app.test/dashboard/inbox",
        accountName: HOSTILE,
      })
    );

    assertEscaped(html);
    assert.ok(!html.includes("m".repeat(200 - HOSTILE.length + 1)));
  });
});

describe("passwordResetEmail", () => {
  it("greets the user and links to the reset page with its token", async () => {
    const { subject, html } = await passwordResetEmail({
      userName: "Ada",
      resetUrl: "http://localhost:3100/reset-password?token=abc123",
    });

    assert.strictEqual(subject, "Password reset requested — OmniPost Admin");
    assert.ok(html.includes("Hi Ada, an administrator has initiated a password reset"));
    assert.deepStrictEqual(linkTargets(html), [
      "http://localhost:3100/reset-password?token=abc123",
    ]);
  });

  it("escapes the user's name", async () => {
    const { html } = await passwordResetEmail({
      userName: HOSTILE,
      resetUrl: "https://admin.test/reset-password?token=t",
    });

    assertEscaped(html);
  });
});

describe("welcomeEmail", () => {
  it("names the account, links to onboarding and names support", async () => {
    const { subject, html } = rendered(
      await welcomeEmail({
        accountName: "Test Account",
        onboardingUrl: "https://app.test.io/dashboard",
        supportEmail: "help@test.io",
      })
    );

    assert.strictEqual(subject, "Welcome to OmniPost — let's get you set up");
    assert.ok(html.includes("Your account <strong>Test Account</strong> is ready."));
    assert.ok(html.includes("Questions? Reach us at help@test.io."));
    assert.deepStrictEqual(linkTargets(html), ["https://app.test.io/dashboard"]);
  });

  it("escapes the account name", async () => {
    const { html } = rendered(
      await welcomeEmail({
        accountName: HOSTILE,
        onboardingUrl: "https://app.test/dashboard",
        supportEmail: "help@test.io",
      })
    );

    assertEscaped(html);
  });
});

describe("teamInvitationEmail", () => {
  it("names the inviter, the account and the role, and links to the accept page", async () => {
    const { subject, html } = rendered(
      await teamInvitationEmail({
        inviterName: "An admin",
        accountName: "acc-1",
        role: "EDITOR",
        acceptUrl: "https://app.test/accept-invitation?token=tok",
      })
    );

    assert.strictEqual(subject, "An admin invited you to acc-1");
    assert.ok(
      html.includes(
        "<strong>An admin</strong> invited you to join <strong>acc-1</strong> as a <strong>EDITOR</strong> on OmniPost."
      )
    );
    assert.deepStrictEqual(linkTargets(html), ["https://app.test/accept-invitation?token=tok"]);
  });

  it("escapes the inviter, the account and the role", async () => {
    const { html } = rendered(
      await teamInvitationEmail({
        inviterName: HOSTILE,
        accountName: HOSTILE,
        role: HOSTILE,
        acceptUrl: "https://app.test/accept-invitation?token=tok",
      })
    );

    assertEscaped(html);
  });
});

describe("deletedAccountNoticeEmail", () => {
  it("renders subject, html and text that name support, both options and the erasure", async () => {
    const { subject, html, text } = rendered(
      await deletedAccountNoticeEmail({
        supportEmail: "help@test.io",
      })
    );

    assert.match(subject, /registration was attempted/i);
    for (const body of [html, text]) {
      assert.ok(body.includes("help@test.io"), "the notice sends the owner to support");
      assert.match(body, /can be restored/);
      assert.match(body, /deletion can be completed/);
      assert.match(body, /permanently erases all of the account(&#x27;|')s data/);
    }
    assert.ok(html.includes("belongs to a deleted OmniPost account"), "the footer names why");
    assert.ok(!html.includes("member of"), "the recipient is not addressed as a member");
  });

  it("carries no link, token or credential", async () => {
    const { html, text } = rendered(
      await deletedAccountNoticeEmail({ supportEmail: "help@test.io" })
    );

    assert.ok(!html.includes("href="), "the notice has no link to follow");
    assert.doesNotMatch(text, /https?:\/\//);
    for (const body of [html, text]) {
      assert.doesNotMatch(body, /token|password/i);
    }
  });

  it("escapes the support address in the html and keeps it verbatim in the text", async () => {
    const { html, text } = rendered(await deletedAccountNoticeEmail({ supportEmail: HOSTILE }));

    assertEscaped(html);
    assert.ok(text.includes(HOSTILE), "the plain-text part is not HTML");
  });
});

describe("referralRewardEmail", () => {
  const reward = {
    referrerName: "Acme Inc.",
    referredCompanyName: "Globex Corp.",
    rewardDays: 30,
    newExpiryDate: "2026-07-01",
    totalConversions: 3,
    billingUrl: "https://app.test/dashboard/settings/billing",
    accountName: "Acme Inc.",
  };

  it("names the reward and the referred company, and links to billing", async () => {
    const { subject, html } = rendered(await referralRewardEmail(reward));

    assert.strictEqual(subject, "You earned 30 free days! Globex Corp. just became a customer.");
    assert.ok(html.includes("+30 free days"));
    assert.ok(html.includes("Your plan is now active until <strong>2026-07-01</strong>."));
    assert.deepStrictEqual(linkTargets(html), ["https://app.test/dashboard/settings/billing"]);
  });

  it("totals the days earned only once the referrer has more than one conversion", async () => {
    const several = rendered(await referralRewardEmail(reward));
    const first = rendered(await referralRewardEmail({ ...reward, totalConversions: 1 }));

    assert.ok(
      several.html.includes(
        "You have now referred 3 paying customers. That is 90 free days earned!"
      )
    );
    assert.ok(!first.html.includes("You have now referred"));
  });

  it("escapes the referrer, the company, the date and the account", async () => {
    const { html } = rendered(
      await referralRewardEmail({
        ...reward,
        referrerName: HOSTILE,
        referredCompanyName: HOSTILE,
        newExpiryDate: HOSTILE,
        accountName: HOSTILE,
      })
    );

    assertEscaped(html);
  });
});

describe("plainNotificationEmail", () => {
  it("uses the title as subject and renders the body escaped in a paragraph", async () => {
    const { subject, html } = rendered(
      await plainNotificationEmail({ title: "A title", body: HOSTILE })
    );

    assert.strictEqual(subject, "A title");
    assert.strictEqual(html, `<p>${HOSTILE_ESCAPED}</p>`);
  });
});

describe("the call to action", () => {
  const invitation = {
    inviterName: "An admin",
    accountName: "acc-1",
    role: "EDITOR",
    acceptUrl: "https://app.test/accept-invitation?token=tok",
  };

  it.each([
    ["a javascript: link", "javascript:alert(1)"],
    ["a data: link", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
    ["a relative link", "/accept-invitation?token=tok"],
    ["a mailto: link", "mailto:someone@test.io"],
  ])("refuses %s and renders nothing", async (_label, acceptUrl) => {
    const error = refusal(await teamInvitationEmail({ ...invitation, acceptUrl }));

    assert.strictEqual(
      error.message,
      "An email call to action links only to an absolute http(s) URL"
    );
    assert.ok(!error.message.includes("token"), "the refusal does not repeat the link");
  });

  it("renders an absolute https link", async () => {
    const { html } = rendered(await teamInvitationEmail(invitation));

    assert.deepStrictEqual(linkTargets(html), [invitation.acceptUrl]);
  });

  it("refuses a password-reset email whose link is not an absolute http(s) URL", async () => {
    await expect(
      passwordResetEmail({ userName: "Ada", resetUrl: "javascript:alert(1)" })
    ).rejects.toThrow("An email call to action links only to an absolute http(s) URL");
  });

  it("refuses a button with a link but no text, or a text but no link", async () => {
    // The public emails always name their button, so the check is reached through the layout:
    // an empty link stands for the missing half.
    const error = refusal(await teamInvitationEmail({ ...invitation, acceptUrl: " " }));

    assert.strictEqual(error.message, "An email call to action needs both a text and a link");
  });
});

describe("the inbox preview", () => {
  /** The hidden padding that follows the preview text, or null when there is none. */
  function previewPadding(html: string): string | null {
    const match = /<div style="display:none;[^"]*">[^<]*(?:<div>([^<]*)<\/div>)?<\/div>/.exec(html);
    assert.ok(match, "the email has a hidden preview");
    return match[1] ?? null;
  }

  it("pads a short preview with invisible characters up to 150 characters", async () => {
    const short = await passwordResetEmail({ userName: "Ada", resetUrl: "https://a.test/r" });
    const shortPreview = "Password reset requested for your account";

    const padding = previewPadding(short.html);

    assert.ok(short.html.includes(`>${shortPreview}<div>`), "the preview text comes first");
    assert.strictEqual(padding?.length, 150 - shortPreview.length);
    assert.match(padding ?? "", /^[\u00A0\u200B-\u200F\uFEFF]+$/u, "the padding is invisible");
  });

  it("cuts a long preview at 150 characters and adds no padding", async () => {
    const long = rendered(
      await approvalRequestedEmail({
        authorName: "x".repeat(200),
        postTitle: "T",
        postPreview: "P",
        platforms: [],
        reviewUrl: "https://a.test/approvals",
        accountName: "A",
      })
    );

    assert.ok(long.html.includes(`>${"x".repeat(150)}</div>`), "the preview is cut at 150");
    assert.strictEqual(previewPadding(long.html), null, "a full preview needs no padding");
  });
});

describe("EmailTemplateEngine", () => {
  let engine: EmailTemplateEngine;

  beforeEach(() => {
    engine = new EmailTemplateEngine(EMAIL_TEMPLATES, EMAIL_LAYOUT);
  });

  it("refuses a template id the catalogue does not hold", () => {
    assert.strictEqual(
      refusal(engine.renderEmail("email.unknown", {})).message,
      "Unknown email template: email.unknown"
    );
  });

  it("refuses a view that lacks a variable the layout reads", () => {
    const [first] = EMAIL_TEMPLATES;
    assert.ok(first);

    // The first variable the template reads is the layout's preview, so the refusal also shows
    // the layout partial renders in strict mode.
    assert.match(refusal(engine.renderEmail(first.id, {})).message, /"preview" not defined/);
  });

  it("renders every template from a view holding exactly its declared variables", () => {
    for (const template of EMAIL_TEMPLATES) {
      const view = Object.fromEntries(
        template.variables.map((variable) => [
          variable.name,
          variable.type === "boolean" ? true : `${variable.name}-value`,
        ])
      );

      const html = rendered(engine.renderEmail(template.id, view));

      assert.ok(html.length > 0, `${template.id} renders`);
      assert.deepStrictEqual(engine.validate(template.content).errors, [], template.id);
    }
  });

  it("serves the catalogue read-only", async () => {
    const [first] = EMAIL_TEMPLATES;
    assert.ok(first);

    assert.strictEqual(
      (await engine.loadTemplates({ category: "email" })).length,
      EMAIL_TEMPLATES.length
    );
    assert.deepStrictEqual(await engine.loadTemplates({ category: "post" }), []);
    assert.strictEqual(await engine.loadTemplate(first.id), first);
    assert.strictEqual(await engine.loadTemplate("email.unknown"), null);
    await expect(engine.saveTemplate(first)).rejects.toThrow(/read-only/);
    await expect(engine.deleteTemplate(first.id)).rejects.toThrow(/read-only/);
  });
});
