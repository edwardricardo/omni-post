/**
 * Domain Layer - Post Aggregate
 *
 * Part of Sprint 5: DDD Architecture Implementation
 * The Post aggregate manages Post entity along with its content and media.
 */

import { type Result, ok, err } from "@shared/types";
import { AggregateRoot } from "./AggregateRoot.js";
import { PostId, ProjectId, MediaId, ContentId } from "../value-objects/EntityId.js";
import { Content, type ContentProps, type ContentLocale } from "../value-objects/Content.js";
import { PublishStatus, PUBLISH_STATUS } from "../value-objects/PublishStatus.js";
import { ScheduledTime } from "../value-objects/ScheduledTime.js";
import { MediaAttachment, type MediaAttachmentProps } from "../value-objects/MediaAttachment.js";
import { type ProviderType } from "../value-objects/Provider.js";
import {
  InvalidStateTransitionError,
  InvariantViolationError,
  EmptyValueError,
} from "../errors/index.js";
import {
  PostCreated,
  PostContentUpdated,
  PostScheduled,
  PostUnscheduled,
  PostPublishingStarted,
  PostPublished,
  PostPublishingFailed,
  PostCancelled,
  PostMediaAdded,
  PostMediaRemoved,
  PostSubmittedForReview,
  PostApproved,
  PostRejected,
} from "../events/PostEvents.js";

/**
 * Post creation input
 */
export interface CreatePostAggregateInput {
  projectId: ProjectId;
  body: string;
  title?: string;
  summary?: string;
  tags?: string[];
  locale?: ContentLocale;
  scheduledAt?: Date;
  timezone?: string;
}

/**
 * Post aggregate state for reconstitution
 */
export interface PostAggregateState {
  id: PostId;
  projectId: ProjectId;
  content: Content;
  status: PublishStatus;
  scheduledAt?: ScheduledTime;
  publishedAt?: Date;
  media: MediaAttachment[];
  contentVersions: ContentId[];
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/**
 * PostAggregate - Aggregate root for Post domain
 *
 * Manages:
 * - Post content and versions
 * - Publishing state machine
 * - Media attachments
 * - Domain events
 *
 * @example
 * const result = PostAggregate.create({
 *   projectId,
 *   body: 'Hello world!',
 *   tags: ['announcement']
 * });
 * if (result.ok) {
 *   const post = result.value;
 *   post.schedule(futureDate);
 *   const events = post.domainEvents; // [PostCreated, PostScheduled]
 * }
 */
export class PostAggregate extends AggregateRoot<PostId> {
  private readonly _projectId: ProjectId;
  private _content: Content;
  private _status: PublishStatus;
  private _scheduledAt: ScheduledTime | undefined;
  private _publishedAt: Date | undefined;
  private readonly _media: MediaAttachment[];
  private readonly _contentVersions: ContentId[];

  private constructor(id: PostId, state: Omit<PostAggregateState, "id">) {
    super(id, state.createdAt, state.version);
    this._projectId = state.projectId;
    this._content = state.content;
    this._status = state.status;
    this._scheduledAt = state.scheduledAt;
    this._publishedAt = state.publishedAt;
    this._media = [...state.media];
    this._contentVersions = [...state.contentVersions];

    if (state.updatedAt) {
      this._updatedAt = state.updatedAt;
    }
  }

  /**
   * Factory method to create a new Post aggregate
   */
  static create(
    input: CreatePostAggregateInput
  ): Result<PostAggregate, EmptyValueError | InvariantViolationError> {
    // Create content value object
    const contentResult = Content.create({
      body: input.body,
      ...(input.title !== undefined && { title: input.title }),
      ...(input.summary !== undefined && { summary: input.summary }),
      ...(input.tags !== undefined && { tags: input.tags }),
      ...(input.locale !== undefined && { locale: input.locale }),
    });

    if (!contentResult.ok) {
      return err(contentResult.error);
    }

    // Create scheduled time if provided
    let scheduledAt: ScheduledTime | undefined;
    let initialStatus = PublishStatus.draft();

    if (input.scheduledAt) {
      const scheduledResult = ScheduledTime.create({
        dateTime: input.scheduledAt,
        ...(input.timezone !== undefined && { timezone: input.timezone }),
      });
      if (!scheduledResult.ok) {
        return err(
          new InvariantViolationError(`Invalid scheduled time: ${scheduledResult.error.message}`)
        );
      }
      scheduledAt = scheduledResult.value;
      initialStatus = PublishStatus.scheduled();
    }

    const postId = PostId.generate();
    const now = new Date();

    const aggregate = new PostAggregate(postId, {
      projectId: input.projectId,
      content: contentResult.value,
      status: initialStatus,
      ...(scheduledAt !== undefined && { scheduledAt }),
      media: [],
      contentVersions: [],
      createdAt: now,
      updatedAt: now,
      version: 0,
    });

    // Raise creation event — use the actual locale from the content (default "en")
    aggregate.addDomainEvent(
      new PostCreated(
        postId.value,
        input.projectId.value,
        input.body,
        contentResult.value.locale,
        input.title
      )
    );

    // If scheduled, raise scheduled event
    if (scheduledAt) {
      aggregate.addDomainEvent(
        new PostScheduled(postId.value, scheduledAt.dateTime, scheduledAt.timezone)
      );
    }

    return ok(aggregate);
  }

