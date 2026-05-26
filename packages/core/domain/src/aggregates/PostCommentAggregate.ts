/**
 * @file PostCommentAggregate.ts
 * @description Aggregate root for in-context comments on posts.
 *   Manages the lifecycle of a comment: creation, editing, and soft-deletion.
 *   Supports threaded replies via an optional parentId and extracts @mentions
 *   from the comment body.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { AggregateRoot } from "./AggregateRoot.js";
import { CommentId } from "../value-objects/CommentId.js";
import { InvalidValueError, InvariantViolationError } from "../errors/index.js";
import { BaseDomainEvent } from "../events/DomainEvent.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BODY_LENGTH = 2000;
const MENTION_REGEX = /@(\w+)/g;

// ---------------------------------------------------------------------------
// Domain events for PostComment lifecycle
// ---------------------------------------------------------------------------

/**
 * Event raised when a new comment is added to a post
 */
export class CommentAdded extends BaseDomainEvent {
  readonly eventType = "CommentAdded";
  readonly aggregateType = "PostComment";

  constructor(
    readonly aggregateId: string,
    readonly postId: string,
    readonly authorId: string,
    readonly mentions: string[],
    readonly parentId?: string,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      commentId: this.aggregateId,
      postId: this.postId,
      authorId: this.authorId,
      mentions: this.mentions,
      ...(this.parentId !== undefined && { parentId: this.parentId }),
    };
  }
}

/**
 * Event raised when a comment body is edited
 */
export class CommentEdited extends BaseDomainEvent {
  readonly eventType = "CommentEdited";
  readonly aggregateType = "PostComment";

  constructor(
    readonly aggregateId: string,
    readonly authorId: string,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      commentId: this.aggregateId,
      authorId: this.authorId,
    };
  }
}

/**
 * Event raised when a comment is soft-deleted
 */
export class CommentDeleted extends BaseDomainEvent {
  readonly eventType = "CommentDeleted";
  readonly aggregateType = "PostComment";

  constructor(
    readonly aggregateId: string,
    readonly deleterId: string,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      commentId: this.aggregateId,
      deleterId: this.deleterId,
    };
  }
}

// ---------------------------------------------------------------------------
// Creation and reconstitution props
// ---------------------------------------------------------------------------

/**
 * Input for creating a new post comment
 */
export interface CreateCommentProps {
  postId: string;
  authorId: string;
  body: string;
  parentId?: string;
}

/**
 * Full state for reconstituting a post comment from persistence
 */
