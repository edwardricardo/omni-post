/**
 * @file page.tsx
 * @description Help & Documentation page with accordion-style expandable sections
 *   explaining every feature of the admin portal.
 * @layer presentation
 */
"use client";

import { useState, useCallback } from "react";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  TrendingUp,
  BarChart3,
  Shield,
  FileText,
  Webhook,
  UserCog,
  ChevronDown,
  ChevronUp,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";

// ---------------------------------------------------------------------------
// Section data
// ---------------------------------------------------------------------------

interface HelpSection {
  id: string;
  icon: LucideIcon;
  title: string;
  shows: string[];
  actions: string[];
  concepts: { term: string; definition: string }[];
}

const HELP_SECTIONS: HelpSection[] = [
  {
    id: "dashboard",
    icon: LayoutDashboard,
    title: "Dashboard Overview",
    shows: [
      "Monthly Recurring Revenue (MRR) and total revenue breakdown",
      "Active accounts and trial counts",
      "Plan distribution across custom, bundle, trial, and no-plan categories",
      "Revenue split between monthly and yearly subscriptions",
    ],
    actions: [
      "Refresh data to get the latest metrics",
      "Navigate to detail pages via Quick Actions cards",
    ],
    concepts: [
      {
        term: "MRR",
        definition:
          "Monthly Recurring Revenue -- the total predictable revenue earned per month from all active subscriptions.",
      },
    ],
  },
  {
    id: "accounts",
    icon: Users,
    title: "Accounts",
    shows: [
      "All customer accounts with subscription, trial, and usage information",
      "Account status (active, suspended, trial)",
      "Subscription tier and billing details per account",
    ],
    actions: [
      "View and edit account details",
      "View billing breakdown for each account",
      "Change subscription plan",
      "Suspend or activate accounts",
      "Extend trial periods for trial accounts",
    ],
    concepts: [
      {
        term: "Grandfathered",
        definition:
          "A customer locked into an old price after a price increase. They keep paying the original rate until they change plans.",
      },
    ],
  },
  {
    id: "subscriptions",
    icon: CreditCard,
    title: "Subscriptions",
    shows: [
      "Active, trial, and cancelled subscriptions",
      "Revenue metrics and subscription counts",
      "Trial conversion rates and expiration dates",
    ],
    actions: [
      "Cancel subscriptions",
      "Convert trial accounts to paid plans",
      "Change subscription plans for existing customers",
      "Process auto-renewals",
    ],
    concepts: [
      {
        term: "MRR",
        definition: "Monthly Recurring Revenue -- the total predictable revenue earned per month.",
      },
      {
        term: "Churn",
        definition: "Customers who cancelled their subscription within a given period.",
      },
    ],
  },
  {
    id: "pricing",
    icon: TrendingUp,
    title: "Pricing Configuration",
    shows: [
      "Provider tiers with volume-based pricing",
      "Account tiers with multi-account discounts",
      "Predefined bundles combining providers and accounts",
    ],
    actions: ["Create, edit, and deactivate provider tiers", "Create, edit, and delete bundles"],
    concepts: [
      {
        term: "Provider Tiers",
        definition:
          "Price per social platform, often with volume discounts as more channels are added.",
      },
      {
        term: "Account Tiers",
        definition:
          "Discount structure for customers managing multiple accounts on the same platform.",
      },
      {
        term: "Bundles",
        definition:
          "Predefined packages that combine provider tiers and account tiers at a fixed price.",
      },
      {
        term: "Grandfathering",
        definition:
          "Existing customers keep their old price when a price increase is applied to new customers.",
      },
    ],
  },
  {
    id: "executive",
    icon: BarChart3,
    title: "Executive Dashboard",
    shows: [
      "Business KPIs and growth metrics",
      "Compliance overview and health scores",
      "Revenue trends and customer lifetime value",
    ],
    actions: [],
    concepts: [
      {
        term: "MRR",
        definition: "Monthly Recurring Revenue.",
      },
      {
        term: "Churn",
        definition: "Rate of customers cancelling their subscriptions.",
      },
      {
        term: "LTV",
        definition:
          "Lifetime Value -- the average revenue earned per customer over the entire duration of their subscription.",
      },
      {
        term: "CAC",
        definition:
          "Customer Acquisition Cost -- how much it costs on average to acquire a new paying customer.",
      },
    ],
  },
  {
    id: "security",
    icon: Shield,
    title: "Security",
    shows: [
      "RBAC overview showing roles and permissions",
      "MFA status for all admin users",
      "Permission hierarchy and access levels",
    ],
    actions: [
      "Change user roles",
      "Enable or disable MFA for admin users",
      "View the full permissions matrix",
    ],
    concepts: [
      {
        term: "RBAC",
        definition:
          "Role-Based Access Control -- permissions are assigned to roles, and roles are assigned to users.",
      },
      {
        term: "MFA",
        definition:
          "Multi-Factor Authentication -- requires a second verification step (e.g. TOTP code) in addition to a password.",
      },
      {
        term: "Roles",
        definition:
          "SUPER_ADMIN has full access, ADMIN can manage accounts and subscriptions, SUPPORT has view-only access.",
      },
    ],
  },
  {
    id: "compliance",
    icon: FileText,
    title: "Compliance",
    shows: [
      "Audit log summary with recent activity",
      "Compliance score and health indicators",
      "GDPR status and data retention policies",
    ],
    actions: [],
    concepts: [
      {
        term: "Audit Logs",
        definition:
          "A tamper-proof record of every action performed in the admin portal, including who did what and when.",
      },
      {
        term: "GDPR",
        definition:
          "General Data Protection Regulation -- European Union law governing how personal data is collected, stored, and processed.",
      },
      {
        term: "Retention",
        definition:
          "How long data (logs, user records, media) is kept before being automatically deleted or archived.",
      },
    ],
  },
  {
    id: "webhooks",
    icon: Webhook,
    title: "Webhooks",
    shows: [
      "Webhook delivery metrics and success rates",
      "Event timeline with delivery status",
      "Active subscriptions and endpoint configuration",
      "Dead letter queue for failed deliveries",
    ],
    actions: [
      "Monitor delivery success and failure rates",
      "Retry failed webhook events",
      "Manage webhook subscriptions and endpoints",
    ],
    concepts: [
      {
        term: "Webhooks",
        definition:
          "HTTP POST notifications sent to external systems when events occur (e.g. subscription created, post published).",
      },
      {
        term: "Dead Letter Queue",
        definition:
          "A holding area for webhook deliveries that failed after all retry attempts. These require manual attention.",
      },
    ],
  },
  {
    id: "admin-users",
    icon: UserCog,
    title: "Admin Users",
    shows: [
      "All admin portal users with their roles and account status",
      "Last login time and MFA enrollment status",
    ],
    actions: [
      "Invite new admin users",
      "Change user roles",
      "Deactivate or reactivate admin accounts",
    ],
    concepts: [
      {
        term: "SUPER_ADMIN",
        definition:
          "Full access to all features, settings, and user management. Only one SUPER_ADMIN should exist.",
      },
      {
        term: "ADMIN",
        definition:
          "Can manage customer accounts, subscriptions, and pricing. Cannot manage other admin users.",
      },
      {
        term: "SUPPORT",
        definition:
          "Read-only access with limited editing capabilities. Intended for customer support agents.",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Accordion section component
// ---------------------------------------------------------------------------

interface AccordionSectionProps {
  section: HelpSection;
  isOpen: boolean;
  onToggle: () => void;
}

function AccordionSection({ section, isOpen, onToggle }: AccordionSectionProps) {
  const Icon = section.icon;
  const sectionHeadingId = `help-heading-${section.id}`;
  const sectionContentId = `help-content-${section.id}`;

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-[var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-lg"
        aria-expanded={isOpen}
        aria-controls={sectionContentId}
        id={sectionHeadingId}
      >
        <div className="flex items-center gap-3">
          <Icon size={20} className="shrink-0 text-[var(--accent)]" aria-hidden="true" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">{section.title}</span>
        </div>
        {isOpen ? (
          <ChevronUp
            size={16}
            className="shrink-0 text-[var(--text-tertiary)]"
            aria-hidden="true"
          />
        ) : (
          <ChevronDown
            size={16}
            className="shrink-0 text-[var(--text-tertiary)]"
            aria-hidden="true"
          />
        )}
      </button>

      {isOpen && (
        <div
          id={sectionContentId}
          role="region"
          aria-labelledby={sectionHeadingId}
          className="border-t border-[var(--border-subtle)] px-5 py-4 space-y-4"
        >
          {/* What it shows */}
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
              What it shows
            </h3>
            <ul className="space-y-1.5">
              {section.shows.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2 text-sm text-[var(--text-secondary)]"
                >
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]"
                    aria-hidden="true"
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* What you can do */}
          {section.actions.length > 0 && (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
                What you can do
              </h3>
              <ul className="space-y-1.5">
                {section.actions.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-sm text-[var(--text-secondary)]"
                  >
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--success)]"
                      aria-hidden="true"
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Key concepts */}
          {section.concepts.length > 0 && (
            <div className="rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-4">
              <h3 className="text-xs font-medium uppercase tracking-wider text-[var(--text-tertiary)] mb-3">
                Key concepts
              </h3>
              <dl className="space-y-2">
                {section.concepts.map((concept) => (
                  <div key={concept.term}>
                    <dt className="text-sm font-medium text-[var(--accent)]">{concept.term}</dt>
                    <dd className="text-sm text-[var(--text-secondary)] ml-0">
                      {concept.definition}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function HelpContent() {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const handleToggle = useCallback((sectionId: string) => {
    setOpenSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  }, []);

  return (
    <div className="p-6">
      <PageHeader
        title="Help & Documentation"
        description="What every feature does and how to use it"
      />

      <div className="space-y-3" role="region" aria-label="Help sections">
        {HELP_SECTIONS.map((section) => (
          <AccordionSection
            key={section.id}
            section={section}
            isOpen={openSections[section.id] === true}
            onToggle={() => handleToggle(section.id)}
          />
        ))}
      </div>
    </div>
  );
}

export default function HelpPage() {
  return <HelpContent />;
}
