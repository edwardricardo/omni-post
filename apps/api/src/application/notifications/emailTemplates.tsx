/**
 * @file emailTemplates.tsx
 * @description React Email templates for notification emails.
 *              Uses @react-email/components for type-safe, previewable templates.
 *              Rendered server-side to HTML via @react-email/render.
 * @layer application
 */

import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Button,
  Preview,
} from "@react-email/components";
import { render } from "@react-email/render";
import * as React from "react";

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const BRAND_COLOR = "#6366f1";
const HEADER_BG = "#1a1a2e";

const bodyStyle: React.CSSProperties = {
  backgroundColor: "#f4f4f5",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  margin: 0,
  padding: 0,
};

const containerStyle: React.CSSProperties = {
  maxWidth: "600px",
  margin: "0 auto",
  padding: "20px 0",
};

const headerStyle: React.CSSProperties = {
  backgroundColor: HEADER_BG,
  padding: "24px",
  borderRadius: "8px 8px 0 0",
};

const contentStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  padding: "32px",
  borderRadius: "0 0 8px 8px",
};

const cardStyle: React.CSSProperties = {
  backgroundColor: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  padding: "16px",
  margin: "16px 0",
};

const ctaStyle: React.CSSProperties = {
  backgroundColor: BRAND_COLOR,
  color: "#ffffff",
  padding: "12px 32px",
  borderRadius: "6px",
  fontWeight: 600,
  textDecoration: "none",
  display: "inline-block",
};

const footerStyle: React.CSSProperties = {
  padding: "16px",
  textAlign: "center" as const,
};

// ---------------------------------------------------------------------------
// Base layout
// ---------------------------------------------------------------------------

interface BaseLayoutProps {
  preview: string;
  accountName: string;
  children: React.ReactNode;
  ctaText?: string;
  ctaUrl?: string;
}

