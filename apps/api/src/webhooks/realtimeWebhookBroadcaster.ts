/**
 * @file realtimeWebhookBroadcaster.ts
 * @description WebSocket and Redis pub/sub broadcaster for real-time webhook event
 *              delivery to connected dashboard clients with filtering support.
 * @layer infrastructure
 */
import * as WebSocket from "ws";
import Redis from "ioredis";
import type { PrismaClient, Provider, WebhookEventType } from "@infra/prisma";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import { webhookLogger } from "../lib/logger.js";

export interface WebhookEventBroadcast {
  eventId: string;
  eventType: WebhookEventType;
  provider: Provider;
  timestamp: Date;
  accountId?: string;
  projectId?: string;
  postId?: string;
  channelId?: string;
  data: {
    type: "engagement_update" | "post_status" | "account_update" | "system_alert";
    payload: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
}

export interface WebhookSubscription {
  connectionId: string;
  userId: string;
  accountId: string;
  projectIds: string[];
  eventTypes: WebhookEventType[];
  providers: Provider[];
  socket: WebSocket.WebSocket;
  lastActivity: Date;
}

/**
 * SSE listener callback type for Server-Sent Events subscribers
 */
export type SSEListenerCallback = (event: {
  type: string;
  event: {
    id: string;
    type: WebhookEventType;
    provider: Provider;
    timestamp: Date;
    data: WebhookEventBroadcast["data"];
  };
}) => void;

export interface SSESubscription {
  id: string;
  accountId: string;
  callback: SSEListenerCallback;
}

/**
 * Real-time Webhook Event Broadcaster
 * Broadcasts webhook events to connected clients via WebSocket
 */
export class RealtimeWebhookBroadcaster {
  private redis: Redis;
  private scheduler: BackgroundTaskScheduler;
  private connections: Map<string, WebhookSubscription> = new Map();
  private subscriptionsByProject: Map<string, Set<string>> = new Map(); // projectId -> connectionIds
  private subscriptionsByAccount: Map<string, Set<string>> = new Map(); // accountId -> connectionIds
  private readonly heartbeatTaskId = "realtime-webhook-broadcaster-heartbeat";
  private sseSubscriptions: Map<string, SSESubscription> = new Map();
  private sseByAccount: Map<string, Set<string>> = new Map(); // accountId -> sseSubscription ids

  constructor(
    private readonly prisma: PrismaClient,
    redis: Redis,
    scheduler: BackgroundTaskScheduler
  ) {
    this.redis = redis;
    this.scheduler = scheduler;
    this.startHeartbeat();
    this.setupRedisSubscription();
  }

  /**
   * Add WebSocket connection for webhook events
   */
  addConnection(
    connectionId: string,
    userId: string,
    accountId: string,
    socket: WebSocket.WebSocket,
    config: {
      projectIds?: string[];
      eventTypes?: WebhookEventType[];
      providers?: Provider[];
    } = {}
  ): void {
    const subscription: WebhookSubscription = {
      connectionId,
      userId,
      accountId,
      projectIds: config.projectIds || [],
      eventTypes: config.eventTypes || [],
      providers: config.providers || [],
      socket,
      lastActivity: new Date(),
    };

    this.connections.set(connectionId, subscription);

    // Index by account
    if (!this.subscriptionsByAccount.has(accountId)) {
      this.subscriptionsByAccount.set(accountId, new Set());
    }
    this.subscriptionsByAccount.get(accountId)!.add(connectionId);

    // Index by projects
    for (const projectId of subscription.projectIds) {
      if (!this.subscriptionsByProject.has(projectId)) {
        this.subscriptionsByProject.set(projectId, new Set());
      }
      this.subscriptionsByProject.get(projectId)!.add(connectionId);
    }

    // Set up socket event handlers
    this.setupSocketHandlers(connectionId, socket);

    webhookLogger.info({ connectionId, accountId }, "Webhook WebSocket connection added");
  }

