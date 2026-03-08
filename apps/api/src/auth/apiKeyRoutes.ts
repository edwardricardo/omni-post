/**
 * API Key Routes
 *
 * REST API endpoints for managing API keys. Allows authenticated admin users
 * to create, list, rotate, and deactivate API keys scoped to their account.
 *
 * All endpoints require JWT authentication (Bearer token).
 * The actual API keys issued here are used for machine-to-machine access.
 *
 * Endpoints:
 *   GET    /api-keys               — List all active keys for the account
 *   POST   /api-keys               — Create a new API key (returns raw key once)
 *   POST   /api-keys/:id/rotate    — Rotate (re-generate) a key's secret
 *   DELETE /api-keys/:id           — Deactivate a key (soft delete)
 *
 * @module auth/apiKeyRoutes
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import { authenticateMiddleware } from "./authMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { CreateApiKeyUseCase } from "../application/apiKeys/ApiKeyUseCases.js";
import type { ValidateApiKeyUseCase } from "../application/apiKeys/ApiKeyUseCases.js";
import type { ListApiKeysUseCase } from "../application/apiKeys/ApiKeyUseCases.js";
import type { RotateApiKeyUseCase } from "../application/apiKeys/ApiKeyUseCases.js";
import type { DeactivateApiKeyUseCase } from "../application/apiKeys/ApiKeyUseCases.js";
import type { DomainApiKey } from "../domain/repositories/ApiKeyRepository.js";
import { withTimeout, TimeoutError, USE_CASE_TIMEOUT_MS } from "../lib/withTimeout.js";

// ─── Schemas ────────────────────────────────────────────────────────────────

const CreateApiKeyBody = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.enum(["read", "write", "publish", "analytics", "admin"])).optional(),
  rateLimit: z.number().int().min(1).max(100_000).optional(),
  expiresAt: z.string().datetime().optional(),
  rotationSchedule: z.string().optional(),
});

type CreateApiKeyBodyType = z.infer<typeof CreateApiKeyBody>;

const KeyIdParams = z.object({
  id: z.string().uuid(),
});

type KeyIdParamsType = z.infer<typeof KeyIdParams>;

// ─── Safe projection (never expose keyHash to API consumers) ───────────────

function toPublicView(key: DomainApiKey) {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    permissions: key.permissions,
    rateLimit: key.rateLimit,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    isActive: key.isActive,
    rotationSchedule: key.rotationSchedule ?? null,
    createdAt: key.createdAt.toISOString(),
    updatedAt: key.updatedAt.toISOString(),
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

class ApiKeyRouteHandler extends BaseRouteHandler {
  protected routeName = "api-keys";

  constructor(
    private readonly createUC: CreateApiKeyUseCase,
    // validateUC reserved for future middleware use
    private readonly _validateUC: ValidateApiKeyUseCase,
    private readonly listUC: ListApiKeysUseCase,
    private readonly rotateUC: RotateApiKeyUseCase,
    private readonly deactivateUC: DeactivateApiKeyUseCase
  ) {
    super();
  }

  /** Extract accountId from the authenticated request */
  private getAccountId(request: FastifyRequest): string | undefined {
    return (request as FastifyRequest & { user?: { accountId?: string } }).user?.accountId;
  }

  /**
   * GET /api-keys
   * List all active API keys for the authenticated account.
   */
  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = this.getAccountId(request);

    if (!accountId) {
      return this.sendError(ctx, 401, "Missing account context");
    }

    let result: Awaited<ReturnType<ListApiKeysUseCase["execute"]>>;
    try {
      result = await withTimeout(
        this.listUC.execute(accountId),
        USE_CASE_TIMEOUT_MS,
        "ListApiKeys"
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        return this.sendError(ctx, 504, "Request timeout");
      }
      return this.sendError(ctx, 500, "Failed to list API keys");
    }

    if (!result.ok) {
      return this.sendError(ctx, 500, "Failed to list API keys");
    }

    return this.sendSuccess(ctx, result.value.map(toPublicView));
  }

  /**
   * POST /api-keys
   * Create a new API key. The raw key is returned exactly once.
   */
  async create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = this.getAccountId(request);

    if (!accountId) {
      return this.sendError(ctx, 401, "Missing account context");
    }

    const bodyResult = await this.validateBody<CreateApiKeyBodyType>(ctx, CreateApiKeyBody);
    if (!bodyResult.ok) return this.sendError(ctx, 400, "Validation failed");

    const { name, permissions, rateLimit, expiresAt, rotationSchedule } = bodyResult.value;

    let result: Awaited<ReturnType<CreateApiKeyUseCase["execute"]>>;
    try {
      result = await withTimeout(
        this.createUC.execute({
          accountId,
          name,
          ...(permissions !== undefined && { permissions }),
          ...(rateLimit !== undefined && { rateLimit }),
          ...(expiresAt !== undefined && { expiresAt: new Date(expiresAt) }),
          ...(rotationSchedule !== undefined && { rotationSchedule }),
        }),
        USE_CASE_TIMEOUT_MS,
        "CreateApiKey"
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        return this.sendError(ctx, 504, "Request timeout");
      }
      return this.sendError(ctx, 500, "Failed to create API key");
    }

    if (!result.ok) {
      const isValidation = result.error.message.toLowerCase().includes("valid");
      return this.sendError(ctx, isValidation ? 400 : 500, result.error.message);
    }

    const { key, rawKey } = result.value;
    return this.sendSuccess(
      ctx,
      {
        key: toPublicView(key),
        rawKey,
        warning: "Save this key securely — it will not be shown again.",
      },
      201
    );
  }

  /**
   * POST /api-keys/:id/rotate
   * Rotate a key's secret. Old key becomes invalid immediately.
   */
  async rotate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const paramsResult = await this.validateParams<KeyIdParamsType>(ctx, KeyIdParams);
    if (!paramsResult.ok) return this.sendError(ctx, 400, "Validation failed");

    const { id } = paramsResult.value;

    let result: Awaited<ReturnType<RotateApiKeyUseCase["execute"]>>;
    try {
      result = await withTimeout(this.rotateUC.execute(id), USE_CASE_TIMEOUT_MS, "RotateApiKey");
    } catch (error) {
      if (error instanceof TimeoutError) {
        return this.sendError(ctx, 504, "Request timeout");
      }
      return this.sendError(ctx, 500, "Failed to rotate API key");
    }

    if (!result.ok) {
      const isNotFound = result.error.constructor.name === "ApiKeyNotFoundError";
      return this.sendError(ctx, isNotFound ? 404 : 500, result.error.message);
    }

    const { key, rawKey } = result.value;
    return this.sendSuccess(ctx, {
      key: toPublicView(key),
      rawKey,
      warning: "Save this key securely — it will not be shown again.",
    });
  }

  /**
   * DELETE /api-keys/:id
   * Deactivate (soft-delete) an API key.
   */
  async deactivate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const paramsResult = await this.validateParams<KeyIdParamsType>(ctx, KeyIdParams);
    if (!paramsResult.ok) return this.sendError(ctx, 400, "Validation failed");

    const { id } = paramsResult.value;

    let result: Awaited<ReturnType<DeactivateApiKeyUseCase["execute"]>>;
    try {
      result = await withTimeout(
        this.deactivateUC.execute(id),
        USE_CASE_TIMEOUT_MS,
        "DeactivateApiKey"
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        return this.sendError(ctx, 504, "Request timeout");
      }
      return this.sendError(ctx, 500, "Failed to deactivate API key");
    }

    if (!result.ok) {
      const isNotFound = result.error.constructor.name === "ApiKeyNotFoundError";
      return this.sendError(ctx, isNotFound ? 404 : 500, result.error.message);
    }

    return this.sendSuccess(ctx, { deactivated: true });
  }
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