function BaseEmailLayout({ preview, accountName, children, ctaText, ctaUrl }: BaseLayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section style={headerStyle}>
            <Text style={{ color: "#ffffff", fontSize: "20px", fontWeight: "bold", margin: 0 }}>
              OmniPost
            </Text>
          </Section>
          <Section style={contentStyle}>
            {children}
            {ctaText && ctaUrl && (
              <Section style={{ textAlign: "center" as const, marginTop: "32px" }}>
                <Button href={ctaUrl} style={ctaStyle}>
                  {ctaText}
                </Button>
              </Section>
            )}
          </Section>
          <Section style={footerStyle}>
            <Text style={{ color: "#9ca3af", fontSize: "12px", margin: 0 }}>
              You are receiving this because you are a member of {accountName}.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// ---------------------------------------------------------------------------
// Approval Requested
// ---------------------------------------------------------------------------

interface ApprovalRequestedProps {
  authorName: string;
  postTitle: string;
  postPreview: string;
  platforms: string[];
  reviewUrl: string;
  accountName: string;
}

function ApprovalRequestedEmail(props: ApprovalRequestedProps) {
  return (
    <BaseEmailLayout
      preview={`${props.authorName} submitted a post for your approval`}
      accountName={props.accountName}
      ctaText="Review Post"
      ctaUrl={props.reviewUrl}
    >
      <Text style={{ fontSize: "18px", fontWeight: 600, color: "#111827", margin: "0 0 12px" }}>
        Action required
      </Text>
      <Text style={{ color: "#4b5563" }}>
        <strong>{props.authorName}</strong> submitted a post for your approval.
      </Text>
      <Section style={cardStyle}>
        <Text style={{ fontWeight: 600, margin: "0 0 8px", color: "#111827" }}>
          {props.postTitle}
        </Text>
        <Text style={{ color: "#6b7280", fontSize: "14px", margin: "0 0 8px" }}>
          {props.postPreview.slice(0, 140)}
          {props.postPreview.length > 140 ? "..." : ""}
        </Text>
        <Text style={{ color: "#9ca3af", fontSize: "12px", margin: 0 }}>
          Platforms: {props.platforms.join(", ")}
        </Text>
      </Section>
    </BaseEmailLayout>
  );
}

// ---------------------------------------------------------------------------
// Approval Decision
// ---------------------------------------------------------------------------

interface ApprovalDecisionProps {
  decision: "approved" | "rejected";
  reviewerName: string;
  postTitle: string;
  rejectionReason?: string;
  postUrl: string;
  accountName: string;
}

function ApprovalDecisionEmail(props: ApprovalDecisionProps) {
  const isApproved = props.decision === "approved";
  const accentColor = isApproved ? "#10b981" : "#f59e0b";
  const title = isApproved ? "Your post has been approved" : "Your post needs changes";

  return (
    <BaseEmailLayout
      preview={`${props.reviewerName} ${props.decision} your post`}
      accountName={props.accountName}
      ctaText="View Post"
      ctaUrl={props.postUrl}
    >
      <Section
        style={{
          borderLeft: `4px solid ${accentColor}`,
          paddingLeft: "16px",
          marginBottom: "16px",
        }}
      >
        <Text style={{ fontSize: "18px", fontWeight: 600, color: "#111827", margin: "0 0 8px" }}>
          {title}
        </Text>
        <Text style={{ color: "#4b5563", margin: 0 }}>
          <strong>{props.reviewerName}</strong> {props.decision} your post &quot;{props.postTitle}
          &quot;.
        </Text>
      </Section>
      {props.rejectionReason && (
        <Section
          style={{
            background: "#fef3c7",
            border: "1px solid #fde68a",
            borderRadius: "8px",
            padding: "12px",
            margin: "12px 0",
          }}
        >
          <Text style={{ color: "#92400e", fontSize: "14px", margin: 0 }}>
            <strong>Reason:</strong> {props.rejectionReason}
          </Text>
        </Section>
      )}
    </BaseEmailLayout>
  );
}

// ---------------------------------------------------------------------------
// Task Assigned
// ---------------------------------------------------------------------------

interface TaskAssignedProps {
  assignerName: string;
  taskTitle: string;
  taskDescription?: string;
  priority: string;
  dueDate?: string;
  taskUrl: string;
  accountName: string;
}

const priorityColors: Record<string, string> = {
  LOW: "#9ca3af",
  MEDIUM: "#3b82f6",
  HIGH: "#f97316",
  URGENT: "#ef4444",
};

function TaskAssignedEmail(props: TaskAssignedProps) {
  const color = priorityColors[props.priority] ?? "#9ca3af";

  return (
    <BaseEmailLayout
      preview={`${props.assignerName} assigned you a task`}
      accountName={props.accountName}
      ctaText="View Task"
      ctaUrl={props.taskUrl}
    >
      <Text style={{ fontSize: "18px", fontWeight: 600, color: "#111827", margin: "0 0 12px" }}>
        New task assigned
      </Text>
      <Text style={{ color: "#4b5563" }}>
        <strong>{props.assignerName}</strong> assigned you a task.
      </Text>
      <Section style={cardStyle}>
        <Text style={{ fontWeight: 600, margin: "0 0 8px", color: "#111827" }}>
          {props.taskTitle}
        </Text>
        {props.taskDescription && (
          <Text style={{ color: "#6b7280", fontSize: "14px", margin: "0 0 8px" }}>
            {props.taskDescription.slice(0, 200)}
          </Text>
        )}
        <Text style={{ margin: 0 }}>
          <span
            style={{
              background: color,
              color: "#fff",
              padding: "2px 8px",
              borderRadius: "9999px",
              fontSize: "11px",
              fontWeight: 600,
            }}
          >
            {props.priority}
          </span>
          {props.dueDate && (
            <span style={{ color: "#9ca3af", fontSize: "12px", marginLeft: "8px" }}>
              Due: {props.dueDate}
            </span>
          )}
        </Text>
      </Section>
    </BaseEmailLayout>
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

function MentionEmail(props: MentionProps) {
  return (
    <BaseEmailLayout
      preview={`${props.mentionerName} mentioned you`}
      accountName={props.accountName}
      ctaText="View"
      ctaUrl={props.contextUrl}
    >
      <Text style={{ fontSize: "18px", fontWeight: 600, color: "#111827", margin: "0 0 12px" }}>
        You were mentioned
      </Text>
      <Text style={{ color: "#4b5563" }}>
        <strong>{props.mentionerName}</strong> mentioned you in a {props.context}.
      </Text>
      <Section style={cardStyle}>
        <Text style={{ color: "#4b5563", fontSize: "14px", margin: 0 }}>
          {props.textPreview.slice(0, 200)}
        </Text>
      </Section>
    </BaseEmailLayout>
  );
}

// ---------------------------------------------------------------------------
// Public render API — used by SendEmailNotificationService
// ---------------------------------------------------------------------------

export async function approvalRequestedEmail(
  params: ApprovalRequestedProps
): Promise<{ subject: string; html: string }> {
  return {
    subject: `Action required: "${params.postTitle}" needs your approval`,
    html: await render(React.createElement(ApprovalRequestedEmail, params)),
  };
}

export async function approvalDecisionEmail(
  params: ApprovalDecisionProps
): Promise<{ subject: string; html: string }> {
  const isApproved = params.decision === "approved";
  return {
    subject: isApproved
      ? `Your post "${params.postTitle}" has been approved`
      : `Changes requested: "${params.postTitle}"`,
    html: await render(React.createElement(ApprovalDecisionEmail, params)),
  };
}

export async function taskAssignedEmail(
  params: TaskAssignedProps
): Promise<{ subject: string; html: string }> {
  return {
    subject: `Task assigned: "${params.taskTitle}"`,
    html: await render(React.createElement(TaskAssignedEmail, params)),
  };
}

export async function mentionEmail(
  params: MentionProps
): Promise<{ subject: string; html: string }> {
  return {
    subject: `${params.mentionerName} mentioned you in a ${params.context}`,
    html: await render(React.createElement(MentionEmail, params)),
  };
}

// ---------------------------------------------------------------------------
// Password Reset (Admin-initiated)
// ---------------------------------------------------------------------------

interface PasswordResetProps {
  userName: string;
  resetUrl: string;
}

function PasswordResetEmail(props: PasswordResetProps) {
  return (
    <BaseEmailLayout
      preview="Password reset requested for your account"
      accountName="OmniPost Admin"
      ctaText="Reset Password"
      ctaUrl={props.resetUrl}
    >
      <Text style={{ fontSize: "18px", fontWeight: 600, color: "#111827", margin: "0 0 12px" }}>
        Password Reset
      </Text>
      <Text style={{ color: "#4b5563" }}>
        Hi {props.userName}, an administrator has initiated a password reset for your account. Click
        the button below to set a new password. This link expires in 1 hour.
      </Text>
      <Text style={{ color: "#9ca3af", fontSize: "13px", marginTop: "24px" }}>
        If you did not expect this, you can safely ignore this email.
      </Text>
    </BaseEmailLayout>
  );
}

export async function passwordResetEmail(
  params: PasswordResetProps
): Promise<{ subject: string; html: string }> {
  return {
    subject: "Password reset requested — OmniPost Admin",
    html: await render(React.createElement(PasswordResetEmail, params)),
  };
}

// ---------------------------------------------------------------------------
// Dunning (Payment Failed)
// ---------------------------------------------------------------------------

interface DunningProps {
  accountName: string;
  amountDue: string;
  currency: string;
  attemptCount: number;
  updatePaymentUrl: string;
}

function DunningEmail(props: DunningProps) {
  const isFinal = props.attemptCount >= 3;
  const title = isFinal ? "Action Required: Account Suspended" : "Payment Failed";
  const message = isFinal
    ? `We were unable to process your payment of ${props.currency} ${props.amountDue} after multiple attempts. Your account has been suspended. Please update your payment method to restore access.`
    : props.attemptCount === 1
      ? `Your payment of ${props.currency} ${props.amountDue} could not be processed. We will automatically retry in a few days. To avoid interruption, please update your payment method.`
      : `We attempted to charge ${props.currency} ${props.amountDue} again, but the payment failed. This is attempt ${props.attemptCount}. Please update your payment method to avoid account suspension.`;

  return (
    <BaseEmailLayout
      preview={`Payment failed — ${props.currency} ${props.amountDue}`}
      accountName={props.accountName}
      ctaText="Update Payment Method"
      ctaUrl={props.updatePaymentUrl}
    >
      <Text style={{ fontSize: "18px", fontWeight: 600, color: "#111827", margin: "0 0 12px" }}>
        {title}
      </Text>
      <Text style={{ color: "#4b5563" }}>{message}</Text>
    </BaseEmailLayout>
  );
}

export async function dunningEmail(
  params: DunningProps
): Promise<{ subject: string; html: string }> {
  const isFinal = params.attemptCount >= 3;
  return {
    subject: isFinal
      ? "Account suspended — update payment method"
      : `Payment failed — ${params.currency} ${params.amountDue}`,
    html: await render(React.createElement(DunningEmail, params)),
  };
}

// ---------------------------------------------------------------------------
// Subscription Cancelled
// ---------------------------------------------------------------------------

interface SubscriptionCancelledProps {
  accountName: string;
  planName: string;
  accessUntil: string;
  reactivateUrl: string;
}

function SubscriptionCancelledEmail(props: SubscriptionCancelledProps) {
  return (
    <BaseEmailLayout
      preview="Your subscription has been cancelled"
      accountName={props.accountName}
      ctaText="Reactivate Subscription"
      ctaUrl={props.reactivateUrl}
    >
      <Text style={{ fontSize: "18px", fontWeight: 600, color: "#111827", margin: "0 0 12px" }}>
        Subscription Cancelled
      </Text>
      <Text style={{ color: "#4b5563" }}>
        Your {props.planName} subscription has been cancelled. You will continue to have access
        until {props.accessUntil}.
      </Text>
      <Text style={{ color: "#4b5563", marginTop: "16px" }}>
        If this was a mistake or you change your mind, you can reactivate your subscription at any
        time.
      </Text>
    </BaseEmailLayout>
  );
}

export async function subscriptionCancelledEmail(
  params: SubscriptionCancelledProps
): Promise<{ subject: string; html: string }> {
  return {
    subject: "Your subscription has been cancelled",
    html: await render(React.createElement(SubscriptionCancelledEmail, params)),
  };
}

// ---------------------------------------------------------------------------
// Welcome Email (Client Registration)
// ---------------------------------------------------------------------------

interface WelcomeProps {
  accountName: string;
  onboardingUrl: string;
  supportEmail: string;
}

function WelcomeEmail(props: WelcomeProps) {
  return (
    <BaseEmailLayout
      preview={`Welcome to OmniPost, ${props.accountName}!`}
      accountName={props.accountName}
      ctaText="Get Started"
      ctaUrl={props.onboardingUrl}
    >
      <Text style={{ fontSize: "18px", fontWeight: 600, color: "#111827", margin: "0 0 12px" }}>
        Welcome to OmniPost!
      </Text>
      <Text style={{ color: "#4b5563" }}>
        Your account <strong>{props.accountName}</strong> is ready. Here are three quick steps to
        get the most out of OmniPost:
      </Text>
      <Section style={cardStyle}>
        <Text style={{ fontWeight: 600, margin: "0 0 8px", color: "#111827" }}>
          1. Connect your first social account
        </Text>
        <Text style={{ color: "#6b7280", fontSize: "14px", margin: "0 0 12px" }}>
          Link your social media profiles to start managing content from one place.
        </Text>
        <Text style={{ fontWeight: 600, margin: "0 0 8px", color: "#111827" }}>
          2. Create your first post
        </Text>
        <Text style={{ color: "#6b7280", fontSize: "14px", margin: "0 0 12px" }}>
          Write, schedule, and publish across all your connected platforms.
        </Text>
        <Text style={{ fontWeight: 600, margin: "0 0 8px", color: "#111827" }}>
          3. Invite your team
        </Text>
        <Text style={{ color: "#6b7280", fontSize: "14px", margin: 0 }}>
          Collaborate with your team using roles and approval workflows.
        </Text>
      </Section>
      <Text style={{ color: "#9ca3af", fontSize: "13px", marginTop: "16px" }}>
        Questions? Reach us at {props.supportEmail}.
      </Text>
    </BaseEmailLayout>
  );
}

export async function welcomeEmail(
  params: WelcomeProps
): Promise<{ subject: string; html: string }> {
  return {
    subject: `Welcome to OmniPost — let's get you set up`,
    html: await render(React.createElement(WelcomeEmail, params)),
  };
}

// ---------------------------------------------------------------------------
// Team Invitation
// ---------------------------------------------------------------------------

interface TeamInvitationProps {
  inviterName: string;
  accountName: string;
  role: string;
  acceptUrl: string;
}

function TeamInvitationEmail(props: TeamInvitationProps) {
  return (
    <BaseEmailLayout
      preview={`${props.inviterName} invited you to ${props.accountName}`}
      accountName={props.accountName}
      ctaText="Accept Invitation"
      ctaUrl={props.acceptUrl}
    >
      <Text style={{ fontSize: "18px", fontWeight: 600, color: "#111827", margin: "0 0 12px" }}>
        You&apos;ve been invited!
      </Text>
      <Text style={{ color: "#4b5563" }}>
        <strong>{props.inviterName}</strong> invited you to join{" "}
        <strong>{props.accountName}</strong> as a <strong>{props.role}</strong> on OmniPost.
      </Text>
      <Text style={{ color: "#9ca3af", fontSize: "13px", marginTop: "16px" }}>
        This invitation expires in 48 hours. If you did not expect this, you can ignore it.
      </Text>
    </BaseEmailLayout>
  );
}

export async function teamInvitationEmail(
  params: TeamInvitationProps
): Promise<{ subject: string; html: string }> {
  return {
    subject: `${params.inviterName} invited you to ${params.accountName}`,
    html: await render(React.createElement(TeamInvitationEmail, params)),
  };
}
