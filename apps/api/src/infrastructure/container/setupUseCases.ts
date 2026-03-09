/**
 * Container Setup - Use Case Registrations
 *
 * Registers all application use cases in the DI container.
 * Extracted from setup.ts to keep files under 800 lines.
 *
 * @module infrastructure/container/setupUseCases
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type {
  PostRepository,
  PostQueryRepository,
  EventDispatcher,
  ChannelRepository,
  SocialMessageRepository,
  SocialMessageQueryRepository,
  SocialConversationRepository,
  SocialOutboundReplyRepository,
} from "../../domain/index.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { ApiKeyRepository } from "../../domain/repositories/ApiKeyRepository.js";
import {
  CreatePostUseCase,
  GetPostUseCase,
  UpdatePostUseCase,
  ListPostsUseCase,
  DeletePostUseCase,
  SchedulePostUseCase,
  GetPostWithThreadQuery,
  ListPostsGlobalQuery,
} from "../../application/posts/index.js";
import {
  CreateApiKeyUseCase,
  ValidateApiKeyUseCase,
  ListApiKeysUseCase,
  RotateApiKeyUseCase,
  DeactivateApiKeyUseCase,
} from "../../application/apiKeys/index.js";
import { OutboxRelay } from "../outbox/OutboxRelay.js";
import { OutboxCleaner } from "../outbox/OutboxCleaner.js";
import {
  GetCrossPlatformAnalyticsUseCase,
  ComparePerformanceUseCase,
  CalculateROIUseCase,
} from "../../application/analytics/index.js";
import { CrossPlatformAnalyticsAdapter } from "../adapters/CrossPlatformAnalyticsAdapter.js";
import { PerformanceComparatorAdapter } from "../adapters/PerformanceComparatorAdapter.js";
import { ROICalculatorAdapter } from "../adapters/ROICalculatorAdapter.js";
import { OptimizeContentUseCase, PredictOptimalTimingUseCase } from "../../application/ml/index.js";
import type { TrackedLinkRepository } from "../../domain/repositories/TrackedLinkRepository.js";
import {
  CreateTrackedLinkUseCase,
  GetTrackedLinkUseCase,
  RedirectAndTrackClickUseCase,
  GetLinkStatsUseCase,
  DeleteTrackedLinkUseCase,
} from "../../application/links/index.js";
import type { CrisisProjectRepository } from "../../application/crisis/types.js";
import {
  EnterCrisisModeUseCase,
  ExitCrisisModeUseCase,
  GetCrisisStatusUseCase,
} from "../../application/crisis/index.js";
import type { ApprovalRequestRepository } from "../../domain/repositories/ApprovalRequestRepository.js";
import {
  SubmitForReviewUseCase,
  ApprovePostUseCase,
  RejectPostUseCase,
  GetApprovalHistoryQuery,
  GetPendingApprovalsQuery,
} from "../../application/approvals/index.js";
import type { TeamMemberRepository } from "../../domain/repositories/TeamMemberRepository.js";
import {
  InviteTeamMemberUseCase,
  GetTeamMembersQuery,
  UpdateTeamMemberRoleUseCase,
  RemoveTeamMemberUseCase,
} from "../../application/team/index.js";
import type {
  NotificationRepository,
  NotificationPreferenceRepository,
} from "../../domain/repositories/NotificationRepository.js";
import {
  CreateNotificationUseCase,
  GetNotificationsQuery,
  MarkNotificationReadUseCase,
  MarkAllNotificationsReadUseCase,
  GetUnreadCountQuery,
  NotificationEventHandlers,
} from "../../application/notifications/index.js";
import type { PostCommentRepository } from "../../domain/repositories/PostCommentRepository.js";
import {
  CreateCommentUseCase,
  EditCommentUseCase,
  DeleteCommentUseCase,
  GetPostCommentsQuery,
} from "../../application/comments/index.js";
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
} from "../../application/inbox/index.js";
import { InboxEventHandlers } from "../../application/inbox/handlers/InboxEventHandlers.js";

/**
 * Register all use cases and their adapters in the container
 */