  /**
   * Remove WebSocket connection
   */
  removeConnection(connectionId: string): void {
    const subscription = this.connections.get(connectionId);
    if (!subscription) return;

    // Remove from account index
    const accountConnections = this.subscriptionsByAccount.get(subscription.accountId);
    if (accountConnections) {
      accountConnections.delete(connectionId);
      if (accountConnections.size === 0) {
        this.subscriptionsByAccount.delete(subscription.accountId);
      }
    }

    // Remove from project indexes
    for (const projectId of subscription.projectIds) {
      const projectConnections = this.subscriptionsByProject.get(projectId);
      if (projectConnections) {
        projectConnections.delete(connectionId);
        if (projectConnections.size === 0) {
          this.subscriptionsByProject.delete(projectId);
        }
      }
    }

    this.connections.delete(connectionId);
    webhookLogger.info({ connectionId }, "Webhook WebSocket connection removed");
  }

  /**
   * Broadcast webhook event to relevant connections
   */
  async broadcastWebhookEvent(event: WebhookEventBroadcast): Promise<void> {
    const relevantConnections = this.getRelevantConnections(event);

    if (relevantConnections.length === 0) {
      return;
    }

    const message = {
      type: "webhook_event",
      event: {
        id: event.eventId,
        type: event.eventType,
        provider: event.provider,
        timestamp: event.timestamp,
        data: event.data,
      },
    };

    // Broadcast to connections
    const broadcasts = relevantConnections.map(async (connectionId) => {
      const subscription = this.connections.get(connectionId);
      if (!subscription) return;

      try {
        if (subscription.socket.readyState === WebSocket.WebSocket.OPEN) {
          subscription.socket.send(JSON.stringify(message));
          subscription.lastActivity = new Date();
        } else {
          // Remove dead connection
          this.removeConnection(connectionId);
        }
      } catch (error) {
        webhookLogger.error({ err: error, connectionId }, "Error broadcasting webhook event");
        this.removeConnection(connectionId);
      }
    });

    await Promise.all(broadcasts);

    // Notify SSE listeners
    this.notifySSEListeners(event);

    // Also publish to Redis for other server instances
    await this.redis.publish("webhook_events", JSON.stringify(event));
  }