export interface PostCommentState {
  id: CommentId;
  postId: string;
  authorId: string;
  body: string;
  mentions: string[];
  isEdited: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  parentId?: string;
  editedAt?: Date;
  deletedAt?: Date;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * @function extractMentions
 * @description Extracts unique @mention usernames from a text body.
 * @param text - The text to scan for mentions
 * @returns Deduplicated array of mentioned usernames (without the @ symbol)
 */
function extractMentions(text: string): string[] {
  const matches: string[] = [];
  let match: RegExpExecArray | null = MENTION_REGEX.exec(text);

  while (match !== null) {
    const username = match[1];
    if (username && !matches.includes(username)) {
      matches.push(username);
    }
    match = MENTION_REGEX.exec(text);
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

/**
 * @class PostCommentAggregate
 * @description Aggregate root for in-context post comments.
 *   Supports creation, editing (author-only), and soft-deletion (author or admin).
 *   Threaded replies are modeled via an optional parentId reference.
 *
 * @example
 * const result = PostCommentAggregate.create({
 *   postId: 'post-uuid',
 *   authorId: 'member-uuid',
 *   body: 'Great post @john! cc @jane',
 * });
 * if (result.ok) {
 *   const comment = result.value;
 *   // comment.mentions => ['john', 'jane']
 * }
 */
export class PostCommentAggregate extends AggregateRoot<CommentId> {
  private readonly _postId: string;
  private readonly _authorId: string;
  private readonly _parentId: string | undefined;
  private _body: string;
  private _mentions: string[];
  private _isEdited: boolean;
  private _editedAt: Date | undefined;
  private _deletedAt: Date | undefined;

  private constructor(id: CommentId, state: Omit<PostCommentState, "id">) {
    super(id, state.createdAt, state.version);
    this._postId = state.postId;
    this._authorId = state.authorId;
    this._parentId = state.parentId;
    this._body = state.body;
    this._mentions = [...state.mentions];
    this._isEdited = state.isEdited;

    if (state.updatedAt) {
      this._updatedAt = state.updatedAt;
    }
    if (state.editedAt !== undefined) {
      this._editedAt = state.editedAt;
    }
    if (state.deletedAt !== undefined) {
      this._deletedAt = state.deletedAt;
    }
  }

  // --- Getters ---

  get entityType(): string {
    return "PostCommentAggregate";
  }

  /** @description The post this comment belongs to */
  get postId(): string {
    return this._postId;
  }

  /** @description The team member who authored this comment */
  get authorId(): string {
    return this._authorId;
  }

  /** @description The parent comment ID for threaded replies */
  get parentId(): string | undefined {
    return this._parentId;
  }

  /** @description The comment body text */
  get body(): string {
    return this._body;
  }

  /** @description Extracted @mentions from the body */
  get mentions(): readonly string[] {
    return [...this._mentions];
  }

  /** @description Whether this comment has been edited */
  get isEdited(): boolean {
    return this._isEdited;
  }

  /** @description When this comment was last edited */
  get editedAt(): Date | undefined {
    return this._editedAt;
  }

  /** @description When this comment was soft-deleted */
  get deletedAt(): Date | undefined {
    return this._deletedAt;
  }

  // --- Factory ---

  /**
   * @method create
   * @description Creates a new post comment, validating all required fields
   *   and extracting @mentions from the body.
   * @param props - Creation parameters (postId, authorId, body, optional parentId)
   * @returns Result containing the new aggregate on success, InvalidValueError on failure
   */
  static create(props: CreateCommentProps): Result<PostCommentAggregate, InvalidValueError> {
    if (!props.postId || props.postId.trim().length === 0) {
      return err(new InvalidValueError("postId", props.postId, "Post ID is required"));
    }
    if (!props.authorId || props.authorId.trim().length === 0) {
      return err(new InvalidValueError("authorId", props.authorId, "Author ID is required"));
    }
    if (!props.body || props.body.trim().length === 0) {
      return err(new InvalidValueError("body", props.body, "Comment body is required"));
    }
    if (props.body.length > MAX_BODY_LENGTH) {
      return err(
        new InvalidValueError(
          "body",
          `(${props.body.length} chars)`,
          `Comment body exceeds maximum length of ${MAX_BODY_LENGTH} characters`
        )
      );
    }

    const id = CommentId.generate();
    const now = new Date();
    const mentions = extractMentions(props.body);

    const aggregate = new PostCommentAggregate(id, {
      postId: props.postId,
      authorId: props.authorId,
      ...(props.parentId !== undefined && { parentId: props.parentId }),
      body: props.body.trim(),
      mentions,
      isEdited: false,
      createdAt: now,
      updatedAt: now,
      version: 0,
    });

    aggregate.addDomainEvent(
      new CommentAdded(id.value, props.postId, props.authorId, mentions, props.parentId)
    );

    return ok(aggregate);
  }

  // --- Reconstitution ---

  /**
   * @method reconstitute
   * @description Rebuilds a PostCommentAggregate from persisted state without validation.
   * @param state - The full aggregate state from the data store
   * @returns A reconstituted PostCommentAggregate
   */
  static reconstitute(state: PostCommentState): PostCommentAggregate {
    return new PostCommentAggregate(state.id, state);
  }

  // --- Behavior ---

  /**
   * @method editBody
   * @description Edits the comment body. Only the original author can edit.
   *   Updates the body, re-extracts mentions, and marks the comment as edited.
   * @param newBody - The new comment body text
   * @param editorId - The ID of the user attempting to edit
   * @returns Result<void> on success, error if editor is not the author or body is invalid
   */
  editBody(
    newBody: string,
    editorId: string
  ): Result<void, InvalidValueError | InvariantViolationError> {
    if (this._deletedAt !== undefined) {
      return err(new InvariantViolationError("Cannot edit a deleted comment"));
    }

    if (editorId !== this._authorId) {
      return err(new InvariantViolationError("Only the comment author can edit the comment"));
    }

    if (!newBody || newBody.trim().length === 0) {
      return err(new InvalidValueError("body", newBody, "Comment body is required"));
    }

    if (newBody.length > MAX_BODY_LENGTH) {
      return err(
        new InvalidValueError(
          "body",
          `(${newBody.length} chars)`,
          `Comment body exceeds maximum length of ${MAX_BODY_LENGTH} characters`
        )
      );
    }

    this._body = newBody.trim();
    this._mentions = extractMentions(newBody);
    this._isEdited = true;
    this._editedAt = new Date();
    this.markUpdated();

    this.addDomainEvent(new CommentEdited(this._id.value, this._authorId));

    return ok(undefined);
  }

  /**
   * @method softDelete
   * @description Soft-deletes the comment. The author or an admin can delete.
   * @param deleterId - The ID of the user attempting to delete
   * @param isAdmin - Whether the deleter has admin privileges
   * @returns Result<void> on success, error if the deleter lacks permission or comment is already deleted
   */
  softDelete(deleterId: string, isAdmin: boolean): Result<void, InvariantViolationError> {
    if (this._deletedAt !== undefined) {
      return err(new InvariantViolationError("Comment is already deleted"));
    }

    if (deleterId !== this._authorId && !isAdmin) {
      return err(
        new InvariantViolationError("Only the comment author or an admin can delete the comment")
      );
    }

    this._deletedAt = new Date();
    this.markUpdated();

    this.addDomainEvent(new CommentDeleted(this._id.value, deleterId));

    return ok(undefined);
  }

  /**
   * @method isDeleted
   * @description Checks whether this comment has been soft-deleted.
   * @returns true if deletedAt is set
   */
  isDeleted(): boolean {
    return this._deletedAt !== undefined;
  }

  /**
   * @method isReply
   * @description Checks whether this comment is a reply to another comment.
   * @returns true if parentId is set
   */
  isReply(): boolean {
    return this._parentId !== undefined;
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this._id.toString(),
      postId: this._postId,
      authorId: this._authorId,
      ...(this._parentId !== undefined && { parentId: this._parentId }),
      body: this._body,
      mentions: [...this._mentions],
      isEdited: this._isEdited,
      ...(this._editedAt !== undefined && {
        editedAt: this._editedAt.toISOString(),
      }),
      ...(this._deletedAt !== undefined && {
        deletedAt: this._deletedAt.toISOString(),
      }),
      version: this.version,
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }
}
