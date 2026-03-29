/**
 * Domain Layer - Main Export
 *
 * Part of DDD Architecture Implementation
 * This is the main entry point for the domain layer.
 *
 * The domain layer contains:
 * - Value Objects: Immutable objects identified by their value
 * - Entities: Objects with identity that persists over time (Sprint 4)
 * - Aggregates: Clusters of entities and value objects (Sprint 5)
 * - Domain Events: Significant occurrences in the domain (Sprint 5)
 * - Repository Interfaces: Ports for data access (Sprint 5)
 */

// Value Objects (Sprint 3)
export * from "./value-objects/index.js";

// Domain Errors
export * from "./errors/index.js";

// Entities (Sprint 4)
export * from "./entities/index.js";

// Aggregates (Sprint 5)
export * from "./aggregates/index.js";

// Domain Events (Sprint 5)
export * from "./events/index.js";

// Domain Services
export * from "./services/index.js";

// Repository Interfaces (Sprint 5)
export * from "./repositories/index.js";
