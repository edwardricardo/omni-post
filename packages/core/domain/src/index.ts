/**
 * @file index.ts
 * @description Barrel for the shared domain core (`@core/domain`): kernel base —
 *   entity errors, strongly-typed identifiers, base domain event infrastructure,
 *   entity/aggregate roots, and base repository ports + UnitOfWork. Populated
 *   incrementally by the @core migration roadmap
 *   (docs/architecture/CORE_MIGRATION_ROADMAP_ES.md).
 * @layer domain
 */

// Kernel base (P1)
export * from "./errors/index.js";
export * from "./value-objects/EntityId.js";
export * from "./events/DomainEvent.js";
export * from "./entities/Entity.js";
export * from "./aggregates/AggregateRoot.js";
export * from "./repositories/Repository.js";

// Shared cross-cutting domain model (P2)
export * from "./value-objects/Provider.js";
export * from "./value-objects/Content.js";
export * from "./value-objects/PublishStatus.js";
export * from "./value-objects/ScheduledTime.js";
export * from "./value-objects/MediaAttachment.js";
export * from "./value-objects/NotificationType.js";
export * from "./events/ProjectEvents.js";
export * from "./entities/Account.js";
export * from "./entities/Channel.js";
export * from "./entities/CustomerUser.js";
export * from "./entities/Project.js";
export * from "./repositories/ReadModelDtos.js";

// Shared cross-cutting ports (P2): repos of the P2 entities + infra ports
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
export * from "./repositories/EmailPort.js";
export * from "./repositories/HttpClientPort.js";

// Leaf contexts (P3): value objects, entities, domain services, security rules, ports
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

// Standalone features (P4): links, notifications, comments, first-comment,
// external-notifications, aiPromptTemplates, referral/conversions
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

// Feature module: analytics (P5-A)
export * from "./repositories/AnalyticsReadRepository.js";
export * from "./repositories/AnalyticsQueryRepository.js";
export * from "./repositories/AnalyticsWriteRepository.js";
export * from "./repositories/AnalyticsAggregationQueryPort.js";
export * from "./repositories/ThreadReadRepository.js";
export * from "./analytics/DimensionRegistry.js";
export * from "./analytics/MetricRegistry.js";
export * from "./analytics/ReportSchema.js";