/**
 * Fastify plugin registering all API key endpoints.
 * Resolves use cases from the DI container attached to the Fastify instance.
 */
export const apiKeyRoutes: FastifyPluginAsync = async (fastify) => {
  const container = (
    fastify as typeof fastify & { container?: { resolve: <T>(token: symbol) => T } }
  ).container;

  if (!container) {
    fastify.log.warn("DI container not available — API key routes skipped");
    return;
  }

  const handler = new ApiKeyRouteHandler(
    container.resolve<CreateApiKeyUseCase>(TOKENS.CreateApiKeyUseCase),
    container.resolve<ValidateApiKeyUseCase>(TOKENS.ValidateApiKeyUseCase),
    container.resolve<ListApiKeysUseCase>(TOKENS.ListApiKeysUseCase),
    container.resolve<RotateApiKeyUseCase>(TOKENS.RotateApiKeyUseCase),
    container.resolve<DeactivateApiKeyUseCase>(TOKENS.DeactivateApiKeyUseCase)
  );

  const authOptions = { preHandler: [authenticateMiddleware] };

  fastify.get("/api-keys", authOptions, (req, reply) => handler.list(req, reply));
  fastify.post("/api-keys", authOptions, (req, reply) => handler.create(req, reply));
  fastify.post("/api-keys/:id/rotate", authOptions, (req, reply) => handler.rotate(req, reply));
  fastify.delete("/api-keys/:id", authOptions, (req, reply) => handler.deactivate(req, reply));
};
