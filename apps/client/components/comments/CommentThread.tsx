/**
 * @file CommentThread.tsx
 * @description Threaded comment list for the post review panel.
 *              Supports 1-level nesting (replies). Shows author initials avatar,
 *              name, body, and timestamp.
 * @layer ui
 */

"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useComments, useAddComment } from "@/hooks/api/useComments";
import type { Comment } from "@/hooks/api/useComments";

// ---------------------------------------------------------------------------
// Single comment row
// ---------------------------------------------------------------------------

interface CommentRowProps {
  comment: Comment;
  onReply?: (parentId: string) => void;
  isReply?: boolean;
}

function CommentRow({ comment, onReply, isReply = false }: CommentRowProps) {
  const initials = comment.authorName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const timeAgo = formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true });

  return (
    <div className={["flex gap-3", isReply && "ml-8"].join(" ")}>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-semibold text-indigo-700">
        {initials}
      </div>
      <div className="flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold text-gray-900">{comment.authorName}</span>
          <span className="text-[10px] text-gray-400">{timeAgo}</span>
        </div>
        <p className="mt-0.5 text-sm text-gray-700 leading-relaxed">{comment.body}</p>
        {!isReply && onReply && (
          <button
            onClick={() => onReply(comment.id)}
            className="mt-1 text-[11px] text-indigo-600 hover:text-indigo-700"
          >
            Reply
          </button>
        )}
        {/* Replies (1 level) */}
        {!isReply && comment.replies.length > 0 && (
          <div className="mt-2 space-y-3">
            {comment.replies.map((reply) => (
              <CommentRow key={reply.id} comment={reply} isReply />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface CommentThreadProps {
  postId: string;
  authorId: string;
}

export function CommentThread({ postId, authorId }: CommentThreadProps) {
  const { data: comments = [], isLoading } = useComments(postId);
  const addCommentMutation = useAddComment(postId);
  const [newBody, setNewBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const handleSubmit = () => {
    if (!newBody.trim()) return;
    addCommentMutation.mutate(
      { authorId, body: newBody.trim(), ...(replyTo ? { parentId: replyTo } : {}) },
      {
        onSuccess: () => {
          setNewBody("");
          setReplyTo(null);
        },
      }
    );
  };

  return (
    <div className="mt-6 border-t border-gray-100 pt-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">
        Comments {comments.length > 0 && `(${comments.length})`}
      </h3>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="flex gap-3 animate-pulse">
              <div className="h-7 w-7 rounded-full bg-gray-200 shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-32 rounded bg-gray-200" />
                <div className="h-3 w-full rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && (
        <div className="space-y-4">
          {comments.map((c) => (
            <CommentRow key={c.id} comment={c} onReply={setReplyTo} />
          ))}
          {comments.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-2">No comments yet</p>
          )}
        </div>
      )}

      {/* Reply / new comment input */}
      <div className="mt-4">
        {replyTo && (
          <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
            <span>Replying to comment</span>
            <button onClick={() => setReplyTo(null)} className="text-red-500 hover:text-red-600">
              Cancel
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder={replyTo ? "Write a reply…" : "Add a comment…"}
            rows={2}
            className="flex-1 resize-none rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <button
            onClick={handleSubmit}
            disabled={!newBody.trim() || addCommentMutation.isPending}
            className="self-end rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {addCommentMutation.isPending ? "…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
