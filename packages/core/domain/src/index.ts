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
