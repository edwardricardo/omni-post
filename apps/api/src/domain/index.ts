/**
 * @file index.ts
 * @description Barrel export for the domain layer — re-exports value objects, errors, entities, aggregates, events, services, and repository ports.
 * @layer domain
 */

// Value Objects
export * from "./value-objects/index.js";

// Domain Errors
export * from "./errors/index.js";

// Entities
export * from "./entities/index.js";

// Aggregates
export * from "./aggregates/index.js";

// Domain Events
export * from "./events/index.js";

// Domain Services
export * from "./services/index.js";

// Repository Interfaces
export * from "./repositories/index.js";