  /**
   * Reconstitute aggregate from persistence
   */
  static reconstitute(state: PostAggregateState): PostAggregate {
    return new PostAggregate(state.id, state);
  }

  // Getters

  get entityType(): string {
    return "PostAggregate";
  }

  get projectId(): ProjectId {
    return this._projectId;
  }

  get content(): Content {
    return this._content;
  }

  get status(): PublishStatus {
    return this._status;
  }

  get scheduledAt(): ScheduledTime | undefined {
    return this._scheduledAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt ? new Date(this._publishedAt.getTime()) : undefined;
  }

  get media(): readonly MediaAttachment[] {
    return [...this._media];
  }

  get contentVersions(): readonly ContentId[] {
    return [...this._contentVersions];
  }

  // Status predicates

  get isDraft(): boolean {
    return this._status.isDraft();
  }

  get isScheduled(): boolean {
    return this._status.isScheduled();
  }

  get isPublishing(): boolean {
    return this._status.isPublishing();
  }

  get isPublished(): boolean {
    return this._status.isPublished();
  }

  get isFailed(): boolean {
    return this._status.isFailed();
  }

  get isPendingReview(): boolean {
    return this._status.isPendingReview();
  }

  get isEditable(): boolean {
    return this._status.isEditable();
  }

  // Domain behavior with events

  /**
   * Update post content
   */
  updateContent(
    props: Partial<ContentProps>
  ): Result<void, InvalidStateTransitionError | EmptyValueError> {
    if (!this.isEditable) {
      return err(new InvalidStateTransitionError(this._status.value, "EDIT", "Post"));
    }

    const previousBody = this._content.body;
    let newContent = this._content;

    if (props.body !== undefined) {
      const bodyResult = newContent.withBody(props.body);
      if (!bodyResult.ok) {
        return err(bodyResult.error);
      }
      newContent = bodyResult.value;
    }

    if (props.title !== undefined) {
      newContent = newContent.withTitle(props.title);
    }

    if (props.tags !== undefined) {
      newContent = newContent.withTags(props.tags);
    }

    // Store version and update
    const versionId = ContentId.generate();
    this._contentVersions.push(versionId);
    this._content = newContent;
    this.markUpdated();

    // Raise event
    this.addDomainEvent(
      new PostContentUpdated(this._id.value, previousBody, newContent.body, versionId.value)
    );

    return ok(undefined);
  }

  /**
   * Schedule post for publication
   */
  schedule(
    scheduledAt: Date,
    timezone?: string
  ): Result<void, InvalidStateTransitionError | InvariantViolationError> {
    if (!this._status.canTransitionTo(PUBLISH_STATUS.SCHEDULED)) {
      return err(
        new InvalidStateTransitionError(this._status.value, PUBLISH_STATUS.SCHEDULED, "Post")
      );
    }

    const scheduledResult = ScheduledTime.create({
      dateTime: scheduledAt,
      ...(timezone !== undefined && { timezone }),
    });
    if (!scheduledResult.ok) {
      return err(
        new InvariantViolationError(`Invalid scheduled time: ${scheduledResult.error.message}`)
      );
    }

    const transitionResult = this._status.transitionTo(PUBLISH_STATUS.SCHEDULED);
    if (!transitionResult.ok) {
      return err(transitionResult.error);
    }

    this._status = transitionResult.value;
    this._scheduledAt = scheduledResult.value;
    this.markUpdated();

    // Raise event
    this.addDomainEvent(
      new PostScheduled(
        this._id.value,
        scheduledResult.value.dateTime,
        scheduledResult.value.timezone
      )
    );

    return ok(undefined);
  }

