/**
 * @file TriageInboxMessageUseCase.ts
 * @description AI-powered message triage: classifies priority, scores sentiment,
 *              and generates three ready-to-send reply suggestions via the
 *              schema-validated structured-output path (`AIServicePort.
 *              generateStructured`). Optional CRM lookup enriches the prompt.
 *              Runs asynchronously after message ingestion. Never throws —
 *              triage is an enhancement, not a requirement for inbox to function.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { AIServicePort } from "../../domain/repositories/AIServicePort.js";
import type { AIMessage } from "../../ai/types.js";
import { triageSpec, type TriageClassification } from "../../ai/structuredSchemas.js";

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

const DEFAULT_TRIAGE_OUTPUT = {
  priority: "NORMAL",
  suggestedReplies: [] as string[],
  sentimentScore: 0,
} as const;

const SYSTEM_PROMPT = [
  "You triage inbound social-inbox messages.",
  "Priority rules:",
  '- "URGENT": complaints, negative feedback, or potential sales leads.',
  '- "HIGH": direct questions needing answers.',
  '- "NORMAL": general comments, compliments.',
  '- "LOW": spam or automated messages.',
  "Always produce exactly three reply suggestions in different tones (professional, warm, direct), 1-3 sentences each, ready to send without editing.",
  "Sentiment score is a number in [-1, 1] (negative = hostile, 0 = neutral, positive = warm).",
].join("\n");

const FEW_SHOT_EXAMPLES: AIMessage[] = [
  {
    role: "user",
    content: 'Message (INSTAGRAM): "This product is terrible, I want a refund!"',
  },
  {
    role: "assistant",
    content: JSON.stringify({
      priority: "URGENT",
      sentimentScore: -0.85,
      suggestedReplies: [
        "We are sorry to hear about your experience. Please DM us your order number and we will resolve this right away.",
        "That sounds really frustrating — we want to make it right. Could you share your order details so we can start the refund?",
        "Apologies for the trouble. Reply with your order ID and we will process the refund today.",
      ],
    }),
  },
  {
    role: "user",
    content: 'Message (X): "Do you ship to Mexico?"',
  },
  {
    role: "assistant",
    content: JSON.stringify({
      priority: "HIGH",
      sentimentScore: 0.1,
      suggestedReplies: [
        "Yes, we ship to Mexico. You will see the available rates at checkout once you enter your address.",
        "We do! Pop your address in at checkout and shipping options will appear, usually 5-7 business days.",
        "Yes — shipping to Mexico is available at checkout.",
      ],
    }),
  },
  {
    role: "user",
    content: 'Message (FACEBOOK): "Love the new launch, great work!"',
  },
  {
    role: "assistant",
    content: JSON.stringify({
      priority: "NORMAL",
      sentimentScore: 0.9,
      suggestedReplies: [
        "Thank you so much — we are thrilled you love it!",
        "Appreciate you! Glad it landed well — more on the way soon.",
        "Thanks for the kind words!",
      ],
    }),
  },
];

function buildUserPrompt(
  message: { body: string; provider: string },
  context: string,
  crmContext: string,
  brandVoice: string | undefined
): string {
  const lines = [`Message (${message.provider}): "${message.body}"`];
  if (crmContext) lines.push(crmContext);
  if (context) lines.push(context);
  if (brandVoice) lines.push(`Match this brand voice: ${brandVoice}`);
  return lines.join("\n");
}

export class TriageInboxMessageUseCase implements UseCase<
  TriageInboxInput,
  TriageInboxOutput,
  UseCaseError
> {
  constructor(
    private readonly port: TriageMessagePort,
    private readonly aiServicePort: AIServicePort,
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
          context = `Conversation context (last ${prevMessages.length} messages):\n${prevMessages.join("\n")}`;
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
          crmContext = `Sender is ${contact.name}${contact.company ? ` from ${contact.company}` : ""} (known CRM contact).`;
        }
      }

      const brandVoice = this.brandVoiceResolver
        ? await this.brandVoiceResolver(input.accountId)
        : undefined;

      const messages: AIMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...FEW_SHOT_EXAMPLES,
        {
          role: "user",
          content: buildUserPrompt(message, context, crmContext, brandVoice),
        },
      ];

      const aiResult = await this.aiServicePort.generateStructured<TriageClassification>(
        messages,
        triageSpec,
        { temperature: 0.3 },
        input.accountId
      );

      if (!aiResult.ok) {
        return ok({
          ...DEFAULT_TRIAGE_OUTPUT,
          suggestedReplies: [...DEFAULT_TRIAGE_OUTPUT.suggestedReplies],
          crmContactId,
        });
      }

      const classification = aiResult.value;

      await this.port.updateMessageTriage(input.messageId, {
        priority: classification.priority,
        suggestedReplies: classification.suggestedReplies,
        sentimentScore: classification.sentimentScore,
        ...(crmContactId !== null ? { crmContactId } : {}),
        aiProcessedAt: new Date(),
      });

      return ok({
        priority: classification.priority,
        suggestedReplies: classification.suggestedReplies,
        sentimentScore: classification.sentimentScore,
        crmContactId,
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<TriageInboxOutput, UseCaseError> = ok({
          ...DEFAULT_TRIAGE_OUTPUT,
          suggestedReplies: [...DEFAULT_TRIAGE_OUTPUT.suggestedReplies],
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
}
