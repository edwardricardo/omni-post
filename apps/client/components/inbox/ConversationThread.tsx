/**
 * @file ConversationThread.tsx
 * @description Conversation thread panel. Loads the conversation entity + its
 *              messages, marks unread messages read on open, auto-scrolls to
 *              the latest message, and anchors the reply composer at the
 *              bottom.
 * @layer infrastructure
 */

"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
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
 * @description Full conversation thread panel. Renders the header, the message
 *              list (with auto-scroll on update + mark-as-read on open), and
 *              the reply composer. Suggested replies clicked in a message
 *              bubble pre-fill the composer.
 * @param props.conversationId - The conversation id loaded.
 * @param props.userId - Current user id used for header actions.
 */
export function ConversationThread({ conversationId, userId }: ConversationThreadProps) {
  const t = useTranslations("inbox.components");
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

  const allMessages = useMemo(
    () => messagesData?.pages.flatMap((p) => p.items) ?? [],
    [messagesData]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allMessages.length]);

  // Mark unread messages as read on conversation open. Re-running on every
  // `allMessages` change would re-fire mutations on each refetch, so the
  // dependency is intentionally the conversation id only.
  useEffect(() => {
    if (!allMessages.length) return;
    allMessages.filter((m) => m.status === "UNREAD").forEach((m) => markRead.mutate(m.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const lastMessageId = allMessages.at(-1)?.id ?? null;

  if (convLoading || msgLoading) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="border-b border-gray-200 bg-white px-4 py-3 animate-pulse">
          <div className="h-4 w-48 rounded bg-gray-200" />
        </div>
        <div className="flex-1 space-y-4 px-4 py-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-2">
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
      <ConversationHeader conversation={conversation} userId={userId} />

      <div className="flex-1 overflow-y-auto py-4">
        {allMessages.length === 0 && (
          <p className="py-12 text-center text-sm text-gray-400">{t("emptyConversation")}</p>
        )}

        {allMessages.map((message) => (
          <MessageBubble key={message.id} message={message} onSelectReply={handleSelectReply} />
        ))}

        <div ref={bottomRef} aria-hidden="true" />
      </div>

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
