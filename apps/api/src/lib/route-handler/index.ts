/**
 * @file index.ts
 * @description Barrel for the app-local route-handler module — `BaseRouteHandler`
 *              and its companion types. Lives in `apps/api` because the class is
 *              Fastify-coupled and would otherwise leak the framework into the
 *              shared `@packages/api-common`.
 * @layer infrastructure
 */
export { BaseRouteHandler } from "./BaseRouteHandler.js";
export type {
  RouteContext,
  ValidationOptions,
  ErrorResponse,
  SuccessResponse,
  OAuthErrorContext,
  OAuthErrorResponse,
  WebhookVerificationOptions,
} from "./BaseRouteHandler.js";
