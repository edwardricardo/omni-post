/**
 * @file setupInboxUseCases.ts
 * @description Registers social inbox command, query, and event handler use cases
 *              in the DI container. Extracted from setupUseCases.ts.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type {
  EventDispatcher,
  ChannelRepository,
  SocialMessageRepository,
  SocialMessageQueryRepository,
  SocialConversationRepository,
  SocialOutboundReplyRepository,
} from "../../domain/index.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { CreateNotificationUseCase } from "../../application/notifications/index.js";
import {
  IngestSocialMessageUseCase,
  MarkMessageReadUseCase,
  MarkMessageArchivedUseCase,
  AssignMessageUseCase,
  SendReplyUseCase,
  ResolveConversationUseCase,
  ReopenConversationUseCase,
  SyncProviderCommentsUseCase,
  GetInboxQuery,
  GetMentionsQuery,
  GetConversationQuery,
  GetConversationMessagesQuery,
  GetUnreadInboxCountQuery,
  AddConversationNoteUseCase,
  DeleteConversationNoteUseCase,
  ListConversationNotesQuery,
} from "../../application/inbox/index.js";
import type { ConversationNoteRepository } from "../../domain/repositories/ConversationNoteRepository.js";
import type { NotifyMentionedUsersService } from "../../application/mentions/index.js";
import { InboxEventHandlers } from "../../application/inbox/handlers/InboxEventHandlers.js";
import type { ProviderRegistryService } from "../../providers/providerRegistry.js";
import { DispatchInboxSyncUseCase } from "../../application/inbox/DispatchInboxSyncUseCase.js";
import type { ChannelQueryForIngestion } from "../../application/analytics/DispatchAnalyticsIngestionUseCase.js";
import type { QueuePort } from "@ports/core";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";
import { prisma } from "@infra/prisma";
import { PrismaTriageMessageAdapter } from "../repositories/PrismaTriageMessageAdapter.js";
import { PrismaTriageCrmAdapter } from "../repositories/PrismaTriageCrmAdapter.js";
import {
  TriageInboxMessageUseCase,
  type TriageMessagePort,
  type TriageAIPort,
  type TriageCrmPort,
} from "../../application/inbox/TriageInboxMessageUseCase.js";
import type { AIService } from "../../ai/aiService.js";
import type { BrandVoiceRepository } from "../../domain/repositories/BrandVoiceRepository.js";

/**
 * Register social inbox commands, queries, and event handlers
 */
