/**
 * Application Layer - Main Export
 *
 * Part of Sprint 8: DDD Architecture Implementation
 * This is the main entry point for the application layer.
 *
 * The application layer contains:
 * - Use cases (application services)
 * - Input/Output DTOs
 * - Application errors
 *
 * Use cases orchestrate domain objects and external services
 * to fulfill specific user intentions.
 */

// Base use case types
export { USE_CASE_ERRORS } from "./UseCase.js";

// Post use cases
export * from "./posts/index.js";

// Link Tracking use cases (Sprint 19)
export * from "./links/index.js";

// Crisis Mode use cases (Sprint 19)
export * from "./crisis/index.js";
