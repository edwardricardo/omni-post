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
  SearchTeamMembersQuery: Symbol.for("SearchTeamMembersQuery"),

  // Mention Notifications (Phase 1.1 — @mention autocomplete)
  NotifyMentionedUsersService: Symbol.for("NotifyMentionedUsersService"),

  // Approval Workflow (Phase 1.3)
  ApprovalRequestRepository: Symbol.for("ApprovalRequestRepository"),
  ApprovalWorkflowRepository: Symbol.for("ApprovalWorkflowRepository"),
  SubmitForReviewUseCase: Symbol.for("SubmitForReviewUseCase"),
  ApprovePostUseCase: Symbol.for("ApprovePostUseCase"),
  RejectPostUseCase: Symbol.for("RejectPostUseCase"),
  GetApprovalHistoryQuery: Symbol.for("GetApprovalHistoryQuery"),
  GetPendingApprovalsQuery: Symbol.for("GetPendingApprovalsQuery"),
  CreateApprovalWorkflowUseCase: Symbol.for("CreateApprovalWorkflowUseCase"),
  UpdateApprovalWorkflowUseCase: Symbol.for("UpdateApprovalWorkflowUseCase"),
  DeleteApprovalWorkflowUseCase: Symbol.for("DeleteApprovalWorkflowUseCase"),
  ListApprovalWorkflowsQuery: Symbol.for("ListApprovalWorkflowsQuery"),

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
  // Social Inbox (Phase 2)
  SocialMessageRepository: Symbol.for("SocialMessageRepository"),
  SocialMessageQueryRepository: Symbol.for("SocialMessageQueryRepository"),
  SocialConversationRepository: Symbol.for("SocialConversationRepository"),
  SocialOutboundReplyRepository: Symbol.for("SocialOutboundReplyRepository"),
  IngestSocialMessageUseCase: Symbol.for("IngestSocialMessageUseCase"),
  MarkMessageReadUseCase: Symbol.for("MarkMessageReadUseCase"),
  MarkMessageArchivedUseCase: Symbol.for("MarkMessageArchivedUseCase"),
  AssignMessageUseCase: Symbol.for("AssignMessageUseCase"),
  SendReplyUseCase: Symbol.for("SendReplyUseCase"),
  ResolveConversationUseCase: Symbol.for("ResolveConversationUseCase"),
  ReopenConversationUseCase: Symbol.for("ReopenConversationUseCase"),
  SyncProviderCommentsUseCase: Symbol.for("SyncProviderCommentsUseCase"),
  GetInboxQuery: Symbol.for("GetInboxQuery"),
  GetMentionsQuery: Symbol.for("GetMentionsQuery"),
  GetConversationQuery: Symbol.for("GetConversationQuery"),
  GetConversationMessagesQuery: Symbol.for("GetConversationMessagesQuery"),
  GetUnreadInboxCountQuery: Symbol.for("GetUnreadInboxCountQuery"),
  InboxEventHandlers: Symbol.for("InboxEventHandlers"),

  // Conversation Notes (Social Inbox)
  ConversationNoteRepository: Symbol.for("ConversationNoteRepository"),
  AddConversationNoteUseCase: Symbol.for("AddConversationNoteUseCase"),
  DeleteConversationNoteUseCase: Symbol.for("DeleteConversationNoteUseCase"),
  ListConversationNotesQuery: Symbol.for("ListConversationNotesQuery"),

  // Campaign (Phase 3.1: Campaign Tagging)
  CampaignRepository: Symbol.for("CampaignRepository"),
  CampaignQueryRepository: Symbol.for("CampaignQueryRepository"),
  CreateCampaignUseCase: Symbol.for("CreateCampaignUseCase"),
  UpdateCampaignUseCase: Symbol.for("UpdateCampaignUseCase"),
  ArchiveCampaignUseCase: Symbol.for("ArchiveCampaignUseCase"),
  TagPostWithCampaignUseCase: Symbol.for("TagPostWithCampaignUseCase"),
  UntagPostFromCampaignUseCase: Symbol.for("UntagPostFromCampaignUseCase"),
  GetCampaignAnalyticsUseCase: Symbol.for("GetCampaignAnalyticsUseCase"),
  ListCampaignsQuery: Symbol.for("ListCampaignsQuery"),
  GetCampaignQuery: Symbol.for("GetCampaignQuery"),

  // First Comment Scheduling
  FirstCommentRepository: Symbol.for("FirstCommentRepository"),
  SetFirstCommentUseCase: Symbol.for("SetFirstCommentUseCase"),
  RemoveFirstCommentUseCase: Symbol.for("RemoveFirstCommentUseCase"),
  GetFirstCommentQuery: Symbol.for("GetFirstCommentQuery"),
  PublishFirstCommentUseCase: Symbol.for("PublishFirstCommentUseCase"),

  // Historical Analytics (Phase 3 Step 5)
  GetHistoricalAnalyticsQuery: Symbol.for("GetHistoricalAnalyticsQuery"),

  // UTM / GA4 (Phase 3 Step 4: UTM/GA4 Integration)
  GenerateUTMLinksUseCase: Symbol.for("GenerateUTMLinksUseCase"),
  GA4TrackingPort: Symbol.for("GA4TrackingPort"),

  // Scheduled Reports (Phase 3 Step 7)
  ScheduledReportRepository: Symbol.for("ScheduledReportRepository"),
  EmailPort: Symbol.for("EmailPort"),
  CreateScheduledReportUseCase: Symbol.for("CreateScheduledReportUseCase"),
  UpdateScheduledReportUseCase: Symbol.for("UpdateScheduledReportUseCase"),
  DeleteScheduledReportUseCase: Symbol.for("DeleteScheduledReportUseCase"),
  ListScheduledReportsQuery: Symbol.for("ListScheduledReportsQuery"),
  GenerateReportUseCase: Symbol.for("GenerateReportUseCase"),

  // External Notifications (Step 6: Slack/Teams webhooks)
  ExternalNotificationConfigRepository: Symbol.for("ExternalNotificationConfigRepository"),
  ExternalNotifierPort: Symbol.for("ExternalNotifierPort"),
  ConfigureExternalNotificationUseCase: Symbol.for("ConfigureExternalNotificationUseCase"),
  ListExternalNotificationsQuery: Symbol.for("ListExternalNotificationsQuery"),
  DeleteExternalNotificationUseCase: Symbol.for("DeleteExternalNotificationUseCase"),
  TestExternalNotificationUseCase: Symbol.for("TestExternalNotificationUseCase"),
  ExternalNotificationDispatcher: Symbol.for("ExternalNotificationDispatcher"),

  // AI Image Generation (Step 8)
  GeneratedImageRepository: Symbol.for("GeneratedImageRepository"),
  GenerateImageUseCase: Symbol.for("GenerateImageUseCase"),
  ListGeneratedImagesQuery_AIImage: Symbol.for("ListGeneratedImagesQuery_AIImage"),

  // Recurring Posts
  RecurringPostRepository: Symbol.for("RecurringPostRepository"),
  CreateRecurringPostUseCase: Symbol.for("CreateRecurringPostUseCase"),
  UpdateRecurringPostUseCase: Symbol.for("UpdateRecurringPostUseCase"),
  DeactivateRecurringPostUseCase: Symbol.for("DeactivateRecurringPostUseCase"),
  ListRecurringPostsQuery_Recurring: Symbol.for("ListRecurringPostsQuery_Recurring"),
  GetRecurringPostQuery: Symbol.for("GetRecurringPostQuery"),
  ProcessRecurrenceUseCase: Symbol.for("ProcessRecurrenceUseCase"),

  // AI Prompt Templates (Task 11.3)
  AIPromptTemplateRepository: Symbol.for("AIPromptTemplateRepository"),
  ListAIPromptTemplatesQuery: Symbol.for("ListAIPromptTemplatesQuery"),
  CreateAIPromptTemplateUseCase: Symbol.for("CreateAIPromptTemplateUseCase"),
  UpdateAIPromptTemplateUseCase: Symbol.for("UpdateAIPromptTemplateUseCase"),
  DeleteAIPromptTemplateUseCase: Symbol.for("DeleteAIPromptTemplateUseCase"),

  // Usage Metering (Task 11.5)
  UsageMetricRepository: Symbol.for("UsageMetricRepository"),
  IncrementUsageUseCase: Symbol.for("IncrementUsageUseCase"),
  GetUsageUseCase: Symbol.for("GetUsageUseCase"),

  // Brand Voice Profiles (Task 11.7)
  BrandVoiceRepository: Symbol.for("BrandVoiceRepository"),
  GetBrandVoiceQuery: Symbol.for("GetBrandVoiceQuery"),
  UpsertBrandVoiceUseCase: Symbol.for("UpsertBrandVoiceUseCase"),
  DeleteBrandVoiceUseCase: Symbol.for("DeleteBrandVoiceUseCase"),
  // Brand Kit
  BrandKitRepository: Symbol.for("BrandKitRepository"),
  GetBrandKitQuery: Symbol.for("GetBrandKitQuery"),
  UpsertBrandKitUseCase: Symbol.for("UpsertBrandKitUseCase"),
  DeleteBrandKitUseCase: Symbol.for("DeleteBrandKitUseCase"),

  // Integration Platform (Zapier, Make, etc.)
  IntegrationApiKeyRepository: Symbol.for("IntegrationApiKeyRepository"),
  IntegrationSubscriptionRepository: Symbol.for("IntegrationSubscriptionRepository"),
  GenerateIntegrationApiKeyUseCase: Symbol.for("GenerateIntegrationApiKeyUseCase"),
  RevokeIntegrationApiKeyUseCase: Symbol.for("RevokeIntegrationApiKeyUseCase"),
  ListIntegrationApiKeysQuery: Symbol.for("ListIntegrationApiKeysQuery"),
  SubscribeIntegrationTriggerUseCase: Symbol.for("SubscribeIntegrationTriggerUseCase"),
  UnsubscribeIntegrationTriggerUseCase: Symbol.for("UnsubscribeIntegrationTriggerUseCase"),
  TriggerIntegrationEventService: Symbol.for("TriggerIntegrationEventService"),

  // Task Assignment
  TaskRepository: Symbol.for("TaskRepository"),
  CreateTaskUseCase: Symbol.for("CreateTaskUseCase"),
  UpdateTaskUseCase: Symbol.for("UpdateTaskUseCase"),
  CompleteTaskUseCase: Symbol.for("CompleteTaskUseCase"),
  CancelTaskUseCase: Symbol.for("CancelTaskUseCase"),
  ListTasksQuery: Symbol.for("ListTasksQuery"),
  GetTaskQuery: Symbol.for("GetTaskQuery"),

  // Asset Library (Phase 2: Asset Tags)
  MediaAssetRepository: Symbol.for("MediaAssetRepository"),
  AssetTagRepository: Symbol.for("AssetTagRepository"),
  AssetFolderRepository: Symbol.for("AssetFolderRepository"),
  CreateMediaAssetUseCase: Symbol.for("CreateMediaAssetUseCase"),
  UpdateMediaAssetUseCase: Symbol.for("UpdateMediaAssetUseCase"),
  DeleteMediaAssetUseCase: Symbol.for("DeleteMediaAssetUseCase"),
  TagMediaAssetUseCase: Symbol.for("TagMediaAssetUseCase"),
  GetMediaAssetsQuery: Symbol.for("GetMediaAssetsQuery"),
  CreateAssetTagUseCase: Symbol.for("CreateAssetTagUseCase"),
  ListAssetTagsQuery: Symbol.for("ListAssetTagsQuery"),
  CreateAssetFolderUseCase: Symbol.for("CreateAssetFolderUseCase"),
  ImportFromGoogleDriveUseCase: Symbol.for("ImportFromGoogleDriveUseCase"),

  // SAML SSO
  SamlConfigurationRepository: Symbol.for("SamlConfigurationRepository"),
  ConfigureSamlUseCase: Symbol.for("ConfigureSamlUseCase"),
  EnableSsoUseCase: Symbol.for("EnableSsoUseCase"),
  DisableSsoUseCase: Symbol.for("DisableSsoUseCase"),
  GetSamlConfigurationQuery: Symbol.for("GetSamlConfigurationQuery"),

  // OIDC SSO
  OidcConfigurationRepository: Symbol.for("OidcConfigurationRepository"),
  ConfigureOidcUseCase: Symbol.for("ConfigureOidcUseCase"),
  EnableOidcSsoUseCase: Symbol.for("EnableOidcSsoUseCase"),
  DisableOidcSsoUseCase: Symbol.for("DisableOidcSsoUseCase"),
  GetOidcConfigurationQuery: Symbol.for("GetOidcConfigurationQuery"),

  // Custom Report Builder
  CustomReportRepository: Symbol.for("CustomReportRepository"),
  CreateCustomReportUseCase: Symbol.for("CreateCustomReportUseCase"),
  UpdateCustomReportUseCase: Symbol.for("UpdateCustomReportUseCase"),
  DeleteCustomReportUseCase: Symbol.for("DeleteCustomReportUseCase"),
  ListCustomReportsQuery: Symbol.for("ListCustomReportsQuery"),
  GetCustomReportQuery: Symbol.for("GetCustomReportQuery"),
  RunCustomReportQuery: Symbol.for("RunCustomReportQuery"),
  ScheduleCustomReportUseCase: Symbol.for("ScheduleCustomReportUseCase"),
  // Customer Auth
  CustomerUserRepository: Symbol.for("CustomerUserRepository"),
  RegisterCustomerUseCase: Symbol.for("RegisterCustomerUseCase"),
  LoginCustomerUseCase: Symbol.for("LoginCustomerUseCase"),
  RefreshCustomerTokenUseCase: Symbol.for("RefreshCustomerTokenUseCase"),
  LogoutCustomerUseCase: Symbol.for("LogoutCustomerUseCase"),
  RequestPasswordResetUseCase: Symbol.for("RequestPasswordResetUseCase"),
  ResetPasswordUseCase: Symbol.for("ResetPasswordUseCase"),

  // CRM Integration
  CrmConnectionRepository: Symbol.for("CrmConnectionRepository"),
  CrmContactRepository: Symbol.for("CrmContactRepository"),
  CrmActivityRepository: Symbol.for("CrmActivityRepository"),
  CrmSyncLogRepository: Symbol.for("CrmSyncLogRepository"),
  ConnectCrmUseCase: Symbol.for("ConnectCrmUseCase"),
  DisconnectCrmUseCase: Symbol.for("DisconnectCrmUseCase"),
  GetCrmConnectionsQuery: Symbol.for("GetCrmConnectionsQuery"),
  SyncCrmContactsUseCase: Symbol.for("SyncCrmContactsUseCase"),
  LogCrmActivityUseCase: Symbol.for("LogCrmActivityUseCase"),
  GetCrmSyncLogsQuery: Symbol.for("GetCrmSyncLogsQuery"),

  // Queue (shared)
  QueuePort: Symbol.for("QueuePort"),

  // Analytics Aggregation (Sprint Gaps — Batch 2)
  AnalyticsAggregationQuery: Symbol.for("AnalyticsAggregationQuery"),

  // Analytics Ingestion (Sprint Gaps — Batch 1)
  AnalyticsWriteRepository: Symbol.for("AnalyticsWriteRepository"),
  ChannelQueryForIngestion: Symbol.for("ChannelQueryForIngestion"),
  IngestChannelAnalyticsUseCase: Symbol.for("IngestChannelAnalyticsUseCase"),
  DispatchAnalyticsIngestionUseCase: Symbol.for("DispatchAnalyticsIngestionUseCase"),

  // Inbox Sync (Sprint Gaps — Batch 3)
  DispatchInboxSyncUseCase: Symbol.for("DispatchInboxSyncUseCase"),

  // Payment Billing (Sprint 6 — Batch 5)
  PaymentAdapter: Symbol.for("PaymentAdapter"),

  // Report Sharing (Sprint 6 — Batch 3)
  EnableReportSharingUseCase: Symbol.for("EnableReportSharingUseCase"),
  DisableReportSharingUseCase: Symbol.for("DisableReportSharingUseCase"),

  // AI Differentiation (Sprint 7)
  TopPerformersQueryPort: Symbol.for("TopPerformersQueryPort"),
  GetTopPerformersContextUseCase: Symbol.for("GetTopPerformersContextUseCase"),
  GeneratePlatformVariantsUseCase: Symbol.for("GeneratePlatformVariantsUseCase"),
  GenerateContentCalendarUseCase: Symbol.for("GenerateContentCalendarUseCase"),
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
