/**
 * @file useComments.ts
 * @description TanStack Query hooks for post comment threads.
 * @layer client-hooks
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  parentId?: string;
  replies: Comment[];
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchComments(postId: string): Promise<Comment[]> {
  const res = await fetch(`/api/backend/posts/${postId}/comments`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch comments");
  const data = (await res.json()) as { ok: boolean; value?: Comment[] };
  return data.ok && data.value ? data.value : [];
}

async function addComment(
  postId: string,
  authorId: string,
  body: string,
  parentId?: string
): Promise<Comment> {
  const res = await fetch(`/api/backend/posts/${postId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authorId, body, ...(parentId ? { parentId } : {}) }),
  });
  if (!res.ok) throw new Error("Failed to add comment");
  const data = (await res.json()) as { ok: boolean; value?: Comment };
  if (!data.ok || !data.value) throw new Error("Comment failed");
  return data.value;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useComments(postId: string | null) {
  return useQuery({
    queryKey: ["comments", postId],
    queryFn: () => fetchComments(postId!),
    enabled: !!postId,
    staleTime: 30_000,
  });
}

export function useAddComment(postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      authorId,
      body,
      parentId,
    }: {
      authorId: string;
      body: string;
      parentId?: string;
    }) => addComment(postId, authorId, body, parentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["comments", postId] });
    },
  });
}
