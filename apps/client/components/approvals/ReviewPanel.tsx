/**
 * @file ReviewPanel.tsx
 * @description Slide-in sheet panel for reviewing a pending approval.
 *              Shows full post content, approve/reject actions, and an embedded comment thread.
 * @layer infrastructure
 */

"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { useApprovePost, useRejectPost } from "@/hooks/api/useApprovals";
import type { ApprovalRequest } from "@/hooks/api/useApprovals";
import { CommentThread } from "@/components/comments/CommentThread";

// ---------------------------------------------------------------------------
// Provider badge (same colours as other components)
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

interface ReviewPanelProps {
  approval: ApprovalRequest | null;
  reviewerId: string;
  onClose: () => void;
}

/**
 * @component ReviewPanel
 * @description Slide-in sheet panel for reviewing a pending approval. Displays full
 *              post content, platform badges, approve/reject actions with a rejection
 *              reason dialog, and an embedded comment thread.
 * @param props.approval - The approval request to review, or null to hide the panel
 * @param props.reviewerId - ID of the reviewer performing the action
 * @param props.onClose - Callback to dismiss the panel
 */
export function ReviewPanel({ approval, reviewerId, onClose }: ReviewPanelProps) {
  const t = useTranslations("approvals.components");
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const approveMutation = useApprovePost();
  const rejectMutation = useRejectPost();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  if (!approval) return null;

  const handleApprove = () => {
    approveMutation.mutate(
      { approvalId: approval.id, reviewerId },
      {
        onSuccess: () => {
          showToast(t("toastApproved"));
          onClose();
        },
        onError: () => showToast(t("toastApproveFailed")),
      }
    );
  };

  const handleReject = () => {
    if (rejectReason.trim().length < 10) return;
    rejectMutation.mutate(
      { approvalId: approval.id, reviewerId, comment: rejectReason.trim() },
      {
        onSuccess: () => {
          showToast(t("toastRejected", { reason: rejectReason.trim().slice(0, 60) }));
          setShowRejectDialog(false);
          setRejectReason("");
          onClose();
        },
        onError: () => showToast(t("toastRejectFailed")),
      }
    );
  };

  return (
    <>
      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-[60] rounded-lg bg-white border border-gray-200 px-4 py-3 text-sm text-gray-800 shadow-lg"
        >
          {toast}
        </div>
      )}

      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-panel-title"
        className="fixed right-0 top-0 bottom-0 z-50 flex w-full max-w-[600px] flex-col bg-white shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 shrink-0">
          <div>
            <h2 id="review-panel-title" className="text-base font-semibold text-gray-900">
              {t("reviewPostTitle")}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {t("submittedBy", { name: approval.submitterName })}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t("closePanelAria")}
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Platform badges */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {approval.platforms.map((p) => {
              const colour = PROVIDER_COLOURS[p.toLowerCase()] ?? "bg-gray-500 text-white";
              return (
                <span
                  key={p}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${colour}`}
                >
                  {p}
                </span>
              );
            })}
          </div>

          {/* Post content */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 mb-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
              {t("postContentLabel")}
            </p>
            <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
              {approval.postContent || t("noContent")}
            </p>
          </div>

          {/* Approve / Reject */}
          <div className="flex gap-3 mb-2">
            <button
              onClick={handleApprove}
              disabled={approveMutation.isPending || rejectMutation.isPending}
              className="flex-1 rounded-md bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
            >
              {approveMutation.isPending ? t("approving") : t("approve")}
            </button>
            <button
              onClick={() => setShowRejectDialog(true)}
              disabled={approveMutation.isPending || rejectMutation.isPending}
              className="flex-1 rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              {t("reject")}
            </button>
          </div>

          {/* Comment thread */}
          <CommentThread postId={approval.postId} />
        </div>
      </div>

      {/* Reject dialog */}
      {showRejectDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reject-dialog-title"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
        >
          <button
            type="button"
            aria-label={t("closeRejectDialogAria")}
            className="absolute inset-0 cursor-default"
            onClick={() => {
              setShowRejectDialog(false);
              setRejectReason("");
            }}
          />
          <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 id="reject-dialog-title" className="text-base font-semibold text-gray-900">
              {t("rejectPostTitle")}
            </h3>
            <p className="mt-1 text-sm text-gray-500">{t("rejectReasonHint")}</p>

            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t("rejectReasonPlaceholder")}
              rows={4}
              minLength={10}
              aria-invalid={
                rejectReason.length > 0 && rejectReason.length < 10 ? "true" : undefined
              }
              aria-describedby={
                rejectReason.length > 0 && rejectReason.length < 10
                  ? "reject-reason-error"
                  : undefined
              }
              className="mt-4 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
            />
            {rejectReason.length > 0 && rejectReason.length < 10 && (
              <p id="reject-reason-error" role="alert" className="mt-1 text-xs text-red-500">
                {t("rejectReasonError", { count: rejectReason.length })}
              </p>
            )}

            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowRejectDialog(false);
                  setRejectReason("");
                }}
                className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleReject}
                disabled={rejectReason.trim().length < 10 || rejectMutation.isPending}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {rejectMutation.isPending ? t("rejecting") : t("confirmReject")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
