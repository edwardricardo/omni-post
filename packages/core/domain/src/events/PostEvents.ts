/**
 * @file PostEvents.ts
 * @description Domain events emitted by the Post aggregate during state transitions — creation, scheduling, publishing, failure, and cancellation.
 * @layer domain
 */

import { BaseDomainEvent } from "./DomainEvent.js";
import { type PublishStatusValue } from "../value-objects/PublishStatus.js";
import { type ProviderType } from "../value-objects/Provider.js";
import { type FragmentReferenceJson } from "../value-objects/FragmentReference.js";
import { type ChannelFailureCode } from "../value-objects/ExclusionReason.js";
import {
  type ChannelRetractionBlock,
  type RetractionAlertCause,
} from "../value-objects/PublicationOutcome.js";

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
 * Event raised when a post is submitted for review
 */
export class PostSubmittedForReview extends BaseDomainEvent {
  readonly eventType = "PostSubmittedForReview";
  readonly aggregateType = "Post";

  constructor(
    readonly aggregateId: string,
    readonly projectId: string,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      postId: this.aggregateId,
      projectId: this.projectId,
    };
  }
}

/**
 * Event raised when a post is approved for scheduling
 */
export class PostApproved extends BaseDomainEvent {
  readonly eventType = "PostApproved";
  readonly aggregateType = "Post";

  constructor(
    readonly aggregateId: string,
    readonly scheduledAt: Date,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      postId: this.aggregateId,
      scheduledAt: this.scheduledAt.toISOString(),
    };
  }
}

/**
 * Event raised when a post is rejected during review
 */
export class PostRejected extends BaseDomainEvent {
  readonly eventType = "PostRejected";
  readonly aggregateType = "Post";

  constructor(
    readonly aggregateId: string,
    readonly reason?: string,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      postId: this.aggregateId,
      ...(this.reason !== undefined && { reason: this.reason }),
    };
  }
}

/**
 * Input of {@link PostChannelPublished}. Flat by intent: the payload is the contract
 * an in-process consumer reads off the outbox, so every field is named here.
 */
export interface PostChannelPublishedProps {
  postId: string;
  projectId: string;
  accountId?: string;
  channelId: string;
  externalId?: string;
  fragmentCount: number;
  publishedAt: Date;
  contentHash?: string;
}

/**
 * Event raised when ONE channel published every fragment of the post.
 *
 * Internal: it is absent from the outbound integration catalog exactly as
 * {@link PostPublishingStarted} is, and is consumed in-process only.
 */
export class PostChannelPublished extends BaseDomainEvent {
  readonly eventType = "PostChannelPublished";
  readonly aggregateType = "Post";
  readonly aggregateId: string;

  constructor(
    private readonly props: PostChannelPublishedProps,
    version: number = 1
  ) {
    super(version);
    this.aggregateId = props.postId;
  }

  toPayload(): Record<string, unknown> {
    return {
      postId: this.props.postId,
      projectId: this.props.projectId,
      ...(this.props.accountId !== undefined && { accountId: this.props.accountId }),
      channelId: this.props.channelId,
      ...(this.props.externalId !== undefined && { externalId: this.props.externalId }),
      fragmentCount: this.props.fragmentCount,
      publishedAt: this.props.publishedAt.toISOString(),
      ...(this.props.contentHash !== undefined && { contentHash: this.props.contentHash }),
    };
  }
}

/** Input of {@link PostChannelExcluded}. */
export interface PostChannelExcludedProps {
  postId: string;
  projectId: string;
  accountId?: string;
  channelId: string;
  reasonCode: ChannelFailureCode;
  attempts: number;
  pendingRetraction: boolean;
  liveFragmentCount: number;
}

/**
 * Event raised when ONE channel resolved to the terminal not-published outcome.
 * `pendingRetraction` and `liveFragmentCount` travel with it because "failed with
 * nothing live" and "failed with content still on the platform" are different facts
 * and only the second one obliges anyone.
 *
 * Internal: consumed in-process only.
 */
export class PostChannelExcluded extends BaseDomainEvent {
  readonly eventType = "PostChannelExcluded";
  readonly aggregateType = "Post";
  readonly aggregateId: string;

  constructor(
    private readonly props: PostChannelExcludedProps,
    version: number = 1
  ) {
    super(version);
    this.aggregateId = props.postId;
  }

  toPayload(): Record<string, unknown> {
    return {
      postId: this.props.postId,
      projectId: this.props.projectId,
      ...(this.props.accountId !== undefined && { accountId: this.props.accountId }),
      channelId: this.props.channelId,
      reasonCode: this.props.reasonCode,
      attempts: this.props.attempts,
      pendingRetraction: this.props.pendingRetraction,
      liveFragmentCount: this.props.liveFragmentCount,
    };
  }
}

/** Input of {@link PostChannelRetractionAlertRaised}. */
export interface PostChannelRetractionAlertRaisedProps {
  postId: string;
  projectId: string;
  accountId?: string;
  channelId: string;
  liveFragments: readonly FragmentReferenceJson[];
  cause: ChannelRetractionBlock;
  alertKey: string;
  supersededAlertKey?: string;
}

/**
 * Event raised when content of this post is live on a provider that did not publish
 * it and this application cannot take it down. The fragments are NAMED rather than
 * counted: the customer is being asked to remove exactly these.
 *
 * Internal: consumed in-process only.
 */
export class PostChannelRetractionAlertRaised extends BaseDomainEvent {
  readonly eventType = "PostChannelRetractionAlertRaised";
  readonly aggregateType = "Post";
  readonly aggregateId: string;

  constructor(
    private readonly props: PostChannelRetractionAlertRaisedProps,
    version: number = 1
  ) {
    super(version);
    this.aggregateId = props.postId;
  }

  toPayload(): Record<string, unknown> {
    return {
      postId: this.props.postId,
      projectId: this.props.projectId,
      ...(this.props.accountId !== undefined && { accountId: this.props.accountId }),
      channelId: this.props.channelId,
      liveFragments: this.props.liveFragments.map((fragment) => ({ ...fragment })),
      cause: this.props.cause,
      alertKey: this.props.alertKey,
      ...(this.props.supersededAlertKey !== undefined && {
        supersededAlertKey: this.props.supersededAlertKey,
      }),
    };
  }
}

/** Input of {@link PostChannelRetractionAlertResolved}. */
export interface PostChannelRetractionAlertResolvedProps {
  postId: string;
  projectId: string;
  accountId?: string;
  channelId: string;
  alertKey: string;
  cause: RetractionAlertCause;
}

/**
 * Event raised when an alert about live content no longer stands — the content came
 * down, or the customer's window to act closed.
 *
 * Internal: consumed in-process only.
 */
export class PostChannelRetractionAlertResolved extends BaseDomainEvent {
  readonly eventType = "PostChannelRetractionAlertResolved";
  readonly aggregateType = "Post";
  readonly aggregateId: string;

  constructor(
    private readonly props: PostChannelRetractionAlertResolvedProps,
    version: number = 1
  ) {
    super(version);
    this.aggregateId = props.postId;
  }

  toPayload(): Record<string, unknown> {
    return {
      postId: this.props.postId,
      projectId: this.props.projectId,
      ...(this.props.accountId !== undefined && { accountId: this.props.accountId }),
      channelId: this.props.channelId,
      alertKey: this.props.alertKey,
      cause: this.props.cause,
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
  | PostMediaRemoved
  | PostSubmittedForReview
  | PostApproved
  | PostRejected
  | PostChannelPublished
  | PostChannelExcluded
  | PostChannelRetractionAlertRaised
  | PostChannelRetractionAlertResolved;
