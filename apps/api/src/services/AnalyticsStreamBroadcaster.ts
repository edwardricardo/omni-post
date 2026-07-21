/**
 * @file AnalyticsStreamBroadcaster.ts
 * @description SSE broadcaster for real-time analytics metric delivery. Uses Redis
 *   pub/sub for cross-instance communication and in-memory subscriptions for local
 *   SSE connections. Keyed by postId: a post belongs to exactly one account/project,
 *   and the stream route only ever subscribes a connection to posts it is authorized
 *   for, so per-post channels are naturally tenant-isolated. Mirror of
 *   NotificationBroadcaster (recipientId → postId).
 * @layer infrastructure
 */

import type { Redis } from "ioredis";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import { duplicateForSubscriber } from "../lib/redis.js";

const REDIS_CHANNEL_PREFIX = "analytics-stream:";
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Payload for an analytics metric SSE event. `timestamp` is an ISO string so the
 * shape survives Redis JSON round-trips identically to the local-dispatch path.
 */
export interface AnalyticsStreamEventPayload {
  timestamp: string;
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

/**
 * Internal subscription record. A connection watches one or more postIds.
 */
interface AnalyticsSSESubscription {
  id: string;
  postIds: string[];
  callback: (event: AnalyticsStreamEventPayload) => void;
}

/**
 * @class AnalyticsStreamBroadcaster
 * @description Manages SSE subscriptions for real-time analytics delivery. Publishes
 *   per-post events via Redis for cross-instance fan-out and dispatches to local SSE
 *   connections via callbacks. Exposes the set of watched postIds so the metrics
 *   poller queries only posts that actually have a live subscriber.
 */
export class AnalyticsStreamBroadcaster {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly scheduler: BackgroundTaskScheduler;
  private subscriptions: Map<string, AnalyticsSSESubscription> = new Map();
  private byPost: Map<string, Set<string>> = new Map();
  private readonly heartbeatTaskId = "analytics-stream-broadcaster-heartbeat";
  private initialized = false;

  constructor(redis: Redis, scheduler: BackgroundTaskScheduler) {
    this.publisher = redis;
    // Subscribe-mode connection via the canonical helper: it omits commandTimeout
    // entirely so a blocking psubscribe never arms a spurious "Command timed out"
    // timer (see duplicateForSubscriber in lib/redis.ts).
    this.subscriber = duplicateForSubscriber(redis);
    this.subscriber.on("error", () => {});
    this.scheduler = scheduler;
  }

  /**
   * @method initialize
   * @description Sets up Redis subscription and heartbeat. Call once at startup.
   */
  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    this.setupRedisSubscription();
    this.startHeartbeat();
  }

  /**
   * @method subscribe
   * @description Registers an SSE client for real-time metric events on a set of posts.
   * @param id - Unique subscription identifier
   * @param postIds - The posts this connection watches
   * @param callback - Function called when a metric event arrives for a watched post
   */
  subscribe(
    id: string,
    postIds: string[],
    callback: (event: AnalyticsStreamEventPayload) => void
  ): void {
    this.subscriptions.set(id, { id, postIds, callback });

    for (const postId of postIds) {
      if (!this.byPost.has(postId)) {
        this.byPost.set(postId, new Set());
      }
      this.byPost.get(postId)?.add(id);
    }
  }

  /**
   * @method unsubscribe
   * @description Removes an SSE subscription from every post it watched.
   * @param id - The subscription identifier to remove
   */
  unsubscribe(id: string): void {
    const sub = this.subscriptions.get(id);
    if (!sub) return;

    this.subscriptions.delete(id);

    for (const postId of sub.postIds) {
      const postSubs = this.byPost.get(postId);
      if (postSubs) {
        postSubs.delete(id);
        if (postSubs.size === 0) {
          this.byPost.delete(postId);
        }
      }
    }
  }

  /**
   * @method broadcast
   * @description Publishes a metric event via Redis pub/sub. All server instances
   *   subscribed to the post's channel deliver it to their local connections.
   * @param event - The metric payload to broadcast
   * @param postId - The target post
   */
  async broadcast(event: AnalyticsStreamEventPayload, postId: string): Promise<void> {
    const channel = `${REDIS_CHANNEL_PREFIX}${postId}`;
    await this.publisher.publish(channel, JSON.stringify(event));

    // Also dispatch to local subscriptions immediately.
    this.dispatchToLocal(postId, event);
  }

  /**
   * @method getWatchedPostIds
   * @description Returns the set of postIds that currently have at least one live
   *   local subscriber. The metrics poller uses this to query only watched posts
   *   instead of every post in every active account.
   */
  getWatchedPostIds(): string[] {
    return Array.from(this.byPost.keys());
  }

  /**
   * @method getActiveConnectionCount
   * @description Returns the total number of active SSE subscriptions.
   */
  getActiveConnectionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * @method shutdown
   * @description Cleans up all subscriptions, heartbeat, and the Redis subscriber.
   */
  async shutdown(): Promise<void> {
    this.scheduler.unregister(this.heartbeatTaskId);

    this.subscriptions.clear();
    this.byPost.clear();

    try {
      await this.subscriber.quit();
    } catch {
      // Subscriber may already be closed.
    }
  }

  /**
   * @method setupRedisSubscription
   * @description Subscribes to the Redis analytics pattern channel. Incoming messages
   *   from other server instances are dispatched to local SSE clients.
   */
  private setupRedisSubscription(): void {
    this.subscriber.psubscribe(`${REDIS_CHANNEL_PREFIX}*`, (error) => {
      if (error) {
        // Subscription failure is non-fatal; local broadcasts still work.
      }
    });

    this.subscriber.on("pmessage", (_pattern: string, channel: string, message: string) => {
      const postId = channel.replace(REDIS_CHANNEL_PREFIX, "");

      try {
        const payload = JSON.parse(message) as AnalyticsStreamEventPayload;
        this.dispatchToLocal(postId, payload);
      } catch {
        // Malformed message -- skip.
      }
    });
  }

  /**
   * @method dispatchToLocal
   * @description Delivers a metric payload to all local SSE subscriptions watching
   *   the given post.
   * @param postId - The target post
   * @param payload - The metric event to deliver
   */
  private dispatchToLocal(postId: string, payload: AnalyticsStreamEventPayload): void {
    const subIds = this.byPost.get(postId);
    if (!subIds || subIds.size === 0) return;

    for (const subId of subIds) {
      const sub = this.subscriptions.get(subId);
      if (!sub) continue;

      try {
        sub.callback(payload);
      } catch {
        // Callback error -- remove dead subscription.
        this.unsubscribe(subId);
      }
    }
  }

  /**
   * @method startHeartbeat
   * @description Registers a no-op scheduler tick. Heartbeats are written at the
   *   route level via reply.raw.write; this tick retains a hook for future
   *   stale-subscription cleanup without reintroducing a raw setInterval.
   */
  private startHeartbeat(): void {
    this.scheduler.register(
      this.heartbeatTaskId,
      () => {
        // Intentionally empty -- see method description.
      },
      HEARTBEAT_INTERVAL_MS
    );
  }
}
