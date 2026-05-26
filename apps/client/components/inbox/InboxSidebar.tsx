/**
 * @file InboxSidebar.tsx
 * @description Filter sidebar for the Social Inbox. Provides platform, status,
 *              and message-type filter pills. Filter values mirror the server
 *              `InboxFilter` enums (`status: UNREAD|READ|REPLIED|ARCHIVED`,
 *              `messageType: COMMENT|MENTION|REPLY|DIRECT_MESSAGE`).
 * @layer infrastructure
 */

"use client";

import { useTranslations } from "next-intl";
import type { InboxMessageStatus, InboxMessageWireType } from "@/hooks/api/useInbox";

type Provider =
  | "all"
  | "x"
  | "instagram"
  | "facebook"
  | "youtube"
  | "tiktok"
  | "snapchat"
  | "telegram"
  | "pinterest"
  | "linkedin";

type StatusFilter = "all" | InboxMessageStatus;
type MessageTypeFilter = "all" | InboxMessageWireType;

export interface InboxFilters {
  provider: Provider;
  status: StatusFilter;
  messageType: MessageTypeFilter;
}

interface InboxSidebarProps {
  filters: InboxFilters;
  onChange: (filters: InboxFilters) => void;
}

const PROVIDERS: { label: string; value: Provider }[] = [
  { label: "All", value: "all" },
  { label: "X", value: "x" },
  { label: "Instagram", value: "instagram" },
  { label: "Facebook", value: "facebook" },
  { label: "YouTube", value: "youtube" },
  { label: "TikTok", value: "tiktok" },
  { label: "Snapchat", value: "snapchat" },
  { label: "Telegram", value: "telegram" },
  { label: "Pinterest", value: "pinterest" },
  { label: "LinkedIn", value: "linkedin" },
];

const STATUSES = [
  { labelKey: "filterAll", value: "all" },
  { labelKey: "statusUnread", value: "UNREAD" },
  { labelKey: "statusRead", value: "READ" },
  { labelKey: "statusReplied", value: "REPLIED" },
  { labelKey: "statusArchived", value: "ARCHIVED" },
] as const satisfies ReadonlyArray<{ labelKey: string; value: StatusFilter }>;

const MESSAGE_TYPES = [
  { labelKey: "filterAll", value: "all" },
  { labelKey: "typeMentions", value: "MENTION" },
  { labelKey: "typeComments", value: "COMMENT" },
  { labelKey: "typeReplies", value: "REPLY" },
  { labelKey: "typeDms", value: "DIRECT_MESSAGE" },
] as const satisfies ReadonlyArray<{ labelKey: string; value: MessageTypeFilter }>;

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-3 py-1 rounded-full text-xs font-medium transition-colors",
        active ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

/**
 * @component InboxSidebar
 * @description Filter sidebar for the social inbox. Provides pill-based filters
 *              for message type, status, and platform, mirroring the server's
 *              `InboxFilter` enums exactly.
 * @param props.filters - Current filter selections
 * @param props.onChange - Callback when any filter value changes
 */
export function InboxSidebar({ filters, onChange }: InboxSidebarProps) {
  const t = useTranslations("inbox.components");
  return (
    <div className="h-full flex flex-col border-r border-gray-200 bg-white">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-900">{t("sidebarTitle")}</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            {t("filterTypeHeading")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {MESSAGE_TYPES.map((mt) => (
              <FilterPill
                key={mt.value}
                label={t(mt.labelKey)}
                active={filters.messageType === mt.value}
                onClick={() => onChange({ ...filters, messageType: mt.value })}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            {t("filterStatusHeading")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((s) => (
              <FilterPill
                key={s.value}
                label={t(s.labelKey)}
                active={filters.status === s.value}
                onClick={() => onChange({ ...filters, status: s.value })}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            {t("filterPlatformHeading")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PROVIDERS.map((p) => (
              <FilterPill
                key={p.value}
                label={p.value === "all" ? t("filterAll") : p.label}
                active={filters.provider === p.value}
                onClick={() => onChange({ ...filters, provider: p.value })}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