export function setupInboxUseCases(container: Container): void {
  // Social Inbox Use Cases
  container.register<IngestSocialMessageUseCase>(
    TOKENS.IngestSocialMessageUseCase,
    () =>
      new IngestSocialMessageUseCase(
        container.resolve<SocialMessageRepository>(TOKENS.SocialMessageRepository),
        container.resolve<SocialConversationRepository>(TOKENS.SocialConversationRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<MarkMessageReadUseCase>(
    TOKENS.MarkMessageReadUseCase,
    () =>
      new MarkMessageReadUseCase(
        container.resolve<SocialMessageRepository>(TOKENS.SocialMessageRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<MarkMessageArchivedUseCase>(
    TOKENS.MarkMessageArchivedUseCase,
    () =>
      new MarkMessageArchivedUseCase(
        container.resolve<SocialMessageRepository>(TOKENS.SocialMessageRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<AssignMessageUseCase>(
    TOKENS.AssignMessageUseCase,
    () =>
      new AssignMessageUseCase(
        container.resolve<SocialMessageRepository>(TOKENS.SocialMessageRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<SendReplyUseCase>(
    TOKENS.SendReplyUseCase,
    () => {
      const registry = container.resolve<ProviderRegistryService>(TOKENS.ProviderRegistry);
      return new SendReplyUseCase(
        container.resolve<SocialMessageRepository>(TOKENS.SocialMessageRepository),
        container.resolve<SocialOutboundReplyRepository>(TOKENS.SocialOutboundReplyRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
        container.resolve<ChannelRepository>(TOKENS.ChannelRepository),
        { resolve: (provider) => registry.getAdapter(provider) },
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      );
    },
    true
  );
  container.register<ResolveConversationUseCase>(
    TOKENS.ResolveConversationUseCase,
    () =>
      new ResolveConversationUseCase(
        container.resolve<SocialConversationRepository>(TOKENS.SocialConversationRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<ReopenConversationUseCase>(
    TOKENS.ReopenConversationUseCase,
    () =>
      new ReopenConversationUseCase(
        container.resolve<SocialConversationRepository>(TOKENS.SocialConversationRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<SyncProviderCommentsUseCase>(
    TOKENS.SyncProviderCommentsUseCase,
    () => {
      const registry = container.resolve<ProviderRegistryService>(TOKENS.ProviderRegistry);
      return new SyncProviderCommentsUseCase(
        container.resolve<ChannelRepository>(TOKENS.ChannelRepository),
        container.resolve<IngestSocialMessageUseCase>(TOKENS.IngestSocialMessageUseCase),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork),
        (provider: string) => registry.getAdapter(provider)
      );
    },
    true
  );

  // Social Inbox Queries
  container.register<GetInboxQuery>(
    TOKENS.GetInboxQuery,
    () =>
      new GetInboxQuery(
        container.resolve<SocialMessageQueryRepository>(TOKENS.SocialMessageQueryRepository)
      ),
    true
  );
  container.register<GetMentionsQuery>(
    TOKENS.GetMentionsQuery,
    () =>
      new GetMentionsQuery(
        container.resolve<SocialMessageQueryRepository>(TOKENS.SocialMessageQueryRepository)
      ),
    true
  );
  container.register<GetConversationQuery>(
    TOKENS.GetConversationQuery,
    () =>
      new GetConversationQuery(
        container.resolve<SocialConversationRepository>(TOKENS.SocialConversationRepository)
      ),
    true
  );
  container.register<GetConversationMessagesQuery>(
    TOKENS.GetConversationMessagesQuery,
    () =>
      new GetConversationMessagesQuery(
        container.resolve<SocialMessageQueryRepository>(TOKENS.SocialMessageQueryRepository)
      ),
    true
  );
  container.register<GetUnreadInboxCountQuery>(
    TOKENS.GetUnreadInboxCountQuery,
    () =>
      new GetUnreadInboxCountQuery(
        container.resolve<SocialMessageQueryRepository>(TOKENS.SocialMessageQueryRepository)
      ),
    true
  );

  // Conversation Notes (Social Inbox)
  container.register<AddConversationNoteUseCase>(
    TOKENS.AddConversationNoteUseCase,
    () =>
      new AddConversationNoteUseCase(
        container.resolve<ConversationNoteRepository>(TOKENS.ConversationNoteRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork),
        container.tryResolve<NotifyMentionedUsersService>(TOKENS.NotifyMentionedUsersService)
      ),
    true
  );
  container.register<DeleteConversationNoteUseCase>(
    TOKENS.DeleteConversationNoteUseCase,
    () =>
      new DeleteConversationNoteUseCase(
        container.resolve<ConversationNoteRepository>(TOKENS.ConversationNoteRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<ListConversationNotesQuery>(
    TOKENS.ListConversationNotesQuery,
    () =>
      new ListConversationNotesQuery(
        container.resolve<ConversationNoteRepository>(TOKENS.ConversationNoteRepository)
      ),
    true
  );

  // Inbox Sync Coordinator
  container.register<DispatchInboxSyncUseCase>(
    TOKENS.DispatchInboxSyncUseCase,
    () =>
      new DispatchInboxSyncUseCase(
        container.resolve<ChannelQueryForIngestion>(TOKENS.ChannelQueryForIngestion),
        container.resolve<QueuePort>(TOKENS.QueuePort),
        QUEUE_NAMES.INBOX_SYNC,
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // Social Inbox Event Handlers
  container.register<InboxEventHandlers>(
    TOKENS.InboxEventHandlers,
    () =>
      new InboxEventHandlers(
        container.resolve<CreateNotificationUseCase>(TOKENS.CreateNotificationUseCase)
      ),
    true
  );

  // Inbox Triage — AI-powered message classification and reply suggestions
  container.registerInstance<TriageMessagePort>(
    TOKENS.TriageMessagePort,
    new PrismaTriageMessageAdapter(prisma)
  );
  container.registerInstance<TriageCrmPort>(
    TOKENS.TriageCrmPort,
    new PrismaTriageCrmAdapter(prisma)
  );
  container.register<TriageAIPort>(
    TOKENS.TriageAIPort,
    () => {
      const aiService = container.resolve<AIService>(TOKENS.AIService);
      return {
        async generateContent(
          messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
          _options?: Record<string, unknown>
        ): Promise<{ success: boolean; value?: string }> {
          try {
            const result = await aiService.generateContent(messages);
            const value = typeof result.content === "string" ? result.content : undefined;
            return { success: true, ...(value !== undefined && { value }) };
          } catch {
            return { success: false };
          }
        },
      };
    },
    true
  );
  container.register<TriageInboxMessageUseCase>(
    TOKENS.TriageInboxMessageUseCase,
    () => {
      const brandVoiceRepo = container.tryResolve<BrandVoiceRepository>(
        TOKENS.BrandVoiceRepository
      );
      const brandVoiceResolver = brandVoiceRepo
        ? async (accountId: string): Promise<string | undefined> => {
            const bv = await brandVoiceRepo.findByAccountId(accountId);
            return bv?.systemPrompt ?? undefined;
          }
        : undefined;

      return new TriageInboxMessageUseCase(
        container.resolve<TriageMessagePort>(TOKENS.TriageMessagePort),
        container.resolve<TriageAIPort>(TOKENS.TriageAIPort),
        container.resolve<TriageCrmPort>(TOKENS.TriageCrmPort),
        brandVoiceResolver,
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      );
    },
    true
  );
}
