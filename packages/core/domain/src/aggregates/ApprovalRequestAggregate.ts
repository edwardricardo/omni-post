/**
 * @file ApprovalRequestAggregate.ts
 * @description Aggregate root for the content approval workflow.
 *   Manages the lifecycle of an approval request: submission, review, and resolution.
 *   Reviews are collected from assigned reviewers and drive the aggregate status.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { randomUUID } from "crypto";
import { AggregateRoot } from "./AggregateRoot.js";
import { ApprovalRequestId } from "../value-objects/ApprovalRequestId.js";
import { ApprovalStatus, APPROVAL_STATUSES } from "../value-objects/ApprovalStatus.js";
import { ReviewDecision, REVIEW_DECISIONS } from "../value-objects/ReviewDecision.js";
import {
  InvalidValueError,
  InvalidStateTransitionError,
  InvariantViolationError,
} from "../errors/index.js";
import { BaseDomainEvent } from "../events/DomainEvent.js";

// ---------------------------------------------------------------------------
// Review child entity (embedded within the aggregate)
// ---------------------------------------------------------------------------

/**
 * Represents a single review decision within an approval request
 */
export interface Review {
  readonly id: string;
  /**
   * `null` when the reviewer's user row was hard-deleted: the FK is
   * `ON DELETE SET NULL` so the decision survives as approval history.
   * A review added through {@link ApprovalRequestAggregate.addReview} always
   * names its reviewer — only a reconstituted one can have lost it.
   */
  readonly reviewerId: string | null;
  readonly decision: ReviewDecision;
  readonly comment?: string;
  readonly level: number;
  readonly reviewedAt: Date;
}

// ---------------------------------------------------------------------------
// Domain events for ApprovalRequest lifecycle
// ---------------------------------------------------------------------------

/**
 * Event raised when an approval request is created
 */
export class ApprovalRequestCreated extends BaseDomainEvent {
  readonly eventType = "ApprovalRequestCreated";
  readonly aggregateType = "ApprovalRequest";

  constructor(
    readonly aggregateId: string,
    readonly postId: string,
    readonly submitterId: string,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      approvalRequestId: this.aggregateId,
      postId: this.postId,
      submitterId: this.submitterId,
    };
  }
}

/**
 * Event raised when a review is added to an approval request
 */
export class ApprovalReviewAdded extends BaseDomainEvent {
  readonly eventType = "ApprovalReviewAdded";
  readonly aggregateType = "ApprovalRequest";

  constructor(
    readonly aggregateId: string,
    readonly reviewerId: string,
    readonly decision: string,
    readonly level: number = 1,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      approvalRequestId: this.aggregateId,
      reviewerId: this.reviewerId,
      decision: this.decision,
      level: this.level,
    };
  }
}

/**
 * Event raised when an approval request advances to the next level
 */
export class ApprovalLevelAdvanced extends BaseDomainEvent {
  readonly eventType = "ApprovalLevelAdvanced";
  readonly aggregateType = "ApprovalRequest";

  constructor(
    readonly aggregateId: string,
    readonly previousLevel: number,
    readonly newLevel: number,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      approvalRequestId: this.aggregateId,
      previousLevel: this.previousLevel,
      newLevel: this.newLevel,
    };
  }
}

/**
 * Event raised when an approval request reaches a terminal status
 */
export class ApprovalRequestResolved extends BaseDomainEvent {
  readonly eventType = "ApprovalRequestResolved";
  readonly aggregateType = "ApprovalRequest";

  constructor(
    readonly aggregateId: string,
    readonly postId: string,
    readonly resolution: string,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      approvalRequestId: this.aggregateId,
      postId: this.postId,
      resolution: this.resolution,
    };
  }
}

/**
 * Event raised when an approval request is cancelled
 */
export class ApprovalRequestCancelled extends BaseDomainEvent {
  readonly eventType = "ApprovalRequestCancelled";
  readonly aggregateType = "ApprovalRequest";

  constructor(
    readonly aggregateId: string,
    readonly postId: string,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      approvalRequestId: this.aggregateId,
      postId: this.postId,
    };
  }
}

// ---------------------------------------------------------------------------
// Creation and reconstitution props
// ---------------------------------------------------------------------------

/**
 * Input for creating a new approval request
 */
export interface CreateApprovalRequestInput {
  postId: string;
  submitterId: string;
  comment?: string;
  workflowId?: string;
  currentLevel?: number;
  totalLevels?: number;
}

/**
 * Full state for reconstituting an approval request from persistence
 */
