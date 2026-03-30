/**
 * @file ReplyComposer.tsx
 * @description Inline reply composer anchored below the conversation thread.
 *              Supports optimistic updates, character counter, and provider-level
 *              reply capability check.
 * @layer ui
 */

"use client";

import { useState, useRef, useCallback } from "react";
import { Send } from "lucide-react";
import { useSendReply } from "@/hooks/api/useInbox";

// Providers that support API-level reply from the dashboard
const REPLY_SUPPORTED_PROVIDERS = new Set(["x", "instagram", "facebook", "youtube", "linkedin"]);

const MAX_CHARS = 2000;
const WARN_THRESHOLD = 1800;

interface ReplyComposerProps {
  conversationId: string;
  lastMessageId: string | null;
  provider: string;
}

export function ReplyComposer({ conversationId, lastMessageId, provider }: ReplyComposerProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sendReplyMutation = useSendReply(conversationId);

  const isSupported = REPLY_SUPPORTED_PROVIDERS.has(provider);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  const handleSend = useCallback(() => {
    if (!text.trim() || !lastMessageId || sendReplyMutation.isPending) return;
    const body = text.trim();

    sendReplyMutation.mutate(
      { messageId: lastMessageId, body },
      {
        onSuccess: () => {
          setText("");
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
          }
        },
      }
    );
  }, [text, lastMessageId, sendReplyMutation]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const charCount = text.length;
  const isOverLimit = charCount >= MAX_CHARS;
  const isWarning = charCount >= WARN_THRESHOLD;

  if (!isSupported) {
    const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
    return (
      <div className="border-t border-gray-200 bg-gray-50 px-4 py-3">
        <p className="text-xs text-gray-500 text-center">
          Replies are not supported for {providerLabel} via API. Reply directly in the{" "}
          {providerLabel} app.
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-200 bg-white px-4 py-3">
      {sendReplyMutation.isError && (
        <div className="mb-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 border border-red-200">
          Failed to send reply. Please try again.
        </div>
      )}

      <div className="flex items-end gap-3">
        <div className="flex-1">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a reply… (Ctrl+Enter to send)"
            disabled={sendReplyMutation.isPending}
            maxLength={MAX_CHARS}
            rows={2}
            className={[
              "w-full resize-none rounded-lg border px-3 py-2 text-sm leading-relaxed",
              "focus:outline-none focus:ring-2 focus:ring-indigo-500",
              "disabled:cursor-not-allowed disabled:opacity-60",
              "transition-colors placeholder:text-gray-400",
              isOverLimit ? "border-red-400" : "border-gray-200",
            ].join(" ")}
            style={{ minHeight: "80px" }}
            aria-label="Reply text"
          />
          <div className="mt-1 flex justify-end">
            <span
              className={[
                "text-xs",
                isOverLimit
                  ? "text-red-600 font-medium"
                  : isWarning
                    ? "text-amber-500"
                    : "text-gray-400",
              ].join(" ")}
            >
              {charCount}/{MAX_CHARS}
            </span>
          </div>
        </div>

        <button
          onClick={handleSend}
          disabled={!text.trim() || isOverLimit || sendReplyMutation.isPending || !lastMessageId}
          aria-label="Send reply"
          className={[
            "mb-6 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium",
            "transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "bg-indigo-600 text-white hover:bg-indigo-700",
          ].join(" ")}
        >
          {sendReplyMutation.isPending ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
          Reply
        </button>
      </div>
    </div>
  );
}