  /**
   * Broadcast engagement update to specific post subscribers
   */
  async broadcastEngagementUpdate(
    postId: string,
    provider: Provider,
    metrics: {
      likes?: number;
      comments?: number;
      shares?: number;
      views?: number;
    },
    delta?: {
      likes?: number;
      comments?: number;
      shares?: number;
      views?: number;
    }
  ): Promise<void> {
    // Find post details
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        projectId: true,
        project: {
          select: { accountId: true },
        },
      },
    });

    if (!post) return;

    const event: WebhookEventBroadcast = {
      eventId: `engagement_${postId}_${Date.now()}`,
      eventType: "POST_ENGAGEMENT_UPDATE",
      provider,
      timestamp: new Date(),
      accountId: post.project.accountId,
      projectId: post.projectId,
      postId,
      data: {
        type: "engagement_update",
        payload: {
          postId,
          provider,
          metrics,
          delta,
        },
      },
    };

    await this.broadcastWebhookEvent(event);
  }

  /**
   * Broadcast post status change
   */
  async broadcastPostStatusChange(
    postId: string,
    newStatus: string,
    provider: Provider,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        projectId: true,
        project: {
          select: { accountId: true },
        },
      },
    });

    if (!post) return;

    const event: WebhookEventBroadcast = {
      eventId: `status_${postId}_${Date.now()}`,
      eventType: newStatus === "PUBLISHED" ? "POST_PUBLISHED" : "POST_UPDATED",
      provider,
      timestamp: new Date(),
      accountId: post.project.accountId,
      projectId: post.projectId,
      postId,
      data: {
        type: "post_status",
        payload: {
          postId,
          status: newStatus,
          provider,
          metadata,
        },
      },
    };

    await this.broadcastWebhookEvent(event);
  }

  /**
   * Broadcast system alert (rate limits, errors, etc.)
   */
  async broadcastSystemAlert(
    accountId: string,
    alertType: "rate_limit" | "quota_exceeded" | "api_error" | "webhook_error",
    message: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    const event: WebhookEventBroadcast = {
      eventId: `alert_${accountId}_${Date.now()}`,
      eventType: alertType === "rate_limit" ? "RATE_LIMIT_REACHED" : "API_ERROR",
      provider: (details?.provider as Provider | undefined) || "X", // Default provider
      timestamp: new Date(),
      accountId,
      data: {
        type: "system_alert",
        payload: {
          alertType,
          message,
          details,
        },
      },
    };

    await this.broadcastWebhookEvent(event);
  }

  /**
   * Subscribe an SSE client to webhook events for a given account.
   * Returns an unsubscribe function that must be called on client disconnect.
   */
  subscribeSSE(accountId: string, callback: SSEListenerCallback): () => void {
    const subscriptionId = `sse_${accountId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.sseSubscriptions.set(subscriptionId, {
      id: subscriptionId,
      accountId,
      callback,
    });

    if (!this.sseByAccount.has(accountId)) {
      this.sseByAccount.set(accountId, new Set());
    }
    this.sseByAccount.get(accountId)!.add(subscriptionId);

    webhookLogger.info({ subscriptionId, accountId }, "SSE subscription added");

    return () => {
      this.sseSubscriptions.delete(subscriptionId);
      const accountSubs = this.sseByAccount.get(accountId);
      if (accountSubs) {
        accountSubs.delete(subscriptionId);
        if (accountSubs.size === 0) {
          this.sseByAccount.delete(accountId);
        }
      }
      webhookLogger.info({ subscriptionId, accountId }, "SSE subscription removed");
    };
  }

  /**
   * Notify SSE listeners relevant to a webhook event
   */
  private notifySSEListeners(event: WebhookEventBroadcast): void {
    if (this.sseSubscriptions.size === 0) return;

    const message = {
      type: "webhook_event" as const,
      event: {
        id: event.eventId,
        type: event.eventType,
        provider: event.provider,
        timestamp: event.timestamp,
        data: event.data,
      },
    };

    // Find relevant SSE subscriptions by accountId
    const relevantSubIds = new Set<string>();

    if (event.accountId) {
      const accountSubs = this.sseByAccount.get(event.accountId);
      if (accountSubs) {
        accountSubs.forEach((id) => relevantSubIds.add(id));
      }
    }

    for (const subId of relevantSubIds) {
      const sub = this.sseSubscriptions.get(subId);
      if (!sub) continue;

      try {
        sub.callback(message);
      } catch (error) {
        webhookLogger.error({ err: error, subscriptionId: subId }, "Error notifying SSE listener");
      }
    }
  }

  /**
   * Get connections relevant to a webhook event
   */
  private getRelevantConnections(event: WebhookEventBroadcast): string[] {
    const relevantConnections = new Set<string>();

    // Get connections by account
    if (event.accountId) {
      const accountConnections = this.subscriptionsByAccount.get(event.accountId);
      if (accountConnections) {
        accountConnections.forEach((connectionId) => relevantConnections.add(connectionId));
      }
    }

    // Get connections by project
    if (event.projectId) {
      const projectConnections = this.subscriptionsByProject.get(event.projectId);
      if (projectConnections) {
        projectConnections.forEach((connectionId) => relevantConnections.add(connectionId));
      }
    }

    // Filter by subscription preferences
    return Array.from(relevantConnections).filter((connectionId) => {
      const subscription = this.connections.get(connectionId);
      if (!subscription) return false;

      // Check event type filter
      if (
        subscription.eventTypes.length > 0 &&
        !subscription.eventTypes.includes(event.eventType)
      ) {
        return false;
      }

      // Check provider filter
      if (subscription.providers.length > 0 && !subscription.providers.includes(event.provider)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Set up socket event handlers
   */
  private setupSocketHandlers(connectionId: string, socket: WebSocket.WebSocket): void {
    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleWebSocketMessage(connectionId, message);
      } catch (error) {
        webhookLogger.error({ err: error, connectionId }, "Error parsing WebSocket message");
      }
    });

    socket.on("close", () => {
      this.removeConnection(connectionId);
    });

    socket.on("error", (error) => {
      webhookLogger.error({ err: error, connectionId }, "WebSocket error");
      this.removeConnection(connectionId);
    });

    // Send initial connection confirmation
    socket.send(
      JSON.stringify({
        type: "connection_established",
        connectionId,
        timestamp: new Date(),
      })
    );
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleWebSocketMessage(connectionId: string, message: Record<string, unknown>): void {
    const subscription = this.connections.get(connectionId);
    if (!subscription) return;

    subscription.lastActivity = new Date();

    switch (message.type) {
      case "ping":
        subscription.socket.send(
          JSON.stringify({
            type: "pong",
            timestamp: new Date(),
          })
        );
        break;

      case "subscribe_projects":
        this.updateProjectSubscriptions(connectionId, (message.projectIds as string[]) || []);
        break;

      case "subscribe_events":
        this.updateEventSubscriptions(
          connectionId,
          (message.eventTypes as WebhookEventType[]) || []
        );
        break;

      case "subscribe_providers":
        this.updateProviderSubscriptions(connectionId, (message.providers as Provider[]) || []);
        break;

      default:
        webhookLogger.warn({ connectionId, messageType: message.type }, "Unknown message type");
    }
  }

  /**
   * Update project subscriptions for a connection
   */
  private updateProjectSubscriptions(connectionId: string, projectIds: string[]): void {
    const subscription = this.connections.get(connectionId);
    if (!subscription) return;

    // Remove from old project indexes
    for (const oldProjectId of subscription.projectIds) {
      const projectConnections = this.subscriptionsByProject.get(oldProjectId);
      if (projectConnections) {
        projectConnections.delete(connectionId);
        if (projectConnections.size === 0) {
          this.subscriptionsByProject.delete(oldProjectId);
        }
      }
    }

    // Add to new project indexes
    subscription.projectIds = projectIds;
    for (const projectId of projectIds) {
      if (!this.subscriptionsByProject.has(projectId)) {
        this.subscriptionsByProject.set(projectId, new Set());
      }
      this.subscriptionsByProject.get(projectId)!.add(connectionId);
    }

    // Confirm subscription update
    subscription.socket.send(
      JSON.stringify({
        type: "subscription_updated",
        subscriptions: {
          projects: projectIds,
          eventTypes: subscription.eventTypes,
          providers: subscription.providers,
        },
      })
    );
  }

  /**
   * Update event type subscriptions for a connection
   */
  private updateEventSubscriptions(connectionId: string, eventTypes: WebhookEventType[]): void {
    const subscription = this.connections.get(connectionId);
    if (!subscription) return;

    subscription.eventTypes = eventTypes;

    subscription.socket.send(
      JSON.stringify({
        type: "subscription_updated",
        subscriptions: {
          projects: subscription.projectIds,
          eventTypes,
          providers: subscription.providers,
        },
      })
    );
  }

  /**
   * Update provider subscriptions for a connection
   */
  private updateProviderSubscriptions(connectionId: string, providers: Provider[]): void {
    const subscription = this.connections.get(connectionId);
    if (!subscription) return;

    subscription.providers = providers;

    subscription.socket.send(
      JSON.stringify({
        type: "subscription_updated",
        subscriptions: {
          projects: subscription.projectIds,
          eventTypes: subscription.eventTypes,
          providers,
        },
      })
    );
  }

  /**
   * Set up Redis subscription for cross-server communication
   */
  private setupRedisSubscription(): void {
    // Override commandTimeout: subscribe() blocks indefinitely waiting for
    // messages, so any commandTimeout inherited from the parent connection
    // surfaces as spurious "Command timed out" errors.
    const subscriber = this.redis.duplicate({ commandTimeout: 0 });

    subscriber.subscribe("webhook_events", (err) => {
      if (err) {
        webhookLogger.error({ err }, "Failed to subscribe to webhook_events channel");
      } else {
        webhookLogger.info("Subscribed to webhook_events Redis channel");
      }
    });

    subscriber.on("message", (channel, message) => {
      if (channel === "webhook_events") {
        try {
          const event: WebhookEventBroadcast = JSON.parse(message);
          // Re-broadcast to local connections (avoid infinite loop)
          this.broadcastToLocalConnections(event);
        } catch (error) {
          webhookLogger.error({ err: error }, "Error processing Redis webhook event");
        }
      }
    });
  }

  /**
   * Broadcast to local connections only (from Redis subscription)
   */
  private async broadcastToLocalConnections(event: WebhookEventBroadcast): Promise<void> {
    const relevantConnections = this.getRelevantConnections(event);

    const message = {
      type: "webhook_event",
      event: {
        id: event.eventId,
        type: event.eventType,
        provider: event.provider,
        timestamp: event.timestamp,
        data: event.data,
      },
    };

    for (const connectionId of relevantConnections) {
      const subscription = this.connections.get(connectionId);
      if (!subscription) continue;

      try {
        if (subscription.socket.readyState === WebSocket.WebSocket.OPEN) {
          subscription.socket.send(JSON.stringify(message));
          subscription.lastActivity = new Date();
        } else {
          this.removeConnection(connectionId);
        }
      } catch (error) {
        webhookLogger.error({ err: error, connectionId }, "Error broadcasting Redis event");
        this.removeConnection(connectionId);
      }
    }

    // Also notify SSE listeners from Redis-received events
    this.notifySSEListeners(event);
  }

  /**
   * Start heartbeat to cleanup inactive connections
   */
  private startHeartbeat(): void {
    this.scheduler.register(
      this.heartbeatTaskId,
      () => {
        const now = new Date();
        const timeout = 30 * 60 * 1000; // 30 minutes

        for (const [connectionId, subscription] of Array.from(this.connections.entries())) {
          if (now.getTime() - subscription.lastActivity.getTime() > timeout) {
            webhookLogger.info({ connectionId }, "Removing inactive webhook connection");
            this.removeConnection(connectionId);
          }
        }
      },
      5 * 60 * 1000
    ); // Check every 5 minutes
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): {
    totalConnections: number;
    connectionsByAccount: Record<string, number>;
    connectionsByProject: Record<string, number>;
    sseSubscriptions: number;
  } {
    const connectionsByAccount: Record<string, number> = {};
    const connectionsByProject: Record<string, number> = {};

    for (const subscription of Array.from(this.connections.values())) {
      connectionsByAccount[subscription.accountId] =
        (connectionsByAccount[subscription.accountId] || 0) + 1;

      for (const projectId of subscription.projectIds) {
        connectionsByProject[projectId] = (connectionsByProject[projectId] || 0) + 1;
      }
    }

    return {
      totalConnections: this.connections.size,
      connectionsByAccount,
      connectionsByProject,
      sseSubscriptions: this.sseSubscriptions.size,
    };
  }

  /**
   * Shutdown the broadcaster
   */
  shutdown(): void {
    this.scheduler.unregister(this.heartbeatTaskId);

    // Close all WebSocket connections
    for (const subscription of Array.from(this.connections.values())) {
      if (subscription.socket.readyState === WebSocket.WebSocket.OPEN) {
        subscription.socket.close();
      }
    }

    this.connections.clear();
    this.subscriptionsByProject.clear();
    this.subscriptionsByAccount.clear();
    this.sseSubscriptions.clear();
    this.sseByAccount.clear();
  }
}