export interface ApprovalRequestState {
  id: ApprovalRequestId;
  postId: string;
  /**
   * `null` when the submitter's user row was hard-deleted: the FK is
   * `ON DELETE SET NULL` so the request survives as approval history. Creation
   * still requires a submitter (see {@link CreateApprovalRequestInput}) — only
   * a reconstituted request can have lost one.
   */
  submitterId: string | null;
  status: ApprovalStatus;
  comment?: string;
  workflowId?: string;
  currentLevel: number;
  totalLevels: number;
  reviews: Review[];
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

/**
 * @class ApprovalRequestAggregate
 * @description Aggregate root for content approval requests.
 *   Collects reviews from reviewers and transitions to a terminal status
 *   (APPROVED, REJECTED, or CANCELLED) based on review decisions.
 *
 * @example
 * const result = ApprovalRequestAggregate.create({
 *   postId: 'post-uuid',
 *   submitterId: 'member-uuid',
 *   comment: 'Please review this campaign post',
 * });
 * if (result.ok) {
 *   const request = result.value;
 *   request.addReview('reviewer-uuid', ReviewDecision.approved(), 'Looks good!');
 * }
 */
export class ApprovalRequestAggregate extends AggregateRoot<ApprovalRequestId> {
  private readonly _postId: string;
  private readonly _submitterId: string | null;
  private _status: ApprovalStatus;
  private readonly _comment: string | undefined;
  private readonly _workflowId: string | undefined;
  private _currentLevel: number;
  private readonly _totalLevels: number;
  private readonly _reviews: Review[];

  private constructor(id: ApprovalRequestId, state: Omit<ApprovalRequestState, "id">) {
    super(id, state.createdAt, state.version);
    this._postId = state.postId;
    this._submitterId = state.submitterId;
    this._status = state.status;
    this._comment = state.comment;
    this._workflowId = state.workflowId;
    this._currentLevel = state.currentLevel;
    this._totalLevels = state.totalLevels;
    this._reviews = [...state.reviews];

    if (state.updatedAt) {
      this._updatedAt = state.updatedAt;
    }
  }

  // --- Getters ---

  get entityType(): string {
    return "ApprovalRequestAggregate";
  }

  /** @description The post this approval request is for */
  get postId(): string {
    return this._postId;
  }

  /**
   * @description The team member who submitted the request, or `null` when
   *   that user has been erased and the request survives as approval history.
   */
  get submitterId(): string | null {
    return this._submitterId;
  }

  /** @description Current approval status */
  get status(): ApprovalStatus {
    return this._status;
  }

  /** @description Optional comment from the submitter */
  get comment(): string | undefined {
    return this._comment;
  }

  /** @description All reviews collected so far */
  get reviews(): readonly Review[] {
    return [...this._reviews];
  }

  /** @description Whether this request is still pending */
  get isPending(): boolean {
    return this._status.isPending();
  }

  /** @description Whether this request has been approved */
  get isApproved(): boolean {
    return this._status.isApproved();
  }

  /** @description Whether this request has been rejected */
  get isRejected(): boolean {
    return this._status.isRejected();
  }

  /** @description Whether this request has reached a terminal state */
  get isTerminal(): boolean {
    return this._status.isTerminal();
  }

  /** @description The workflow ID if using a multi-level workflow */
  get workflowId(): string | undefined {
    return this._workflowId;
  }

  /** @description The current approval level (1-indexed) */
  get currentLevel(): number {
    return this._currentLevel;
  }

  /** @description The total number of approval levels */
  get totalLevels(): number {
    return this._totalLevels;
  }

  /** @description Whether this is a multi-level approval request */
  get isMultiLevel(): boolean {
    return this._totalLevels > 1;
  }

  // --- Factory ---

  /**
   * @method create
   * @description Creates a new approval request for a post.
   * @param input - Creation parameters (postId, submitterId, optional comment)
   * @returns Result containing the new aggregate on success, InvalidValueError on failure
   */
  static create(
    input: CreateApprovalRequestInput
  ): Result<ApprovalRequestAggregate, InvalidValueError> {
    if (!input.postId || input.postId.trim().length === 0) {
      return err(new InvalidValueError("postId", input.postId, "Post ID is required"));
    }
    if (!input.submitterId || input.submitterId.trim().length === 0) {
      return err(
        new InvalidValueError("submitterId", input.submitterId, "Submitter ID is required")
      );
    }

    const id = ApprovalRequestId.generate();
    const now = new Date();

    const aggregate = new ApprovalRequestAggregate(id, {
      postId: input.postId,
      submitterId: input.submitterId,
      status: ApprovalStatus.pending(),
      ...(input.comment !== undefined && { comment: input.comment }),
      ...(input.workflowId !== undefined && { workflowId: input.workflowId }),
      currentLevel: input.currentLevel ?? 1,
      totalLevels: input.totalLevels ?? 1,
      reviews: [],
      createdAt: now,
      updatedAt: now,
      version: 0,
    });

    aggregate.addDomainEvent(new ApprovalRequestCreated(id.value, input.postId, input.submitterId));

    return ok(aggregate);
  }

