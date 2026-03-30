/**
 * @file registry.ts
 * @description Static registry of all OmniPost integrations.
 * @layer client-lib
 */

export type IntegrationCategory = "automation" | "crm" | "storage" | "security" | "coming_soon";

export interface IntegrationDefinition {
  id: string;
  name: string;
  description: string;
  category: IntegrationCategory;
  settingsPath: string;
  isComingSoon?: boolean;
  features: string[];
}

export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    id: "zapier",
    name: "Zapier",
    description: "Connect OmniPost to 7,000+ apps",
    category: "automation",
    settingsPath: "/dashboard/settings/integrations",
    features: [
      "Trigger Zaps when posts are published",
      "Create OmniPost drafts from any app",
      "Connect to Slack, Gmail, Notion, and more",
    ],
  },
  {
    id: "make",
    name: "Make",
    description: "Visual automation platform",
    category: "automation",
    settingsPath: "/dashboard/settings/integrations",
    features: [
      "Visual scenario builder",
      "Advanced data transformations",
      "Webhook triggers and actions",
    ],
  },
  {
    id: "hubspot",
    name: "HubSpot",
    description: "Sync contacts and log social activities",
    category: "crm",
    settingsPath: "/dashboard/settings/crm",
    features: [
      "Sync CRM contacts to OmniPost",
      "Log published posts as CRM activities",
      "Contact context in social inbox",
    ],
  },
  {
    id: "salesforce",
    name: "Salesforce",
    description: "Connect your Salesforce CRM",
    category: "crm",
    settingsPath: "/dashboard/settings/crm",
    features: [
      "SOQL-powered contact sync",
      "Activity records for social interactions",
      "Sandbox mode for testing",
    ],
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Import assets from Google Drive",
    category: "storage",
    settingsPath: "/dashboard/assets",
    features: ["Import images and videos directly", "Browser-native Google Picker"],
  },
  {
    id: "saml-sso",
    name: "SAML 2.0 SSO",
    description: "Enterprise single sign-on",
    category: "security",
    settingsPath: "/dashboard/settings/sso",
    features: [
      "Okta, Azure AD, Google Workspace support",
      "SP-initiated login flow",
      "Custom attribute mapping",
    ],
  },
  {
    id: "oidc",
    name: "OpenID Connect",
    description: "Modern OAuth 2.0 SSO",
    category: "security",
    settingsPath: "/dashboard/settings/sso",
    features: ["PKCE flow with auto-discovery", "Auth0, Okta, Cognito support"],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Get notifications in Slack",
    category: "coming_soon",
    settingsPath: "",
    isComingSoon: true,
    features: ["Post publish notifications", "Approval alerts in Slack"],
  },
  {
    id: "notion",
    name: "Notion",
    description: "Sync content briefs from Notion",
    category: "coming_soon",
    settingsPath: "",
    isComingSoon: true,
    features: ["Import content briefs", "Sync campaign notes"],
  },
];
