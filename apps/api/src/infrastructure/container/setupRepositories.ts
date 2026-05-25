/**
 * @file setupRepositories.ts
 * @description Registers all repository adapters and Unit of Work in the DI container.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { PrismaAdminUserRepository } from "../repositories/PrismaAdminUserRepository.js";
import type { AdminUserRepositoryPort } from "../../domain/repositories/AdminUserRepository.js";
import { PrismaAdminSessionRepository } from "../repositories/PrismaAdminSessionRepository.js";
import type { AdminSessionRepository } from "../../domain/repositories/AdminSessionRepository.js";
import { PrismaRoleRepository } from "../repositories/PrismaRoleRepository.js";
import type { RoleRepository } from "../../domain/repositories/RoleRepository.js";
import { PrismaAuditLogRepository } from "../repositories/PrismaAuditLogRepository.js";
import type { AuditLogRepository } from "../../domain/repositories/AuditLogRepository.js";
import { PrismaPostRepository } from "../repositories/PrismaPostRepository.js";
import { PrismaPostQueryRepository } from "../repositories/PrismaPostQueryRepository.js";
import { PrismaAccountRepository } from "../repositories/PrismaAccountRepository.js";
import { PrismaAccountQueryRepository } from "../repositories/PrismaAccountQueryRepository.js";
import { PrismaProjectRepository } from "../repositories/PrismaProjectRepository.js";
import { PrismaAnalyticsQueryRepository } from "../repositories/PrismaAnalyticsQueryRepository.js";
import { PrismaProjectQueryRepository } from "../repositories/PrismaProjectQueryRepository.js";
import { PrismaAnalyticsReadRepository } from "../repositories/PrismaAnalyticsReadRepository.js";
import { PrismaThreadReadRepository } from "../repositories/PrismaThreadReadRepository.js";
import { PrismaConversionRepository } from "../repositories/PrismaConversionRepository.js";
import type { ProjectQueryRepositoryPort } from "../../domain/repositories/ProjectQueryRepository.js";
import type { AnalyticsReadRepositoryPort } from "../../domain/repositories/AnalyticsReadRepository.js";
import type { ThreadReadRepositoryPort } from "../../domain/repositories/ThreadReadRepository.js";
import type { ConversionRepositoryPort } from "../../domain/repositories/ConversionRepository.js";
import { PrismaChannelRepository } from "../repositories/PrismaChannelRepository.js";
import type { PostRepository, PostQueryRepository } from "../../domain/index.js";
import type { AccountRepositoryPort } from "../../domain/repositories/AccountRepository.js";
import type { AccountQueryRepositoryPort } from "../../domain/repositories/AccountQueryRepository.js";
import type { ProjectRepositoryPort } from "../../domain/repositories/ProjectRepository.js";
import type { AnalyticsQueryRepository } from "../../domain/repositories/AnalyticsQueryRepository.js";
import type { ChannelRepository } from "../../domain/repositories/ChannelRepository.js";
import { PrismaApiKeyRepository } from "../repositories/PrismaApiKeyRepository.js";
import type { ApiKeyRepository } from "../../domain/repositories/ApiKeyRepository.js";
import { PrismaOutboxWriter } from "../outbox/PrismaOutboxWriter.js";
import type { OutboxWriter } from "../../domain/repositories/OutboxWriter.js";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";
import type { UnitOfWork } from "../../domain/index.js";
import type { TrackedLinkRepository } from "../../domain/repositories/TrackedLinkRepository.js";
import { PrismaTrackedLinkRepository } from "../repositories/PrismaTrackedLinkRepository.js";
import type { CrisisProjectRepository } from "../../application/crisis/types.js";
import { PrismaCrisisProjectRepository } from "../repositories/PrismaCrisisProjectRepository.js";
import type { ApprovalRequestRepository } from "../../domain/repositories/ApprovalRequestRepository.js";
import { PrismaApprovalRequestRepository } from "../repositories/PrismaApprovalRequestRepository.js";
import type { ApprovalWorkflowRepository } from "../../domain/repositories/ApprovalWorkflowRepository.js";
import { PrismaApprovalWorkflowRepository } from "../repositories/PrismaApprovalWorkflowRepository.js";
import type {
  NotificationRepository,
  NotificationPreferenceRepository,
} from "../../domain/repositories/NotificationRepository.js";
import { PrismaNotificationRepository } from "../repositories/PrismaNotificationRepository.js";
import type { PostCommentRepository } from "../../domain/repositories/PostCommentRepository.js";
import { PrismaPostCommentRepository } from "../repositories/PrismaPostCommentRepository.js";
import type { SocialMessageRepository } from "../../domain/repositories/SocialMessageRepository.js";
import type { SocialMessageQueryRepository } from "../../domain/repositories/SocialMessageQueryRepository.js";
import type { SocialConversationRepository } from "../../domain/repositories/SocialConversationRepository.js";
import type { SocialOutboundReplyRepository } from "../../domain/repositories/SocialOutboundReplyRepository.js";
import { PrismaSocialMessageRepository } from "../repositories/PrismaSocialMessageRepository.js";
import { PrismaSocialMessageQueryRepository } from "../repositories/PrismaSocialMessageQueryRepository.js";
import type { MentionQueryRepository } from "../../domain/repositories/MentionQueryRepository.js";
import { PrismaMentionQueryRepository } from "../repositories/PrismaMentionQueryRepository.js";
import type { BulkScheduleBatchRepository } from "../../domain/repositories/BulkScheduleBatchRepository.js";
import { PrismaBulkScheduleBatchRepository } from "../repositories/PrismaBulkScheduleBatchRepository.js";
import type { BulkScheduleQueryRepository } from "../../domain/repositories/BulkScheduleQueryRepository.js";
import { PrismaBulkScheduleQueryRepository } from "../repositories/PrismaBulkScheduleQueryRepository.js";
import { PrismaSocialConversationRepository } from "../repositories/PrismaSocialConversationRepository.js";
import { PrismaSocialOutboundReplyRepository } from "../repositories/PrismaSocialOutboundReplyRepository.js";
import type { ConversationNoteRepository } from "../../domain/repositories/ConversationNoteRepository.js";
import { PrismaConversationNoteRepository } from "../repositories/PrismaConversationNoteRepository.js";
import type { CampaignRepository } from "../../domain/repositories/CampaignRepository.js";
import type { CampaignQueryRepository } from "../../domain/repositories/CampaignQueryRepository.js";
import { PrismaCampaignRepository } from "../repositories/PrismaCampaignRepository.js";
import { PrismaCampaignQueryRepository } from "../repositories/PrismaCampaignQueryRepository.js";
import type { ScheduledReportRepository } from "../../domain/repositories/ScheduledReportRepository.js";
import { PrismaScheduledReportRepository } from "../repositories/PrismaScheduledReportRepository.js";
import type { FirstCommentRepository } from "../../domain/repositories/FirstCommentRepository.js";
import { PrismaFirstCommentRepository } from "../repositories/PrismaFirstCommentRepository.js";
import type { RecurringPostRepository } from "../../domain/repositories/RecurringPostRepository.js";
import { PrismaRecurringPostRepository } from "../repositories/PrismaRecurringPostRepository.js";
import type { TaskRepository } from "../../domain/repositories/TaskRepository.js";
import { PrismaTaskRepository } from "../repositories/PrismaTaskRepository.js";
import type { AccountSubscriptionPort } from "../../domain/repositories/AccountSubscriptionPort.js";
import { PrismaAccountSubscriptionAdapter } from "../repositories/PrismaAccountSubscriptionAdapter.js";
import type { AccountSubscriptionQueryRepository } from "../../domain/repositories/AccountSubscriptionQueryRepository.js";
import { PrismaAccountSubscriptionQueryRepository } from "../repositories/PrismaAccountSubscriptionQueryRepository.js";
import type { SubscriptionStatsQueryRepository } from "../../domain/repositories/SubscriptionStatsQueryRepository.js";
import { PrismaSubscriptionStatsQueryRepository } from "../repositories/PrismaSubscriptionStatsQueryRepository.js";

/**
 * Register all repository adapters in the container
 */
