/**
 * @file index.ts
 * @description Barrel for the shared domain core (`@core/domain`): kernel base —
 *   entity errors, strongly-typed identifiers, base domain event infrastructure,
 *   entity/aggregate roots, and base repository ports + UnitOfWork. Populated
 *   incrementally by the @core migration roadmap
 *   (docs/architecture/CORE_MIGRATION_ROADMAP_ES.md).
 * @layer domain
 */

export * from "./errors/index.js";
export * from "./value-objects/EntityId.js";
export * from "./events/DomainEvent.js";
export * from "./entities/Entity.js";
export * from "./aggregates/AggregateRoot.js";
export * from "./repositories/Repository.js";
