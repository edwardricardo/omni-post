/**
 * @file integrationAuthMiddleware.ts
 * @description Two-hook Fastify seam that authenticates requests with integration
 *   API keys (Zapier, Make, etc.) and binds the tenant context for the guarded
 *   Prisma client.
 *
 *   The seam is split into two hooks so the tenant guard only ever observes a
 *   FULLY-POPULATED context — no empty holder, no by-reference mutation, no
 *   "context is bound but still empty" window:
 *
 *   1. `integrationAuthResolve` (async, wire as `onRequest`): extracts the
 *      `Authorization: Bearer zap_.../mak_...` header, looks the key up and
 *      verifies the argon2 hash under an explicit SYSTEM context (the account is
 *      unknown pre-match), and on success stashes the resolved account and the
 *      matched key on `request.integrationAuth`. Fails closed with 401 on any
 *      miss; never binds a tenant context.
 *   2. `integrationAuthBind` (sync, wire as `preHandler`): reads the stashed
 *      account and binds a fresh tenant context via `enterTenantContext`
 *      SYNCHRONOUSLY, before any await, so `AsyncLocalStorage.enterWith`
 *      propagates to the route handler and every downstream guarded query
 *      (mirrors `requireClientAuth`). The tenant-scoped `lastUsedAt` write runs
 *      after the bind.
 *
 *   Fastify runs `onRequest` → `preHandler` → handler, so resolution always
 *   precedes binding. No tenant context is bound between the two hooks, so the
 *   body-parsing/validation phases in that window carry nothing to lose.
 * @layer infrastructure
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyPassword } from "./passwordHashing.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { IntegrationApiKeyRepository } from "@core/domain/repositories/IntegrationApiKeyRepository.js";
import type { IntegrationApiKey } from "@core/domain/entities/IntegrationApiKey.js";
import { enterTenantContext, withSystemContext } from "../security/tenantContext.js";

const KEY_PREFIX_VISIBLE_LENGTH = 12;

/**
 * Recognized key prefixes for integration platforms.
 */
const VALID_KEY_PREFIXES = ["zap_", "mak_"] as const;

/**
 * Resolved integration-key auth. Produced by `integrationAuthResolve` and
 * consumed by `integrationAuthBind`.
 */
interface IntegrationAuthContext {
  /** Account that owns the matched key — bound as the request's tenant scope. */
  accountId: string;
  /** Matched key identifier. */
  keyId: string;
  /**
   * Matched key entity, carried so the synchronous bind can run the
   * tenant-scoped `lastUsedAt` write after `enterTenantContext`.
   */
  key: IntegrationApiKey;
}

/**
 * Extend Fastify request to include the resolved integration auth handed from
 * the `onRequest` resolver to the `preHandler` binder.
 */
declare module "fastify" {
  interface FastifyRequest {
    integrationAuth?: IntegrationAuthContext;
  }
}

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
 * @function integrationAuthResolve
 * @description `onRequest` hook that authenticates an integration API key and
 *   stashes the resolved account on the request. Does NOT bind the tenant
 *   context — that is `integrationAuthBind`'s job, kept synchronous so the
 *   `enterWith` store propagates to the handler.
 *
 *   1. Extracts the Bearer token from the Authorization header
 *   2. Validates a recognized prefix (`zap_`, `mak_`)
 *   3. Finds candidate keys by prefix under an explicit system context
 *   4. Verifies the full key against stored argon2 hashes
 *   5. Stashes `request.integrationAuth` and sets `request.user` on success
 * @param request - Incoming request; reads the Authorization header.
 * @param reply - Used to fail closed (401/500) without reaching the handler.
 */
export async function integrationAuthResolve(
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

    // The account is unknown until a key matches, so the lookup + hash
    // verification run under an explicit system context: `integrationApiKey`
    // is a tenant-scoped model and the guarded client fails closed with no
    // tenant context bound. `withSystemContext` scopes the bypass to just the
    // lookup, so no tenant context leaks out of this hook.
    const matchedKey: IntegrationApiKey | null = await withSystemContext(
      "system:integration-key-auth",
      async () => {
        const candidates = await repo.findByKeyPrefix(prefix);
        for (const candidate of candidates) {
          if (candidate.isRevoked) {
            continue;
          }
          const valid = await verifyPassword(candidate.keyHash, token);
          if (valid) {
            return candidate;
          }
        }
        return null;
      }
    );

    if (!matchedKey) {
      reply.code(401).send({ error: "Invalid API key" });
      return;
    }

    // Entity-invariant backstop: `IntegrationApiKey.create()` rejects an empty
    // accountId, but `reconstitute()` (used when loading a row from the DB) does
    // not re-validate. Fail closed rather than bind an empty tenant context if a
    // row ever surfaced without an account.
    if (!matchedKey.accountId) {
      reply.code(401).send({ error: "Invalid API key" });
      return;
    }

    // Hand the resolved account + matched key to the synchronous bind hook.
    request.integrationAuth = {
      accountId: matchedKey.accountId,
      keyId: matchedKey.id,
      key: matchedKey,
    };

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

/**
 * @function integrationAuthBind
 * @description `preHandler` hook that binds the tenant context resolved by
 *   `integrationAuthResolve`. It reaches `enterTenantContext`
 *   (`AsyncLocalStorage.enterWith`) SYNCHRONOUSLY — before any await — so the
 *   store propagates to the route handler and every downstream guarded query.
 *   The function is `async` because Fastify hooks that neither return a promise
 *   nor invoke the `done` callback stall the request pipeline; reaching
 *   `enterWith` before the first suspension is exactly the pattern
 *   `requireClientAuth` proves propagates. The tenant-scoped `lastUsedAt` write
 *   runs AFTER the bind so it is itself scoped (fire-and-forget, un-awaited).
 * @param request - Carries `request.integrationAuth` from the resolve hook.
 * @param reply - Used to fail closed if resolution is unexpectedly absent.
 */
export async function integrationAuthBind(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const resolved = request.integrationAuth;
  if (!resolved) {
    // Defensive: `integrationAuthResolve` must run first (as `onRequest`) and
    // either short-circuit with 401/500 or populate `integrationAuth`. Reaching
    // here means the hooks are mis-wired; fail closed rather than run the
    // handler context-less.
    reply.code(401).send({ error: "Invalid API key" });
    return;
  }

  // Bind a FRESH, fully-populated tenant context. `enterWith` is reached before
  // any await, so the store propagates to the handler (mirrors requireClientAuth).
  enterTenantContext({ accountId: resolved.accountId });

  // With the tenant context now bound, the lastUsedAt write is itself
  // tenant-scoped. Fire-and-forget (un-awaited) — never block the request on it.
  const repo = resolveIntegrationApiKeyRepo(request);
  if (repo) {
    resolved.key.markUsed();
    repo.save(resolved.key).catch(() => {
      // Silently ignore lastUsedAt update failures
    });
  }
}
