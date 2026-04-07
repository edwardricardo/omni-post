/**
 * Content Sync Routes Plugin (F28)
 *
 * Exposes the content synchronisation subsystem via REST endpoints under the
 * /content prefix.  Services are resolved from the DI container and shared
 * Redis/EventService instances are wired in during container setup.
 *
 * Endpoints:
 *
 *   Sync Operations
 *     POST   /content/sync/:postId                  — Sync a post through a channel
 *     GET    /content/sync/metrics                  — Global sync metrics
 *     GET    /content/sync/metrics/:channelId       — Per-channel sync metrics
 *     POST   /content/sync/:transactionId/rollback  — Roll back a sync transaction
 *
 *   Channel Management
 *     POST   /content/channels                      — Create sync channel
 *     POST   /content/channels/realtime/start       — Start real-time sync for a post
 *     POST   /content/channels/realtime/stop/:postId — Stop real-time sync for a post
 *
 *   Version Management
 *     GET    /content/versions/:postId              — List version history
 *     POST   /content/versions/:postId              — Create version snapshot
 *     POST   /content/versions/:postId/restore/:versionId — Restore to a version
 *     POST   /content/versions/compare              — Compare two versions (diff)
 *
 *   Conflict Management
 *     POST   /content/conflicts/resolve             — Apply conflict resolutions
 *     GET    /content/conflicts/history/:channelId  — Conflict history for a channel
 *
 *   Content Transformation
 *     POST   /content/transform                     — Adapt content for one provider
 *     POST   /content/transform/multi               — Adapt for multiple providers
 *     POST   /content/transform/recommendations     — Get per-provider recommendations
 *     POST   /content/render/:provider              — Render content preview for a provider
 *     POST   /content/diff                          — Diff two raw version objects
 *
 * @module content/contentRoutes
 */

import type { FastifyPluginAsync } from "fastify";
import { createLogger } from "../lib/logger.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import {
  SyncHandlers,
  ChannelHandlers,
  VersionHandlers,
  ContentConflictHandlers,
  TransformHandlers,
} from "./ContentHandlers.js";

const log = createLogger("content-routes");

