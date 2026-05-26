/**
 * @file integrationAuthMiddleware.ts
 * @description Fastify preHandler that authenticates requests using integration API keys.
 *   Validates `Authorization: Bearer zap_...` or `Bearer mak_...` header, verifies the
 *   key hash with argon2, and attaches the accountId to the request on success.
 *   Supports multiple integration platforms (Zapier, Make, etc.).
 * @layer infrastructure
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyPassword } from "./passwordHashing.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { IntegrationApiKeyRepository } from "@core/domain/repositories/IntegrationApiKeyRepository.js";

const KEY_PREFIX_VISIBLE_LENGTH = 12;

/**
 * Recognized key prefixes for integration platforms.
 */
const VALID_KEY_PREFIXES = ["zap_", "mak_"] as const;

/**
 * Resolve IntegrationApiKeyRepository from the DI container attached to the Fastify instance.
 */
function resolveIntegrationApiKeyRepo(request: FastifyRequest): IntegrationApiKeyRepository | null {
  const server = request.server as unknown as {
    container?: { resolve: (token: symbol) => unknown };
  };
  return (
    (server.container?.resolve(
      TOKENS.IntegrationApiKeyRepository
    ) as IntegrationApiKeyRepository) ?? null
  );
}

/**
 * @function integrationAuthMiddleware
 * @description Authenticates a request using an integration API key.
 *   1. Extracts Bearer token from Authorization header
 *   2. Validates recognized prefix (zap_, mak_)
 *   3. Finds candidate keys by prefix
 *   4. Verifies the full key against stored argon2 hashes
 *   5. Attaches accountId to request.user on success
 *   6. Updates lastUsedAt timestamp
 */
export async function integrationAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      reply.code(401).send({ error: "Authorization token required" });
      return;
    }

    const token = authHeader.substring(7);

    const hasValidPrefix = VALID_KEY_PREFIXES.some((prefix) => token.startsWith(prefix));
    if (!token || !hasValidPrefix) {
      reply.code(401).send({ error: "Invalid integration API key format" });
      return;
    }

    const repo = resolveIntegrationApiKeyRepo(request);
    if (!repo) {
      reply.code(500).send({ error: "Authentication service unavailable" });
      return;
    }

    // Extract prefix to narrow DB lookup
    const prefix = token.substring(0, KEY_PREFIX_VISIBLE_LENGTH);
    const candidates = await repo.findByKeyPrefix(prefix);

    if (candidates.length === 0) {
      reply.code(401).send({ error: "Invalid API key" });
      return;
    }

    // Verify token against each candidate hash
    let matchedKey = null;
    for (const candidate of candidates) {
      if (candidate.isRevoked) {
        continue;
      }
      const valid = await verifyPassword(candidate.keyHash, token);
      if (valid) {
        matchedKey = candidate;
        break;
      }
    }

    if (!matchedKey) {
      reply.code(401).send({ error: "Invalid API key" });
      return;
    }

    // Update lastUsedAt (fire-and-forget, do not block the request)
    matchedKey.markUsed();
    repo.save(matchedKey).catch(() => {
      // Silently ignore lastUsedAt update failures
    });

    // Determine platform name from key
    const platformName = matchedKey.platform === "MAKE" ? "Make" : "Zapier";

    // Attach user context matching the existing FastifyRequest.user shape
    request.user = {
      id: matchedKey.id,
      email: `${matchedKey.platform.toLowerCase()}@integration`,
      role: "ADMIN" as const,
      name: `${platformName} Integration`,
      isActive: true,
      emailVerified: true,
      mfaEnabled: false,
      lastLoginAt: null,
      ...(matchedKey.createdAt ? { createdAt: matchedKey.createdAt } : {}),
      ...(matchedKey.accountId ? { accountId: matchedKey.accountId } : {}),
    };
  } catch {
    reply.code(500).send({ error: "Internal server error" });
  }
}