  /**
   * Unschedule post
   */
  unschedule(): Result<void, InvalidStateTransitionError> {
    if (!this._status.canTransitionTo(PUBLISH_STATUS.DRAFT)) {
      return err(new InvalidStateTransitionError(this._status.value, PUBLISH_STATUS.DRAFT, "Post"));
    }

    const previousScheduledAt = this._scheduledAt?.dateTime;

    const transitionResult = this._status.transitionTo(PUBLISH_STATUS.DRAFT);
    if (!transitionResult.ok) {
      return err(transitionResult.error);
    }

    this._status = transitionResult.value;
    this._scheduledAt = undefined;
    this.markUpdated();

    // Raise event
    if (previousScheduledAt) {
      this.addDomainEvent(new PostUnscheduled(this._id.value, previousScheduledAt));
    }

    return ok(undefined);
  }

  /**
   * Start publishing process
   */
  startPublishing(targetProviders: ProviderType[]): Result<void, InvalidStateTransitionError> {
    if (!this._status.canTransitionTo(PUBLISH_STATUS.PUBLISHING)) {
      return err(
        new InvalidStateTransitionError(this._status.value, PUBLISH_STATUS.PUBLISHING, "Post")
      );
    }

    const transitionResult = this._status.transitionTo(PUBLISH_STATUS.PUBLISHING);
    if (!transitionResult.ok) {
      return err(transitionResult.error);
    }

    this._status = transitionResult.value;
    this.markUpdated();

    // Raise event
    this.addDomainEvent(new PostPublishingStarted(this._id.value, targetProviders));

    return ok(undefined);
  }

  /**
   * Mark as published
   */
  markAsPublished(
    providerResults: Record<string, { success: boolean; externalId?: string; error?: string }>
  ): Result<void, InvalidStateTransitionError> {
    if (!this._status.canTransitionTo(PUBLISH_STATUS.PUBLISHED)) {
      return err(
        new InvalidStateTransitionError(this._status.value, PUBLISH_STATUS.PUBLISHED, "Post")
      );
    }

    const transitionResult = this._status.transitionTo(PUBLISH_STATUS.PUBLISHED);
    if (!transitionResult.ok) {
      return err(transitionResult.error);
    }

    this._status = transitionResult.value;
    this._publishedAt = new Date();
    this.markUpdated();

    // Raise event
    this.addDomainEvent(new PostPublished(this._id.value, this._publishedAt, providerResults));

    return ok(undefined);
  }

  /**
   * Mark as failed
   */
  markAsFailed(
    error: string,
    failedProviders: ProviderType[],
    retryable: boolean = true
  ): Result<void, InvalidStateTransitionError> {
    if (!this._status.canTransitionTo(PUBLISH_STATUS.FAILED)) {
      return err(
        new InvalidStateTransitionError(this._status.value, PUBLISH_STATUS.FAILED, "Post")
      );
    }

    const transitionResult = this._status.transitionTo(PUBLISH_STATUS.FAILED);
    if (!transitionResult.ok) {
      return err(transitionResult.error);
    }

    this._status = transitionResult.value;
    this.markUpdated();

    // Raise event
    this.addDomainEvent(
      new PostPublishingFailed(this._id.value, error, failedProviders, retryable)
    );

    return ok(undefined);
  }

  /**
   * Cancel post
   */
  cancel(reason?: string): Result<void, InvalidStateTransitionError> {
    if (!this._status.canTransitionTo(PUBLISH_STATUS.CANCELLED)) {
      return err(
        new InvalidStateTransitionError(this._status.value, PUBLISH_STATUS.CANCELLED, "Post")
      );
    }

    const previousStatus = this._status.value;
    const transitionResult = this._status.transitionTo(PUBLISH_STATUS.CANCELLED);
    if (!transitionResult.ok) {
      return err(transitionResult.error);
    }

    this._status = transitionResult.value;
    this.markUpdated();

    // Raise event
    this.addDomainEvent(new PostCancelled(this._id.value, previousStatus, reason));

    return ok(undefined);
  }