export const contentRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Handler instances ────────────────────────────────────────────────────────
  // Handlers are stateless and resolve dependencies from the DI container on
  // each request — safe to instantiate once per plugin registration.

  const syncHandlers = new SyncHandlers();
  const channelHandlers = new ChannelHandlers();
  const versionHandlers = new VersionHandlers();
  const conflictHandlers = new ContentConflictHandlers();
  const transformHandlers = new TransformHandlers();

  // ── Sync Operation Routes ────────────────────────────────────────────────────

  /**
   * POST /content/sync/:postId
   *
   * Execute synchronisation for a specific post through the named channel.
   * Body: { channelId, direction? }
   * Returns the created SyncTransaction record.
   */
  fastify.post(
    "/content/sync/:postId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Content Sync"], summary: "Sync a post through a channel" },
    },
    async (request, reply) => syncHandlers.syncPost({ request, reply })
  );

  /**
   * GET /content/sync/metrics
   *
   * Return global sync metrics (total transactions, success/fail counts, etc.).
   */
  fastify.get(
    "/content/sync/metrics",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Content Sync"], summary: "Get global sync metrics" },
    },
    async (request, reply) => syncHandlers.getSyncMetrics({ request, reply })
  );

  /**
   * GET /content/sync/metrics/:channelId
   *
   * Return sync metrics scoped to a single channel.
   */
  fastify.get(
    "/content/sync/metrics/:channelId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Content Sync"], summary: "Get per-channel sync metrics" },
    },
    async (request, reply) => syncHandlers.getSyncMetrics({ request, reply })
  );

  /**
   * POST /content/sync/:transactionId/rollback
   *
   * Roll back an active sync transaction (requires a rollbackPlan to be set).
   */
  fastify.post(
    "/content/sync/:transactionId/rollback",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Content Sync"], summary: "Roll back a sync transaction" },
    },
    async (request, reply) => syncHandlers.rollbackTransaction({ request, reply })
  );

  // ── Channel Management Routes ────────────────────────────────────────────────

  /**
   * POST /content/channels
   *
   * Create a new sync channel between two providers.
   * Body: { name, sourceProvider, targetProvider, bidirectional?, configuration? }
   * Returns: SyncChannel
   */
  fastify.post(
    "/content/channels",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Content Sync"], summary: "Create sync channel" },
    },
    async (request, reply) => channelHandlers.createChannel({ request, reply })
  );

  /**
   * POST /content/channels/realtime/start
   *
   * Subscribe a post to real-time synchronisation across a set of channels.
   * Body: { postId, channelIds[] }
   */
  fastify.post(
    "/content/channels/realtime/start",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Content Sync"], summary: "Start real-time sync for a post" },
    },
    async (request, reply) => channelHandlers.startRealtimeSync({ request, reply })
  );

  /**
   * POST /content/channels/realtime/stop/:postId
   *
   * Unsubscribe a post from real-time synchronisation.
   */
  fastify.post(
    "/content/channels/realtime/stop/:postId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Content Sync"], summary: "Stop real-time sync for a post" },
    },
    async (request, reply) => channelHandlers.stopRealtimeSync({ request, reply })
  );

  // ── Version Management Routes ────────────────────────────────────────────────

  /**
   * GET /content/versions/:postId
   *
   * List version history for a post.
   * Query params: branch (string), limit (number)
   */
  fastify.get(
    "/content/versions/:postId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Content Sync"], summary: "List version history for a post" },
    },
    async (request, reply) => versionHandlers.listVersions({ request, reply })
  );

  /**
   * POST /content/versions/:postId
   *
   * Create a new version snapshot for the post.
   * Body: { content, adaptations?, createdBy, changelog?, branchName?, tags? }
   * Returns: ContentVersion (201)
   */
  fastify.post(
    "/content/versions/:postId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Content Sync"], summary: "Create version snapshot" },
    },
    async (request, reply) => versionHandlers.createVersionSnapshot({ request, reply })
  );

  /**
   * POST /content/versions/:postId/restore/:versionId
   *
   * Restore a post to a specific historical version by creating a new version
   * record with the same content.
   * Body: { restoredBy }
   * Returns: ContentVersion
   */
  fastify.post(
    "/content/versions/:postId/restore/:versionId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Content Sync"], summary: "Restore post to a specific version" },
    },
    async (request, reply) => versionHandlers.restoreVersion({ request, reply })
  );

  /**
   * POST /content/versions/compare
   *
   * Compare two versions by ID and return a structured VersionDiff array.
   * Body: { fromVersionId, toVersionId }
   */
  fastify.post(
    "/content/versions/compare",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Content Sync"], summary: "Compare two versions" },
    },
    async (request, reply) => versionHandlers.compareVersions({ request, reply })
  );

  // ── Conflict Management Routes ───────────────────────────────────────────────

  /**
   * POST /content/conflicts/resolve
   *
   * Apply user-supplied resolutions to sync conflicts and resume the transaction.
   * Body: { transactionId, resolutions[] }
   * Returns: SyncTransaction
   */
  fastify.post(
    "/content/conflicts/resolve",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Content Sync"], summary: "Resolve sync conflicts" },
    },
    async (request, reply) => conflictHandlers.resolveConflicts({ request, reply })
  );

  /**
   * GET /content/conflicts/history/:channelId
   *
   * Return the in-memory conflict history accumulated by the ConflictDetector
   * for the given sync channel.
   */
  fastify.get(
    "/content/conflicts/history/:channelId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Content Sync"], summary: "Get conflict history for a channel" },
    },
    async (request, reply) => conflictHandlers.getConflictHistory({ request, reply })
  );

  // ── Content Transformation Routes ───────────────────────────────────────────

  /**
   * POST /content/transform
   *
   * Adapt canonical post content for a single target provider.
   * Body: { content, targetProvider, userPreferences? }
   * Returns: PlatformAdaptation
   */
  fastify.post(
    "/content/transform",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Content Sync"], summary: "Transform content for a provider" },
    },
    async (request, reply) => transformHandlers.transformContent({ request, reply })
  );

  /**
   * POST /content/transform/multi
   *
   * Adapt canonical post content for multiple providers simultaneously.
   * Body: { content, targetProviders[] }
   * Returns: { adaptations: Record<ProviderId, PlatformAdaptation> }
   */
  fastify.post(
    "/content/transform/multi",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Content Sync"], summary: "Transform content for multiple providers" },
    },
    async (request, reply) => transformHandlers.transformForMultipleProviders({ request, reply })
  );

  /**
   * POST /content/transform/recommendations
   *
   * Get adaptation recommendations (text, media, timing) for content across
   * a set of providers without actually transforming it.
   * Body: { content, targetProviders[] }
   * Returns: { recommendations: Record<ProviderId, string[]> }
   */
  fastify.post(
    "/content/transform/recommendations",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Content Sync"], summary: "Get adaptation recommendations" },
    },
    async (request, reply) => transformHandlers.getRecommendations({ request, reply })
  );

  /**
   * POST /content/render/:provider
   *
   * Render a content preview for the specified provider.
   * Returns the adapted content alongside applied rules, confidence score,
   * and any warnings — useful for building a live preview UI.
   */
  fastify.post(
    "/content/render/:provider",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Content Sync"], summary: "Render content preview for a provider" },
    },
    async (request, reply) => transformHandlers.renderForProvider({ request, reply })
  );

  /**
   * POST /content/diff
   *
   * Calculate a field-level diff between two raw version objects without
   * requiring them to be stored in the system first.
   * Body: { fromVersion, toVersion }
   * Returns: { diffs: VersionDiff[], summary }
   */
  fastify.post(
    "/content/diff",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Content Sync"], summary: "Calculate diff between two versions" },
    },
    async (request, reply) => transformHandlers.calculateDiff({ request, reply })
  );

  log.info("Content sync routes registered (F28)");
};
