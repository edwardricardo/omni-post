/**
 * @file fastify.d.ts
 * @description Fastify module augmentation declaring custom decorators
 *              (prisma, container, cache, sagaIntegration) and request
 *              properties (correlationId, metrics hooks).
 * @layer infrastructure
 */

declare module "fastify" {
  import type { PrismaClient } from "@infra/prisma";
  import type { Container } from "../infrastructure/container/Container.js";
  import type { CachePort } from "@ports/core";
  import type { SagaIntegration } from "../saga/SagaIntegration.js";

  /**
   * OpenAPI-related schema fields surfaced by `@fastify/swagger`. The
   * plugin loads dynamically at runtime, so the upstream module
   * augmentation is not picked up automatically by the TS project;
   * declaring it here lets route definitions carry
   * `schema: { tags, summary, description, ... }` without errors.
   */
  export interface FastifySchema {
    tags?: readonly string[];
    summary?: string;
    description?: string;
    hide?: boolean;
    deprecated?: boolean;
    consumes?: readonly string[];
    produces?: readonly string[];
    operationId?: string;
    security?: ReadonlyArray<{ [securityLabel: string]: readonly string[] }>;
  }

  /**
   * Cookie options surfaced by `@fastify/cookie`. Same dynamic-import
   * situation as the swagger augmentation above.
   */
  interface FastifyCookieOptions {
    domain?: string;
    encode?: (value: string) => string;
    expires?: Date;
    httpOnly?: boolean;
    maxAge?: number;
    path?: string;
    priority?: "low" | "medium" | "high";
    sameSite?: "lax" | "none" | "strict" | boolean;
    secure?: boolean;
    signed?: boolean;
  }

  /**
   * `RouteShorthandOptions` extension surfaced by `@fastify/websocket`
   * so route definitions can opt into WebSocket upgrade with
   * `{ websocket: true }`.
   */
  interface RouteShorthandOptions {
    websocket?: boolean;
  }

  export interface FastifyInstance {
    prisma?: PrismaClient;
    container?: Container;
    /**
     * OpenAPI document accessor surfaced by `@fastify/swagger`.
     */
    swagger?: () => Record<string, unknown>;
    /**
     * Application-tier cache port decorated at app boot from
     * `TOKENS.CachePort`. Routes and the auto-cache middleware consume it.
     * Ops tooling (stats, flush, pattern invalidation) resolves the concrete
     * `RedisCacheManager` from the DI container directly — never via this
     * decoration.
     */
    cache?: CachePort;
    /** Saga integration for orchestrating multi-step publishing workflows */
    sagaIntegration?: SagaIntegration;
  }

  export interface FastifyRequest {
    cache?: {
      get: (key: string) => Promise<unknown>;
      set: (key: string, value: unknown, ttl?: number, tags?: string[]) => Promise<void>;
      delete: (key: string) => Promise<void>;
    };
    startTime?: number;
    routeConfig?: {
      cache?: boolean;
      cacheTTL?: number;
    };
    user?: {
      id: string;
      email: string;
      role: string;
      name: string;
      isActive: boolean;
      emailVerified: boolean;
      mfaEnabled: boolean;
      lastLoginAt?: Date;
      createdAt: Date;
      projectId?: string;
      accountId?: string;
    };
    /**
     * Admin auth context populated by `adminAuthMiddleware`. Distinct from
     * `request.user` (regular user auth tier).
     */
    auth?: {
      user?: {
        id: string;
        email: string;
        name: string;
        role: string;
        isActive: boolean;
        emailVerified: boolean;
        mfaEnabled: boolean;
        timezone: string | null;
        locale: string | null;
        department: string | null;
        team: string | null;
        lastLoginAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
      };
      sessionId?: string;
      deviceId?: string;
    };
    correlationId?: string;
    requestId?: string;
    userId?: string;
    eventMetadata?: {
      source: string;
      traceId: string;
      userAgent?: string;
      ipAddress?: string;
      userId?: string;
      sessionId?: string;
      sagaId?: string;
    };
    session?: {
      id: string;
      [key: string]: unknown;
    };

    // Metrics middleware (metricsMiddleware.ts)
    finishRequest?: (statusCode: number) => void;
    finishEndpoint?: (status: string) => void;

    // Cache middleware (autoCacheMiddleware.ts, cache-redis middleware)
    _cacheKey?: string;
    _cacheConfig?: { ttl?: number; tags?: string[]; enabled?: boolean };
    _routeCacheOptions?: unknown;

    // Input validation middleware (inputValidation.ts)
    validatedBody?: unknown;
    validatedQuery?: unknown;
    validatedParams?: unknown;

    // Cookie members surfaced by `@fastify/cookie` (dynamically
    // registered in `index.ts`).
    cookies: Record<string, string | undefined>;
  }

  export interface FastifyReply {
    skipCache?: boolean;

    // Cookie members surfaced by `@fastify/cookie`.
    setCookie(name: string, value: string, options?: FastifyCookieOptions): FastifyReply;
    cookie(name: string, value: string, options?: FastifyCookieOptions): FastifyReply;
    clearCookie(name: string, options?: FastifyCookieOptions): FastifyReply;
  }
}

// Export empty object to make this file a module
export {};
