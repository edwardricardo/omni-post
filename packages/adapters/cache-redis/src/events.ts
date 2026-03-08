/**
 * Event-driven cache invalidation system
 *
 * Integrates with domain events to automatically invalidate cache entries
 * when domain entities are created, updated, or deleted.
 */

import { RedisCacheManager } from "./cache-manager.js";
import pino from "pino";

const logger = pino({
  name: "cache-events",
  level: process.env.LOG_LEVEL || "info",
});

export interface CacheEventHandler {
  /**
   * Event type to listen for
   */
  eventType: string;

  /**
   * Handler function called when event occurs
   */
  handle: (event: DomainEvent) => Promise<void>;
}

export interface DomainEvent {
  id: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  data: Record<string, any>;
  metadata?: Record<string, any>;
  timestamp: number;
}

/**
 * Event-driven cache manager
 *
 * Automatically invalidates cache entries based on domain events
 */
export class CacheEventManager {
  private handlers = new Map<string, CacheEventHandler[]>();

  constructor(private cacheManager: RedisCacheManager) {}

  /**
   * Register a cache invalidation handler for a domain event
   */
  registerHandler(eventType: string, handler: CacheEventHandler): void {
    const existing = this.handlers.get(eventType) || [];
    existing.push(handler);
    this.handlers.set(eventType, existing);

    logger.info(`Registered cache event handler for: ${eventType}`);
  }

  /**
   * Handle a domain event and trigger cache invalidation
   */
  async handleEvent(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.eventType) || [];

    if (handlers.length === 0) {
      return;
    }

    logger.debug(`Processing ${handlers.length} cache handlers for event: ${event.eventType}`);

    try {
      await Promise.all(handlers.map((handler) => handler.handle(event)));
    } catch (error: unknown) {
      logger.error(`Cache event handler failed for ${event.eventType}: ${error}`);
    }
  }

  /**
   * Register standard CRUD event handlers for an entity type
   */
  registerEntityHandlers(entityType: string, options: EntityCacheOptions): void {
    // Handle CREATE events
    if (options.onCreated) {
      this.registerHandler(`${entityType}.created`, {
        eventType: `${entityType}.created`,
        handle: async (event) => {
          const tags = options.onCreated!(event);
          if (tags.length > 0) {
            await this.cacheManager.invalidateByTag(String(tags[0]));
            logger.info(`Invalidated cache for ${entityType} creation: ${tags.join(", ")}`);
          }
        },
      });
    }

    // Handle UPDATE events
    if (options.onUpdated) {
      this.registerHandler(`${entityType}.updated`, {
        eventType: `${entityType}.updated`,
        handle: async (event) => {
          const keys = options.onUpdated!(event);
          if (keys.length > 0) {
            await this.cacheManager.invalidate(keys);
            logger.info(`Invalidated cache for ${entityType} update: ${keys.join(", ")}`);
          }
        },
      });
    }

    // Handle DELETE events
    if (options.onDeleted) {
      this.registerHandler(`${entityType}.deleted`, {
        eventType: `${entityType}.deleted`,
        handle: async (event) => {
          const keys = options.onDeleted!(event);
          if (keys.length > 0) {
            await this.cacheManager.invalidate(keys);
            logger.info(`Invalidated cache for ${entityType} deletion: ${keys.join(", ")}`);
          }
        },
      });
    }
  }

  /**
   * Clear all registered handlers
   */
  clearHandlers(): void {
    this.handlers.clear();
    logger.info("Cleared all cache event handlers");
  }

  /**
   * Get registered event types
   */
  getRegisteredEvents(): string[] {
    return Array.from(this.handlers.keys());
  }
}

export interface EntityCacheOptions {
  /**
   * Handler for entity creation - returns tags to invalidate
   */
  onCreated?: (event: DomainEvent) => string[];

  /**
   * Handler for entity updates - returns keys to invalidate
   */
  onUpdated?: (event: DomainEvent) => string[];

  /**
   * Handler for entity deletion - returns keys to invalidate
   */
  onDeleted?: (event: DomainEvent) => string[];
}

/**
 * Predefined cache invalidation patterns
 */
export const CacheInvalidationPatterns = {
  /**
   * Invalidate all caches for a post
   */
  post: {
    onCreated: (event: DomainEvent) => {
      const projectId = event.data.projectId as string;
      return [`posts:${projectId}`, "dashboard:stats"];
    },
    onUpdated: (event: DomainEvent) => {
      const postId = event.aggregateId;
      const projectId = event.data.projectId as string;
      return [`post:${postId}`, `post:${postId}:analytics`, `posts:${projectId}`];
    },
    onDeleted: (event: DomainEvent) => {
      const postId = event.aggregateId;
      const projectId = event.data.projectId as string;
      return [`post:${postId}`, `post:${postId}:analytics`, `posts:${projectId}`];
    },
  },

  /**
   * Invalidate all caches for a project
   */
  project: {
    onCreated: (_event: DomainEvent) => ["projects", "dashboard:stats"],
    onUpdated: (event: DomainEvent) => {
      const projectId = event.aggregateId;
      return [`project:${projectId}`, "projects"];
    },
    onDeleted: (event: DomainEvent) => {
      const projectId = event.aggregateId;
      return [`project:${projectId}`, `posts:${projectId}`, "projects"];
    },
  },

  /**
   * Invalidate all caches for analytics
   */
  analytics: {
    onCreated: (event: DomainEvent) => {
      const postId = event.data.postId as string;
      const channelId = event.data.channelId as string;
      return [`post:${postId}:analytics`, `channel:${channelId}:analytics`, "analytics:aggregated"];
    },
    onUpdated: (event: DomainEvent) => {
      const postId = event.data.postId as string;
      return [`post:${postId}:analytics`, "analytics:aggregated"];
    },
    onDeleted: (event: DomainEvent) => {
      const postId = event.data.postId as string;
      return [`post:${postId}:analytics`, "analytics:aggregated"];
    },
  },

  /**
   * Invalidate all caches for a user
   */
  user: {
    onCreated: (_event: DomainEvent) => ["users"],
    onUpdated: (event: DomainEvent) => {
      const userId = event.aggregateId;
      return [`user:${userId}`, "users"];
    },
    onDeleted: (event: DomainEvent) => {
      const userId = event.aggregateId;
      return [`user:${userId}`, "users"];
    },
  },
};

/**
 * Create a cache event manager with predefined patterns
 */
export function createCacheEventManager(
  cacheManager: RedisCacheManager,
  patterns: string[] = ["post", "project", "analytics", "user"]
): CacheEventManager {
  const eventManager = new CacheEventManager(cacheManager);

  // Register predefined patterns
  for (const pattern of patterns) {
    const handlers = CacheInvalidationPatterns[pattern as keyof typeof CacheInvalidationPatterns];
    if (handlers) {
      eventManager.registerEntityHandlers(pattern, handlers);
      logger.info(`Registered predefined cache handlers for: ${pattern}`);
    }
  }

  return eventManager;
}
