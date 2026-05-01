/**
 * @file fastify.d.ts
 * @description Fastify module augmentation declaring custom decorators (prisma, container,
 *              cache, sagaIntegration) and request properties (correlationId, metrics hooks).
 * @layer infrastructure
 */

declare module "fastify" {
  import type { PrismaClient } from "@infra/prisma";
  import type { Container } from "../infrastructure/container/Container.js";
  import type { RedisCacheManager } from "@adapters/cache-redis";
  import type { SagaIntegration } from "../saga/SagaIntegration.js";

  export interface FastifyInstance {
    prisma?: PrismaClient;
    container?: Container;
    /** Cache manager decorated on the Fastify instance (see index.ts createApp) */
    cache?: RedisCacheManager;
    /** Alias for cache — same RedisCacheManager instance */
    cacheManager?: RedisCacheManager;
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
    _cacheConfig?: { ttl?: number; tags?: string[]; version?: string; enabled?: boolean };
    _routeCacheOptions?: unknown;

    // Input validation middleware (inputValidation.ts)
    validatedBody?: unknown;
    validatedQuery?: unknown;
    validatedParams?: unknown;
  }

  export interface FastifyReply {
    skipCache?: boolean;
  }
}

// Export empty object to make this file a module
export {};
