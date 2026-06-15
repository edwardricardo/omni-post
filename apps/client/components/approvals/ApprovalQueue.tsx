/**
 * @file ApprovalQueue.tsx
 * @description Grid of pending approval cards with ReviewPanel sheet integration.
 * @layer infrastructure
 */

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { usePendingApprovals } from "@/hooks/api/useApprovals";
import type { ApprovalRequest } from "@/hooks/api/useApprovals";
import { ApprovalCard } from "./ApprovalCard.js";
import { ReviewPanel } from "./ReviewPanel.js";
import { CheckSquare } from "lucide-react";

interface ApprovalQueueProps {
  reviewerId: string;
}

/**
 * @component ApprovalQueue
 * @description Renders a responsive grid of pending approval cards with a slide-in
 *              ReviewPanel sheet for reviewing individual posts. Handles loading,
 *              error, and empty states.
 * @param props.reviewerId - ID of the current reviewer used for approve/reject actions
 */
export function ApprovalQueue({ reviewerId }: ApprovalQueueProps) {
  const t = useTranslations("approvals.components");
  const [selectedApproval, setSelectedApproval] = useState<ApprovalRequest | null>(null);
  const { data: approvals = [], isLoading, isError, refetch } = usePendingApprovals(reviewerId);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 animate-pulse">
            <div className="flex gap-1 mb-4">
              <div className="h-4 w-12 rounded-full bg-gray-200" />
              <div className="h-4 w-16 rounded-full bg-gray-200" />
            </div>
            <div className="space-y-2 mb-4">
              <div className="h-3 w-full rounded bg-gray-100" />
              <div className="h-3 w-3/4 rounded bg-gray-100" />
            </div>
            <div className="flex justify-between items-center">
              <div className="h-3 w-24 rounded bg-gray-200" />
              <div className="h-7 w-16 rounded-md bg-indigo-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-gray-500">{t("loadFailed")}</p>
        <button
          onClick={() => void refetch()}
          className="text-xs text-blue-600 hover:text-blue-700"
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  if (approvals.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="h-12 w-12 rounded-full bg-green-50 flex items-center justify-center">
          <CheckSquare className="h-6 w-6 text-green-500" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-gray-900">{t("emptyTitle")}</p>
        <p className="text-xs text-gray-400">{t("emptyDescription")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {approvals.map((approval) => (
          <ApprovalCard key={approval.id} approval={approval} onReview={setSelectedApproval} />
        ))}
      </div>

      <ReviewPanel
        approval={selectedApproval}
        reviewerId={reviewerId}
        onClose={() => setSelectedApproval(null)}
      />
    </>
  );
}
