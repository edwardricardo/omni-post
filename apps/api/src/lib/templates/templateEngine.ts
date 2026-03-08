/**
 * Template Engine - API Server
 *
 * This file now re-exports the ServerTemplateEngine from the new implementation.
 * All template functionality has been consolidated into:
 * - BaseTemplateEngine (packages/shared) - shared helpers and core logic
 * - ServerTemplateEngine (this directory) - server-specific features
 *
 * ✅ P1-2: Template Engine Unification Complete
 * - Eliminated ~500 lines of duplicate Handlebars helper code
 * - Centralized template compilation, validation, and rendering
 * - Maintained all server-specific features (Prisma, DOMPurify, platform adapters)
 */

export * from "./ServerTemplateEngine";
export { serverTemplateEngine as templateEngine } from "./ServerTemplateEngine";
