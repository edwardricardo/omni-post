/**
 * @file SocialTab.tsx
 * @description Settings tab for social media provider OAuth credentials.
 *   Covers all 11 supported platforms in collapsible sections.
 * @layer infrastructure
 */
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";

import { CredentialForm } from "./CredentialForm.js";
import { buildFieldDefs, SOCIAL_GROUPS } from "./constants.js";

// ---------------------------------------------------------------------------
// Inline collapsible (not a shared UI component)
// ---------------------------------------------------------------------------

function Collapsible({
  title,
  children,
  configured,
}: {
  title: string;
  children: React.ReactNode;
  configured?: boolean | undefined;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-[var(--border-subtle)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center justify-between p-3 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span>{title}</span>
          {configured !== undefined && (
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                configured ? "bg-[var(--success)]" : "bg-[var(--text-tertiary)]"
              }`}
            />
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 text-[var(--text-tertiary)] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && <div className="p-3 pt-0 border-t border-[var(--border-subtle)]">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SocialTabProps {
  /** Map of credential group key to "configured" boolean from settings status. */
  groupStatus?: Record<string, boolean> | undefined;
}

/**
 * @component SocialTab
 * @description Renders 11 social platform credential forms in collapsible sections.
 *   Each section lazy-mounts its CredentialForm when opened.
 * @param props.groupStatus - Optional map of group → configured boolean from status
 */
export function SocialTab({ groupStatus }: SocialTabProps) {
  const t = useTranslations("settings");

  return (
    <div className="space-y-2">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">{t("social.title")}</h3>
        <p className="text-sm text-[var(--text-secondary)] mt-1">{t("social.description")}</p>
      </div>

      {SOCIAL_GROUPS.map((group) => (
        <Collapsible key={group} title={t(`groups.${group}`)} configured={groupStatus?.[group]}>
          <CredentialForm group={group} fields={buildFieldDefs(group, t)} />
        </Collapsible>
      ))}
    </div>
  );
}
