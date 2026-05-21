/**
 * @file CampaignStatusBadge.tsx
 * @description Status badge for campaign display.
 * @layer infrastructure
 */

"use client";

import { useTranslations } from "next-intl";

const STATUS_STYLES = {
  DRAFT: "bg-gray-100 text-gray-700",
  ACTIVE: "bg-green-100 text-green-700",
  PAUSED: "bg-yellow-100 text-yellow-700",
  COMPLETED: "bg-blue-100 text-blue-700",
  ARCHIVED: "bg-gray-100 text-gray-500 line-through",
} as const;

const STATUS_LABEL_KEYS = {
  DRAFT: "statusDraft",
  ACTIVE: "statusActive",
  PAUSED: "statusPaused",
  COMPLETED: "statusCompleted",
  ARCHIVED: "statusArchived",
} as const;

/**
 * @component CampaignStatusBadge
 * @description Color-coded badge displaying a campaign's current status
 * (Draft, Active, Paused, Completed, Archived).
 */
export function CampaignStatusBadge({
  status,
}: {
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";
}) {
  const t = useTranslations("campaigns.components");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {t(STATUS_LABEL_KEYS[status])}
    </span>
  );
}
