/**
 * @file templateEngine.ts
 * @description Re-exports ServerTemplateEngine as the unified template engine entry point
 *              for the API server.
 * @layer infrastructure
 */

export * from "./ServerTemplateEngine";
export { serverTemplateEngine as templateEngine } from "./ServerTemplateEngine";
