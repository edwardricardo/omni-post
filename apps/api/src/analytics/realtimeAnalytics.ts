/**
 * @file realtimeAnalytics.ts
 * @description Real-time analytics service providing WebSocket-based live metrics,
 *              Redis pub/sub event streaming, and real-time dashboard data.
 * @layer infrastructure
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type * as WebSocket from "ws";
import Redis from "ioredis";
import { z } from "zod";
import { prisma } from "@infra/prisma";
import { createLogger } from "../lib/logger.js";
import { getRequiredSecret } from "../lib/envValidation.js";

const analyticsLogger = createLogger("analytics");
// Note: Authentication is handled within this service
import jwt from "jsonwebtoken";
import type { AccountQueryRepositoryPort } from "../domain/repositories/AccountQueryRepository.js";
import { BaseService } from "../services/BaseService";

interface RealtimeMetrics {
  timestamp: Date;
  postId: string;
  provider: string;
  metrics: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    engagementRate: number;
  };
  deltaMetrics?: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
  };
}

interface ConnectionManager {
  connectionId: string;
  userId: string;
  projectId: string;
  subscriptions: Set<string>;
  lastActivity: Date;
  socket: WebSocket.WebSocket;
}

export class RealtimeAnalyticsService extends BaseService {
  private redis: Redis;
  private connections: Map<string, ConnectionManager> = new Map();
  private subscriptions: Map<string, Set<string>> = new Map(); // postId -> Set<connectionId>
  private metricsCache: Map<string, RealtimeMetrics> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;

  constructor(
    redis: Redis,
    private readonly accountRepository: AccountQueryRepositoryPort
  ) {
    super("RealtimeAnalyticsService");
    this.redis = redis;
    this.startMetricsUpdater();
    this.startConnectionCleaner();
  }

  /**
   * Register WebSocket routes
   */
  async registerWebSocketRoutes(fastify: FastifyInstance): Promise<void> {
    const websocketPlugin = await import("@fastify/websocket");
    await fastify.register(websocketPlugin.default);

    // WebSocket endpoint for real-time analytics
    const self = this;
    fastify.register(async function (fastify) {
      fastify.get("/ws/analytics", { websocket: true }, async (connection, req) => {
        await self.handleWebSocketConnection(connection, req);
      });
    });
  }

  /**
   * Handle new WebSocket connection
   */
  private async handleWebSocketConnection(
    connection: WebSocket.WebSocket,
    request: FastifyRequest
  ): Promise<void> {
    const connectionId = this.generateConnectionId();

    try {
      // Authenticate the WebSocket connection using JWT token
      const user = await this.authenticateWebSocket(request);
      if (!user) {
        connection.close(1008, "Authentication required");
        return;
      }

      // Create connection manager
      const connectionManager: ConnectionManager = {
        connectionId,
        userId: user.id,
        projectId: "", // Will be set when client subscribes
        subscriptions: new Set(),
        lastActivity: new Date(),
        socket: connection,
      };

      this.connections.set(connectionId, connectionManager);

      analyticsLogger.info({ connectionId, userId: user.id }, "WebSocket connected");

      // Send welcome message
      this.sendMessage(connection, {
        type: "connected",
        connectionId,
        timestamp: new Date(),
      });

      // Handle incoming messages
      connection.on("message", async (message: Buffer) => {
        await this.handleWebSocketMessage(connectionId, message);
      });

      // Handle connection close
      connection.on("close", () => {
        this.handleWebSocketClose(connectionId);
      });

      // Handle errors
      connection.on("error", (_error: Error) => {
        analyticsLogger.error({ err: _error, connectionId }, "WebSocket error for connection");
        this.handleWebSocketClose(connectionId);
      });
    } catch (_error: unknown) {
      analyticsLogger.error({ err: _error }, "Error handling WebSocket connection");
      connection.close(1011, "Internal server error");
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private async handleWebSocketMessage(connectionId: string, message: Buffer): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    try {
      const data = JSON.parse(message.toString());
      connection.lastActivity = new Date();

      switch (data.type) {
        case "subscribe":
          await this.handleSubscribe(connectionId, data);
          break;

        case "unsubscribe":
          await this.handleUnsubscribe(connectionId, data);
          break;

        case "ping":
          this.sendMessage(connection.socket, {
            type: "pong",
            timestamp: new Date(),
          });
          break;

        default:
          this.sendMessage(connection.socket, {
            type: "error",
            message: "Unknown message type",
            timestamp: new Date(),
          });
      }
    } catch (_error: unknown) {
      analyticsLogger.error({ err: _error, connectionId }, "Error handling WebSocket message");
      this.sendMessage(connection.socket, {
        type: "error",
        message: "Invalid message format",
        timestamp: new Date(),
      });
    }
  }

  /**
   * Handle subscription request
   */
  private async handleSubscribe(
    connectionId: string,
    data: { type: string; config: unknown }
  ): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    try {
      // Validate subscription data
      const subscriptionSchema = z.object({
        projectId: z.string().min(1),
        postIds: z.array(z.string()).optional(),
        providers: z.array(z.string()).optional(),
        metricsTypes: z.array(z.enum(["views", "likes", "comments", "shares"])).optional(),
        updateInterval: z.number().min(1).max(60).optional(),
      });

      const config = subscriptionSchema.parse(data.config);

      // Verify user has access to the project
      const hasAccess = await this.verifyProjectAccess(connection.userId, config.projectId);
      if (!hasAccess) {
        this.sendMessage(connection.socket, {
          type: "error",
          message: "Access denied to project",
          timestamp: new Date(),
        });
        return;
      }

      connection.projectId = config.projectId;

      // Subscribe to specific posts or all posts in project
      const postIds = config.postIds || (await this.getProjectPostIds(config.projectId));

      for (const postId of postIds) {
        // Add connection to post subscriptions
        if (!this.subscriptions.has(postId)) {
          this.subscriptions.set(postId, new Set());
        }
        this.subscriptions.get(postId)!.add(connectionId);
        connection.subscriptions.add(postId);

        // Send current metrics
        const currentMetrics = await this.getCurrentMetrics(postId);
        if (currentMetrics) {
          this.sendMessage(connection.socket, {
            type: "metrics",
            data: currentMetrics,
            timestamp: new Date(),
          });
        }
      }

      this.sendMessage(connection.socket, {
        type: "subscribed",
        postIds,
        timestamp: new Date(),
      });

      analyticsLogger.info(
        { connectionId, postCount: postIds.length },
        "Connection subscribed to posts"
      );
    } catch (_error: unknown) {
      analyticsLogger.error({ err: _error, connectionId }, "Error handling subscribe");
      this.sendMessage(connection.socket, {
        type: "error",
        message: "Invalid subscription configuration",
        timestamp: new Date(),
      });
    }
  }

  /**
   * Handle unsubscribe request
   */
  private async handleUnsubscribe(
    connectionId: string,
    data: { postIds?: string[] }
  ): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    const postIds = data.postIds || Array.from(connection.subscriptions);

    for (const postId of postIds) {
      this.subscriptions.get(postId)?.delete(connectionId);
      connection.subscriptions.delete(postId);

      // Clean up empty subscription sets
      if (this.subscriptions.get(postId)?.size === 0) {
        this.subscriptions.delete(postId);
      }
    }

    this.sendMessage(connection.socket, {
      type: "unsubscribed",
      postIds,
      timestamp: new Date(),
    });
  }

  /**
   * Handle WebSocket connection close
   */
  private handleWebSocketClose(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    // Remove from all subscriptions
    for (const postId of connection.subscriptions) {
      this.subscriptions.get(postId)?.delete(connectionId);
      if (this.subscriptions.get(postId)?.size === 0) {
        this.subscriptions.delete(postId);
      }
    }

    this.connections.delete(connectionId);
    analyticsLogger.info({ connectionId }, "WebSocket disconnected");
  }

  /**
   * Broadcast metrics update to subscribers
   */
  async broadcastMetricsUpdate(postId: string, metrics: RealtimeMetrics): Promise<void> {
    const subscribers = this.subscriptions.get(postId);
    if (!subscribers || subscribers.size === 0) return;

    const message = {
      type: "metrics_update",
      data: metrics,
      timestamp: new Date(),
    };

    for (const connectionId of subscribers) {
      const connection = this.connections.get(connectionId);
      if (connection && connection.socket.readyState === 1) {
        // WebSocket.OPEN
        this.sendMessage(connection.socket, message);
      }
    }
  }

  /**
   * Start periodic metrics updater
   */
  private startMetricsUpdater(): void {
    this.updateInterval = setInterval(async () => {
      await this.updateAllMetrics();
    }, 30000); // Update every 30 seconds
  }

  /**
   * Update metrics for all subscribed posts
   */
  private async updateAllMetrics(): Promise<void> {
    const subscribedPostIds = Array.from(this.subscriptions.keys());
    if (subscribedPostIds.length === 0) return;

    try {
      // Get latest analytics for subscribed posts
      const analytics = await prisma.analytics.findMany({
        where: {
          postId: {
            in: subscribedPostIds,
          },
        },
        orderBy: {
          capturedAt: "desc",
        },
      });

      // Group by postId and provider
      interface AnalyticsRecord {
        views: number | null;
        likes: number | null;
        comments: number | null;
        shares: number | null;
        postId: string | null;
        provider: string;
      }
      const latestMetrics = new Map<string, AnalyticsRecord>();
      analytics.forEach((a) => {
        const key = `${a.postId}:${a.provider}`;
        if (!latestMetrics.has(key)) {
          latestMetrics.set(key, a);
        }
      });

      // Calculate deltas and broadcast updates
      for (const [key, analyticsRecord] of latestMetrics) {
        const splitKey = key.split(":");
        if (splitKey.length !== 2) continue;
        const [postId, provider] = splitKey;
        if (!postId || !provider) continue;
        const previousMetrics = this.metricsCache.get(key);

        const currentMetrics: RealtimeMetrics = {
          timestamp: new Date(),
          postId,
          provider,
          metrics: {
            views: analyticsRecord.views || 0,
            likes: analyticsRecord.likes || 0,
            comments: analyticsRecord.comments || 0,
            shares: analyticsRecord.shares || 0,
            engagementRate: this.calculateEngagementRate(analyticsRecord),
          },
        };

        // Calculate deltas if we have previous data
        if (previousMetrics) {
          currentMetrics.deltaMetrics = {
            views: currentMetrics.metrics.views - previousMetrics.metrics.views,
            likes: currentMetrics.metrics.likes - previousMetrics.metrics.likes,
            comments: currentMetrics.metrics.comments - previousMetrics.metrics.comments,
            shares: currentMetrics.metrics.shares - previousMetrics.metrics.shares,
          };
        }

        // Cache current metrics
        this.metricsCache.set(key, currentMetrics);

        // Broadcast update
        await this.broadcastMetricsUpdate(postId!, currentMetrics);
      }
    } catch (_error: unknown) {
      analyticsLogger.error({ err: _error }, "Error updating metrics");
    }
  }

  /**
   * Start connection cleaner
   */
  private startConnectionCleaner(): void {
    setInterval(() => {
      const cutoff = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago

      for (const [connectionId, connection] of this.connections) {
        if (connection.lastActivity < cutoff || connection.socket.readyState !== 1) {
          this.handleWebSocketClose(connectionId);
        }
      }
    }, 60000); // Check every minute
  }

  /**
   * Send message to WebSocket client
   */
  private sendMessage(socket: WebSocket.WebSocket, message: Record<string, unknown>): void {
    try {
      if (socket.readyState === 1) {
        // WebSocket.OPEN
        socket.send(JSON.stringify(message));
      }
    } catch (_error: unknown) {
      analyticsLogger.error({ err: _error }, "Error sending WebSocket message");
    }
  }

  /**
   * Generate unique connection ID
   */
  public generateConnectionId(): string {
    return `conn_${randomUUID()}`;
  }

  /**
   * Calculate engagement rate from analytics data
   */
  public calculateEngagementRate(analytics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
  }): number {
    const views = analytics.views || 0;
    if (views === 0) return 0;

    const totalEngagements =
      (analytics.likes || 0) + (analytics.comments || 0) + (analytics.shares || 0);
    return (totalEngagements / views) * 100;
  }

  /**
   * Authenticate WebSocket connection using JWT token
   */
  private async authenticateWebSocket(request: FastifyRequest): Promise<{ id: string } | null> {
    try {
      // Try to get token from query parameter, header, or cookies
      let token: string | undefined = (request.query as Record<string, unknown>)?.token as
        | string
        | undefined;

      if (!token && request.headers?.authorization) {
        token = request.headers.authorization.replace("Bearer ", "");
      }

      if (!token && request.headers?.cookie) {
        const cookieParts = request.headers.cookie.split("token=");
        if (cookieParts.length > 1) {
          const tokenPart = cookieParts[1]?.split(";")[0];
          if (tokenPart) {
            token = tokenPart;
          }
        }
      }

      if (!token) {
        analyticsLogger.info("No authentication token provided for WebSocket connection");
        return null;
      }

      const JWT_SECRET = getRequiredSecret("JWT_SECRET", "jwt-secret-dev-only");
      const decoded = jwt.verify(token, JWT_SECRET) as Record<string, unknown>;
      const userId = typeof decoded?.userId === "string" ? decoded.userId : null;

      if (!userId) {
        analyticsLogger.info("Invalid token payload for WebSocket connection");
        return null;
      }

      // ✅ Phase 1: Verify account exists in database using repository
      const accountResult = await this.accountRepository.findById(userId);

      if (!accountResult.ok) {
        analyticsLogger.info({ userId }, "Account not found for WebSocket connection");
        return null;
      }

      const account = accountResult.value;
      return { id: account.id };
    } catch (_error: unknown) {
      analyticsLogger.error({ err: _error }, "WebSocket authentication error");
      return null;
    }
  }

  /**
   * Verify user has access to project
   */
  private async verifyProjectAccess(userId: string, projectId: string): Promise<boolean> {
    try {
      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          accountId: userId,
        },
      });
      return !!project;
    } catch (_error: unknown) {
      analyticsLogger.error({ err: _error }, "Error verifying project access");
      return false;
    }
  }

  /**
   * Get all post IDs for a project
   */
  private async getProjectPostIds(projectId: string): Promise<string[]> {
    try {
      const posts = await prisma.post.findMany({
        where: { projectId },
        select: { id: true },
      });
      return posts.map((p) => p.id);
    } catch (_error: unknown) {
      analyticsLogger.error({ err: _error }, "Error getting project post IDs");
      return [];
    }
  }

  /**
   * Get current metrics for a post
   */
  private async getCurrentMetrics(postId: string): Promise<RealtimeMetrics | null> {
    try {
      const analytics = await prisma.analytics.findFirst({
        where: { postId },
        orderBy: { capturedAt: "desc" },
      });

      if (!analytics) return null;

      return {
        timestamp: new Date(),
        postId,
        provider: analytics.provider,
        metrics: {
          views: analytics.views || 0,
          likes: analytics.likes || 0,
          comments: analytics.comments || 0,
          shares: analytics.shares || 0,
          engagementRate: this.calculateEngagementRate(analytics),
        },
      };
    } catch (_error: unknown) {
      analyticsLogger.error({ err: _error }, "Error getting current metrics");
      return null;
    }
  }

  /**
   * Trigger real-time update (called when new analytics data arrives)
   */
  async triggerUpdate(
    postId: string,
    provider: string,
    metrics: Record<string, unknown>
  ): Promise<void> {
    const realtimeMetrics: RealtimeMetrics = {
      timestamp: new Date(),
      postId,
      provider,
      metrics: {
        views: (metrics.views as number) || 0,
        likes: (metrics.likes as number) || 0,
        comments: (metrics.comments as number) || 0,
        shares: (metrics.shares as number) || 0,
        engagementRate: (metrics.engagementRate as number) || 0,
      },
    };

    await this.broadcastMetricsUpdate(postId, realtimeMetrics);
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): {
    totalConnections: number;
    activeSubscriptions: number;
    subscribedPosts: number;
    connectionsByProject: Record<string, number>;
  } {
    const connectionsByProject: Record<string, number> = {};

    for (const connection of this.connections.values()) {
      if (connection.projectId) {
        connectionsByProject[connection.projectId] =
          (connectionsByProject[connection.projectId] || 0) + 1;
      }
    }

    return {
      totalConnections: this.connections.size,
      activeSubscriptions: Array.from(this.connections.values()).reduce(
        (sum, conn) => sum + conn.subscriptions.size,
        0
      ),
      subscribedPosts: this.subscriptions.size,
      connectionsByProject,
    };
  }

  /**
   * Cleanup on service shutdown
   */
  shutdown(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    // Close all connections
    for (const connection of this.connections.values()) {
      connection.socket.close(1001, "Server shutting down");
    }

    this.connections.clear();
    this.subscriptions.clear();
    this.metricsCache.clear();
  }
}
