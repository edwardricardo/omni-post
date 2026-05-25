/**
 * @file index.ts
 * @description Barrel for the shared application core (`@core/application`):
 *   use cases, command/query handlers, and use-case-contract DTOs. Currently
 *   exposes the base UseCase interfaces + UseCaseError + USE_CASE_ERRORS.
 *   Populated incrementally by the @core migration roadmap
 *   (docs/architecture/CORE_MIGRATION_ROADMAP_ES.md).
 * @layer application
 */

export * from "./UseCase.js";
