/**
 * Infrastructure Layer - Dependency Injection Types
 *
 * Part of Sprint 7: DDD Architecture Implementation
 * Defines types and tokens for dependency injection.
 */

/**
 * Service identifier tokens for dependency injection
 */
export const TOKENS = {
  // Database
  PrismaClient: Symbol.for("PrismaClient"),

  // Repositories
  PostRepository: Symbol.for("PostRepository"),

  // AdminUser Repository (R1-A — hexagonal port, replaces legacy UserRepository)
  AdminUserRepository: Symbol.for("AdminUserRepository"),

  // Repositories (FASE H4b — new adapters)
  AccountRepository: Symbol.for("AccountRepository"),
  ProjectRepository: Symbol.for("ProjectRepository"),
  AnalyticsQueryRepository: Symbol.for("AnalyticsQueryRepository"),
  ChannelRepository: Symbol.for("ChannelRepository"),

  // Account query read-model repository (R1-B — billing services)
  AccountQueryRepository: Symbol.for("AccountQueryRepository"),

  // Read-model repositories (R1-C — analytics consumers)
  ProjectQueryRepository: Symbol.for("ProjectQueryRepository"),
  AnalyticsReadRepository: Symbol.for("AnalyticsReadRepository"),

  // Repositories (P2-3 — CQRS read side)
  PostQueryRepository: Symbol.for("PostQueryRepository"),

  // Repositories (FASE H10-B — API keys)
  ApiKeyRepository: Symbol.for("ApiKeyRepository"),

  // Use Cases (FASE H10-B)
  CreateApiKeyUseCase: Symbol.for("CreateApiKeyUseCase"),
  ValidateApiKeyUseCase: Symbol.for("ValidateApiKeyUseCase"),
  ListApiKeysUseCase: Symbol.for("ListApiKeysUseCase"),
  RotateApiKeyUseCase: Symbol.for("RotateApiKeyUseCase"),
  DeactivateApiKeyUseCase: Symbol.for("DeactivateApiKeyUseCase"),

  // Event Dispatching
  EventDispatcher: Symbol.for("EventDispatcher"),

  // Use Cases (Sprint 8)
  CreatePostUseCase: Symbol.for("CreatePostUseCase"),
  UpdatePostUseCase: Symbol.for("UpdatePostUseCase"),
  GetPostUseCase: Symbol.for("GetPostUseCase"),
  ListPostsUseCase: Symbol.for("ListPostsUseCase"),
  DeletePostUseCase: Symbol.for("DeletePostUseCase"),

  // Use Cases (P2-ARCH-1 — postRoutes migration)
  SchedulePostUseCase: Symbol.for("SchedulePostUseCase"),
  GetPostWithThreadQuery: Symbol.for("GetPostWithThreadQuery"),
  ListPostsGlobalQuery: Symbol.for("ListPostsGlobalQuery"),

  // Outbox (P2-1 — Transactional Outbox)
  OutboxWriter: Symbol.for("OutboxWriter"),
  OutboxRelay: Symbol.for("OutboxRelay"),
  OutboxCleaner: Symbol.for("OutboxCleaner"),

  // Unit of Work (P2-4)
  UnitOfWork: Symbol.for("UnitOfWork"),

  // Integration Events (P2-2)
  IntegrationEventPublisher: Symbol.for("IntegrationEventPublisher"),

  // Event Versioning (P2-5)
  EventSchemaRegistry: Symbol.for("EventSchemaRegistry"),
  UpcasterChain: Symbol.for("UpcasterChain"),

  // Analytics Use Cases + Adapters (F26)
  GetCrossPlatformAnalyticsUseCase: Symbol.for("GetCrossPlatformAnalyticsUseCase"),
  ComparePerformanceUseCase: Symbol.for("ComparePerformanceUseCase"),
  CalculateROIUseCase: Symbol.for("CalculateROIUseCase"),

  // Analytics Port Adapters (F26)
  CrossPlatformAnalyticsAdapter: Symbol.for("CrossPlatformAnalyticsAdapter"),
  PerformanceComparatorAdapter: Symbol.for("PerformanceComparatorAdapter"),
  ROICalculatorAdapter: Symbol.for("ROICalculatorAdapter"),

  // Content Sync Services (F28)
  SyncEngine: Symbol.for("SyncEngine"),
  ContentVersionManager: Symbol.for("ContentVersionManager"),
  PlatformContentAdapter: Symbol.for("PlatformContentAdapter"),

  // Services (P1-4 — DI route migration)
  AuthService: Symbol.for("AuthService"),
  MfaService: Symbol.for("MfaService"),
  RbacService: Symbol.for("RbacService"),
  AuditService: Symbol.for("AuditService"),
  ActivityFeedService: Symbol.for("ActivityFeedService"),
  AIService: Symbol.for("AIService"),
  DashboardService: Symbol.for("DashboardService"),
  AccountLifecycleService: Symbol.for("AccountLifecycleService"),
  AccountSessionService: Symbol.for("AccountSessionService"),
  AdminAuthService: Symbol.for("AdminAuthService"),
  TemplateService: Symbol.for("TemplateService"),
  TemplateAnalytics: Symbol.for("TemplateAnalytics"),
  SubscriptionService: Symbol.for("SubscriptionService"),
  WebhookDashboardService: Symbol.for("WebhookDashboardService"),
  RealtimeWebhookBroadcaster: Symbol.for("RealtimeWebhookBroadcaster"),
  ProviderService: Symbol.for("ProviderService"),

  // Analytics Services (M-8c — DI route migration)
  ThreadAnalytics: Symbol.for("ThreadAnalytics"),
  // Future: GeoAnalyticsService — deleted (100% fake geographic distribution)

  // ML Use Cases (B0-2 — DI violation fix in ai/routes.ts)
  OptimizeContentUseCase: Symbol.for("OptimizeContentUseCase"),
  PredictOptimalTimingUseCase: Symbol.for("PredictOptimalTimingUseCase"),
  // Posts Service (B0-4)
  PostsService: Symbol.for("PostsService"),

  // Orchestration (P2-A — publish flow integration)
  CredentialManager: Symbol.for("CredentialManager"),
  RateLimitManager: Symbol.for("RateLimitManager"),

  // Provider Orchestration (P2-B — health monitoring)
  ProviderCoordinator: Symbol.for("ProviderCoordinator"),
  ProviderHealthMonitor: Symbol.for("ProviderHealthMonitor"),

  // Provider Registry (H5 — DI route migration)
  ProviderRegistry: Symbol.for("ProviderRegistry"),

  // Saga Orchestration (P3-A — publish flow integration)
  SagaManager: Symbol.for("SagaManager"),

  // Repositories (P1-DI-7 — link tracking)
  TrackedLinkRepository: Symbol.for("TrackedLinkRepository"),

  // Repositories (P1-DI-8 — crisis mode)
  CrisisProjectRepository: Symbol.for("CrisisProjectRepository"),

  // Use Cases (P1-DI-7 — link tracking)
  CreateTrackedLinkUseCase: Symbol.for("CreateTrackedLinkUseCase"),
  GetTrackedLinkUseCase: Symbol.for("GetTrackedLinkUseCase"),
  GetLinkStatsUseCase: Symbol.for("GetLinkStatsUseCase"),
  DeleteTrackedLinkUseCase: Symbol.for("DeleteTrackedLinkUseCase"),
  RedirectAndTrackClickUseCase: Symbol.for("RedirectAndTrackClickUseCase"),

  // Use Cases (P1-DI-8 — crisis mode)
  EnterCrisisModeUseCase: Symbol.for("EnterCrisisModeUseCase"),
  ExitCrisisModeUseCase: Symbol.for("ExitCrisisModeUseCase"),
  GetCrisisStatusUseCase: Symbol.for("GetCrisisStatusUseCase"),

  // Team Member (Phase 1.1)
  TeamMemberRepository: Symbol.for("TeamMemberRepository"),
  InviteTeamMemberUseCase: Symbol.for("InviteTeamMemberUseCase"),
  GetTeamMembersQuery: Symbol.for("GetTeamMembersQuery"),
  UpdateTeamMemberRoleUseCase: Symbol.for("UpdateTeamMemberRoleUseCase"),
  RemoveTeamMemberUseCase: Symbol.for("RemoveTeamMemberUseCase"),

  // Approval Workflow (Phase 1.3)
  ApprovalRequestRepository: Symbol.for("ApprovalRequestRepository"),
  SubmitForReviewUseCase: Symbol.for("SubmitForReviewUseCase"),
  ApprovePostUseCase: Symbol.for("ApprovePostUseCase"),
  RejectPostUseCase: Symbol.for("RejectPostUseCase"),
  GetApprovalHistoryQuery: Symbol.for("GetApprovalHistoryQuery"),
  GetPendingApprovalsQuery: Symbol.for("GetPendingApprovalsQuery"),

  // Notification System (Phase 1.2)
  NotificationRepository: Symbol.for("NotificationRepository"),
  NotificationPreferenceRepository: Symbol.for("NotificationPreferenceRepository"),
  NotificationBroadcaster: Symbol.for("NotificationBroadcaster"),
  CreateNotificationUseCase: Symbol.for("CreateNotificationUseCase"),
  GetNotificationsQuery: Symbol.for("GetNotificationsQuery"),
  MarkNotificationReadUseCase: Symbol.for("MarkNotificationReadUseCase"),
  MarkAllNotificationsReadUseCase: Symbol.for("MarkAllNotificationsReadUseCase"),
  GetUnreadCountQuery: Symbol.for("GetUnreadCountQuery"),

  // Notification Event Handlers (Phase 1.5)
  NotificationEventHandlers: Symbol.for("NotificationEventHandlers"),

  // Comments (Phase 1.4)
  PostCommentRepository: Symbol.for("PostCommentRepository"),
  CreateCommentUseCase: Symbol.for("CreateCommentUseCase"),
  EditCommentUseCase: Symbol.for("EditCommentUseCase"),
  DeleteCommentUseCase: Symbol.for("DeleteCommentUseCase"),
  GetPostCommentsQuery: Symbol.for("GetPostCommentsQuery"),
} as const;

/**
 * Token type for type-safe dependency injection
 */
export type Token = (typeof TOKENS)[keyof typeof TOKENS];

/**
 * Service factory function type
 */
export type ServiceFactory<T> = () => T;

/**
 * Service registration entry
 */
export interface ServiceRegistration<T> {
  factory: ServiceFactory<T>;
  singleton: boolean;
  instance?: T;
}

/**
 * Container configuration options
 */
export interface ContainerOptions {
  /** Whether to create singleton instances by default */
  defaultSingleton?: boolean;
}
