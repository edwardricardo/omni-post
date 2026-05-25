/**
 * @file referralRewardEmail.tsx
 * @description React Email template for referral reward notification.
 * @layer infrastructure
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

interface ReferralRewardEmailProps {
  referrerName: string;
  referredCompanyName: string;
  rewardDays: number;
  newExpiryDate: string;
  totalConversions: number;
  billingUrl: string;
  accountName: string;
}

function ReferralRewardEmailComponent(props: ReferralRewardEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{`You earned ${String(props.rewardDays)} free days!`}</Preview>
      <Body
        style={{
          backgroundColor: "#f4f4f5",
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <Container style={{ maxWidth: "600px", margin: "0 auto", padding: "20px 0" }}>
          <Section
            style={{ backgroundColor: "#1a1a2e", padding: "24px", borderRadius: "8px 8px 0 0" }}
          >
            <Text style={{ color: "#fff", fontSize: "20px", fontWeight: "bold", margin: 0 }}>
              OmniPost
            </Text>
          </Section>
          <Section
            style={{ backgroundColor: "#fff", padding: "32px", borderRadius: "0 0 8px 8px" }}
          >
            <Text
              style={{ fontSize: "18px", fontWeight: 600, color: "#111827", margin: "0 0 12px" }}
            >
              {props.referrerName}, great news!
            </Text>
            <Text style={{ color: "#4b5563" }}>
              <strong>{props.referredCompanyName}</strong> signed up using your referral link and
              just started their paid subscription.
            </Text>
            <Section
              style={{
                backgroundColor: "#ecfdf5",
                border: "1px solid #a7f3d0",
                borderRadius: "8px",
                padding: "16px",
                margin: "16px 0",
                textAlign: "center" as const,
              }}
            >
              <Text
                style={{
                  fontSize: "24px",
                  fontWeight: "bold",
                  color: "#059669",
                  margin: "0 0 4px",
                }}
              >
                +{props.rewardDays} free days
              </Text>
              <Text style={{ color: "#065f46", fontSize: "14px", margin: 0 }}>
                Added to your account
              </Text>
            </Section>
            <Text style={{ color: "#4b5563" }}>
              Your plan is now active until <strong>{props.newExpiryDate}</strong>.
            </Text>
            {props.totalConversions > 1 && (
              <Text style={{ color: "#6b7280", fontSize: "14px" }}>
                You have now referred {props.totalConversions} paying customers. That is{" "}
                {props.totalConversions * props.rewardDays} free days earned!
              </Text>
            )}
            <Section style={{ textAlign: "center" as const, marginTop: "32px" }}>
              <Button
                href={props.billingUrl}
                style={{
                  backgroundColor: "#6366f1",
                  color: "#fff",
                  padding: "12px 32px",
                  borderRadius: "6px",
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                View your account
              </Button>
            </Section>
          </Section>
          <Section style={{ padding: "16px", textAlign: "center" as const }}>
            <Text style={{ color: "#9ca3af", fontSize: "12px", margin: 0 }}>
              You are receiving this because you are a member of {props.accountName}.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export async function referralRewardEmail(
  params: ReferralRewardEmailProps
): Promise<{ subject: string; html: string }> {
  return {
    subject: `You earned ${params.rewardDays} free days! ${params.referredCompanyName} just became a customer.`,
    html: await render(React.createElement(ReferralRewardEmailComponent, params)),
  };
}