export function setupRepositories(container: Container): void {
  // Register Outbox Writer
  container.register<OutboxWriter>(TOKENS.OutboxWriter, () => new PrismaOutboxWriter(), true);

  // Register PostRepository (receives OutboxWriter for atomic event persistence)
  container.register<PostRepository>(
    TOKENS.PostRepository,
    () =>
      new PrismaPostRepository(
        container.resolve(TOKENS.PrismaClient),
        container.resolve<OutboxWriter>(TOKENS.OutboxWriter)
      ),
    true
  );

  // Register Post Query Repository (CQRS read side)
  container.register<PostQueryRepository>(
    TOKENS.PostQueryRepository,
    () => new PrismaPostQueryRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register Repositories
  container.register<AccountRepositoryPort>(
    TOKENS.AccountRepository,
    () => new PrismaAccountRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register Account Query Repository (R1-B -- billing read-model, CQRS read side)
  container.register<AccountQueryRepositoryPort>(
    TOKENS.AccountQueryRepository,
    () => new PrismaAccountQueryRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  container.register<ProjectRepositoryPort>(
    TOKENS.ProjectRepository,
    () => new PrismaProjectRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  container.register<AnalyticsQueryRepository>(
    TOKENS.AnalyticsQueryRepository,
    () => new PrismaAnalyticsQueryRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  container.register<ChannelRepository>(
    TOKENS.ChannelRepository,
    () =>
      new PrismaChannelRepository(
        container.resolve(TOKENS.PrismaClient),
        container.resolve(TOKENS.ChannelCredentialsCrypto)
      ),
    true
  );

  // Register Read-model Repositories (R1-C -- analytics consumers)
  container.register<ProjectQueryRepositoryPort>(
    TOKENS.ProjectQueryRepository,
    () => new PrismaProjectQueryRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  container.register<AnalyticsReadRepositoryPort>(
    TOKENS.AnalyticsReadRepository,
    () => new PrismaAnalyticsReadRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  container.register<ThreadReadRepositoryPort>(
    TOKENS.ThreadReadRepository,
    () => new PrismaThreadReadRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  container.register<ConversionRepositoryPort>(
    TOKENS.ConversionRepository,
    () => new PrismaConversionRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register API Key Repository
  container.register<ApiKeyRepository>(
    TOKENS.ApiKeyRepository,
    () => new PrismaApiKeyRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register AdminUser Repository (R1-A -- hexagonal port replacing legacy UserRepository)
  container.register<AdminUserRepositoryPort>(
    TOKENS.AdminUserRepository,
    () => new PrismaAdminUserRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register AdminSession Repository (admin-auth session persistence)
  container.register<AdminSessionRepository>(
    TOKENS.AdminSessionRepository,
    () => new PrismaAdminSessionRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register admin Role Repository (RBAC roles -- distinct from CustomerRoleRepository)
  container.register<RoleRepository>(
    TOKENS.RoleRepository,
    () => new PrismaRoleRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register AuditLog Repository (audit-trail persistence + anonymization)
  container.register<AuditLogRepository>(
    TOKENS.AuditLogRepository,
    () => new PrismaAuditLogRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register Unit of Work
  container.register<UnitOfWork>(
    TOKENS.UnitOfWork,
    () => new PrismaUnitOfWork(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register TrackedLink Repository
  container.register<TrackedLinkRepository>(
    TOKENS.TrackedLinkRepository,
    () => new PrismaTrackedLinkRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register Crisis Project Repository
  container.register<CrisisProjectRepository>(
    TOKENS.CrisisProjectRepository,
    () => new PrismaCrisisProjectRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register ApprovalRequest Repository
  container.register<ApprovalRequestRepository>(
    TOKENS.ApprovalRequestRepository,
    () => new PrismaApprovalRequestRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register ApprovalWorkflow Repository (Multi-Level Approvals)
  container.register<ApprovalWorkflowRepository>(
    TOKENS.ApprovalWorkflowRepository,
    () => new PrismaApprovalWorkflowRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register Notification Repositories
  // Single adapter implements both command and preference ports
  container.register<NotificationRepository>(
    TOKENS.NotificationRepository,
    () => new PrismaNotificationRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<NotificationPreferenceRepository>(
    TOKENS.NotificationPreferenceRepository,
    () => new PrismaNotificationRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register PostComment Repository
  container.register<PostCommentRepository>(
    TOKENS.PostCommentRepository,
    () => new PrismaPostCommentRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register Social Inbox Repositories
  container.register<SocialMessageRepository>(
    TOKENS.SocialMessageRepository,
    () => new PrismaSocialMessageRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<SocialMessageQueryRepository>(
    TOKENS.SocialMessageQueryRepository,
    () => new PrismaSocialMessageQueryRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<MentionQueryRepository>(
    TOKENS.MentionQueryRepository,
    () => new PrismaMentionQueryRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<BulkScheduleBatchRepository>(
    TOKENS.BulkScheduleBatchRepository,
    () => new PrismaBulkScheduleBatchRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<BulkScheduleQueryRepository>(
    TOKENS.BulkScheduleQueryRepository,
    () => new PrismaBulkScheduleQueryRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<SocialConversationRepository>(
    TOKENS.SocialConversationRepository,
    () => new PrismaSocialConversationRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<SocialOutboundReplyRepository>(
    TOKENS.SocialOutboundReplyRepository,
    () => new PrismaSocialOutboundReplyRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register ConversationNote Repository (Social Inbox)
  container.register<ConversationNoteRepository>(
    TOKENS.ConversationNoteRepository,
    () => new PrismaConversationNoteRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register Campaign Repositories
  container.register<CampaignRepository>(
    TOKENS.CampaignRepository,
    () => new PrismaCampaignRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<CampaignQueryRepository>(
    TOKENS.CampaignQueryRepository,
    () => new PrismaCampaignQueryRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register ScheduledReport Repository
  container.register<ScheduledReportRepository>(
    TOKENS.ScheduledReportRepository,
    () => new PrismaScheduledReportRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register FirstComment Repository
  container.register<FirstCommentRepository>(
    TOKENS.FirstCommentRepository,
    () => new PrismaFirstCommentRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register RecurringPost Repository
  container.register<RecurringPostRepository>(
    TOKENS.RecurringPostRepository,
    () => new PrismaRecurringPostRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register Task Repository
  container.register<TaskRepository>(
    TOKENS.TaskRepository,
    () => new PrismaTaskRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register AccountSubscription command + query repositories (billing)
  container.register<AccountSubscriptionPort>(
    TOKENS.AccountSubscriptionPort,
    () => new PrismaAccountSubscriptionAdapter(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<AccountSubscriptionQueryRepository>(
    TOKENS.AccountSubscriptionQueryRepository,
    () => new PrismaAccountSubscriptionQueryRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<SubscriptionStatsQueryRepository>(
    TOKENS.SubscriptionStatsQueryRepository,
    () => new PrismaSubscriptionStatsQueryRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
}
