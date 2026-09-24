/**
 * @file PostAggregate.ts
 * @description Aggregate root for Post — enforces publishing invariants, manages content and media attachments, and emits lifecycle domain events.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { AggregateRoot } from "./AggregateRoot.js";
import { PostId, ProjectId, MediaId, ContentId, ChannelId } from "../value-objects/EntityId.js";
import { Content, type ContentProps, type ContentLocale } from "../value-objects/Content.js";
import { PublishStatus, PUBLISH_STATUS } from "../value-objects/PublishStatus.js";
import { ScheduledTime } from "../value-objects/ScheduledTime.js";
import { MediaAttachment, type MediaAttachmentProps } from "../value-objects/MediaAttachment.js";
import { type ChannelPublication } from "../entities/ChannelPublication.js";
import { ChannelPublications } from "./ChannelPublications.js";
import { providersOf } from "./post/PostPublicationEvents.js";
import { type PublicationOutcome } from "../value-objects/PublicationOutcome.js";
import {
  applyDerivedStatus,
  assertPublicationProjection,
  clearPendingRetraction,
  contentLock,
  declarePublicationTargets,
  expireRetractionActionWindow,
  markAsFailedFromRecord,
  markAsPartiallyPublishedFromRecord,
  markAsPublishedFromRecord,
  markRetractionOutcome,
  openPublicationEpisode,
  recordChannelAttempt,
  type ClearChannelPendingRetractionInput,
  type ExpireChannelRetractionWindowInput,
  type MarkChannelRetractionOutcomeInput,
  type OpenedPublicationChannel,
  type OpenPublicationEpisodeInput,
  type PublicationContext,
  type RecordChannelAttemptInput,
} from "./post/PostPublicationMethods.js";
import {
  ContentLockedError,
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
 * The facts every Post carries, whether it was just built in memory or loaded
 * from a row. It deliberately holds NEITHER the tenant nor the record set: a
 * post created in memory has no tenant until the repository derives one from
 * its project inside the save, and it has declared no targets yet.
 *
 * Module-private: {@link PersistedPostState} is the only shape a caller outside
 * this file can name, so there is no partially-hydrated post to hand around.
 */
interface PostAggregateState {
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
 * The state a PERSISTED post is rebuilt from. Both extra fields are REQUIRED,
 * and that is the whole point: every predicate that decides whether content is
 * locked, whether a channel may be re-driven, or what word the post derives
 * reads the record set, so "the relation was not loaded" and "the post has no
 * targets" must not share a value. The mapper supplies both unconditionally —
 * its input type is the payload of the one include that hydrates them — so a
 * query issued without them does not compile.
 */
export interface PersistedPostState extends PostAggregateState {
  /** The owning tenant, read from the post row. */
  accountId: string;
  /** The per-channel publication records, empty only when none were declared. */
  publications: readonly ChannelPublication[];
}

/**
 * What the constructor needs: the persisted shape with the tenant relaxed,
 * because {@link PostAggregate.create} legitimately has none yet. Private to
 * this module — no caller can reach the relaxed tenant through a public entry
 * point.
 */
type PostConstructorState = Omit<PersistedPostState, "id" | "accountId"> & {
  accountId: string | undefined;
};

export type {
  ClearChannelPendingRetractionInput,
  ExpireChannelRetractionWindowInput,
  MarkChannelRetractionOutcomeInput,
  OpenedPublicationChannel,
  OpenPublicationEpisodeInput,
  RecordChannelAttemptInput,
};

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
  private readonly _accountId: string | undefined;
  private _content: Content;
  private _status: PublishStatus;
  private _scheduledAt: ScheduledTime | undefined;
  private _publishedAt: Date | undefined;
  private readonly _media: MediaAttachment[];
  private readonly _contentVersions: ContentId[];
  private _publications: ChannelPublication[];

  /**
   * Whether a publication method has REACHED the per-channel records since they were loaded
   * or last persisted. Set the moment a method touches a record, before that method can
   * still refuse or answer `applied: false`, so a refusal path never leaves a mutated record
   * reading clean; the price is that a no-op call (a replayed attempt, a duplicate confirm,
   * a second sweep tick) also sets it, and the next full save refuses loudly where it could
   * have proceeded. That is the direction to be wrong in.
   *
   * It exists because the two saves write different things and only one of them writes
   * records: the FULL save persists the post, its content and its media and touches no
   * publication row, while the NARROW save persists the word and every record. Without
   * this marker, `declarePublicationTargets()` followed by the full save returns success
   * and drops the records on the floor — and the domain emits no event for a declaration,
   * so nothing downstream can notice. The flag is the aggregate's own answer to "do I
   * still owe someone a publication write?", which is the only question the full save can
   * ask without a second read.
   */
  private _publicationsDirty = false;

