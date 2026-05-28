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
} from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { CreateNotificationUseCase } from "@core/notifications/index.js";
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
} from "@core/application/inbox/index.js";
import type { ConversationNoteRepository } from "@core/domain/repositories/ConversationNoteRepository.js";
import type { NotifyMentionedUsersService } from "@core/application/mentions/index.js";
import { InboxEventHandlers } from "@core/application/inbox/handlers/InboxEventHandlers.js";
import type { ProviderRegistryService } from "../../providers/providerRegistry.js";
import { DispatchInboxSyncUseCase } from "@core/application/inbox/DispatchInboxSyncUseCase.js";
import { DispatchMentionSearchUseCase } from "@core/listening/DispatchMentionSearchUseCase.js";
import { GetShareOfVoiceQuery } from "@core/listening/GetShareOfVoiceQuery.js";
import { ListMentionsQuery } from "@core/listening/ListMentionsQuery.js";
import type { ChannelQueryForIngestion } from "@core/domain/repositories/ChannelQueryForIngestion.js";
import type { TrackedTermQuery } from "@core/domain/repositories/TrackedTermQuery.js";
import type { MentionQueryRepository } from "@core/domain/repositories/MentionQueryRepository.js";
import { PrismaTrackedTermQuery } from "../repositories/PrismaTrackedTermQuery.js";
import { providerRegistry } from "../../providers/providerRegistry.js";
import type { QueuePortRegistry } from "@ports/core";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";
import { prisma } from "@infra/prisma";
import { PrismaTriageMessageAdapter } from "../repositories/PrismaTriageMessageAdapter.js";
import { PrismaTriageCrmAdapter } from "../repositories/PrismaTriageCrmAdapter.js";
import { NotificationDispatchAdapter } from "./adapters/NotificationDispatchAdapter.js";
import { GuardrailEvaluationAdapter } from "./adapters/GuardrailEvaluationAdapter.js";
import { MentionTrackingAdapter } from "./adapters/MentionTrackingAdapter.js";
import {
  TriageInboxMessageUseCase,
  type TriageMessagePort,
  type TriageCrmPort,
} from "@core/application/inbox/TriageInboxMessageUseCase.js";
import type { AIServicePort } from "@core/domain/repositories/AIServicePort.js";
import { triageSpec } from "../../ai/structuredSchemas.js";
import type { BrandVoiceRepository } from "@core/domain/repositories/BrandVoiceRepository.js";
import { TriageDispatchEventHandler } from "../../inbox/handlers/TriageDispatchEventHandler.js";
import type { GuardrailRegistry } from "@core/guardrails/GuardrailRegistry.js";

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
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork),
        new GuardrailEvaluationAdapter(
          container.resolve<GuardrailRegistry>(TOKENS.GuardrailRegistry)
        )
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
        (() => {
          const svc = container.tryResolve<NotifyMentionedUsersService>(
            TOKENS.NotifyMentionedUsersService
          );
          return svc ? new MentionTrackingAdapter(svc) : undefined;
        })()
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
        container
          .resolve<QueuePortRegistry>(TOKENS.QueuePortRegistry)
          .forQueue(QUEUE_NAMES.INBOX_SYNC),
        QUEUE_NAMES.INBOX_SYNC,
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // Social Listening — tracked-term read model + mention-search coordinator
  container.register<TrackedTermQuery>(
    TOKENS.TrackedTermQuery,
    () => new PrismaTrackedTermQuery(prisma),
    true
  );
  container.register<DispatchMentionSearchUseCase>(
    TOKENS.DispatchMentionSearchUseCase,
    () =>
      new DispatchMentionSearchUseCase(
        container.resolve<TrackedTermQuery>(TOKENS.TrackedTermQuery),
        container.resolve<ChannelQueryForIngestion>(TOKENS.ChannelQueryForIngestion),
        container
          .resolve<QueuePortRegistry>(TOKENS.QueuePortRegistry)
          .forQueue(QUEUE_NAMES.MENTION_INGEST),
        providerRegistry.getMentionSearchProviders(),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<GetShareOfVoiceQuery>(
    TOKENS.GetShareOfVoiceQuery,
    () =>
      new GetShareOfVoiceQuery(
        container.resolve<MentionQueryRepository>(TOKENS.MentionQueryRepository)
      ),
    true
  );
  container.register<ListMentionsQuery>(
    TOKENS.ListMentionsQuery,
    () =>
      new ListMentionsQuery(
        container.resolve<MentionQueryRepository>(TOKENS.MentionQueryRepository)
      ),
    true
  );

  // Social Inbox Event Handlers
  container.register<InboxEventHandlers>(
    TOKENS.InboxEventHandlers,
    () =>
      new InboxEventHandlers(
        new NotificationDispatchAdapter(
          container.resolve<CreateNotificationUseCase>(TOKENS.CreateNotificationUseCase)
        )
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
        container.resolve<AIServicePort>(TOKENS.AIServicePort),
        triageSpec,
        container.resolve<TriageCrmPort>(TOKENS.TriageCrmPort),
        brandVoiceResolver,
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork),
        new GuardrailEvaluationAdapter(
          container.resolve<GuardrailRegistry>(TOKENS.GuardrailRegistry)
        )
      );
    },
    true
  );

  // Triage dispatch event handler — subscribes to SocialMessageReceived and
  // enqueues TRIAGE_INBOX. Mirrors IntegrationEventDeliveryHandler; wired to
  // the EventDispatcher at boot in index.ts.
  container.register<TriageDispatchEventHandler>(
    TOKENS.TriageDispatchEventHandler,
    () => {
      const queue = container
        .resolve<QueuePortRegistry>(TOKENS.QueuePortRegistry)
        .forQueue(QUEUE_NAMES.TRIAGE_INBOX);
      return new TriageDispatchEventHandler(queue);
    },
    true
  );
}
