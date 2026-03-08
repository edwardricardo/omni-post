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
} from "./AnalyticsReadRepository.js";

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
