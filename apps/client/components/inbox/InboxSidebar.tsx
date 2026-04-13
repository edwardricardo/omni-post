/**
 * @file InboxSidebar.tsx
 * @description Filter sidebar for the Social Inbox. Provides platform, status,
 *              and message type (All / Mentions / Comments) filter pills.
 * @layer ui
 */

"use client";

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
type Status = "all" | "OPEN" | "RESOLVED" | "ARCHIVED";
type MessageType = "all" | "mentions" | "comments";

export interface InboxFilters {
  provider: Provider;
  status: Status;
  messageType: MessageType;
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

const STATUSES: { label: string; value: Status }[] = [
  { label: "Open", value: "OPEN" },
  { label: "Resolved", value: "RESOLVED" },
  { label: "Archived", value: "ARCHIVED" },
  { label: "All", value: "all" },
];

const MESSAGE_TYPES: { label: string; value: MessageType }[] = [
  { label: "All", value: "all" },
  { label: "Mentions", value: "mentions" },
  { label: "Comments", value: "comments" },
];

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
 * @description Filter sidebar for the social inbox. Provides pill-based filters for
 *              message type (All/Mentions/Comments), conversation status, and platform.
 * @param props.filters - Current filter selections
 * @param props.onChange - Callback when any filter value changes
 */
export function InboxSidebar({ filters, onChange }: InboxSidebarProps) {
  return (
    <div className="h-full flex flex-col border-r border-gray-200 bg-white">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-900">Inbox</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Type filter */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Type</p>
          <div className="flex flex-wrap gap-1.5">
            {MESSAGE_TYPES.map((t) => (
              <FilterPill
                key={t.value}
                label={t.label}
                active={filters.messageType === t.value}
                onClick={() => onChange({ ...filters, messageType: t.value })}
              />
            ))}
          </div>
        </div>

        {/* Status filter */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Status
          </p>
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((s) => (
              <FilterPill
                key={s.value}
                label={s.label}
                active={filters.status === s.value}
                onClick={() => onChange({ ...filters, status: s.value })}
              />
            ))}
          </div>
        </div>

        {/* Platform filter */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Platform
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PROVIDERS.map((p) => (
              <FilterPill
                key={p.value}
                label={p.label}
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
