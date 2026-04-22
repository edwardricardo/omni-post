/**
 * @file ConversationThread.tsx
 * @description Conversation thread panel. Shows message list (with infinite scroll
 *              upwards for older messages), marks messages read on open, and mounts
 *              the ReplyComposer at the bottom.
 * @layer ui
 */

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useConversation, useConversationMessages, useMarkMessageRead } from "@/hooks/api/useInbox";
import { MessageBubble } from "./MessageBubble";
import { ConversationHeader } from "./ConversationHeader";
import { ReplyComposer } from "./ReplyComposer";

interface ConversationThreadProps {
  conversationId: string;
  userId: string;
}

/**
 * @component ConversationThread
 * @description Full conversation thread panel. Loads and displays the message list,
 *              auto-scrolls to the latest message, marks inbound messages as read on
 *              open, and mounts the ReplyComposer at the bottom.
 * @param props.conversationId - ID of the conversation to display
 * @param props.userId - ID of the current user for read receipts and header actions
 */
export function ConversationThread({ conversationId, userId }: ConversationThreadProps) {
  const { data: conversation, isLoading: convLoading } = useConversation(conversationId);
  const { data: messagesData, isLoading: msgLoading } = useConversationMessages(conversationId);
  const markRead = useMarkMessageRead();

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [suggestedText, setSuggestedText] = useState<string | undefined>(undefined);

  const handleSelectReply = useCallback((text: string) => {
    setSuggestedText(text);
  }, []);

  const handleSuggestedTextConsumed = useCallback(() => {
    setSuggestedText(undefined);
  }, []);

  const allMessages = messagesData?.pages.flatMap((p) => p.items) ?? [];

  // Scroll to bottom on initial load and on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allMessages.length]);

  // Mark unread messages as read on thread open. Only react to conversation
  // switches — re-running on every `allMessages` change would re-fire mutations
  // after each poll/refetch; markRead is a stable TanStack mutation.
  useEffect(() => {
    if (!allMessages.length) return;
    allMessages
      .filter((m) => !m.read && m.direction === "INBOUND")
      .forEach((m) => markRead.mutate(m.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const lastMessageId = allMessages.at(-1)?.id ?? null;

  // ---------------------------------------------------------------------------
  // Loading / empty states
  // ---------------------------------------------------------------------------

  if (convLoading || msgLoading) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="border-b border-gray-200 bg-white px-4 py-3 animate-pulse">
          <div className="h-4 w-48 rounded bg-gray-200" />
        </div>
        <div className="flex-1 space-y-4 px-4 py-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className={`flex gap-2 ${i % 2 === 0 ? "flex-row-reverse" : ""}`}>
              <div className="h-7 w-7 rounded-full bg-gray-200 shrink-0" />
              <div className="h-12 w-64 rounded-2xl bg-gray-100" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!conversation) return null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <ConversationHeader conversation={conversation} userId={userId} />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4">
        {allMessages.length === 0 && (
          <p className="py-12 text-center text-sm text-gray-400">
            No messages in this conversation
          </p>
        )}

        {allMessages.map((message) => (
          <MessageBubble key={message.id} message={message} onSelectReply={handleSelectReply} />
        ))}

        <div ref={bottomRef} aria-hidden="true" />
      </div>

      {/* Reply composer */}
      <ReplyComposer
        conversationId={conversationId}
        lastMessageId={lastMessageId}
        provider={conversation.provider}
        {...(suggestedText !== undefined && { suggestedText })}
        onSuggestedTextConsumed={handleSuggestedTextConsumed}
      />
    </div>
  );
}
