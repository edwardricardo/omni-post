/**
 * @file page.tsx
 * @description Help & Documentation page with accordion-style expandable sections
 *   explaining every feature of the admin portal.
 * @layer presentation
 */
"use client";

import { useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
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
  Wrench,
  ScrollText,
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

/** Translation keys in the help namespace, mapped to their icons. */
const SECTION_KEYS: { key: string; id: string; icon: LucideIcon }[] = [
  { key: "dashboard", id: "dashboard", icon: LayoutDashboard },
  { key: "accounts", id: "accounts", icon: Users },
  { key: "subscriptions", id: "subscriptions", icon: CreditCard },
  { key: "pricing", id: "pricing", icon: TrendingUp },
  { key: "analytics", id: "analytics", icon: BarChart3 },
  { key: "security", id: "security", icon: Shield },
  { key: "compliance", id: "compliance", icon: FileText },
  { key: "webhooks", id: "webhooks", icon: Webhook },
  { key: "users", id: "admin-users", icon: UserCog },
  { key: "maintenance", id: "maintenance", icon: Wrench },
  { key: "logs", id: "logs", icon: ScrollText },
];

// ---------------------------------------------------------------------------
// Accordion section component
// ---------------------------------------------------------------------------

interface AccordionSectionProps {
  section: HelpSection;
  isOpen: boolean;
  onToggle: () => void;
  labelShows: string;
  labelActions: string;
  labelConcepts: string;
}

function AccordionSection({
  section,
  isOpen,
  onToggle,
  labelShows,
  labelActions,
  labelConcepts,
}: AccordionSectionProps) {
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
              {labelShows}
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
                {labelActions}
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
                {labelConcepts}
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
  const th = useTranslations("help");

  const sections: HelpSection[] = useMemo(
    () =>
      SECTION_KEYS.map(({ key, id, icon }) => ({
        id,
        icon,
        title: th(`${key}.title`),
        shows: th.raw(`${key}.shows`) as string[],
        actions: th.raw(`${key}.actions`) as string[],
        concepts: th.raw(`${key}.concepts`) as { term: string; definition: string }[],
      })),
    [th]
  );

  const handleToggle = useCallback((sectionId: string) => {
    setOpenSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  }, []);

  const labelShows = th("whatItShows");
  const labelActions = th("whatYouCanDo");
  const labelConcepts = th("keyConcepts");

  return (
    <div className="p-6">
      <PageHeader title={th("title")} description={th("subtitle")} />

      <div className="space-y-3" role="region" aria-label="Help sections">
        {sections.map((section) => (
          <AccordionSection
            key={section.id}
            section={section}
            isOpen={openSections[section.id] === true}
            onToggle={() => handleToggle(section.id)}
            labelShows={labelShows}
            labelActions={labelActions}
            labelConcepts={labelConcepts}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * @component HelpPage
 * @description Displays help and documentation with expandable accordion sections explaining every admin portal feature.
 */
export default function HelpPage() {
  return <HelpContent />;
}
