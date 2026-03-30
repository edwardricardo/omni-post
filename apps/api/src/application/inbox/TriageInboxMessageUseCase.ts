/**
 * @file TriageInboxMessageUseCase.ts
 * @description AI-powered message triage: classifies type, scores priority,
 *              generates 3 reply suggestions in Brand Voice, checks CRM context.
 *              Runs asynchronously after message ingestion. Never throws — triage
 *              is an enhancement, not a requirement for inbox to function.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

export interface TriageInboxInput {
  messageId: string;
  accountId: string;
}

export interface TriageInboxOutput {
  priority: string;
  suggestedReplies: string[];
  sentimentScore: number;
  crmContactId: string | null;
}

export interface TriageMessagePort {
  loadMessage(messageId: string): Promise<{
    id: string;
    body: string;
    provider: string;
    authorHandle: string | null;
    conversationId: string | null;
  } | null>;
  getConversationContext(conversationId: string, limit: number): Promise<string[]>;
  updateMessageTriage(
    messageId: string,
    data: {
      priority: string;
      suggestedReplies: string[];
      sentimentScore: number;
      crmContactId?: string;
      aiProcessedAt: Date;
    }
  ): Promise<void>;
}

export interface TriageCrmPort {
  findContactByHandle(
    accountId: string,
    handle: string
  ): Promise<{
    id: string;
    name: string;
    company: string | null;
  } | null>;
}

export interface TriageAIPort {
  generateContent(
    messages: Array<{ role: string; content: string }>,
    options?: Record<string, unknown>
  ): Promise<{ success: boolean; value?: string }>;
}

export class TriageInboxMessageUseCase implements UseCase<
  TriageInboxInput,
  TriageInboxOutput,
  UseCaseError
> {
  constructor(
    private readonly port: TriageMessagePort,
    private readonly aiPort: TriageAIPort,
    private readonly crmPort?: TriageCrmPort,
    private readonly brandVoiceResolver?: (accountId: string) => Promise<string | undefined>,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(input: TriageInboxInput): Promise<Result<TriageInboxOutput, UseCaseError>> {
    const doWork = async (): Promise<Result<TriageInboxOutput, UseCaseError>> => {
      const message = await this.port.loadMessage(input.messageId);
      if (!message) {
        return err(new UseCaseError("Message not found", USE_CASE_ERRORS.NOT_FOUND));
      }

      let context = "";
      if (message.conversationId) {
        const prevMessages = await this.port.getConversationContext(message.conversationId, 5);
        if (prevMessages.length > 0) {
          context = `\nConversation context (last ${prevMessages.length} messages):\n${prevMessages.join("\n")}`;
        }
      }

      let crmContext = "";
      let crmContactId: string | null = null;
      if (this.crmPort && message.authorHandle) {
        const contact = await this.crmPort.findContactByHandle(
          input.accountId,
          message.authorHandle
        );
        if (contact) {
          crmContactId = contact.id;
          crmContext = `\nThis sender is ${contact.name}${contact.company ? ` from ${contact.company}` : ""} (known CRM contact).`;
        }
      }

      const brandVoice = this.brandVoiceResolver
        ? await this.brandVoiceResolver(input.accountId)
        : undefined;

      const prompt = `Analyze this social media message and respond with ONLY valid JSON:
{
  "priority": "URGENT|HIGH|NORMAL|LOW",
  "sentimentScore": <number between -1.0 and 1.0>,
  "replies": ["reply1", "reply2", "reply3"]
}

Rules for priority:
- URGENT: complaints, negative feedback, or potential leads
- HIGH: direct questions needing answers
- NORMAL: general comments, compliments
- LOW: spam, automated messages

Generate 3 reply suggestions:
- Different tones: professional, warm, direct
- 1-3 sentences each
- Ready to send without editing
${brandVoice ? `- Use this brand voice: ${brandVoice}` : ""}
${crmContext}
${context}

Message (${message.provider}): "${message.body}"`;

      const result = await this.aiPort.generateContent([{ role: "user", content: prompt }]);

      if (!result.success || !result.value) {
        return ok({
          priority: "NORMAL",
          suggestedReplies: [],
          sentimentScore: 0,
          crmContactId,
        });
      }

      const parsed = this.parseTriageResponse(result.value);

      await this.port.updateMessageTriage(input.messageId, {
        priority: parsed.priority,
        suggestedReplies: parsed.replies,
        sentimentScore: parsed.sentimentScore,
        ...(crmContactId !== null ? { crmContactId } : {}),
        aiProcessedAt: new Date(),
      });

      return ok({
        priority: parsed.priority,
        suggestedReplies: parsed.replies,
        sentimentScore: parsed.sentimentScore,
        crmContactId,
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<TriageInboxOutput, UseCaseError> = ok({
          priority: "NORMAL",
          suggestedReplies: [],
          sentimentScore: 0,
          crmContactId: null,
        });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to triage inbox message",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  private parseTriageResponse(raw: string): {
    priority: string;
    sentimentScore: number;
    replies: string[];
  } {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { priority: "NORMAL", sentimentScore: 0, replies: [] };

      const data = JSON.parse(jsonMatch[0]) as {
        priority?: string;
        sentimentScore?: number;
        replies?: string[];
      };

      const validPriorities = new Set(["URGENT", "HIGH", "NORMAL", "LOW"]);
      const priority = validPriorities.has(data.priority ?? "") ? data.priority! : "NORMAL";
      const sentimentScore = Math.max(-1, Math.min(1, data.sentimentScore ?? 0));
      const replies = (data.replies ?? []).filter((r) => typeof r === "string").slice(0, 3);

      return { priority, sentimentScore, replies };
    } catch {
      return { priority: "NORMAL", sentimentScore: 0, replies: [] };
    }
  }
}