  /**
   * Submit post for review (DRAFT -> PENDING_REVIEW)
   */
  submitForReview(): Result<void, InvalidStateTransitionError> {
    if (!this._status.canTransitionTo(PUBLISH_STATUS.PENDING_REVIEW)) {
      return err(
        new InvalidStateTransitionError(this._status.value, PUBLISH_STATUS.PENDING_REVIEW, "Post")
      );
    }

    const transitionResult = this._status.transitionTo(PUBLISH_STATUS.PENDING_REVIEW);
    if (!transitionResult.ok) return err(transitionResult.error);

    this._status = transitionResult.value;
    this.markUpdated();
    this.addDomainEvent(new PostSubmittedForReview(this._id.value, this._projectId.value));

    return ok(undefined);
  }

  /**
   * Return post to draft (PENDING_REVIEW -> DRAFT, rejection path)
   */
  returnToDraft(reason?: string): Result<void, InvalidStateTransitionError> {
    if (!this._status.canTransitionTo(PUBLISH_STATUS.DRAFT)) {
      return err(new InvalidStateTransitionError(this._status.value, PUBLISH_STATUS.DRAFT, "Post"));
    }

    const transitionResult = this._status.transitionTo(PUBLISH_STATUS.DRAFT);
    if (!transitionResult.ok) return err(transitionResult.error);

    this._status = transitionResult.value;
    this._scheduledAt = undefined;
    this.markUpdated();
    this.addDomainEvent(new PostRejected(this._id.value, reason));

    return ok(undefined);
  }

  /**
   * Approve and schedule post (PENDING_REVIEW -> SCHEDULED)
   */
  approveForScheduling(
    scheduledAt: Date,
    timezone?: string
  ): Result<void, InvalidStateTransitionError | InvariantViolationError> {
    if (!this._status.canTransitionTo(PUBLISH_STATUS.SCHEDULED)) {
      return err(
        new InvalidStateTransitionError(this._status.value, PUBLISH_STATUS.SCHEDULED, "Post")
      );
    }

    const scheduledResult = ScheduledTime.create({
      dateTime: scheduledAt,
      ...(timezone !== undefined && { timezone }),
    });
    if (!scheduledResult.ok) {
      return err(
        new InvariantViolationError(`Invalid scheduled time: ${scheduledResult.error.message}`)
      );
    }

    const transitionResult = this._status.transitionTo(PUBLISH_STATUS.SCHEDULED);
    if (!transitionResult.ok) return err(transitionResult.error);

    this._status = transitionResult.value;
    this._scheduledAt = scheduledResult.value;
    this.markUpdated();
    this.addDomainEvent(new PostApproved(this._id.value, scheduledAt));

    return ok(undefined);
  }

  /**
   * Add media attachment
   */
  addMedia(props: MediaAttachmentProps): Result<MediaAttachment, InvalidStateTransitionError> {
    if (!this.isEditable) {
      return err(new InvalidStateTransitionError(this._status.value, "ADD_MEDIA", "Post"));
    }

    const mediaResult = MediaAttachment.create(props);
    if (!mediaResult.ok) {
      return err(new InvalidStateTransitionError(this._status.value, "ADD_MEDIA", "Post"));
    }

    const media = mediaResult.value;
    this._media.push(media);
    this.markUpdated();

    // Raise event
    this.addDomainEvent(new PostMediaAdded(this._id.value, media.id.value, media.type, media.url));

    return ok(media);
  }

  /**
   * Remove media attachment
   */
  removeMedia(mediaId: MediaId): Result<void, InvalidStateTransitionError> {
    if (!this.isEditable) {
      return err(new InvalidStateTransitionError(this._status.value, "REMOVE_MEDIA", "Post"));
    }

    const index = this._media.findIndex((m) => m.id.equals(mediaId));
    if (index !== -1) {
      this._media.splice(index, 1);
      this.markUpdated();

      // Raise event
      this.addDomainEvent(new PostMediaRemoved(this._id.value, mediaId.value));
    }

    return ok(undefined);
  }

  /**
   * Check if ready for publishing
   */
  isReadyForPublishing(): boolean {
    if (!this.isScheduled || !this._scheduledAt) {
      return false;
    }
    return this._scheduledAt.hasPassed();
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this._id.toString(),
      projectId: this._projectId.toString(),
      content: this._content.toJSON(),
      status: this._status.value,
      ...(this._scheduledAt && { scheduledAt: this._scheduledAt.toJSON() }),
      ...(this._publishedAt && { publishedAt: this._publishedAt.toISOString() }),
      media: this._media.map((m) => m.toJSON()),
      contentVersions: this._contentVersions.map((id) => id.toString()),
      version: this.version,
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }
}
