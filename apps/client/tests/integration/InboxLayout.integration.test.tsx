/**
 * @file InboxLayout.integration.test.tsx
 * @description Integration tests for the Social Inbox layout: surfaces the
 *              triage classification (priority, sentiment, suggested replies,
 *              CRM badge) on inbox messages, opens a conversation thread on
 *              click, and pre-fills the reply composer when a suggested reply
 *              is selected.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InboxLayout } from "../../components/inbox/InboxLayout";
import type { InboxConversation, InboxMessage, InboxMessagesPage } from "../../hooks/api/useInbox";

const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

const seededMessage: InboxMessage = {
  id: "msg-1",
  accountId: "acc-1",
  projectId: "proj-1",
  channelId: "chan-1",
  conversationId: "conv-1",
  provider: "INSTAGRAM",
  providerMessageId: "ig-m-1",
  providerParentId: null,
  messageType: "COMMENT",
  authorName: "Angry Customer",
  authorHandle: "@angry",
  authorAvatarUrl: null,
  authorProviderId: "ig-author-1",
  body: "This product is terrible, I want a refund!",
  mediaUrls: [],
  webhookEventId: null,
  relatedPostId: null,
  status: "UNREAD",
  assigneeId: null,
  isArchived: false,
  priority: "URGENT",
  sentimentScore: -0.85,
  suggestedReplies: [
    "We are sorry to hear about your experience.",
    "Could you share your order details?",
    "Apologies — please reply with your order id.",
  ],
  aiProcessedAt: "2026-05-20T10:00:00.000Z",
  crmContactId: "crm-1",
  providerCreatedAt: "2026-05-20T09:30:00.000Z",
  createdAt: "2026-05-20T09:30:00.000Z",
  updatedAt: "2026-05-20T10:00:00.000Z",
};

const seededConversation: InboxConversation = {
  id: "conv-1",
  accountId: "acc-1",
  projectId: "proj-1",
  channelId: "chan-1",
  provider: "INSTAGRAM",
  subject: "Refund request",
  participantCount: 1,
  messageCount: 1,
  lastMessageAt: "2026-05-20T09:30:00.000Z",
  isResolved: false,
  resolvedAt: null,
  resolvedById: null,
  rootProviderMessageId: null,
  createdAt: "2026-05-20T09:30:00.000Z",
  updatedAt: "2026-05-20T10:00:00.000Z",
};

const messagesPage = (items: InboxMessage[]): InboxMessagesPage => ({
  items,
  nextCursor: null,
  hasMore: false,
});

const inboxResponse = (items: InboxMessage[]) =>
  jsonResponse({ ok: true, data: messagesPage(items) });
const conversationResponse = () => jsonResponse({ ok: true, data: seededConversation });
const conversationMessagesResponse = (items: InboxMessage[]) =>
  jsonResponse({ ok: true, data: messagesPage(items) });

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

function renderInbox() {
  const client = makeClient();
  return render(
    <QueryClientProvider client={client}>
      <InboxLayout userId="user-1" />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  // jsdom does not implement scrollIntoView — stub it so the thread mount
  // does not throw on the auto-scroll effect.
  Element.prototype.scrollIntoView = vi.fn();
});

describe("InboxLayout", () => {
  it("renders the empty state when the inbox feed has no messages", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/inbox/mentions")) return Promise.resolve(inboxResponse([]));
      return Promise.resolve(inboxResponse([]));
    });

    renderInbox();

    await waitFor(() => expect(screen.getByText("No messages yet")).toBeInTheDocument());
  });

  it("renders an inbox message with priority, sentiment, message-type, and CRM badges", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/inbox/mentions")) return Promise.resolve(inboxResponse([]));
      return Promise.resolve(inboxResponse([seededMessage]));
    });

    renderInbox();

    await waitFor(() => expect(screen.getByText("Angry Customer")).toBeInTheDocument());
    expect(screen.getByText("Comment")).toBeInTheDocument();
    expect(screen.getByText("negative")).toBeInTheDocument();
    expect(screen.getByText("In CRM")).toBeInTheDocument();
    expect(screen.getByLabelText("Priority: URGENT")).toBeInTheDocument();
  });

  it("opens the conversation thread when a message is clicked", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/inbox/mentions")) return Promise.resolve(inboxResponse([]));
      if (url.includes("/inbox/conversations/conv-1/messages")) {
        return Promise.resolve(conversationMessagesResponse([seededMessage]));
      }
      if (url.includes("/inbox/conversations/conv-1")) {
        return Promise.resolve(conversationResponse());
      }
      if (url.includes("/inbox?") || url.endsWith("/inbox")) {
        return Promise.resolve(inboxResponse([seededMessage]));
      }
      return Promise.resolve(inboxResponse([]));
    });

    renderInbox();

    await waitFor(() => expect(screen.getByText("Angry Customer")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Angry Customer"));

    await waitFor(() => expect(screen.getByText("Refund request")).toBeInTheDocument());
    expect(screen.getByText("Open")).toBeInTheDocument();
    // body appears both as the list preview and inside the message bubble
    expect(screen.getAllByText(seededMessage.body).length).toBeGreaterThanOrEqual(2);
  });

  it("pre-fills the reply composer when a suggested-reply chip is clicked", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/inbox/mentions")) return Promise.resolve(inboxResponse([]));
      if (url.includes("/inbox/conversations/conv-1/messages")) {
        return Promise.resolve(conversationMessagesResponse([seededMessage]));
      }
      if (url.includes("/inbox/conversations/conv-1")) {
        return Promise.resolve(conversationResponse());
      }
      if (url.includes("/inbox?") || url.endsWith("/inbox")) {
        return Promise.resolve(inboxResponse([seededMessage]));
      }
      return Promise.resolve(inboxResponse([]));
    });

    renderInbox();

    await waitFor(() => expect(screen.getByText("Angry Customer")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Angry Customer"));

    await waitFor(() =>
      expect(screen.getByText("We are sorry to hear about your experience.")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByText("We are sorry to hear about your experience."));

    await waitFor(() => {
      const textarea = screen.getByLabelText("Reply text") as HTMLTextAreaElement;
      expect(textarea.value).toBe("We are sorry to hear about your experience.");
    });
  });

  it("shows the inbox error state with a retry button when the feed request fails", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/inbox/mentions")) return Promise.resolve(inboxResponse([]));
      return Promise.resolve(jsonResponse({ ok: false, error: "boom" }, 500));
    });

    renderInbox();

    await waitFor(() => expect(screen.getByText("Failed to load inbox")).toBeInTheDocument());
    expect(within(document.body).getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
