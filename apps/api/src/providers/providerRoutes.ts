/**
 * @file providerRoutes.ts
 * @description REST API endpoints for querying provider capabilities, connections,
 *              content validation, and provider metadata.
 * @layer infrastructure
 */
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { ProviderRegistryService } from "./providerRegistry.js";
import type { ProviderService } from "./providerService.js";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import { TOKENS } from "../infrastructure/container/types.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";

// Provider-specific schemas
const ProviderCapabilitySchema = z.enum([
  "publish",
  "schedule",
  "analytics",
  "comments",
  "replies",
  "threading",
  "stories",
  "reels",
  "carousel",
]);

const GetProviderByCapabilityParamsSchema = z.object({
  capability: ProviderCapabilitySchema,
});

const GetProviderParamsSchema = z.object({
  id: z.string().min(1),
});

const GetProviderConnectionsParamsSchema = z.object({
  projectId: z.string().min(1),
});

/** Result shape for individual provider health checks */
interface ProviderHealthResult {
  id: string;
  name: string;
  status: string;
  healthy: boolean;
  latency?: number;
  error?: string;
}

/**
 * Provider route handler extending BaseRouteHandler
 */
class ProviderRouteHandler extends BaseRouteHandler {
  protected routeName = "providers";

  constructor(
    private readonly providerService: ProviderService,
    private readonly providerRegistry: ProviderRegistryService
  ) {
    super();
  }

  /**
   * GET /providers - Get all providers
   */
  async getAllProviders(ctx: RouteContext): Promise<void> {
    const result = await this.providerService.getAllProviders();
    this.sendSuccess(ctx, result);
  }

  /**
   * GET /providers/active - Get active providers only
   */
  async getActiveProviders(ctx: RouteContext): Promise<void> {
    const result = await this.providerService.getActiveProviders();
    this.sendSuccess(ctx, result);
  }

  /**
   * GET /providers/by-capability/:capability - Get providers by capability
   */
  async getProvidersByCapability(ctx: RouteContext): Promise<void> {
    // Validate params
    const validationResult = await this.validateRequest(ctx, {
      params: GetProviderByCapabilityParamsSchema,
    });

    if (!validationResult.ok) {
      return this.sendError(ctx, 400, "Invalid capability", {
        validCapabilities: ProviderCapabilitySchema.options,
      });
    }

    const { params } = validationResult.value as {
      params: z.infer<typeof GetProviderByCapabilityParamsSchema>;
    };

    const result = await this.providerService.getProvidersByCapability(params.capability);
    this.sendSuccess(ctx, result);
  }

  /**
   * GET /providers/:id - Get specific provider details
   */
  async getProviderById(ctx: RouteContext): Promise<void> {
    // Validate params
    const validationResult = await this.validateRequest(ctx, {
      params: GetProviderParamsSchema,
    });

    if (!validationResult.ok) {
      return this.sendError(ctx, 400, "Invalid provider ID");
    }

    const { params } = validationResult.value as {
      params: z.infer<typeof GetProviderParamsSchema>;
    };

    const provider = await this.providerService.getProviderById(params.id);

    if (!provider) {
      return this.sendError(ctx, 404, "Provider not found");
    }

    this.sendSuccess(ctx, { provider });
  }

  /**
   * GET /providers/:id/health - Check provider health
   */
  async getProviderHealth(ctx: RouteContext): Promise<void> {
    // Validate params
    const validationResult = await this.validateRequest(ctx, {
      params: GetProviderParamsSchema,
    });

    if (!validationResult.ok) {
      return this.sendError(ctx, 400, "Invalid provider ID");
    }

    const { params } = validationResult.value as {
      params: z.infer<typeof GetProviderParamsSchema>;
    };

    const provider = this.providerRegistry.getProvider(params.id);

    if (!provider) {
      return this.sendError(ctx, 404, "Provider not found");
    }

    const health = await this.providerRegistry.checkProviderHealth(params.id);

    this.sendSuccess(ctx, {
      providerId: params.id,
      providerName: provider.displayName,
      health,
    });
  }

  /**
   * GET /providers/health/all - Check all providers health
   */
  async getAllProvidersHealth(ctx: RouteContext): Promise<void> {
    const healthResults = await this.providerRegistry.checkAllProvidersHealth();

    const summary = {
      total: healthResults.size,
      healthy: 0,
      unhealthy: 0,
      avgLatency: 0,
    };

    let totalLatency = 0;
    let latencyCount = 0;

    const results: ProviderHealthResult[] = [];
    for (const [id, health] of healthResults) {
      const provider = this.providerRegistry.getProvider(id);
      if (health.healthy) {
        summary.healthy++;
      } else {
        summary.unhealthy++;
      }

      if (health.latency) {
        totalLatency += health.latency;
        latencyCount++;
      }

      results.push({
        id,
        name: provider?.displayName || id,
        status: provider?.status || "unknown",
        ...health,
      });
    }

    if (latencyCount > 0) {
      summary.avgLatency = Math.round(totalLatency / latencyCount);
    }

    this.sendSuccess(ctx, {
      summary,
      providers: results,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * GET /providers/connections/:projectId - Get provider connections for a project
   */
  async getProviderConnections(ctx: RouteContext): Promise<void> {
    // Validate params
    const validationResult = await this.validateRequest(ctx, {
      params: GetProviderConnectionsParamsSchema,
    });

    if (!validationResult.ok) {
      return this.sendError(ctx, 400, "Invalid project ID");
    }

    const { params } = validationResult.value as {
      params: z.infer<typeof GetProviderConnectionsParamsSchema>;
    };

    try {
      const connections = await this.providerService.getConnectionsByProjectId(params.projectId);

      this.sendSuccess(ctx, {
        projectId: params.projectId,
        connections,
        total: connections.length,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch provider connections";
      this.sendError(ctx, 500, message);
    }
  }
}

/**
 * Fastify plugin using the refactored handler
 */
const providerRoutes: FastifyPluginAsync = async (fastify) => {
  const svcProvider = fastify.container!.resolve<ProviderService>(TOKENS.ProviderService);
  const svcRegistry = fastify.container!.resolve<ProviderRegistryService>(TOKENS.ProviderRegistry);
  const handler = new ProviderRouteHandler(svcProvider, svcRegistry);

  // Register routes
  fastify.get(
    "/providers",
    { schema: { tags: ["Providers"], summary: "Get all providers" } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await handler.getAllProviders({ request, reply });
    }
  );

  fastify.get(
    "/providers/active",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Providers"], summary: "Get active providers" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await handler.getActiveProviders({ request, reply });
    }
  );

  fastify.get(
    "/providers/by-capability/:capability",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Providers"], summary: "Get providers by capability" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await handler.getProvidersByCapability({ request, reply });
    }
  );

  fastify.get(
    "/providers/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Providers"], summary: "Get provider details by ID" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await handler.getProviderById({ request, reply });
    }
  );

  fastify.get(
    "/providers/:id/health",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Providers"], summary: "Check provider health" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await handler.getProviderHealth({ request, reply });
    }
  );

  fastify.get(
    "/providers/health/all",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Providers"], summary: "Check all providers health" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await handler.getAllProvidersHealth({ request, reply });
    }
  );

  fastify.get(
    "/providers/connections/:projectId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Providers"], summary: "Get provider connections for a project" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await handler.getProviderConnections({ request, reply });
    }
  );
};

export { providerRoutes };
