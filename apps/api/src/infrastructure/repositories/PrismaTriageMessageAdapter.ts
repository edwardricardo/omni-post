/**
 * @file PrismaTriageMessageAdapter.ts
 * @description Prisma adapter for TriageMessagePort.
 *              Loads social messages, conversation context, and persists triage results.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { TriageMessagePort } from "@core/inbox/TriageInboxMessageUseCase.js";

export class PrismaTriageMessageAdapter implements TriageMessagePort {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method loadMessage
   * @description Loads a social message by ID for triage processing.
   */
  async loadMessage(messageId: string): Promise<{
    id: string;
    body: string;
    provider: string;
    authorHandle: string | null;
    conversationId: string | null;
  } | null> {
    const message = await this.prisma.socialMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        body: true,
        provider: true,
        authorHandle: true,
        conversationId: true,
      },
    });
    return message;
  }

  /**
   * @method getConversationContext
   * @description Retrieves recent messages from a conversation for context.
   */
  async getConversationContext(conversationId: string, limit: number): Promise<string[]> {
    const messages = await this.prisma.socialMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { body: true },
    });
    return messages.map((m) => m.body);
  }

  /**
   * @method updateMessageTriage
   * @description Persists AI triage results on a social message.
   */
  async updateMessageTriage(
    messageId: string,
    data: {
      priority: string;
      suggestedReplies: string[];
      sentimentScore: number;
      crmContactId?: string;
      aiProcessedAt: Date;
    }
  ): Promise<void> {
    await this.prisma.socialMessage.update({
      where: { id: messageId },
      data: {
        priority: data.priority as "URGENT" | "HIGH" | "NORMAL" | "LOW",
        suggestedReplies: data.suggestedReplies,
        sentimentScore: data.sentimentScore,
        ...(data.crmContactId !== undefined && { crmContactId: data.crmContactId }),
        aiProcessedAt: data.aiProcessedAt,
      },
    });
  }
}
