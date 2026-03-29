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

/**
 * Register social inbox commands, queries, and event handlers
 */
export function setupInboxUseCases(container: Container): void {
  // Social Inbox Use Cases (Phase 2)
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
    () =>
      new SyncProviderCommentsUseCase(
        container.resolve<ChannelRepository>(TOKENS.ChannelRepository),
        container.resolve<IngestSocialMessageUseCase>(TOKENS.IngestSocialMessageUseCase),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // Social Inbox Queries (Phase 2)
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

  // Social Inbox Event Handlers (Phase 2)
  container.register<InboxEventHandlers>(
    TOKENS.InboxEventHandlers,
    () =>
      new InboxEventHandlers(
        container.resolve<CreateNotificationUseCase>(TOKENS.CreateNotificationUseCase)
      ),
    true
  );
}
