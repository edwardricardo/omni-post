/**
 * @file index.ts
 * @description Barrel for the shared domain core (`@core/domain`): the domain model
 *   (entities, aggregates, value objects, domain events, domain services) and the
 *   repository/infra ports shared across deployables.
 * @layer domain
 */

// Domain primitives: errors, identifiers, base domain-event infra, entity/aggregate roots, repository base + UnitOfWork
export * from "./errors/index.js";
export * from "./value-objects/EntityId.js";
export * from "./events/DomainEvent.js";
export * from "./entities/Entity.js";
export * from "./aggregates/AggregateRoot.js";
export * from "./repositories/Repository.js";

// Cross-cutting value objects, events, entities, and read-model DTOs
export * from "./value-objects/Provider.js";
export * from "./value-objects/Content.js";
export * from "./value-objects/PublishStatus.js";
export * from "./value-objects/ScheduledTime.js";
export * from "./value-objects/MediaAttachment.js";
export * from "./value-objects/NotificationType.js";
export * from "./value-objects/CredentialGroup.js";
export * from "./value-objects/AccountCredentialGroup.js";
export * from "./events/ProjectEvents.js";
export * from "./entities/Account.js";
export * from "./entities/Channel.js";
export * from "./entities/CustomerUser.js";
export * from "./entities/Project.js";
export * from "./repositories/ReadModelDtos.js";

// Cross-cutting repository ports (account/project/channel/customer-user) + infra ports (outbox/audit/email/http)
export * from "./repositories/AccountRepository.js";
export * from "./repositories/AccountQueryRepository.js";
export * from "./repositories/ProjectRepository.js";
export * from "./repositories/ProjectQueryRepository.js";
export * from "./repositories/ChannelRepository.js";
export * from "./repositories/ChannelQueryForIngestion.js";
export * from "./repositories/CustomerUserRepository.js";
export * from "./repositories/CustomerRoleRepository.js";
export * from "./repositories/RoleRepository.js";
export * from "./repositories/OutboxWriter.js";
export * from "./repositories/AuditLogRepository.js";
export * from "./repositories/AuditEmitterPort.js";
export * from "./repositories/EmailPort.js";
export * from "./repositories/HttpClientPort.js";
export * from "./repositories/BusinessMetricsPort.js";
export * from "./repositories/GuardrailMetricsPort.js";
export * from "./repositories/ImageGenerationPort.js";
export * from "./repositories/PasswordHasher.js";
export * from "./repositories/CustomerTokenService.js";
export * from "./repositories/PlatformCredentialReader.js";
export * from "./repositories/PlatformCredentialRepository.js";
export * from "./repositories/PlatformEncryptionKeyRepository.js";
export * from "./repositories/AiTokenUsageReader.js";
export * from "./repositories/AccountBillingRepository.js";
export * from "./repositories/AccountSubscriptionBillingRepository.js";
export * from "./repositories/GatewaySwitchEventRepository.js";
export * from "./repositories/BillingEventRepository.js";
export * from "./repositories/InvoiceRepository.js";
export * from "./repositories/ProviderBundleReader.js";
export * from "./repositories/GatewaySwitchJobPort.js";
export * from "./repositories/GatewayAdapterRegistryPort.js";
export * from "./repositories/GdprSettingsRepository.js";
export * from "./repositories/SecuritySettingsRepository.js";
export * from "./repositories/DsarRequestRepository.js";
export * from "./repositories/DataBreachReportRepository.js";
export * from "./repositories/AuditLogRetentionPort.js";
export * from "./repositories/AccountNotificationReader.js";
export * from "./repositories/WebhookDeadLetterArchivalPort.js";
export * from "./ai/AIContracts.js";
export * from "./repositories/AIRequestExecutorPort.js";
export * from "./repositories/EncryptionPort.js";
export * from "./repositories/ReferralRewardMailer.js";
export * from "./repositories/WelcomeMailer.js";
export * from "./repositories/TeamInvitationMailer.js";
export * from "./repositories/NotificationMailer.js";

// Leaf-context value objects, entities, services, security rules, and ports
export * from "./value-objects/UTMParameters.js";
export * from "./entities/BrandKit.js";
export * from "./services/MentionParser.js";
export * from "./security/secretCatalog.js";
export * from "./security/rotationStatusRules.js";
export * from "./repositories/SemanticRetrievalPort.js";
export * from "./repositories/GuardrailPort.js";
export * from "./repositories/UsageMetricRepository.js";
export * from "./repositories/ApiKeyRepository.js";
export * from "./repositories/GeneratedImageRepository.js";
export * from "./repositories/GlossaryRepository.js";
export * from "./repositories/BrandKitRepository.js";
export * from "./repositories/BrandVoiceRepository.js";
export * from "./repositories/StyleGuideRuleRepository.js";
export * from "./repositories/TrackedTermQuery.js";
export * from "./repositories/TrendRadarQueryRepository.js";
export * from "./repositories/RepurposeProposalQueryRepository.js";

