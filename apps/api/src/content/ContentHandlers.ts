/**
 * @file ContentHandlers.ts
 * @description BaseRouteHandler subclasses for content synchronisation, version management,
 *              conflict detection, and platform adaptation endpoints.
 * @layer infrastructure
 */

import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { SyncEngine } from "./SyncEngine.js";
import type { ContentVersionManager } from "./ContentVersionManager.js";
import type { PlatformContentAdapter } from "./PlatformContentAdapter.js";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../providers/providerAdapter.interface.js";
import { ConflictDetector } from "./ConflictDetector.js";
import { DiffCalculator } from "./DiffCalculator.js";
import type { SyncConfiguration } from "@shared/types/orchestration.js";

// ─── Validation Schemas ──────────────────────────────────────────────────────

const PostIdParamsSchema = z.object({
  postId: z.string().min(1),
});

const SyncPostBodySchema = z.object({
  channelId: z.string().min(1),
  direction: z
    .enum(["source_to_target", "target_to_source", "bidirectional"])
    .default("source_to_target"),
});

const ChannelIdParamsSchema = z.object({
  channelId: z.string().min(1),
});

const TransactionIdParamsSchema = z.object({
  transactionId: z.string().min(1),
});

const CreateChannelBodySchema = z.object({
  name: z.string().min(1).max(200),
  // sourceProvider / targetProvider are narrowed to ProviderId in the handler body.
  sourceProvider: z.string().min(1),
  targetProvider: z.string().min(1),
  bidirectional: z.boolean().default(false),
  // configuration is accepted as open object and cast to SyncConfiguration.
  configuration: z.record(z.string(), z.unknown()).default({}),
});

const StartRealtimeBodySchema = z.object({
  postId: z.string().min(1),
  channelIds: z.array(z.string().min(1)).min(1),
});

const ResolveConflictsBodySchema = z.object({
  transactionId: z.string().min(1),
  resolutions: z.array(
    z.object({
      conflictId: z.string(),
      resolution: z.enum(["source_wins", "target_wins", "merge", "manual"]),
      resolvedValue: z.unknown().optional(),
    })
  ),
});