  private constructor(id: PostId, state: PostConstructorState) {
    super(id, state.createdAt, state.version);
    this._projectId = state.projectId;
    this._accountId = state.accountId;
    this._content = state.content;
    this._status = state.status;
    this._scheduledAt = state.scheduledAt;
    this._publishedAt = state.publishedAt;
    this._media = [...state.media];
    this._contentVersions = [...state.contentVersions];
    this._publications = [...state.publications];

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
      // No tenant yet: the repository derives it from the project inside the
      // save, so a post that has not been saved honestly has none.
      accountId: undefined,
      content: contentResult.value,
      status: initialStatus,
      ...(scheduledAt !== undefined && { scheduledAt }),
      media: [],
      contentVersions: [],
      // No target has been declared yet, stated rather than defaulted.
      publications: [],
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
   * @method reconstitute
   * @description Rebuilds a post from persistence. It takes the PERSISTED state, so
   *   the tenant and the record set are required by the compiler rather than defaulted
   *   here: a default would let a load that never hydrated the records read as a post
   *   with no targets, which unlocks its content and derives its word from nothing.
   * @param state - The persisted state, tenant and records included
   * @returns The rebuilt aggregate
   */
  static reconstitute(state: PersistedPostState): PostAggregate {
    return new PostAggregate(state.id, state);
  }

  // Getters

  get entityType(): string {
    return "PostAggregate";
  }

  get projectId(): ProjectId {
    return this._projectId;
  }

  get accountId(): string | undefined {
    return this._accountId;
  }

  /**
   * @method publications
   * @description The post's per-channel record set — the ONLY source of publication
   *   truth. Every lock, admission, guard and derived word reads it.
   * @returns A read view over the records
   */
  get publications(): ChannelPublications {
    return ChannelPublications.of(this._publications);
  }

  /**
   * @method hasUnsavedPublications
   * @description Whether a publication write is still owed for this aggregate. Read by
   *   the FULL save, which writes no publication row and must refuse rather than drop
   *   the change in silence.
   * @returns true when a publication method reached the records since they were loaded
   *   or last persisted — including a call that then refused or applied nothing, which
   *   is deliberate (a false positive refuses loudly; a false negative drops records)
   */
  hasUnsavedPublications(): boolean {
    return this._publicationsDirty;
  }

  /**
   * @method markPublicationsPersisted
   * @description Records that the per-channel records are DURABLE. Called once the
   *   transaction that wrote them has COMMITTED — not when the statements ran, which is
   *   a different and weaker fact: statements can still be undone by work that follows
   *   them in the same transaction, and by the commit itself.
   *
   *   The distinction is the whole point. This flag is what the full save reads to refuse
   *   an aggregate whose records it would not write, so an aggregate marked clean by a
   *   transaction that then rolled back would be ACCEPTED by that save and have its
   *   records dropped — the exact silence the refusal exists to prevent, inverted. It is
   *   deliberately NOT the same placement as {@link incrementVersion}, which must run
   *   inside the transaction because the transaction itself reads the version again.
   */
  markPublicationsPersisted(): void {
    this._publicationsDirty = false;
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

  /**
   * Editability is decided from the RECORD first and the lifecycle word second.
   * Deciding it from the word alone is the defect this record exists to close: a post
   * whose content is live on two providers can read `FAILED`, and `FAILED` is an
   * editable word.
   */
  get isEditable(): boolean {
    return this.publications.noLiveContent() && this._status.isEditable();
  }

  // Domain behavior with events

  /**
   * Update post content
   */
  updateContent(
    props: Partial<ContentProps>
  ): Result<void, InvalidStateTransitionError | EmptyValueError | ContentLockedError> {
    const locked = this.contentLock("EDIT");
    if (locked !== undefined) {
      return err(locked);
    }
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
  ): Result<void, InvalidStateTransitionError | InvariantViolationError | ContentLockedError> {
    const locked = this.contentLock("SCHEDULE");
    if (locked !== undefined) {
      return err(locked);
    }
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
  unschedule(): Result<void, InvalidStateTransitionError | ContentLockedError> {
    const locked = this.contentLock("UNSCHEDULE");
    if (locked !== undefined) {
      return err(locked);
    }
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
   * @method startPublishing
   * @description Enters the publication family through the lifecycle state machine,
   *   naming in the internal event the providers of the post's OWN records, read off
   *   the joined channel rows. It takes no argument: there is no seam through which a
   *   caller could name a provider the record does not hold, and a post that declared
   *   no target has nothing to publish to and is refused.
   * @returns Result.ok, InvariantViolationError when no target was declared, or
   *   InvalidStateTransitionError when the word cannot enter the family
   */
  startPublishing(): Result<void, InvalidStateTransitionError | InvariantViolationError> {
    if (this.publications.isEmpty()) {
      return err(
        new InvariantViolationError(
          `post ${this._id.value} has no publication record to start publishing from`
        )
      );
    }

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

    this.addDomainEvent(new PostPublishingStarted(this._id.value, providersOf(this._publications)));

    return ok(undefined);
  }

  /**
   * @method markAsPublished
   * @description Resolves the post to `PUBLISHED`. It is a PROJECTION write gated by
   *   the record itself: the derivation must already read `PUBLISHED`, and the v1
   *   event payload is built FROM the record, so the word can never claim more than
   *   the channels did. A post that declared no target has no derivation and is
   *   refused — there is no caller's word that can stand in for the record.
   * @returns Result.ok, or InvariantViolationError naming what stopped it
   */
  markAsPublished(): Result<void, InvariantViolationError> {
    if (this.publications.isEmpty()) {
      return err(
        new InvariantViolationError(
          `post ${this._id.value} has no publication record to publish from`
        )
      );
    }
    return markAsPublishedFromRecord(this.publicationContext());
  }

  /**
   * @method markAsPartiallyPublished
   * @description Resolves the post to `PARTIALLY_PUBLISHED` — at least one channel
   *   fully published and at least one did not. No external event: the channel-keyed
   *   events carry the news, and `publishedAt` stays null because the post did not
   *   publish everywhere.
   * @returns Result.ok, or InvariantViolationError when the record does not derive it
   */
  markAsPartiallyPublished(): Result<void, InvariantViolationError> {
    return markAsPartiallyPublishedFromRecord(this.publicationContext());
  }

  /**
   * @method markAsFailed
   * @description Resolves the post to `FAILED`. The derivation must already read
   *   `FAILED` and the v1 payload is built FROM the record: the error is the first
   *   not-published channel's reason, the providers are those of the not-published
   *   channels, and `retryable` says whether any channel may still be attempted. A
   *   post that declared no target has no derivation and is refused.
   * @returns Result.ok, or InvariantViolationError naming what stopped it
   */
  markAsFailed(): Result<void, InvariantViolationError> {
    if (this.publications.isEmpty()) {
      return err(
        new InvariantViolationError(`post ${this._id.value} has no publication record to fail from`)
      );
    }
    return markAsFailedFromRecord(this.publicationContext());
  }

  /**
   * Cancel post
   */
  cancel(reason?: string): Result<void, InvalidStateTransitionError | ContentLockedError> {
    const locked = this.contentLock("CANCEL");
    if (locked !== undefined) {
      return err(locked);
    }
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
  addMedia(
    props: MediaAttachmentProps
  ): Result<MediaAttachment, InvalidStateTransitionError | ContentLockedError> {
    const locked = this.contentLock("ADD_MEDIA");
    if (locked !== undefined) {
      return err(locked);
    }
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
  removeMedia(mediaId: MediaId): Result<void, InvalidStateTransitionError | ContentLockedError> {
    const locked = this.contentLock("REMOVE_MEDIA");
    if (locked !== undefined) {
      return err(locked);
    }
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

  // ── the publication record ───────────────────────────────────────────────
  //
  // The facet itself lives in `./post/PostPublicationMethods.ts`. These are its only
  // entry points: the companion takes the narrow mutable view built below, which
  // nothing outside this class can construct, so the record set stays behind the
  // aggregate boundary while this file stays readable.

  /**
   * @method publicationContext
   * @description The narrow mutable view the publication companion operates on.
   * @returns The context bound to this aggregate
   */
  private publicationContext(): PublicationContext {
    // The three mutable reads are GETTERS, not captured values. A companion function
    // that sets the word and then re-reads it must see what it just wrote; a snapshot
    // would make the second read answer with the state before the change.
    const aggregate = this;
    return {
      postId: this._id.value,
      projectId: this._projectId.value,
      accountId: this._accountId,
      get records() {
        return aggregate._publications;
      },
      get status() {
        return aggregate._status;
      },
      get publishedAt() {
        return aggregate._publishedAt;
      },
      replaceRecords: (records) => {
        this._publications = records;
        // Replacing the set IS a record change, and it is the one that emits no domain
        // event — so without this the full save would have nothing at all to notice.
        this._publicationsDirty = true;
      },
      setStatus: (status) => {
        this._status = status;
      },
      setPublishedAt: (publishedAt) => {
        this._publishedAt = publishedAt;
      },
      emit: (event) => {
        this.addDomainEvent(event);
      },
      touch: () => {
        this.markUpdated();
      },
      markRecordsChanged: () => {
        this._publicationsDirty = true;
      },
      startPublishing: () => this.startPublishing(),
    };
  }

  /**
   * @method declarePublicationTargets
   * @description Records the channels this post is INTENDED for, so a channel that
   *   never ran is recorded rather than missing.
   * @param channelIds - The intended channels
   * @returns Result.ok, or InvariantViolationError when content is already live
   */
  declarePublicationTargets(
    channelIds: readonly ChannelId[]
  ): Result<void, InvariantViolationError> {
    return declarePublicationTargets(this.publicationContext(), channelIds);
  }

  /**
   * @method openPublicationEpisode
   * @description Includes re-drivable channels in a new attempt episode; a channel
   *   holding live fragments is refused by name.
   * @param input - The channels to open and whether the post enters the family now
   * @returns Result with the opened channels and whether the episode was already open
   */
  openPublicationEpisode(
    input: OpenPublicationEpisodeInput
  ): Result<
    { opened: readonly OpenedPublicationChannel[]; alreadyOpen: boolean },
    InvariantViolationError | InvalidStateTransitionError
  > {
    return openPublicationEpisode(this.publicationContext(), input);
  }

  /**
   * @method recordChannelAttempt
   * @description Records ONE attempt's result for ONE channel and re-derives the word.
   * @param input - The channel, the episode, the attempt ordinal, the plan size, the result
   * @returns Result with whether the attempt applied and the channel's outcome
   */
  recordChannelAttempt(
    input: RecordChannelAttemptInput
  ): Result<
    { applied: boolean; outcome: PublicationOutcome },
    InvariantViolationError | InvalidStateTransitionError
  > {
    return recordChannelAttempt(this.publicationContext(), input);
  }

  /**
   * @method markRetractionOutcome
   * @description Records what a retraction attempt achieved on one channel.
   * @param input - The channel, the retraction outcome and what is still live
   * @returns Result.ok, or the refusal that stopped it
   */
  markRetractionOutcome(
    input: MarkChannelRetractionOutcomeInput
  ): Result<void, InvariantViolationError | InvalidStateTransitionError> {
    return markRetractionOutcome(this.publicationContext(), input);
  }

  /**
   * @method clearPendingRetraction
   * @description The customer's confirmation that they removed the live fragments.
   * @param input - The channel and the recorded cause
   * @returns Result with `applied` — false when nothing was pending on that channel
   */
  clearPendingRetraction(
    input: ClearChannelPendingRetractionInput
  ): Result<{ applied: boolean }, InvariantViolationError | InvalidStateTransitionError> {
    return clearPendingRetraction(this.publicationContext(), input);
  }

  /**
   * @method expireRetractionActionWindow
   * @description Closes the customer's window on one channel, keeping every fragment.
   * @param input - The channel, the moment and the window length
   * @returns Result with `applied` — false when the window has not elapsed
   */
  expireRetractionActionWindow(
    input: ExpireChannelRetractionWindowInput
  ): Result<{ applied: boolean }, InvariantViolationError | InvalidStateTransitionError> {
    return expireRetractionActionWindow(this.publicationContext(), input);
  }

  /**
   * @method reconcilePublicationProjection
   * @description Re-derives the word from the record and repairs it when the two have
   *   drifted. It is the only path that moves a `PUBLISHED` word, and only to the value
   *   the record proves.
   * @returns Result with whether the word changed
   */
  reconcilePublicationProjection(): Result<
    { changed: boolean },
    InvariantViolationError | InvalidStateTransitionError
  > {
    const projected = applyDerivedStatus(this.publicationContext());
    if (!projected.ok) {
      return err(projected.error);
    }
    if (projected.value) {
      this.markUpdated();
    }
    return ok({ changed: projected.value });
  }

  /**
   * @method assertPublicationProjection
   * @description The invariant every save re-asserts, so divergence between the word
   *   and the record is never representable in committed state.
   * @returns Result.ok, or InvariantViolationError naming the divergence
   */
  assertPublicationProjection(): Result<void, InvariantViolationError> {
    return assertPublicationProjection(this.publicationContext());
  }

  /**
   * @method contentLock
   * @description The refusal a content write gets while any channel holds content of
   *   this post on its provider.
   * @param operation - The write being refused
   * @returns The refusal, or undefined when nothing is live
   */
  private contentLock(operation: string): ContentLockedError | undefined {
    return contentLock(this.publicationContext(), operation);
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