export function setupUseCases(container: Container): void {
  // Register API Key Use Cases (FASE H10-B)
  container.register<CreateApiKeyUseCase>(
    TOKENS.CreateApiKeyUseCase,
    () => new CreateApiKeyUseCase(container.resolve<ApiKeyRepository>(TOKENS.ApiKeyRepository)),
    true
  );
  container.register<ValidateApiKeyUseCase>(
    TOKENS.ValidateApiKeyUseCase,
    () => new ValidateApiKeyUseCase(container.resolve<ApiKeyRepository>(TOKENS.ApiKeyRepository)),
    true
  );
  container.register<ListApiKeysUseCase>(
    TOKENS.ListApiKeysUseCase,
    () => new ListApiKeysUseCase(container.resolve<ApiKeyRepository>(TOKENS.ApiKeyRepository)),
    true
  );
  container.register<RotateApiKeyUseCase>(
    TOKENS.RotateApiKeyUseCase,
    () => new RotateApiKeyUseCase(container.resolve<ApiKeyRepository>(TOKENS.ApiKeyRepository)),
    true
  );
  container.register<DeactivateApiKeyUseCase>(
    TOKENS.DeactivateApiKeyUseCase,
    () => new DeactivateApiKeyUseCase(container.resolve<ApiKeyRepository>(TOKENS.ApiKeyRepository)),
    true
  );

  // Register Post Use Cases (FASE H5)
  container.register<CreatePostUseCase>(
    TOKENS.CreatePostUseCase,
    () =>
      new CreatePostUseCase(
        container.resolve<PostRepository>(TOKENS.PostRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<GetPostUseCase>(
    TOKENS.GetPostUseCase,
    () => new GetPostUseCase(container.resolve<PostQueryRepository>(TOKENS.PostQueryRepository)),
    true
  );
  container.register<UpdatePostUseCase>(
    TOKENS.UpdatePostUseCase,
    () =>
      new UpdatePostUseCase(
        container.resolve<PostRepository>(TOKENS.PostRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<ListPostsUseCase>(
    TOKENS.ListPostsUseCase,
    () => new ListPostsUseCase(container.resolve<PostQueryRepository>(TOKENS.PostQueryRepository)),
    true
  );
  container.register<DeletePostUseCase>(
    TOKENS.DeletePostUseCase,
    () => new DeletePostUseCase(container.resolve<PostRepository>(TOKENS.PostRepository)),
    true
  );

  // Register Post Use Cases (P2-ARCH-1 — postRoutes migration)
  container.register<SchedulePostUseCase>(
    TOKENS.SchedulePostUseCase,
    () =>
      new SchedulePostUseCase(
        container.resolve<PostRepository>(TOKENS.PostRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
        container.resolve<ChannelRepository>(TOKENS.ChannelRepository)
      ),
    true
  );
  container.register<GetPostWithThreadQuery>(
    TOKENS.GetPostWithThreadQuery,
    () =>
      new GetPostWithThreadQuery(
        container.resolve<PostQueryRepository>(TOKENS.PostQueryRepository)
      ),
    true
  );
  container.register<ListPostsGlobalQuery>(
    TOKENS.ListPostsGlobalQuery,
    () =>
      new ListPostsGlobalQuery(container.resolve<PostQueryRepository>(TOKENS.PostQueryRepository)),
    true
  );

  // Register Outbox Relay + Cleaner (P2-1)
  container.register<OutboxRelay>(
    TOKENS.OutboxRelay,
    () =>
      new OutboxRelay({
        prisma: container.resolve(TOKENS.PrismaClient),
        eventDispatcher: container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
      }),
    true
  );
  container.register<OutboxCleaner>(
    TOKENS.OutboxCleaner,
    () => new OutboxCleaner(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register Analytics Port Adapters (F26)
  container.register<CrossPlatformAnalyticsAdapter>(
    TOKENS.CrossPlatformAnalyticsAdapter,
    () => new CrossPlatformAnalyticsAdapter(),
    true
  );
  container.register<PerformanceComparatorAdapter>(
    TOKENS.PerformanceComparatorAdapter,
    () => new PerformanceComparatorAdapter(),
    true
  );
  container.register<ROICalculatorAdapter>(
    TOKENS.ROICalculatorAdapter,
    () => new ROICalculatorAdapter(),
    true
  );

  // Register Analytics Use Cases (F26)
  container.register<GetCrossPlatformAnalyticsUseCase>(
    TOKENS.GetCrossPlatformAnalyticsUseCase,
    () =>
      new GetCrossPlatformAnalyticsUseCase(
        container.resolve<CrossPlatformAnalyticsAdapter>(TOKENS.CrossPlatformAnalyticsAdapter)
      ),
    true
  );
  container.register<ComparePerformanceUseCase>(
    TOKENS.ComparePerformanceUseCase,
    () =>
      new ComparePerformanceUseCase(
        container.resolve<PerformanceComparatorAdapter>(TOKENS.PerformanceComparatorAdapter)
      ),
    true
  );
  container.register<CalculateROIUseCase>(
    TOKENS.CalculateROIUseCase,
    () =>
      new CalculateROIUseCase(container.resolve<ROICalculatorAdapter>(TOKENS.ROICalculatorAdapter)),
    true
  );

  // Register ML Use Cases (B0-2 — AI-powered with heuristic fallback)
  container.register<OptimizeContentUseCase>(
    TOKENS.OptimizeContentUseCase,
    () =>
      new OptimizeContentUseCase(
        container.resolve<import("../../ai/aiService.js").AIService>(TOKENS.AIService)
      ),
    true
  );
  container.register<PredictOptimalTimingUseCase>(
    TOKENS.PredictOptimalTimingUseCase,
    () =>
      new PredictOptimalTimingUseCase(
        container.resolve<import("../../ai/aiService.js").AIService>(TOKENS.AIService),
        container.resolve<
          import("../../domain/repositories/AnalyticsReadRepository.js").AnalyticsReadRepositoryPort
        >(TOKENS.AnalyticsReadRepository)
      ),
    true
  );
  // Register Tracked Link Use Cases (P1-DI-7)
  container.register<CreateTrackedLinkUseCase>(
    TOKENS.CreateTrackedLinkUseCase,
    () =>
      new CreateTrackedLinkUseCase(
        container.resolve<TrackedLinkRepository>(TOKENS.TrackedLinkRepository)
      ),
    true
  );
  container.register<GetTrackedLinkUseCase>(
    TOKENS.GetTrackedLinkUseCase,
    () =>
      new GetTrackedLinkUseCase(
        container.resolve<TrackedLinkRepository>(TOKENS.TrackedLinkRepository)
      ),
    true
  );
  container.register<GetLinkStatsUseCase>(
    TOKENS.GetLinkStatsUseCase,
    () =>
      new GetLinkStatsUseCase(
        container.resolve<TrackedLinkRepository>(TOKENS.TrackedLinkRepository)
      ),
    true
  );
  container.register<DeleteTrackedLinkUseCase>(
    TOKENS.DeleteTrackedLinkUseCase,
    () =>
      new DeleteTrackedLinkUseCase(
        container.resolve<TrackedLinkRepository>(TOKENS.TrackedLinkRepository)
      ),
    true
  );
  container.register<RedirectAndTrackClickUseCase>(
    TOKENS.RedirectAndTrackClickUseCase,
    () =>
      new RedirectAndTrackClickUseCase(
        container.resolve<TrackedLinkRepository>(TOKENS.TrackedLinkRepository)
      ),
    true
  );

  // Register Crisis Mode Use Cases (P1-DI-8)
  container.register<EnterCrisisModeUseCase>(
    TOKENS.EnterCrisisModeUseCase,
    () =>
      new EnterCrisisModeUseCase(
        container.resolve<CrisisProjectRepository>(TOKENS.CrisisProjectRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher)
      ),
    true
  );
  container.register<ExitCrisisModeUseCase>(
    TOKENS.ExitCrisisModeUseCase,
    () =>
      new ExitCrisisModeUseCase(
        container.resolve<CrisisProjectRepository>(TOKENS.CrisisProjectRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher)
      ),
    true
  );
  container.register<GetCrisisStatusUseCase>(
    TOKENS.GetCrisisStatusUseCase,
    () =>
      new GetCrisisStatusUseCase(
        container.resolve<CrisisProjectRepository>(TOKENS.CrisisProjectRepository)
      ),
    true
  );

  // Register Approval Workflow Use Cases (Phase 1.3)
  container.register<SubmitForReviewUseCase>(
    TOKENS.SubmitForReviewUseCase,
    () =>
      new SubmitForReviewUseCase(
        container.resolve<ApprovalRequestRepository>(TOKENS.ApprovalRequestRepository),
        container.resolve<PostRepository>(TOKENS.PostRepository)
      ),
    true
  );
  container.register<ApprovePostUseCase>(
    TOKENS.ApprovePostUseCase,
    () =>
      new ApprovePostUseCase(
        container.resolve<ApprovalRequestRepository>(TOKENS.ApprovalRequestRepository)
      ),
    true
  );
  container.register<RejectPostUseCase>(
    TOKENS.RejectPostUseCase,
    () =>
      new RejectPostUseCase(
        container.resolve<ApprovalRequestRepository>(TOKENS.ApprovalRequestRepository)
      ),
    true
  );
  container.register<GetApprovalHistoryQuery>(
    TOKENS.GetApprovalHistoryQuery,
    () =>
      new GetApprovalHistoryQuery(
        container.resolve<ApprovalRequestRepository>(TOKENS.ApprovalRequestRepository)
      ),
    true
  );
  container.register<GetPendingApprovalsQuery>(
    TOKENS.GetPendingApprovalsQuery,
    () =>
      new GetPendingApprovalsQuery(
        container.resolve<ApprovalRequestRepository>(TOKENS.ApprovalRequestRepository)
      ),
    true
  );

  // Register Team Member Use Cases (Phase 1.1)
  container.register<InviteTeamMemberUseCase>(
    TOKENS.InviteTeamMemberUseCase,
    () =>
      new InviteTeamMemberUseCase(
        container.resolve<TeamMemberRepository>(TOKENS.TeamMemberRepository)
      ),
    true
  );
  container.register<GetTeamMembersQuery>(
    TOKENS.GetTeamMembersQuery,
    () =>
      new GetTeamMembersQuery(container.resolve<TeamMemberRepository>(TOKENS.TeamMemberRepository)),
    true
  );
  container.register<UpdateTeamMemberRoleUseCase>(
    TOKENS.UpdateTeamMemberRoleUseCase,
    () =>
      new UpdateTeamMemberRoleUseCase(
        container.resolve<TeamMemberRepository>(TOKENS.TeamMemberRepository)
      ),
    true
  );
  container.register<RemoveTeamMemberUseCase>(
    TOKENS.RemoveTeamMemberUseCase,
    () =>
      new RemoveTeamMemberUseCase(
        container.resolve<TeamMemberRepository>(TOKENS.TeamMemberRepository)
      ),
    true
  );

  // Register Notification Use Cases (Phase 1.2)
  container.register<CreateNotificationUseCase>(
    TOKENS.CreateNotificationUseCase,
    () =>
      new CreateNotificationUseCase(
        container.resolve<NotificationRepository>(TOKENS.NotificationRepository),
        container.resolve<NotificationPreferenceRepository>(TOKENS.NotificationPreferenceRepository)
      ),
    true
  );
  container.register<GetNotificationsQuery>(
    TOKENS.GetNotificationsQuery,
    () =>
      new GetNotificationsQuery(
        container.resolve<NotificationRepository>(TOKENS.NotificationRepository)
      ),
    true
  );
  container.register<MarkNotificationReadUseCase>(
    TOKENS.MarkNotificationReadUseCase,
    () =>
      new MarkNotificationReadUseCase(
        container.resolve<NotificationRepository>(TOKENS.NotificationRepository)
      ),
    true
  );
  container.register<MarkAllNotificationsReadUseCase>(
    TOKENS.MarkAllNotificationsReadUseCase,
    () =>
      new MarkAllNotificationsReadUseCase(
        container.resolve<NotificationRepository>(TOKENS.NotificationRepository)
      ),
    true
  );
  container.register<GetUnreadCountQuery>(
    TOKENS.GetUnreadCountQuery,
    () =>
      new GetUnreadCountQuery(
        container.resolve<NotificationRepository>(TOKENS.NotificationRepository)
      ),
    true
  );

  // Register Notification Event Handlers (Phase 1.5)
  container.register<NotificationEventHandlers>(
    TOKENS.NotificationEventHandlers,
    () =>
      new NotificationEventHandlers(
        container.resolve<CreateNotificationUseCase>(TOKENS.CreateNotificationUseCase)
      ),
    true
  );

  // Register Comment Use Cases (Phase 1.4)
  container.register<CreateCommentUseCase>(
    TOKENS.CreateCommentUseCase,
    () =>
      new CreateCommentUseCase(
        container.resolve<PostCommentRepository>(TOKENS.PostCommentRepository)
      ),
    true
  );
  container.register<EditCommentUseCase>(
    TOKENS.EditCommentUseCase,
    () =>
      new EditCommentUseCase(
        container.resolve<PostCommentRepository>(TOKENS.PostCommentRepository)
      ),
    true
  );
  container.register<DeleteCommentUseCase>(
    TOKENS.DeleteCommentUseCase,
    () =>
      new DeleteCommentUseCase(
        container.resolve<PostCommentRepository>(TOKENS.PostCommentRepository)
      ),
    true
  );
  container.register<GetPostCommentsQuery>(
    TOKENS.GetPostCommentsQuery,
    () =>
      new GetPostCommentsQuery(
        container.resolve<PostCommentRepository>(TOKENS.PostCommentRepository)
      ),
    true
  );

  // Social Inbox Use Cases (Phase 2)
  container.register<IngestSocialMessageUseCase>(
    TOKENS.IngestSocialMessageUseCase,
    () =>
      new IngestSocialMessageUseCase(
        container.resolve<SocialMessageRepository>(TOKENS.SocialMessageRepository),
        container.resolve<SocialConversationRepository>(TOKENS.SocialConversationRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher)
      ),
    true
  );
  container.register<MarkMessageReadUseCase>(
    TOKENS.MarkMessageReadUseCase,
    () =>
      new MarkMessageReadUseCase(
        container.resolve<SocialMessageRepository>(TOKENS.SocialMessageRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher)
      ),
    true
  );
  container.register<MarkMessageArchivedUseCase>(
    TOKENS.MarkMessageArchivedUseCase,
    () =>
      new MarkMessageArchivedUseCase(
        container.resolve<SocialMessageRepository>(TOKENS.SocialMessageRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher)
      ),
    true
  );
  container.register<AssignMessageUseCase>(
    TOKENS.AssignMessageUseCase,
    () =>
      new AssignMessageUseCase(
        container.resolve<SocialMessageRepository>(TOKENS.SocialMessageRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher)
      ),
    true
  );
  container.register<SendReplyUseCase>(
    TOKENS.SendReplyUseCase,
    () =>
      new SendReplyUseCase(
        container.resolve<SocialMessageRepository>(TOKENS.SocialMessageRepository),
        container.resolve<SocialOutboundReplyRepository>(TOKENS.SocialOutboundReplyRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher)
      ),
    true
  );
  container.register<ResolveConversationUseCase>(
    TOKENS.ResolveConversationUseCase,
    () =>
      new ResolveConversationUseCase(
        container.resolve<SocialConversationRepository>(TOKENS.SocialConversationRepository)
      ),
    true
  );
  container.register<ReopenConversationUseCase>(
    TOKENS.ReopenConversationUseCase,
    () =>
      new ReopenConversationUseCase(
        container.resolve<SocialConversationRepository>(TOKENS.SocialConversationRepository)
      ),
    true
  );
  container.register<SyncProviderCommentsUseCase>(
    TOKENS.SyncProviderCommentsUseCase,
    () =>
      new SyncProviderCommentsUseCase(
        container.resolve<ChannelRepository>(TOKENS.ChannelRepository),
        container.resolve<IngestSocialMessageUseCase>(TOKENS.IngestSocialMessageUseCase)
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