const CreateVersionBodySchema = z.object({
  // Content is accepted as an open object and cast to CanonicalPost in handlers.
  content: z.record(z.string(), z.unknown()),
  adaptations: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  createdBy: z.string().min(1),
  changelog: z.string().optional(),
  branchName: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

const RestoreVersionParamsSchema = z.object({
  postId: z.string().min(1),
  versionId: z.string().min(1),
});

const RestoreVersionBodySchema = z.object({
  restoredBy: z.string().min(1),
});

const CompareVersionsBodySchema = z.object({
  fromVersionId: z.string().min(1),
  toVersionId: z.string().min(1),
});

const TransformBodySchema = z.object({
  // Content and provider accepted as open types, cast to domain types in handlers.
  content: z.record(z.string(), z.unknown()),
  targetProvider: z.string().min(1),
  userPreferences: z
    .object({
      preserveFormatting: z.boolean().default(true),
      allowContentTruncation: z.boolean().default(true),
      preferredHashtagStyle: z.enum(["inline", "grouped", "minimal"]).default("inline"),
      mediaQualityPreference: z.enum(["original", "optimized", "compressed"]).default("optimized"),
    })
    .optional(),
});

const RenderBodySchema = z.object({
  content: z.record(z.string(), z.unknown()),
  provider: z.string().min(1),
});

const RenderParamsSchema = z.object({
  provider: z.string().min(1),
});

const DiffBodySchema = z.object({
  fromVersion: z.record(z.string(), z.unknown()),
  toVersion: z.record(z.string(), z.unknown()),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveSyncEngine(ctx: RouteContext): SyncEngine {
  return ctx.request.server.container!.resolve<SyncEngine>(TOKENS.SyncEngine);
}

function resolveVersionManager(ctx: RouteContext): ContentVersionManager {
  return ctx.request.server.container!.resolve<ContentVersionManager>(TOKENS.ContentVersionManager);
}

function resolvePlatformAdapter(ctx: RouteContext): PlatformContentAdapter {
  return ctx.request.server.container!.resolve<PlatformContentAdapter>(
    TOKENS.PlatformContentAdapter
  );
}

// ─── SyncHandlers ─────────────────────────────────────────────────────────────

/**
 * Handles POST /content/sync/:postId and GET /content/sync/metrics[/:channelId].
 */
export class SyncHandlers extends BaseRouteHandler {
  protected routeName = "content/sync";

  /**
   * POST /content/sync/:postId
   * Execute synchronization for a specific post via the named channel.
   */
  async syncPost(ctx: RouteContext): Promise<void> {
    const paramsResult = await this.validateParams(ctx, PostIdParamsSchema);
    if (!paramsResult.ok) return this.sendError(ctx, 400, "Invalid params");
    const { postId } = paramsResult.value;

    const bodyResult = await this.validateBody(ctx, SyncPostBodySchema);
    if (!bodyResult.ok) return this.sendError(ctx, 400, "Validation failed");
    const { channelId, direction } = bodyResult.value;

    const engine = resolveSyncEngine(ctx);
    const result = await engine.syncPost(postId, channelId, direction);

    if (!result.ok) {
      const status = result.error.type === "validation" ? 400 : 500;
      return this.sendError(ctx, status, result.error.message);
    }

    return this.sendSuccess(ctx, result.value);
  }

  /**
   * GET /content/sync/metrics
   * GET /content/sync/metrics/:channelId
   * Returns global or per-channel sync metrics.
   */
  async getSyncMetrics(ctx: RouteContext): Promise<void> {
    const params = ctx.request.params as Record<string, string | undefined>;
    const channelId = params.channelId;

    const engine = resolveSyncEngine(ctx);
    const metrics = await engine.getSyncMetrics(channelId);

    return this.sendSuccess(ctx, metrics);
  }

  /**
   * POST /content/sync/:transactionId/rollback
   * Roll back a running sync transaction.
   */
  async rollbackTransaction(ctx: RouteContext): Promise<void> {
    const paramsResult = await this.validateParams(ctx, TransactionIdParamsSchema);
    if (!paramsResult.ok) return this.sendError(ctx, 400, "Invalid params");
    const { transactionId } = paramsResult.value;

    const engine = resolveSyncEngine(ctx);
    const result = await engine.rollbackTransaction(transactionId);

    if (!result.ok) {
      const status = result.error.type === "validation" ? 400 : 500;
      return this.sendError(ctx, status, result.error.message);
    }

    return this.sendSuccess(ctx, { transactionId, status: "rolled_back" });
  }
}

// ─── ChannelHandlers ──────────────────────────────────────────────────────────

/**
 * Handles sync channel management: create, start real-time, stop real-time.
 */
export class ChannelHandlers extends BaseRouteHandler {
  protected routeName = "content/channels";

  /**
   * POST /content/channels
   * Create a new sync channel between two providers.
   */
  async createChannel(ctx: RouteContext): Promise<void> {
    const bodyResult = await this.validateBody(ctx, CreateChannelBodySchema);
    if (!bodyResult.ok) return this.sendError(ctx, 400, "Validation failed");
    const { name, sourceProvider, targetProvider, bidirectional, configuration } = bodyResult.value;

    const engine = resolveSyncEngine(ctx);
    const result = await engine.createSyncChannel(
      name,
      sourceProvider as ProviderId,
      targetProvider as ProviderId,
      configuration as unknown as SyncConfiguration,
      bidirectional
    );

    if (!result.ok) {
      const status = result.error.type === "validation" ? 400 : 500;
      return this.sendError(ctx, status, result.error.message);
    }

    return this.sendSuccess(ctx, result.value, 201);
  }

  /**
   * POST /content/channels/realtime/start
   * Start real-time sync subscriptions for a post across a set of channels.
   */
  async startRealtimeSync(ctx: RouteContext): Promise<void> {
    const bodyResult = await this.validateBody(ctx, StartRealtimeBodySchema);
    if (!bodyResult.ok) return this.sendError(ctx, 400, "Validation failed");
    const { postId, channelIds } = bodyResult.value;

    const engine = resolveSyncEngine(ctx);
    const result = await engine.startRealtimeSync(postId, channelIds);

    if (!result.ok) {
      const status = result.error.type === "validation" ? 400 : 500;
      return this.sendError(ctx, status, result.error.message);
    }

    return this.sendSuccess(ctx, { postId, channelIds, status: "realtime_sync_started" });
  }

  /**
   * POST /content/channels/realtime/stop/:postId
   * Stop real-time sync subscriptions for a post.
   */
  async stopRealtimeSync(ctx: RouteContext): Promise<void> {
    const paramsResult = await this.validateParams(ctx, PostIdParamsSchema);
    if (!paramsResult.ok) return this.sendError(ctx, 400, "Invalid params");
    const { postId } = paramsResult.value;

    const engine = resolveSyncEngine(ctx);
    await engine.stopRealtimeSync(postId);

    return this.sendSuccess(ctx, { postId, status: "realtime_sync_stopped" });
  }
}

// ─── VersionHandlers ──────────────────────────────────────────────────────────

/**
 * Handles content version management: list, create snapshot, restore, compare.
 */
export class VersionHandlers extends BaseRouteHandler {
  protected routeName = "content/versions";

  /**
   * GET /content/versions/:postId
   * List version history for a post (optional query: branch, limit).
   */
  async listVersions(ctx: RouteContext): Promise<void> {
    const paramsResult = await this.validateParams(ctx, PostIdParamsSchema);
    if (!paramsResult.ok) return this.sendError(ctx, 400, "Invalid params");
    const { postId } = paramsResult.value;

    const query = ctx.request.query as Record<string, string | undefined>;
    const branch = query.branch;
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;

    const manager = resolveVersionManager(ctx);
    const versions = await manager.getVersionHistory(postId, branch, limit);

    return this.sendSuccess(ctx, versions);
  }

  /**
   * POST /content/versions/:postId
   * Create a new version snapshot for the post.
   */
  async createVersionSnapshot(ctx: RouteContext): Promise<void> {
    const paramsResult = await this.validateParams(ctx, PostIdParamsSchema);
    if (!paramsResult.ok) return this.sendError(ctx, 400, "Invalid params");
    const { postId } = paramsResult.value;

    const bodyResult = await this.validateBody(ctx, CreateVersionBodySchema);
    if (!bodyResult.ok) return this.sendError(ctx, 400, "Validation failed");
    const { content, adaptations, createdBy, changelog, branchName, tags } = bodyResult.value;

    const manager = resolveVersionManager(ctx);
    const result = await manager.createVersion(
      postId,
      content as unknown as CanonicalPost,
      adaptations as unknown as Record<ProviderId, CanonicalPost>,
      {
        createdBy,
        ...(changelog !== undefined && { changelog }),
        ...(branchName !== undefined && { branchName }),
        ...(tags !== undefined && { tags }),
      }
    );

    if (!result.ok) {
      const status = result.error.type === "validation" ? 400 : 500;
      return this.sendError(ctx, status, result.error.message);
    }

    return this.sendSuccess(ctx, result.value, 201);
  }

  /**
   * POST /content/versions/:postId/restore/:versionId
   * Restore a post to a specific version, creating a new version record.
   */
  async restoreVersion(ctx: RouteContext): Promise<void> {
    const paramsResult = await this.validateParams(ctx, RestoreVersionParamsSchema);
    if (!paramsResult.ok) return this.sendError(ctx, 400, "Invalid params");
    const { versionId } = paramsResult.value;

    const bodyResult = await this.validateBody(ctx, RestoreVersionBodySchema);
    if (!bodyResult.ok) return this.sendError(ctx, 400, "Validation failed");
    const { restoredBy } = bodyResult.value;

    const manager = resolveVersionManager(ctx);
    const result = await manager.restoreVersion(versionId, restoredBy);

    if (!result.ok) {
      const status = result.error.type === "validation" ? 404 : 500;
      return this.sendError(ctx, status, result.error.message);
    }

    return this.sendSuccess(ctx, result.value);
  }

  /**
   * POST /content/versions/compare
   * Compare two versions and return a structured diff.
   */
  async compareVersions(ctx: RouteContext): Promise<void> {
    const bodyResult = await this.validateBody(ctx, CompareVersionsBodySchema);
    if (!bodyResult.ok) return this.sendError(ctx, 400, "Validation failed");
    const { fromVersionId, toVersionId } = bodyResult.value;

    const manager = resolveVersionManager(ctx);
    const result = await manager.compareVersions(fromVersionId, toVersionId);

    if (!result.ok) {
      const status = result.error.type === "validation" ? 400 : 500;
      return this.sendError(ctx, status, result.error.message);
    }

    return this.sendSuccess(ctx, result.value);
  }
}

// ─── ConflictHandlers ─────────────────────────────────────────────────────────

/**
 * Handles content conflict detection and resolution.
 * Uses a shared ConflictDetector instance (stateless except for in-memory history).
 */
export class ContentConflictHandlers extends BaseRouteHandler {
  protected routeName = "content/conflicts";

  private conflictDetector = new ConflictDetector();

  /**
   * POST /content/conflicts/resolve
   * Apply user-supplied resolutions to a set of sync conflicts and resume
   * the associated transaction via SyncEngine.
   */
  async resolveConflicts(ctx: RouteContext): Promise<void> {
    const bodyResult = await this.validateBody(ctx, ResolveConflictsBodySchema);
    if (!bodyResult.ok) return this.sendError(ctx, 400, "Validation failed");
    const { transactionId, resolutions } = bodyResult.value;

    const engine = resolveSyncEngine(ctx);
    const result = await engine.resolveSyncConflicts(
      transactionId,
      resolutions.map((r) => ({
        conflictId: r.conflictId,
        resolution: r.resolution,
        ...(r.resolvedValue !== undefined && { resolvedValue: r.resolvedValue }),
      }))
    );

    if (!result.ok) {
      const status = result.error.type === "validation" ? 400 : 500;
      return this.sendError(ctx, status, result.error.message);
    }

    return this.sendSuccess(ctx, result.value);
  }

  /**
   * GET /content/conflicts/history/:channelId
   * Return in-memory conflict history for the given sync channel.
   */
  async getConflictHistory(ctx: RouteContext): Promise<void> {
    const paramsResult = await this.validateParams(ctx, ChannelIdParamsSchema);
    if (!paramsResult.ok) return this.sendError(ctx, 400, "Invalid params");
    const { channelId } = paramsResult.value;

    const history = this.conflictDetector.getConflictHistory(channelId);
    return this.sendSuccess(ctx, { channelId, conflicts: history });
  }
}

// ─── TransformHandlers ────────────────────────────────────────────────────────

/**
 * Handles content transformation, platform rendering, and diff calculation.
 */
export class TransformHandlers extends BaseRouteHandler {
  protected routeName = "content/transform";

  private diffCalculator = new DiffCalculator();

  /**
   * POST /content/transform
   * Adapt canonical post content for a specific provider.
   */
  async transformContent(ctx: RouteContext): Promise<void> {
    const bodyResult = await this.validateBody(ctx, TransformBodySchema);
    if (!bodyResult.ok) return this.sendError(ctx, 400, "Validation failed");
    const { content, targetProvider, userPreferences } = bodyResult.value;

    const adapter = resolvePlatformAdapter(ctx);
    const result = await adapter.adaptForSingleProvider(
      content as unknown as CanonicalPost,
      targetProvider as ProviderId,
      userPreferences as
        | import("./platformContentAdapterTypes.js").UserAdaptationPreferences
        | undefined
    );

    if (!result.ok) {
      const status = result.error.type === "validation" ? 400 : 500;
      return this.sendError(ctx, status, result.error.message);
    }

    // PlatformAdaptation.adaptedContent is the transformed CanonicalPost
    return this.sendSuccess(ctx, result.value);
  }

  /**
   * POST /content/render/:provider
   * Render a content preview for the given provider (adapts + validates).
   */
  async renderForProvider(ctx: RouteContext): Promise<void> {
    const paramsResult = await this.validateParams(ctx, RenderParamsSchema);
    if (!paramsResult.ok) return this.sendError(ctx, 400, "Invalid params");
    const { provider } = paramsResult.value;

    const bodyResult = await this.validateBody(ctx, RenderBodySchema);
    if (!bodyResult.ok) return this.sendError(ctx, 400, "Validation failed");
    const { content } = bodyResult.value;

    const adapter = resolvePlatformAdapter(ctx);
    const result = await adapter.adaptForSingleProvider(
      content as unknown as CanonicalPost,
      provider as ProviderId
    );

    if (!result.ok) {
      const status = result.error.type === "validation" ? 400 : 500;
      return this.sendError(ctx, status, result.error.message);
    }

    return this.sendSuccess(ctx, {
      provider,
      originalContent: result.value.originalContent,
      adaptedContent: result.value.adaptedContent,
      adaptationRules: result.value.adaptationRules,
      confidence: result.value.confidence,
      warnings: result.value.warnings,
      requiresManualReview: result.value.requiresManualReview,
    });
  }

  /**
   * POST /content/transform/multi
   * Adapt canonical post content for multiple providers simultaneously.
   */
  async transformForMultipleProviders(ctx: RouteContext): Promise<void> {
    const MultiTransformSchema = z.object({
      content: z.record(z.string(), z.unknown()),
      targetProviders: z.array(z.string().min(1)).min(1),
    });

    const bodyResult = await this.validateBody(ctx, MultiTransformSchema);
    if (!bodyResult.ok) return this.sendError(ctx, 400, "Validation failed");
    const { content, targetProviders } = bodyResult.value;

    const adapter = resolvePlatformAdapter(ctx);
    const result = await adapter.adaptForProviders(
      content as unknown as CanonicalPost,
      targetProviders as ProviderId[]
    );

    if (!result.ok) {
      const status = result.error.type === "validation" ? 400 : 500;
      return this.sendError(ctx, status, result.error.message);
    }

    // Convert Map to plain object for JSON serialisation
    const adaptations: Record<string, unknown> = {};
    for (const [provider, adaptation] of result.value.entries()) {
      adaptations[provider] = adaptation;
    }

    return this.sendSuccess(ctx, { adaptations });
  }

  /**
   * POST /content/diff
   * Calculate a structured diff between two raw version objects.
   */
  async calculateDiff(ctx: RouteContext): Promise<void> {
    const bodyResult = await this.validateBody(ctx, DiffBodySchema);
    if (!bodyResult.ok) return this.sendError(ctx, 400, "Validation failed");
    const { fromVersion, toVersion } = bodyResult.value;

    // DiffCalculator.generateDiff expects ContentVersion objects; we wrap the
    // raw payload in the minimal required shape.
    const fromVersionObj = fromVersion as {
      content: CanonicalPost;
      adaptations: Record<ProviderId, CanonicalPost>;
    };
    const toVersionObj = toVersion as {
      content: CanonicalPost;
      adaptations: Record<ProviderId, CanonicalPost>;
    };

    const diffs = this.diffCalculator.generateDiff(
      {
        ...fromVersionObj,
        id: "",
        postId: "",
        version: 0,
        createdAt: new Date(),
        createdBy: "",
        isActive: false,
      },
      {
        ...toVersionObj,
        id: "",
        postId: "",
        version: 0,
        createdAt: new Date(),
        createdBy: "",
        isActive: false,
      }
    );

    const summary = this.diffCalculator.getSummary(diffs);

    return this.sendSuccess(ctx, { diffs, summary });
  }

  /**
   * POST /content/transform/recommendations
   * Return adaptation recommendations for content across target providers.
   */
  async getRecommendations(ctx: RouteContext): Promise<void> {
    const RecommendationsSchema = z.object({
      content: z.record(z.string(), z.unknown()),
      targetProviders: z.array(z.string().min(1)).min(1),
    });

    const bodyResult = await this.validateBody(ctx, RecommendationsSchema);
    if (!bodyResult.ok) return this.sendError(ctx, 400, "Validation failed");
    const { content, targetProviders } = bodyResult.value;

    const adapter = resolvePlatformAdapter(ctx);
    const recommendations = await adapter.getAdaptationRecommendations(
      content as unknown as CanonicalPost,
      targetProviders as ProviderId[]
    );

    // Convert Map to plain object for JSON serialisation
    const result: Record<string, string[]> = {};
    for (const [provider, recs] of recommendations.entries()) {
      result[provider] = recs;
    }

    return this.sendSuccess(ctx, { recommendations: result });
  }
}
