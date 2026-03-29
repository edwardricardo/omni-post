/**
 * Phase 2: Week 3-4 - Event-Driven Architecture Foundation
 *
 * Core Domain Events system implementing Event Sourcing patterns.
 * This provides the foundation for CQRS, Saga patterns, and distributed processing.
 *
 * Key Features:
 * - Type-safe event definitions
 * - Event metadata and tracing
 * - Serialization/deserialization
 * - Event versioning support
 * - Integration with Redis pub/sub
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";

// Base event interface with metadata
export interface DomainEvent<T = unknown> {
  id: string;
  type: string;
  version: number;
  timestamp: Date;
  aggregateId: string;
  aggregateType: string;
  data: T;
  metadata: EventMetadata;
  causationId?: string; // ID of the command that caused this event
  correlationId?: string; // ID to trace related events across boundaries
}

export interface EventMetadata {
  userId?: string;
  source: string; // Which service/component generated this event
  traceId?: string;
  sessionId?: string;
  userAgent?: string;
  ipAddress?: string;
  [key: string]: unknown; // Allow additional metadata properties
}

// Event envelope for serialization
export interface EventEnvelope {
  event: DomainEvent;
  occurredAt: Date;
  sequence: number;
  streamId: string;
  streamVersion: number;
}

// Event handler interface
export interface EventHandler<T extends DomainEvent = DomainEvent> {
  handle(event: T): Promise<void>;
  eventType: string;
}

// Event store interface
export interface EventStore {
  append(streamId: string, events: DomainEvent[], expectedVersion?: number): Promise<void>;
  getEvents(streamId: string, fromVersion?: number): Promise<EventEnvelope[]>;
  getAllEvents(fromPosition?: number): Promise<EventEnvelope[]>;
  getEventsByType(eventType: string, fromTimestamp?: Date): Promise<EventEnvelope[]>;
}

// Event publisher interface
export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
  publishBatch(events: DomainEvent[]): Promise<void>;
  subscribe(eventType: string, handler: EventHandler): void;
  unsubscribe(eventType: string, handler: EventHandler): void;
}

// === POST DOMAIN EVENTS ===

// Post lifecycle events
export const PostCreatedEventSchema = z.object({
  postId: z.string(),
  projectId: z.string(),
  title: z.string().optional(),
  status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "FAILED"]),
  scheduledAt: z.date().optional(),
  channelIds: z.array(z.string()),
  content: z.object({
    body: z.string().optional(),
    mediaUrls: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
  }),
});

export const PostUpdatedEventSchema = z.object({
  postId: z.string(),
  projectId: z.string(),
  changes: z.record(z.string(), z.any()),
  previousVersion: z.number(),
  newVersion: z.number(),
});

export const PostScheduledEventSchema = z.object({
  postId: z.string(),
  projectId: z.string(),
  scheduledAt: z.date(),
  channelIds: z.array(z.string()),
  retryCount: z.number().default(0),
});

export const PostPublishedEventSchema = z.object({
  postId: z.string(),
  projectId: z.string(),
  channelId: z.string(),
  provider: z.string(),
  externalId: z.string(),
  publishedAt: z.date(),
  metrics: z
    .object({
      views: z.number().default(0),
      likes: z.number().default(0),
      comments: z.number().default(0),
      shares: z.number().default(0),
    })
    .optional(),
});

export const PostPublishFailedEventSchema = z.object({
  postId: z.string(),
  projectId: z.string(),
  channelId: z.string(),
  provider: z.string(),
  error: z.string(),
  retryCount: z.number(),
  maxRetries: z.number(),
  failedAt: z.date(),
});

export const PostDeletedEventSchema = z.object({
  postId: z.string(),
  projectId: z.string(),
  deletedBy: z.string(),
  deletedAt: z.date(),
  reason: z.string().optional(),
});

// Channel events
export const ChannelConnectedEventSchema = z.object({
  channelId: z.string(),
  projectId: z.string(),
  provider: z.string(),
  externalId: z.string(),
  name: z.string(),
  connectedAt: z.date(),
  permissions: z.array(z.string()),
});

export const ChannelDisconnectedEventSchema = z.object({
  channelId: z.string(),
  projectId: z.string(),
  provider: z.string(),
  reason: z.string(),
  disconnectedAt: z.date(),
});

export const ChannelRateLimitReachedEventSchema = z.object({
  channelId: z.string(),
  projectId: z.string(),
  provider: z.string(),
  limitType: z.string(),
  resetAt: z.date(),
  requestCount: z.number(),
});

// Analytics events
export const AnalyticsCollectedEventSchema = z.object({
  postId: z.string(),
  channelId: z.string(),
  provider: z.string(),
  metrics: z.object({
    views: z.number(),
    likes: z.number(),
    comments: z.number(),
    shares: z.number(),
    reach: z.number().optional(),
    impressions: z.number().optional(),
    engagementRate: z.number().optional(),
  }),
  collectedAt: z.date(),
  period: z.object({
    start: z.date(),
    end: z.date(),
  }),
});

// User activity events
export const UserActionEventSchema = z.object({
  userId: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  details: z.record(z.string(), z.any()).optional(),
  timestamp: z.date(),
  sessionId: z.string().optional(),
});

// System events
export const SystemHealthEventSchema = z.object({
  component: z.string(),
  status: z.enum(["healthy", "degraded", "unhealthy"]),
  metrics: z.record(z.string(), z.number()),
  timestamp: z.date(),
  details: z.string().optional(),
});

// Event type definitions
export type PostCreatedEvent = DomainEvent<z.infer<typeof PostCreatedEventSchema>>;
export type PostUpdatedEvent = DomainEvent<z.infer<typeof PostUpdatedEventSchema>>;
export type PostScheduledEvent = DomainEvent<z.infer<typeof PostScheduledEventSchema>>;
export type PostPublishedEvent = DomainEvent<z.infer<typeof PostPublishedEventSchema>>;
export type PostPublishFailedEvent = DomainEvent<z.infer<typeof PostPublishFailedEventSchema>>;
export type PostDeletedEvent = DomainEvent<z.infer<typeof PostDeletedEventSchema>>;

export type ChannelConnectedEvent = DomainEvent<z.infer<typeof ChannelConnectedEventSchema>>;
export type ChannelDisconnectedEvent = DomainEvent<z.infer<typeof ChannelDisconnectedEventSchema>>;
export type ChannelRateLimitReachedEvent = DomainEvent<
  z.infer<typeof ChannelRateLimitReachedEventSchema>
>;

export type AnalyticsCollectedEvent = DomainEvent<z.infer<typeof AnalyticsCollectedEventSchema>>;
export type UserActionEvent = DomainEvent<z.infer<typeof UserActionEventSchema>>;
export type SystemHealthEvent = DomainEvent<z.infer<typeof SystemHealthEventSchema>>;

// Event constants
export const EVENT_TYPES = {
  // Post events
  POST_CREATED: "post.created",
  POST_UPDATED: "post.updated",
  POST_SCHEDULED: "post.scheduled",
  POST_PUBLISHED: "post.published",
  POST_PUBLISH_FAILED: "post.publish-failed",
  POST_DELETED: "post.deleted",

  // Channel events
  CHANNEL_CONNECTED: "channel.connected",
  CHANNEL_DISCONNECTED: "channel.disconnected",
  CHANNEL_RATE_LIMIT_REACHED: "channel.rate-limit-reached",

  // Analytics events
  ANALYTICS_COLLECTED: "analytics.collected",

  // User events
  USER_ACTION: "user.action",

  // System events
  SYSTEM_HEALTH: "system.health",
} as const;

// Helper functions
export function createDomainEvent<T>(
  type: string,
  aggregateId: string,
  aggregateType: string,
  data: T,
  metadata: EventMetadata,
  options?: {
    version?: number;
    causationId?: string;
    correlationId?: string;
  }
): DomainEvent<T> {
  return {
    id: `${type}-${randomUUID()}`,
    type,
    version: options?.version || 1,
    timestamp: new Date(),
    aggregateId,
    aggregateType,
    data,
    metadata,
    ...(options?.causationId && { causationId: options.causationId }),
    ...(options?.correlationId && { correlationId: options.correlationId }),
  };
}

export function isEventType<T extends DomainEvent>(
  event: DomainEvent,
  eventType: string
): event is T {
  return event.type === eventType;
}

export function serializeEvent(event: DomainEvent): string {
  return JSON.stringify({
    ...event,
    timestamp: event.timestamp.toISOString(),
  });
}

export function deserializeEvent(json: string): DomainEvent {
  const parsed = JSON.parse(json);
  return {
    ...parsed,
    timestamp: new Date(parsed.timestamp),
  };
}

// Event validation schemas
export const eventSchemas = {
  [EVENT_TYPES.POST_CREATED]: PostCreatedEventSchema,
  [EVENT_TYPES.POST_UPDATED]: PostUpdatedEventSchema,
  [EVENT_TYPES.POST_SCHEDULED]: PostScheduledEventSchema,
  [EVENT_TYPES.POST_PUBLISHED]: PostPublishedEventSchema,
  [EVENT_TYPES.POST_PUBLISH_FAILED]: PostPublishFailedEventSchema,
  [EVENT_TYPES.POST_DELETED]: PostDeletedEventSchema,
  [EVENT_TYPES.CHANNEL_CONNECTED]: ChannelConnectedEventSchema,
  [EVENT_TYPES.CHANNEL_DISCONNECTED]: ChannelDisconnectedEventSchema,
  [EVENT_TYPES.CHANNEL_RATE_LIMIT_REACHED]: ChannelRateLimitReachedEventSchema,
  [EVENT_TYPES.ANALYTICS_COLLECTED]: AnalyticsCollectedEventSchema,
  [EVENT_TYPES.USER_ACTION]: UserActionEventSchema,
  [EVENT_TYPES.SYSTEM_HEALTH]: SystemHealthEventSchema,
};

export function validateEvent(event: DomainEvent): boolean {
  const schema = eventSchemas[event.type as keyof typeof eventSchemas];
  if (!schema) {
    return false;
  }

  try {
    schema.parse(event.data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper functions for creating specific events
 */
export function createPostEvent<T>(
  type: string,
  postId: string,
  projectId: string,
  data: T,
  metadata: EventMetadata
): DomainEvent<T> {
  return createDomainEvent(type, postId, "Post", data, metadata);
}

export function createUserActionEvent(
  userId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: EventMetadata,
  details?: Record<string, unknown>
): UserActionEvent {
  return createDomainEvent(
    EVENT_TYPES.USER_ACTION,
    userId,
    "User",
    {
      userId,
      action,
      resourceType,
      resourceId,
      details,
      timestamp: new Date(),
      ...(metadata.sessionId && { sessionId: metadata.sessionId }),
    },
    metadata
  );
}
