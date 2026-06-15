/**
 * @file OverviewTab.tsx
 * @description Configuration status dashboard showing health of all credential groups.
 *   Displays overall health badge and per-group status with clickable navigation cards.
 * @layer infrastructure
 */
"use client";

import { useTranslations } from "next-intl";
import { Badge } from "../ui/Badge.js";
import { SOCIAL_GROUPS, TAB_GROUP_MAP } from "./constants.js";
import type { CredentialGroup } from "./constants.js";
import type { SettingsStatus } from "@/hooks/api/useSettings";

interface OverviewTabProps {
  /** Aggregate settings status with per-group health for each credential group. */
  status: SettingsStatus;
  /** Fired with the target tab key when the user activates a navigation card. */
  onNavigate: (tab: string) => void;
}

const HEALTH_VARIANT: Record<string, "success" | "warning" | "error"> = {
  healthy: "success",
  partial: "warning",
  unconfigured: "error",
};

/** Map a group name to the tab key that manages it */
function groupToTab(group: CredentialGroup): string | null {
  for (const [tab, groups] of Object.entries(TAB_GROUP_MAP)) {
    if (groups.includes(group)) return tab;
  }
  return null;
}

/** Non-social, non-duplicate display groups */
const CARD_GROUPS = [
  "STRIPE",
  "PADDLE",
  "RESEND",
  "AI_POOL",
  "STORAGE",
  "PLATFORM",
  "MONITORING",
] as const satisfies CredentialGroup[];

/**
 * @component OverviewTab
 * @description Configuration status dashboard showing health of all credential groups
 *   with clickable cards that navigate to the relevant settings tab.
 * @param props.status - Configuration status data from useSettingsStatus
 * @param props.onNavigate - Callback to switch to a specific tab
 */
export function OverviewTab({ status, onNavigate }: OverviewTabProps) {
  const t = useTranslations("settings");

  const socialConfigured = SOCIAL_GROUPS.filter((g) => status.groups[g]).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-[var(--text-secondary)]">
          {t("overview.overallHealth")}:
        </span>
        <Badge variant={HEALTH_VARIANT[status.overallHealth] ?? "error"}>
          {t(`overview.${status.overallHealth}`)}
        </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {CARD_GROUPS.map((group) => {
          const configured = !!status.groups[group];
          const tab = groupToTab(group);
          return (
            <button
              key={group}
              type="button"
              onClick={() => tab && onNavigate(tab)}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-left hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <div className="text-sm font-medium text-[var(--text-primary)]">
                {t(`groups.${group}`)}
              </div>
              <div className="mt-1">
                <Badge variant={configured ? "success" : "neutral"} size="sm">
                  {configured ? t("overview.configured") : t("overview.notConfigured")}
                </Badge>
              </div>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => onNavigate("social")}
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-left hover:bg-[var(--bg-elevated)] transition-colors"
        >
          <div className="text-sm font-medium text-[var(--text-primary)]">{t("tabs.social")}</div>
          <div className="mt-1">
            <Badge variant={socialConfigured > 0 ? "success" : "neutral"} size="sm">
              {t("overview.socialCount", { count: socialConfigured })}
            </Badge>
          </div>
        </button>
      </div>

      <p className="text-xs text-[var(--text-tertiary)]">{t("overview.clickToConfigure")}</p>
    </div>
  );
}
