/**
 * @file NotificationBroadcaster.ts
 * @description SSE broadcaster for real-time notification delivery.
 *   Uses Redis pub/sub for cross-server communication and in-memory subscriptions
 *   for local SSE connections.
 * @layer infrastructure
 */

import type Redis from "ioredis";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";

const REDIS_CHANNEL_PREFIX = "notifications:";
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Payload for a notification SSE event
 */
export interface NotificationEventPayload {
  id: string;
  type: string;
  title: string;
  body: string;
  resourceType?: string;
  resourceId?: string;
  actorName?: string;
  createdAt: string;
}

/**
 * Internal subscription record
 */
interface NotificationSSESubscription {
  id: string;
  recipientId: string;
  callback: (notification: NotificationEventPayload) => void;
}

/**
 * @class NotificationBroadcaster
 * @description Manages SSE subscriptions for real-time notification delivery.
 *   Publishes events via Redis for cross-instance communication and dispatches
 *   to local SSE connections via callback functions.
 */
export class NotificationBroadcaster {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly scheduler: BackgroundTaskScheduler;
  private subscriptions: Map<string, NotificationSSESubscription> = new Map();
  private byRecipient: Map<string, Set<string>> = new Map();
  private readonly heartbeatTaskId = "notification-broadcaster-heartbeat";
  private initialized = false;

  constructor(redis: Redis, scheduler: BackgroundTaskScheduler) {
    this.publisher = redis;
    this.subscriber = redis.duplicate();
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
   * @description Registers an SSE client for real-time notification events.
   * @param id - Unique subscription identifier
   * @param recipientId - The team member who should receive events
   * @param callback - Function called when a notification arrives
   */
  subscribe(
    id: string,
    recipientId: string,
    callback: (notification: NotificationEventPayload) => void
  ): void {
    this.subscriptions.set(id, { id, recipientId, callback });

    if (!this.byRecipient.has(recipientId)) {
      this.byRecipient.set(recipientId, new Set());
    }
    const recipientSet = this.byRecipient.get(recipientId);
    if (recipientSet) {
      recipientSet.add(id);
    }
  }

  /**
   * @method unsubscribe
   * @description Removes an SSE subscription.
   * @param id - The subscription identifier to remove
   */
  unsubscribe(id: string): void {
    const sub = this.subscriptions.get(id);
    if (!sub) return;

    this.subscriptions.delete(id);

    const recipientSubs = this.byRecipient.get(sub.recipientId);
    if (recipientSubs) {
      recipientSubs.delete(id);
      if (recipientSubs.size === 0) {
        this.byRecipient.delete(sub.recipientId);
      }
    }
  }

  /**
   * @method broadcast
   * @description Publishes a notification event via Redis pub/sub.
   *   All server instances subscribed to the recipient's channel will receive it.
   * @param notification - The notification payload to broadcast
   * @param recipientId - The target recipient
   */
  async broadcast(notification: NotificationEventPayload, recipientId: string): Promise<void> {
    const channel = `${REDIS_CHANNEL_PREFIX}${recipientId}`;
    const message = JSON.stringify(notification);
    await this.publisher.publish(channel, message);

    // Also dispatch to local subscriptions immediately
    this.dispatchToLocal(recipientId, notification);
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
   * @description Cleans up all subscriptions, heartbeat, and Redis subscriber.
   */
  async shutdown(): Promise<void> {
    this.scheduler.unregister(this.heartbeatTaskId);

    this.subscriptions.clear();
    this.byRecipient.clear();

    try {
      await this.subscriber.quit();
    } catch {
      // Subscriber may already be closed
    }
  }

  /**
   * @method setupRedisSubscription
   * @description Subscribes to the Redis notifications pattern channel.
   *   Incoming messages from other server instances are dispatched to local SSE clients.
   */
  private setupRedisSubscription(): void {
    this.subscriber.psubscribe(`${REDIS_CHANNEL_PREFIX}*`, (error) => {
      if (error) {
        // Subscription failure is non-fatal; local broadcasts still work
      }
    });

    this.subscriber.on("pmessage", (_pattern: string, channel: string, message: string) => {
      const recipientId = channel.replace(REDIS_CHANNEL_PREFIX, "");

      try {
        const payload = JSON.parse(message) as NotificationEventPayload;
        this.dispatchToLocal(recipientId, payload);
      } catch {
        // Malformed message -- skip
      }
    });
  }

  /**
   * @method dispatchToLocal
   * @description Delivers a notification payload to all local SSE subscriptions
   *   for the given recipient.
   * @param recipientId - The target recipient
   * @param payload - The notification event to deliver
   */
  private dispatchToLocal(recipientId: string, payload: NotificationEventPayload): void {
    const subIds = this.byRecipient.get(recipientId);
    if (!subIds || subIds.size === 0) return;

    for (const subId of subIds) {
      const sub = this.subscriptions.get(subId);
      if (!sub) continue;

      try {
        sub.callback(payload);
      } catch {
        // Callback error -- remove dead subscription
        this.unsubscribe(subId);
      }
    }
  }

  /**
   * @method startHeartbeat
   * @description Sends periodic heartbeat comments to keep SSE connections alive.
   */
  private startHeartbeat(): void {
    this.scheduler.register(
      this.heartbeatTaskId,
      () => {
        // Heartbeat is sent at the route level via reply.raw.write.
        // This tick exists so the broadcaster retains a hook for future
        // stale-subscription cleanup without reintroducing a raw setInterval.
      },
      HEARTBEAT_INTERVAL_MS
    );
  }
}
