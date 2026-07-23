/**
 * @file providerOAuth.ts
 * @description Provider OAuth routes facade that re-exports configurations and registers
 *              OAuth route handlers for all supported social media platforms.
 * @layer infrastructure
 */
import { FastifyInstance } from "fastify";
import type { CachePort } from "@ports/core";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import { ProviderOAuthHandler } from "./providerOAuthFlow.js";
import { OAuthFlowStore } from "./oauth/OAuthFlowStore.js";
import { requireClientAuth } from "./customerAuthMiddleware.js";

// Re-export provider OAuth config from the configs module.
export { oauthProviders } from "./providerOAuthConfigs.js";
export type { OAuthConfig, OAuthProvider } from "./providerOAuthConfigs.js";

/**
 * Register OAuth routes
 *
 * Security: All routes require authentication except the OAuth callback,
 * which must remain public because OAuth providers redirect to it.
 */
export async function registerOAuthRoutes(
  fastify: FastifyInstance,
  cache: CachePort,
  channelRepository: ChannelRepository,
  projectRepository: ProjectRepositoryPort
) {
  const handler = new ProviderOAuthHandler(
    new OAuthFlowStore(cache),
    channelRepository,
    projectRepository
  );

  // Requires auth: user must be logged in to initiate an OAuth connection
  fastify.get("/auth/:provider", { preHandler: [requireClientAuth] }, async (request, reply) => {
    return handler.initiateOAuth(request, reply);
  });

  // Public: OAuth providers redirect here with the authorization code
  fastify.get("/auth/callback/:provider", async (request, reply) => {
    return handler.handleCallback(request, reply);
  });

  // Requires auth: accountId is extracted from the authenticated session
  fastify.get(
    "/auth/connections/:projectId",
    { preHandler: [requireClientAuth] },
    async (request, reply) => {
      return handler.getConnections(request, reply);
    }
  );

  // Requires auth: ownership is verified before disconnecting
  fastify.delete(
    "/auth/connections/:connectionId",
    { preHandler: [requireClientAuth] },
    async (request, reply) => {
      return handler.disconnectProvider(request, reply);
    }
  );
}
