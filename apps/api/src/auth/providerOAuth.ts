/**
 * Provider OAuth Routes - Facade
 *
 * Re-exports OAuth configurations and registers route handlers.
 * Implementation split into:
 * - providerOAuthConfigs.ts (provider configs and types)
 * - providerOAuthFlow.ts    (route handler + state management)
 *
 * @module auth/providerOAuth
 */
import { FastifyInstance } from "fastify";
import { ProviderOAuthHandler } from "./providerOAuthFlow.js";
import { requireClientAuth } from "./customerAuthMiddleware.js";

// Re-export for backward compatibility
export { oauthProviders } from "./providerOAuthConfigs.js";
export type { OAuthConfig, OAuthProvider } from "./providerOAuthConfigs.js";

/**
 * Register OAuth routes
 *
 * Security: All routes require authentication except the OAuth callback,
 * which must remain public because OAuth providers redirect to it.
 */
export async function registerOAuthRoutes(fastify: FastifyInstance) {
  const handler = new ProviderOAuthHandler();

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
