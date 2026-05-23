/**
 * @file index.ts
 * @description Barrel export for repositories — re-exports all repository port interfaces, DTOs, and query types.
 * @layer domain
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

// TrackedLink repository
export {
  type TrackedLinkRepository,
  type ClickStats,
  type TrackedLinkFilterOptions,
} from "./TrackedLinkRepository.js";

// Account repository
export { type AccountRepository, type AccountRepositoryPort } from "./AccountRepository.js";

// Project repository
export { type ProjectRepository, type ProjectRepositoryPort } from "./ProjectRepository.js";

// Channel repository
export { type ChannelRepository } from "./ChannelRepository.js";

// Analytics query repository
export { type AnalyticsQueryRepository, type DateRange } from "./AnalyticsQueryRepository.js";

// API Key repository
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

// Thread read-model port (analytics consumers)
export { type ThreadReadRepositoryPort } from "./ThreadReadRepository.js";

// Team-membership operations live on CustomerUserRepository (exported below).
export {
  type CustomerRoleRepository,
  type CustomerRoleSnapshot,
} from "./CustomerRoleRepository.js";

// Approval request repository port
export { type ApprovalRequestRepository } from "./ApprovalRequestRepository.js";

// Notification repository ports
export {
  type NotificationRepository,
  type NotificationPreferenceRepository,
  type NotificationPreferenceDTO,
  type NotificationFindOptions,
  type NotificationPaginatedResult,
} from "./NotificationRepository.js";

// PostComment repository port
export {
  type PostCommentRepository,
  type PostCommentFindOptions,
  type PostCommentPaginatedResult,
} from "./PostCommentRepository.js";

// Social Inbox repository ports
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

// Campaign repository ports
export { type CampaignRepository } from "./CampaignRepository.js";
export {
  type CampaignQueryRepository,
  type CampaignDto,
  type CampaignWithStats,
  type ListCampaignsOptions,
} from "./CampaignQueryRepository.js";

// Scheduled Report repository port
export {
  type ScheduledReportRepository,
  type ScheduledReportDto,
} from "./ScheduledReportRepository.js";

// Email port
export { type EmailPort, type SendEmailOptions, type EmailAttachment } from "./EmailPort.js";

// GA4 Tracking port
export { type GA4TrackingPort, type GA4Event } from "./GA4TrackingPort.js";

// GeneratedImage repository port (AI Image Generation)
export {
  type GeneratedImageRepository,
  type GeneratedImageData,
} from "./GeneratedImageRepository.js";

// UsageMetric repository port (Task 11.5: Usage Metering)
export { type UsageMetricRepository, type UsageMetricData } from "./UsageMetricRepository.js";

// MediaAsset repository port (Asset Library)
export {
  type MediaAssetRepository,
  type MediaAssetFilters,
  type MediaAssetPaginatedResult,
} from "./MediaAssetRepository.js";

// AssetTag repository port (Asset Library)
export { type AssetTagRepository, type AssetTagDTO } from "./AssetTagRepository.js";

// AssetFolder repository port (Asset Library)
export { type AssetFolderRepository, type AssetFolderDTO } from "./AssetFolderRepository.js";

// Task repository port
export { type TaskRepository, type TaskFilters } from "./TaskRepository.js";

// Integration platform repository ports (Zapier, Make, etc.)
export { type IntegrationApiKeyRepository } from "./IntegrationApiKeyRepository.js";
export { type IntegrationSubscriptionRepository } from "./IntegrationSubscriptionRepository.js";

// SAML SSO repository port
export {
  type SamlConfigurationRepository,
  type SamlConfigurationData,
} from "./SamlConfigurationRepository.js";

// OIDC SSO repository port
export {
  type OidcConfigurationRepository,
  type OidcConfigurationData,
} from "./OidcConfigurationRepository.js";

// CustomerUser repository port (Customer Auth)
export { type CustomerUserRepository } from "./CustomerUserRepository.js";

// Custom Report repository port (Custom Report Builder)
export {
  type CustomReportRepository,
  type CustomReportDto,
  type ReportScheduleDto,
} from "./CustomReportRepository.js";

// CRM repository ports
export { type CrmConnectionRepository, type CrmConnectionData } from "./CrmConnectionRepository.js";

export {
  type CrmContactRepository,
  type CrmContactData,
  type UpsertCrmContactInput,
} from "./CrmContactRepository.js";

export {
  type CrmActivityRepository,
  type CrmActivityData,
  type CreateCrmActivityInput,
} from "./CrmActivityRepository.js";

export {
  type CrmSyncLogRepository,
  type CrmSyncLogData,
  type CreateCrmSyncLogInput,
  type UpdateCrmSyncLogInput,
} from "./CrmSyncLogRepository.js";

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
  type ThreadDto,
  type TweetDto,
  type ThreadWithRelations,
  type ThreadWithTweets,
  type AdminUserDto,
  type SsoProviderKind,
} from "./ReadModelDtos.js";
