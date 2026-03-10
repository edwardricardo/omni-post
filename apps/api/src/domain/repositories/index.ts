/**
 * Domain Layer - Repository Interfaces (Ports)
 *
 * Part of Sprint 5: DDD Architecture Implementation
 * These interfaces define the contracts for data access.
 */

// Base repository interfaces
export {
  type Repository,
  type ReadRepository,
  type WriteRepository,
  type PaginationParams,
  type PaginatedResult,
  type SortDirection,
  type SortParams,
  type UnitOfWork,
} from "./Repository.js";

// Post repository
export {
  type PostRepository,
  type PostFilterCriteria,
  type PostSortField,
  type PostReadModel,
  type PostReadModelWithThread,
  type ThreadReadModel,
  type TweetReadModel,
  type GlobalPostFilter,
  type PostQueryRepository,
} from "./PostRepository.js";

// TrackedLink repository (Sprint 19)
export {
  type TrackedLinkRepository,
  type ClickStats,
  type TrackedLinkFilterOptions,
} from "./TrackedLinkRepository.js";

// Account repository (FASE H3)
export { type AccountRepository, type AccountRepositoryPort } from "./AccountRepository.js";

// Project repository (FASE H3)
export { type ProjectRepository, type ProjectRepositoryPort } from "./ProjectRepository.js";

// Channel repository (FASE H3)
export { type ChannelRepository } from "./ChannelRepository.js";

// Analytics query repository (FASE H3)
export { type AnalyticsQueryRepository, type DateRange } from "./AnalyticsQueryRepository.js";

// API Key repository (FASE H10-B)
export {
  type ApiKeyRepository,
  type DomainApiKey,
  type CreateApiKeyData,
} from "./ApiKeyRepository.js";

// Outbox writer port (P2-1: Transactional Outbox)
export { type OutboxWriter } from "./OutboxWriter.js";

// AdminUser repository port (R1-A: hexagonal migration)
export { type AdminUserRepositoryPort } from "./AdminUserRepository.js";

// Account query repository port (R1-B: billing read-model)
export {
  type AccountQueryRepositoryPort,
  type AccountWithProjects,
  type SubscriptionUpdateData,
} from "./AccountQueryRepository.js";

// Project query read-model port (R1-C: analytics read-model)
export {
  type ProjectQueryRepositoryPort,
  type ProjectQueryOptions,
  type PostWithContent,
  type PostWithAnalytics,
  type PublishedPost,
} from "./ProjectQueryRepository.js";

// Analytics read-model port (R1-C: analytics read-model)
export {
  type AnalyticsReadRepositoryPort,
  type AnalyticsQueryOptions,
  type AnalyticsWithPost,
  type AnalyticsWithRelations,
  type EngagementMetrics,
  type TimeSeriesRow,
  type PostWithAnalyticsAndContent,
  type DailySummaryDto,
  type MonthlySummaryDto,
  type HistoricalTrendDto,
} from "./AnalyticsReadRepository.js";

// TeamMember repository port (Phase 1: TeamMember foundation)
export { type TeamMemberRepository } from "./TeamMemberRepository.js";

// Approval request repository port (Phase 1 Step 3: Content Approval)
export { type ApprovalRequestRepository } from "./ApprovalRequestRepository.js";

// Notification repository ports (Phase 1 Step 2: Notification system)
export {
  type NotificationRepository,
  type NotificationPreferenceRepository,
  type NotificationPreferenceDTO,
  type NotificationFindOptions,
  type NotificationPaginatedResult,
} from "./NotificationRepository.js";

// PostComment repository port (Phase 1 Step 4: In-Context Comments)
export {
  type PostCommentRepository,
  type PostCommentFindOptions,
  type PostCommentPaginatedResult,
} from "./PostCommentRepository.js";

// Social Inbox repository ports (Phase 2: Social Inbox)
export { type SocialMessageRepository } from "./SocialMessageRepository.js";
export {
  type SocialMessageQueryRepository,
  type SocialMessageDTO,
  type InboxFilter,
  type CursorPagination,
  type CursorPaginatedResult,
} from "./SocialMessageQueryRepository.js";
export {
  type SocialConversationRepository,
  type SocialConversationDTO,
} from "./SocialConversationRepository.js";
export {
  type SocialOutboundReplyRepository,
  type SocialOutboundReplyDTO,
  type CreateOutboundReplyInput,
  type OutboundReplyStatusValue,
  OUTBOUND_REPLY_STATUSES,
} from "./SocialOutboundReplyRepository.js";

// Campaign repository ports (Phase 3: Analytics & Reporting)
export { type CampaignRepository } from "./CampaignRepository.js";
export {
  type CampaignQueryRepository,
  type CampaignDto,
  type CampaignWithStats,
  type ListCampaignsOptions,
} from "./CampaignQueryRepository.js";

// Scheduled Report repository port (Phase 3 Step 7: Scheduled Reports)
export {
  type ScheduledReportRepository,
  type ScheduledReportDto,
} from "./ScheduledReportRepository.js";

// Email port (Phase 3 Step 7: Scheduled Reports)
export { type EmailPort, type SendEmailOptions, type EmailAttachment } from "./EmailPort.js";

// GA4 Tracking port (Phase 3 Step 4: UTM/GA4 Integration)
export { type GA4TrackingPort, type GA4Event } from "./GA4TrackingPort.js";

// GeneratedImage repository port (AI Image Generation)
export {
  type GeneratedImageRepository,
  type GeneratedImageData,
} from "./GeneratedImageRepository.js";

// Plain domain DTOs — Prisma-free type mirrors for read-model ports
export {
  type ProviderKind,
  type SubscriptionTierKind,
  type AdminRoleKind,
  type MediaKindValue,
  type AccountDto,
  type ProjectDto,
  type PostDto,
  type PostContentDto,
  type PostMediaDto,
  type ChannelDto,
  type AnalyticsDto,
  type AdminUserDto,
} from "./ReadModelDtos.js";