// Links, notifications, comments, first-comment, external-notifications, prompt-templates, conversions
export * from "./value-objects/ShortCode.js";
export * from "./value-objects/CommentId.js";
export * from "./value-objects/NotificationId.js";
export * from "./entities/TrackedLink.js";
export * from "./entities/LinkClick.js";
export * from "./entities/Notification.js";
export * from "./aggregates/PostCommentAggregate.js";
export * from "./repositories/TrackedLinkRepository.js";
export * from "./repositories/NotificationRepository.js";
export * from "./repositories/PostCommentRepository.js";
export * from "./repositories/FirstCommentRepository.js";
export * from "./repositories/ExternalNotifierPort.js";
export * from "./repositories/ExternalNotificationConfigRepository.js";
export * from "./repositories/AIPromptTemplateRepository.js";
export * from "./repositories/ConversionRepository.js";

// Analytics: read/query/write/aggregation/thread ports + dimension/metric registries + report schema
export * from "./repositories/AnalyticsReadRepository.js";
export * from "./repositories/AnalyticsQueryRepository.js";
export * from "./repositories/AnalyticsWriteRepository.js";
export * from "./repositories/AnalyticsAggregationQueryPort.js";
export * from "./repositories/ThreadReadRepository.js";
export * from "./analytics/DimensionRegistry.js";
export * from "./analytics/MetricRegistry.js";
export * from "./analytics/ReportSchema.js";

// Reports, recurring posts, tasks, integrations, CRM entities + ports
export * from "./entities/ScheduledReport.js";
export * from "./entities/RecurringPost.js";
export * from "./entities/Task.js";
export * from "./entities/IntegrationApiKey.js";
export * from "./entities/IntegrationSubscription.js";
export * from "./entities/CrmConnection.js";
export * from "./repositories/ScheduledReportRepository.js";
export * from "./repositories/RecurringPostRepository.js";
export * from "./repositories/TaskRepository.js";
export * from "./repositories/IntegrationApiKeyRepository.js";
export * from "./repositories/IntegrationSubscriptionRepository.js";
export * from "./repositories/CrmConnectionRepository.js";
export * from "./repositories/CrmContactRepository.js";
export * from "./repositories/CrmActivityRepository.js";
export * from "./repositories/CrmSyncLogRepository.js";

// Approvals, campaigns, assets, custom reports (value objects, entities, aggregate, ports)
export * from "./value-objects/ApprovalRequestId.js";
export * from "./value-objects/ApprovalStatus.js";
export * from "./value-objects/ReviewDecision.js";
export * from "./value-objects/CampaignStatus.js";
export * from "./entities/ApprovalWorkflow.js";
export * from "./entities/Campaign.js";
export * from "./entities/CustomReport.js";
export * from "./entities/MediaAsset.js";
export * from "./aggregates/ApprovalRequestAggregate.js";
export * from "./repositories/ApprovalRequestRepository.js";
export * from "./repositories/ApprovalWorkflowRepository.js";
export * from "./repositories/CampaignRepository.js";
export * from "./repositories/CampaignQueryRepository.js";
export * from "./repositories/MediaAssetRepository.js";
export * from "./repositories/AssetTagRepository.js";
export * from "./repositories/AssetFolderRepository.js";
export * from "./repositories/CustomReportRepository.js";

// AI: service contract types, structured-output result shapes, content profile, and service port
export * from "./ai/AiServiceContract.js";
export * from "./ai/AiStructuredOutputs.js";
export * from "./ai/PlatformContentProfile.js";
export * from "./repositories/AIServicePort.js";

// Posts: events, aggregate, repository
export * from "./events/PostEvents.js";
export * from "./aggregates/PostAggregate.js";
export * from "./repositories/PostRepository.js";

// Inbox: social message/conversation value objects, entities, aggregate, ports
export * from "./value-objects/SocialConversationId.js";
export * from "./value-objects/SocialMessageId.js";
export * from "./value-objects/SocialMessageStatus.js";
export * from "./value-objects/SocialMessageType.js";
export * from "./entities/ConversationNote.js";
export * from "./entities/SocialConversation.js";
export * from "./aggregates/SocialMessageAggregate.js";
export * from "./repositories/ConversationNoteRepository.js";
export * from "./repositories/SocialConversationRepository.js";
export * from "./repositories/SocialMessageQueryRepository.js";
export * from "./repositories/SocialMessageRepository.js";
export * from "./repositories/SocialOutboundReplyRepository.js";
export * from "./repositories/MentionQueryRepository.js";
export * from "./value-objects/MentionId.js";
export * from "./aggregates/MentionAggregate.js";
export * from "./repositories/MentionRepository.js";

// Auth / customer-auth: identifiers, SSO config entities, repository ports
export * from "./value-objects/CustomerUserId.js";
export * from "./entities/OidcConfiguration.js";
export * from "./entities/SamlConfiguration.js";
export * from "./repositories/OidcConfigurationRepository.js";
export * from "./repositories/SamlConfigurationRepository.js";
export * from "./repositories/AdminUserRepository.js";
export * from "./repositories/AdminSessionRepository.js";

// Billing, bulk-scheduling, and tracking ports + pricing rules
export * from "./billing/PricingCalculator.js";
export * from "./repositories/AccountSubscriptionPort.js";
export * from "./repositories/AccountSubscriptionQueryRepository.js";
export * from "./repositories/SubscriptionStatsQueryRepository.js";
export * from "./repositories/BulkScheduleBatchRepository.js";
export * from "./repositories/BulkScheduleQueryRepository.js";
export * from "./repositories/GA4TrackingPort.js";
