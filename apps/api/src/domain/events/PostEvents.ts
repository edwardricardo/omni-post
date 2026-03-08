/**
 * Domain Layer - Post Domain Events
 *
 * Part of Sprint 5: DDD Architecture Implementation
 * Events that occur during the Post lifecycle.
 */

import { BaseDomainEvent } from "./DomainEvent.js";
import { type PublishStatusValue } from "../value-objects/PublishStatus.js";
import { type ProviderType } from "../value-objects/Provider.js";

/**
 * Event raised when a new post is created
 */
export class PostCreated extends BaseDomainEvent {
  readonly eventType = "PostCreated";
  readonly aggregateType = "Post";

  constructor(
    readonly aggregateId: string,
    readonly projectId: string,
    readonly body: string,
    readonly locale: string,
    readonly title?: string,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      postId: this.aggregateId,
      projectId: this.projectId,
      body: this.body,
      locale: this.locale,
      ...(this.title && { title: this.title }),
    };
  }
}

/**
 * Event raised when post content is updated
 */
export class PostContentUpdated extends BaseDomainEvent {
  readonly eventType = "PostContentUpdated";
  readonly aggregateType = "Post";

  constructor(
    readonly aggregateId: string,
    readonly previousBody: string,
    readonly newBody: string,
    readonly contentVersionId: string,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      postId: this.aggregateId,
      previousBody: this.previousBody,
      newBody: this.newBody,
      contentVersionId: this.contentVersionId,
    };
  }
}

/**
 * Event raised when a post is scheduled
 */
export class PostScheduled extends BaseDomainEvent {
  readonly eventType = "PostScheduled";
  readonly aggregateType = "Post";

  constructor(
    readonly aggregateId: string,
    readonly scheduledAt: Date,
    readonly timezone: string,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      postId: this.aggregateId,
      scheduledAt: this.scheduledAt.toISOString(),
      timezone: this.timezone,
    };
  }
}

/**
 * Event raised when a post is unscheduled
 */
export class PostUnscheduled extends BaseDomainEvent {
  readonly eventType = "PostUnscheduled";
  readonly aggregateType = "Post";

  constructor(
    readonly aggregateId: string,
    readonly previousScheduledAt: Date,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      postId: this.aggregateId,
      previousScheduledAt: this.previousScheduledAt.toISOString(),
    };
  }
}

/**
 * Event raised when publishing starts
 */
export class PostPublishingStarted extends BaseDomainEvent {
  readonly eventType = "PostPublishingStarted";
  readonly aggregateType = "Post";

  constructor(
    readonly aggregateId: string,
    readonly targetProviders: ProviderType[],
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      postId: this.aggregateId,
      targetProviders: this.targetProviders,
    };
  }
}

/**
 * Event raised when a post is successfully published
 */
export class PostPublished extends BaseDomainEvent {
  readonly eventType = "PostPublished";
  readonly aggregateType = "Post";

  constructor(
    readonly aggregateId: string,
    readonly publishedAt: Date,
    readonly providerResults: Record<
      string,
      { success: boolean; externalId?: string; error?: string }
    >,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      postId: this.aggregateId,
      publishedAt: this.publishedAt.toISOString(),
      providerResults: this.providerResults,
    };
  }
}

/**
 * Event raised when publishing fails
 */
export class PostPublishingFailed extends BaseDomainEvent {
  readonly eventType = "PostPublishingFailed";
  readonly aggregateType = "Post";

  constructor(
    readonly aggregateId: string,
    readonly error: string,
    readonly failedProviders: ProviderType[],
    readonly retryable: boolean,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      postId: this.aggregateId,
      error: this.error,
      failedProviders: this.failedProviders,
      retryable: this.retryable,
    };
  }
}

/**
 * Event raised when a post is cancelled
 */
export class PostCancelled extends BaseDomainEvent {
  readonly eventType = "PostCancelled";
  readonly aggregateType = "Post";

  constructor(
    readonly aggregateId: string,
    readonly previousStatus: PublishStatusValue,
    readonly reason?: string,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      postId: this.aggregateId,
      previousStatus: this.previousStatus,
      ...(this.reason && { reason: this.reason }),
    };
  }
}

/**
 * Event raised when media is added to a post
 */
export class PostMediaAdded extends BaseDomainEvent {
  readonly eventType = "PostMediaAdded";
  readonly aggregateType = "Post";

  constructor(
    readonly aggregateId: string,
    readonly mediaId: string,
    readonly mediaType: string,
    readonly mediaUrl: string,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      postId: this.aggregateId,
      mediaId: this.mediaId,
      mediaType: this.mediaType,
      mediaUrl: this.mediaUrl,
    };
  }
}

/**
 * Event raised when media is removed from a post
 */
export class PostMediaRemoved extends BaseDomainEvent {
  readonly eventType = "PostMediaRemoved";
  readonly aggregateType = "Post";

  constructor(
    readonly aggregateId: string,
    readonly mediaId: string,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      postId: this.aggregateId,
      mediaId: this.mediaId,
    };
  }
}

/**
 * Union type of all post events
 */
export type PostEvent =
  | PostCreated
  | PostContentUpdated
  | PostScheduled
  | PostUnscheduled
  | PostPublishingStarted
  | PostPublished
  | PostPublishingFailed
  | PostCancelled
  | PostMediaAdded
  | PostMediaRemoved;
