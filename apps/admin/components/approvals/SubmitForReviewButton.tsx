/**
 * @file SubmitForReviewButton.tsx
 * @description "Submit for Review" button for the post editor. Visible only when
 *              the post is in DRAFT status and the current user lacks APPROVE_POST role.
 *              Opens a dialog for an optional comment before submitting.
 * @layer ui
 */

"use client";

import { useState, useCallback } from "react";
import { useSubmitForReview } from "@/hooks/api/useApprovals";

interface SubmitForReviewButtonProps {
  postId: string;
  postStatus: string;
  submitterId: string;
  userRole: string;
  onSubmitted?: () => void;
}

const APPROVER_ROLES = new Set(["ADMIN", "APPROVER", "SUPER_ADMIN"]);

export function SubmitForReviewButton({
  postId,
  postStatus,
  submitterId,
  userRole,
  onSubmitted,
}: SubmitForReviewButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const submitMutation = useSubmitForReview();

  // Only visible for DRAFT posts by non-approvers
  const canSubmit = postStatus === "DRAFT" && !APPROVER_ROLES.has(userRole.toUpperCase());

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const handleConfirm = () => {
    submitMutation.mutate(
      { postId, submitterId, ...(comment.trim() ? { comment: comment.trim() } : {}) },
      {
        onSuccess: () => {
          setDialogOpen(false);
          setComment("");
          showToast("Submitted for review");
          onSubmitted?.();
        },
        onError: () => showToast("Failed to submit. Please try again."),
      }
    );
  };

  if (!canSubmit) return null;

  return (
    <>
      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 rounded-lg bg-amber-100 border border-amber-300 px-4 py-3 text-sm text-amber-800 shadow-md"
        >
          {toast}
        </div>
      )}

      {/* Button */}
      <button
        onClick={() => setDialogOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2"
      >
        Submit for Review
      </button>

      {/* Dialog overlay */}
      {dialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDialogOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 id="submit-dialog-title" className="text-base font-semibold text-gray-900">
              Submit for Review
            </h2>
            <p className="mt-1 text-sm text-gray-500">Add an optional note for the reviewer.</p>

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Optional comment for reviewer…"
              rows={3}
              className="mt-4 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
            />

            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => {
                  setDialogOpen(false);
                  setComment("");
                }}
                className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={submitMutation.isPending}
                className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-60"
              >
                {submitMutation.isPending ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