  // --- Reconstitution ---

  /**
   * @method reconstitute
   * @description Rebuilds an ApprovalRequestAggregate from persisted state without validation.
   * @param state - The full aggregate state from the data store
   * @returns A reconstituted ApprovalRequestAggregate
   */
  static reconstitute(state: ApprovalRequestState): ApprovalRequestAggregate {
    return new ApprovalRequestAggregate(state.id, state);
  }

  // --- Behavior ---

  /**
   * @method addReview
   * @description Adds a review from a reviewer. If the decision is APPROVED, the request
   *   transitions to APPROVED. If REJECTED or CHANGES_REQUESTED, it transitions to REJECTED.
   * @param reviewerId - The ID of the reviewer
   * @param decision - The review decision value object
   * @param comment - Optional comment from the reviewer
   * @returns Result<void> on success, error if the request is not pending or reviewer is submitter
   */
  addReview(
    reviewerId: string,
    decision: ReviewDecision,
    comment?: string
  ): Result<void, InvalidStateTransitionError | InvariantViolationError> {
    if (!this._status.isPending()) {
      return err(
        new InvalidStateTransitionError(this._status.value, "ADD_REVIEW", "ApprovalRequest")
      );
    }

    if (reviewerId === this._submitterId) {
      return err(new InvariantViolationError("Submitter cannot review their own request"));
    }

    // Check if this reviewer already submitted a review
    const existingReview = this._reviews.find((r) => r.reviewerId === reviewerId);
    if (existingReview) {
      return err(
        new InvariantViolationError("Reviewer has already submitted a review for this request")
      );
    }

    const review: Review = {
      id: randomUUID(),
      reviewerId,
      decision,
      ...(comment !== undefined && { comment }),
      level: this._currentLevel,
      reviewedAt: new Date(),
    };

    this._reviews.push(review);
    this.markUpdated();

    this.addDomainEvent(
      new ApprovalReviewAdded(this._id.value, reviewerId, decision.value, this._currentLevel)
    );

    // Rejection at any level terminates the request immediately
    if (decision.isRejection()) {
      const transitionResult = this._status.transitionTo(APPROVAL_STATUSES.REJECTED);
      if (transitionResult.ok) {
        this._status = transitionResult.value;
        this.addDomainEvent(
          new ApprovalRequestResolved(this._id.value, this._postId, REVIEW_DECISIONS.REJECTED)
        );
      }
    } else if (decision.isApproval()) {
      // For multi-level: if this is not the last level, advance
      if (this._currentLevel < this._totalLevels) {
        const previousLevel = this._currentLevel;
        this._currentLevel += 1;
        this.addDomainEvent(
          new ApprovalLevelAdvanced(this._id.value, previousLevel, this._currentLevel)
        );
      } else {
        // Last level (or single-level): mark as APPROVED
        const transitionResult = this._status.transitionTo(APPROVAL_STATUSES.APPROVED);
        if (transitionResult.ok) {
          this._status = transitionResult.value;
          this.addDomainEvent(
            new ApprovalRequestResolved(this._id.value, this._postId, REVIEW_DECISIONS.APPROVED)
          );
        }
      }
    }

    return ok(undefined);
  }

  /**
   * @method cancel
   * @description Cancels the approval request. Only valid when status is PENDING.
   * @returns Result<void> on success, InvalidStateTransitionError if not in PENDING state
   */
  cancel(): Result<void, InvalidStateTransitionError> {
    if (!this._status.canTransitionTo(APPROVAL_STATUSES.CANCELLED)) {
      return err(
        new InvalidStateTransitionError(
          this._status.value,
          APPROVAL_STATUSES.CANCELLED,
          "ApprovalRequest"
        )
      );
    }

    const transitionResult = this._status.transitionTo(APPROVAL_STATUSES.CANCELLED);
    if (!transitionResult.ok) return err(transitionResult.error);

    this._status = transitionResult.value;
    this.markUpdated();

    this.addDomainEvent(new ApprovalRequestCancelled(this._id.value, this._postId));

    return ok(undefined);
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this._id.toString(),
      postId: this._postId,
      submitterId: this._submitterId,
      status: this._status.value,
      ...(this._comment !== undefined && { comment: this._comment }),
      ...(this._workflowId !== undefined && { workflowId: this._workflowId }),
      currentLevel: this._currentLevel,
      totalLevels: this._totalLevels,
      reviews: this._reviews.map((r) => ({
        id: r.id,
        reviewerId: r.reviewerId,
        decision: r.decision.value,
        ...(r.comment !== undefined && { comment: r.comment }),
        level: r.level,
        reviewedAt: r.reviewedAt.toISOString(),
      })),
      version: this.version,
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }
}
