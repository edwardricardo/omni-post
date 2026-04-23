/**
 * @file useApprovals.ts
 * @description TanStack Query hooks for the approval workflow.
 *              Covers: submit for review, pending approvals list, approve, reject.
 * @layer infrastructure
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApprovalRequest {
  id: string;
  postId: string;
  postTitle: string;
  postContent: string;
  submitterId: string;
  submitterName: string;
  submittedAt: string;
  platforms: string[];
  status: "PENDING" | "APPROVED" | "REJECTED";
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchPendingApprovals(reviewerId: string): Promise<ApprovalRequest[]> {
  const res = await fetch(`/api/backend/approvals/pending?reviewerId=${reviewerId}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch pending approvals");
  const data = (await res.json()) as { ok: boolean; value?: ApprovalRequest[] };
  return data.ok && data.value ? data.value : [];
}

async function submitForReview(
  postId: string,
  submitterId: string,
  comment?: string
): Promise<{ approvalId: string }> {
  const res = await fetch(`/api/backend/posts/${postId}/submit-for-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ submitterId, ...(comment ? { comment } : {}) }),
  });
  if (!res.ok) throw new Error("Failed to submit for review");
  const data = (await res.json()) as { ok: boolean; value?: { approvalId: string } };
  if (!data.ok || !data.value) throw new Error("Submission failed");
  return data.value;
}

async function approvePost(
  approvalId: string,
  reviewerId: string,
  comment?: string
): Promise<void> {
  const res = await fetch(`/api/backend/approvals/${approvalId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviewerId, ...(comment ? { comment } : {}) }),
  });
  if (!res.ok) throw new Error("Failed to approve post");
}

async function rejectPost(approvalId: string, reviewerId: string, comment: string): Promise<void> {
  const res = await fetch(`/api/backend/approvals/${approvalId}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviewerId, comment }),
  });
  if (!res.ok) throw new Error("Failed to reject post");
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * @hook usePendingApprovals
 * @description Fetches pending approval requests for a given reviewer with auto-refresh.
 * @param reviewerId - The reviewer whose pending approvals to fetch
 * @returns TanStack Query result with pending approval request array
 */
export function usePendingApprovals(reviewerId: string) {
  return useQuery({
    queryKey: ["approvals", "pending", reviewerId],
    queryFn: () => fetchPendingApprovals(reviewerId),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * @hook useSubmitForReview
 * @description Mutation hook for submitting a post for review approval.
 * @returns TanStack Query mutation that invalidates the posts list on success
 */
export function useSubmitForReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      postId,
      submitterId,
      comment,
    }: {
      postId: string;
      submitterId: string;
      comment?: string;
    }) => submitForReview(postId, submitterId, comment),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["posts"] });
    },
  });
}

/**
 * @hook useApprovePost
 * @description Mutation hook for approving a pending post.
 * @returns TanStack Query mutation that invalidates the approvals list on success
 */
export function useApprovePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      approvalId,
      reviewerId,
      comment,
    }: {
      approvalId: string;
      reviewerId: string;
      comment?: string;
    }) => approvePost(approvalId, reviewerId, comment),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
    },
  });
}

/**
 * @hook useRejectPost
 * @description Mutation hook for rejecting a pending post with a required comment.
 * @returns TanStack Query mutation that invalidates the approvals list on success
 */
export function useRejectPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      approvalId,
      reviewerId,
      comment,
    }: {
      approvalId: string;
      reviewerId: string;
      comment: string;
    }) => rejectPost(approvalId, reviewerId, comment),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
    },
  });
}
