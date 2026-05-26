/**
 * @file ApprovalCard.tsx
 * @description Single pending approval card in the approval queue.
 *              Shows: content preview (100 chars), platform badges, submitter name,
 *              relative submission time, and a "Review" button.
 * @layer infrastructure
 */

"use client";

import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import type { ApprovalRequest } from "@/hooks/api/useApprovals";

// ---------------------------------------------------------------------------
// Provider badge colours (same as ConversationCard)
// ---------------------------------------------------------------------------

const PROVIDER_COLOURS: Record<string, string> = {
  x: "bg-black text-white",
  instagram: "bg-gradient-to-br from-purple-500 to-pink-500 text-white",
  facebook: "bg-blue-600 text-white",
  youtube: "bg-red-600 text-white",
  tiktok: "bg-black text-white",
  snapchat: "bg-yellow-400 text-black",
  telegram: "bg-sky-500 text-white",
  pinterest: "bg-red-500 text-white",
  linkedin: "bg-blue-700 text-white",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ApprovalCardProps {
  approval: ApprovalRequest;
  onReview: (approval: ApprovalRequest) => void;
}

/**
 * @component ApprovalCard
 * @description Renders a single pending approval card displaying content preview,
 *              platform badges, submitter info, and a review action button.
 * @param props.approval - The approval request data to display
 * @param props.onReview - Callback invoked when the user clicks the Review button
 */
export function ApprovalCard({ approval, onReview }: ApprovalCardProps) {
  const t = useTranslations("approvals.components");
  const preview =
    approval.postContent.length > 100
      ? `${approval.postContent.slice(0, 100)}…`
      : approval.postContent;
  const timeAgo = formatDistanceToNow(new Date(approval.submittedAt), { addSuffix: true });

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm flex flex-col gap-4 hover:shadow-md transition-shadow">
      {/* Platform badges */}
      <div className="flex flex-wrap gap-1.5">
        {approval.platforms.map((platform) => {
          const colour = PROVIDER_COLOURS[platform.toLowerCase()] ?? "bg-gray-500 text-white";
          return (
            <span
              key={platform}
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${colour}`}
            >
              {platform}
            </span>
          );
        })}
      </div>

      {/* Content preview */}
      <p className="text-sm text-gray-700 leading-relaxed line-clamp-3">
        {preview || t("noContent")}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-gray-600">{approval.submitterName}</p>
          <p className="text-xs text-gray-400">{timeAgo}</p>
        </div>
        <button
          onClick={() => onReview(approval)}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          {t("review")}
        </button>
      </div>
    </div>
  );
}
