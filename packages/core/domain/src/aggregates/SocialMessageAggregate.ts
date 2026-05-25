/**
 * @file SocialMessageAggregate.ts
 * @description Aggregate root for the Social Inbox feature. Manages the lifecycle
 *   of incoming social messages (comments, mentions, DMs, replies) including
 *   status transitions, assignment, and conversation linking.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { AggregateRoot } from "./AggregateRoot.js";
import { SocialMessageId } from "../value-objects/SocialMessageId.js";
import { SocialConversationId } from "../value-objects/SocialConversationId.js";
import { AccountId, ProjectId, ChannelId } from "../value-objects/EntityId.js";
import {
  SocialMessageType,
  type SocialMessageTypeValue,
} from "../value-objects/SocialMessageType.js";
import {
  SocialMessageStatus,
  SOCIAL_MESSAGE_STATUSES,
} from "../value-objects/SocialMessageStatus.js";
import { type ProviderType } from "../value-objects/Provider.js";
import {
  type DomainError,
  InvalidValueError,
  InvalidStateTransitionError,
} from "../errors/index.js";
import { BaseDomainEvent } from "../events/DomainEvent.js";

// ---------------------------------------------------------------------------
// Domain Events
// ---------------------------------------------------------------------------

/**
 * Event raised when a new social message is received from a provider webhook.
 */
export class SocialMessageReceived extends BaseDomainEvent {
  readonly eventType = "SocialMessageReceived";
  readonly aggregateType = "SocialMessage";

  constructor(
    readonly aggregateId: string,
    readonly accountId: string,
    readonly projectId: string,
    readonly channelId: string,
    readonly provider: ProviderType,
    readonly messageType: SocialMessageTypeValue,
    readonly authorName: string,
    readonly body: string,
    version: number = 1
  ) {
    super(version);
  }

  /** @method toPayload @description Serializes event data for outbox persistence. */
  toPayload(): Record<string, unknown> {
    return {
      messageId: this.aggregateId,
      accountId: this.accountId,
      projectId: this.projectId,
      channelId: this.channelId,
      provider: this.provider,
      messageType: this.messageType,
      authorName: this.authorName,
      body: this.body,
    };
  }
}

/**
 * Event raised when a social message is marked as read.
 */
export class SocialMessageRead extends BaseDomainEvent {
  readonly eventType = "SocialMessageRead";
  readonly aggregateType = "SocialMessage";

  constructor(
    readonly aggregateId: string,
    version: number = 1
  ) {
    super(version);
  }

  /** @method toPayload @description Serializes event data for outbox persistence. */
  toPayload(): Record<string, unknown> {
    return { messageId: this.aggregateId };
  }
}

/**
 * Event raised when a social message is replied to.
 */
export class SocialMessageReplied extends BaseDomainEvent {
  readonly eventType = "SocialMessageReplied";
  readonly aggregateType = "SocialMessage";

  constructor(
    readonly aggregateId: string,
    version: number = 1
  ) {
    super(version);
  }

  /** @method toPayload @description Serializes event data for outbox persistence. */
  toPayload(): Record<string, unknown> {
    return { messageId: this.aggregateId };
  }
}

/**
 * Event raised when a social message is assigned to a team member.
 */
export class SocialMessageAssigned extends BaseDomainEvent {
  readonly eventType = "SocialMessageAssigned";
  readonly aggregateType = "SocialMessage";

  constructor(
    readonly aggregateId: string,
    readonly assigneeId: string,
    version: number = 1
  ) {
    super(version);
  }

  /** @method toPayload @description Serializes event data for outbox persistence. */
  toPayload(): Record<string, unknown> {
    return {
      messageId: this.aggregateId,
      assigneeId: this.assigneeId,
    };
  }
}

/**
 * Event raised when a social message is archived.
 */
export class SocialMessageArchived extends BaseDomainEvent {
  readonly eventType = "SocialMessageArchived";
  readonly aggregateType = "SocialMessage";

  constructor(
    readonly aggregateId: string,
    version: number = 1
  ) {
    super(version);
  }

  /** @method toPayload @description Serializes event data for outbox persistence. */
  toPayload(): Record<string, unknown> {
    return { messageId: this.aggregateId };
  }
}

/**
 * Union type of all SocialMessage domain events.
 */
export type SocialMessageEvent =
  | SocialMessageReceived
  | SocialMessageRead
  | SocialMessageReplied
  | SocialMessageAssigned
  | SocialMessageArchived;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Input for creating a new SocialMessage aggregate via the factory method.
 */
export interface CreateSocialMessageInput {
  accountId: AccountId;
  projectId: ProjectId;
  channelId: ChannelId;
  provider: ProviderType;
  providerMessageId: string;
  providerParentId?: string;
  messageType: SocialMessageType;
  authorName: string;
  authorHandle?: string;
  authorAvatarUrl?: string;
  authorProviderId: string;
  body: string;
  mediaUrls?: string[];
  webhookEventId?: string;
  relatedPostId?: string;
  providerCreatedAt: Date;
}

/**
 * Complete state snapshot used to reconstitute the aggregate from persistence.
 */
export interface SocialMessageState {
  id: SocialMessageId;
  accountId: AccountId;
  projectId: ProjectId;
  channelId: ChannelId;
  conversationId: SocialConversationId | null;
  provider: ProviderType;
  providerMessageId: string;
  providerParentId: string | null;
  messageType: SocialMessageType;
  authorName: string;
  authorHandle: string | null;
  authorAvatarUrl: string | null;
  authorProviderId: string;
  body: string;
  mediaUrls: string[];
  webhookEventId: string | null;
  relatedPostId: string | null;
  status: SocialMessageStatus;
  assigneeId: string | null;
  isArchived: boolean;
  providerCreatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

// ---------------------------------------------------------------------------
// Aggregate Root
// ---------------------------------------------------------------------------

/**
 * @class SocialMessageAggregate
 * @description Aggregate root for the Social Inbox bounded context. Manages
 *   the full lifecycle of an incoming social message: reception, read/reply
 *   status transitions, team assignment, conversation linking, and archival.
 *
 * @example
 * const result = SocialMessageAggregate.create({
 *   accountId, projectId, channelId,
 *   provider: "X",
 *   providerMessageId: "ext-123",
 *   messageType: SocialMessageType.comment(),
 *   authorName: "Jane",
 *   authorProviderId: "provider-user-1",
 *   body: "Great post!",
 *   providerCreatedAt: new Date(),
 * });
 * if (result.ok) {
 *   const msg = result.value;
 *   msg.markAsRead();
 * }
 */
export class SocialMessageAggregate extends AggregateRoot<SocialMessageId> {
  private _accountId: AccountId;
  private _projectId: ProjectId;
  private _channelId: ChannelId;
  private _conversationId: SocialConversationId | null;
  private _provider: ProviderType;
  private _providerMessageId: string;
  private _providerParentId: string | null;
  private _messageType: SocialMessageType;
  private _authorName: string;
  private _authorHandle: string | null;
  private _authorAvatarUrl: string | null;
  private _authorProviderId: string;
  private _body: string;
  private _mediaUrls: string[];
  private _webhookEventId: string | null;
  private _relatedPostId: string | null;
  private _status: SocialMessageStatus;
  private _assigneeId: string | null;
  private _isArchived: boolean;
  private _providerCreatedAt: Date;

  private constructor(id: SocialMessageId, state: Omit<SocialMessageState, "id">) {
    super(id, state.createdAt, state.version);
    this._accountId = state.accountId;
    this._projectId = state.projectId;
    this._channelId = state.channelId;
    this._conversationId = state.conversationId;
    this._provider = state.provider;
    this._providerMessageId = state.providerMessageId;
    this._providerParentId = state.providerParentId;
    this._messageType = state.messageType;
    this._authorName = state.authorName;
    this._authorHandle = state.authorHandle;
    this._authorAvatarUrl = state.authorAvatarUrl;
    this._authorProviderId = state.authorProviderId;
    this._body = state.body;
    this._mediaUrls = [...state.mediaUrls];
    this._webhookEventId = state.webhookEventId;
    this._relatedPostId = state.relatedPostId;
    this._status = state.status;
    this._assigneeId = state.assigneeId;
    this._isArchived = state.isArchived;
    this._providerCreatedAt = state.providerCreatedAt;

    if (state.updatedAt) {
      this._updatedAt = state.updatedAt;
    }
  }

  // -------------------------------------------------------------------------
  // Factory methods
  // -------------------------------------------------------------------------

  /**
   * @method create
   * @description Creates a new SocialMessage aggregate with UNREAD status.
   *   Validates required fields and emits a SocialMessageReceived domain event.
   * @param input - Validated creation parameters from the application layer
   * @returns Result<SocialMessageAggregate> on success, InvalidValueError on failure
   */
  static create(input: CreateSocialMessageInput): Result<SocialMessageAggregate, DomainError> {
    if (!input.providerMessageId || input.providerMessageId.trim().length === 0) {
      return err(
        new InvalidValueError(
          "providerMessageId",
          input.providerMessageId,
          "Provider message ID must not be empty"
        )
      );
    }

    if (!input.authorName || input.authorName.trim().length === 0) {
      return err(
        new InvalidValueError("authorName", input.authorName, "Author name must not be empty")
      );
    }

    if (!input.authorProviderId || input.authorProviderId.trim().length === 0) {
      return err(
        new InvalidValueError(
          "authorProviderId",
          input.authorProviderId,
          "Author provider ID must not be empty"
        )
      );
    }

    if (!input.body || input.body.trim().length === 0) {
      return err(new InvalidValueError("body", input.body, "Message body must not be empty"));
    }

    const messageId = SocialMessageId.generate();
    const now = new Date();

    const aggregate = new SocialMessageAggregate(messageId, {
      accountId: input.accountId,
      projectId: input.projectId,
      channelId: input.channelId,
      conversationId: null,
      provider: input.provider,
      providerMessageId: input.providerMessageId.trim(),
      providerParentId: input.providerParentId ?? null,
      messageType: input.messageType,
      authorName: input.authorName.trim(),
      authorHandle: input.authorHandle ?? null,
      authorAvatarUrl: input.authorAvatarUrl ?? null,
      authorProviderId: input.authorProviderId.trim(),
      body: input.body,
      mediaUrls: input.mediaUrls ? [...input.mediaUrls] : [],
      webhookEventId: input.webhookEventId ?? null,
      relatedPostId: input.relatedPostId ?? null,
      status: SocialMessageStatus.unread(),
      assigneeId: null,
      isArchived: false,
      providerCreatedAt: input.providerCreatedAt,
      createdAt: now,
      updatedAt: now,
      version: 0,
    });

    aggregate.addDomainEvent(
      new SocialMessageReceived(
        messageId.value,
        input.accountId.value,
        input.projectId.value,
        input.channelId.value,
        input.provider,
        input.messageType.value,
        input.authorName.trim(),
        input.body
      )
    );

    return ok(aggregate);
  }

  /**
   * @method reconstitute
   * @description Rebuilds the aggregate from persisted state without emitting events.
   *   Used exclusively by the repository adapter when loading from the database.
   * @param state - Complete snapshot of the aggregate's persisted state
   * @returns A fully hydrated SocialMessageAggregate instance
   */
  static reconstitute(state: SocialMessageState): SocialMessageAggregate {
    return new SocialMessageAggregate(state.id, state);
  }

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  /** @method entityType @description Returns the aggregate type name for logging. */
  get entityType(): string {
    return "SocialMessageAggregate";
  }

  /** @method accountId @description Returns the owning account identifier. */
  get accountId(): AccountId {
    return this._accountId;
  }

  /** @method projectId @description Returns the parent project identifier. */
  get projectId(): ProjectId {
    return this._projectId;
  }

  /** @method channelId @description Returns the channel this message arrived on. */
  get channelId(): ChannelId {
    return this._channelId;
  }

  /** @method conversationId @description Returns the linked conversation ID, or null. */
  get conversationId(): SocialConversationId | null {
    return this._conversationId;
  }

  /** @method provider @description Returns the social media provider type. */
  get provider(): ProviderType {
    return this._provider;
  }

  /** @method providerMessageId @description Returns the external message ID from the provider. */
  get providerMessageId(): string {
    return this._providerMessageId;
  }

  /** @method providerParentId @description Returns the parent message ID on the provider, or null. */
  get providerParentId(): string | null {
    return this._providerParentId;
  }

  /** @method messageType @description Returns the social message type value object. */
  get messageType(): SocialMessageType {
    return this._messageType;
  }

  /** @method authorName @description Returns the message author's display name. */
  get authorName(): string {
    return this._authorName;
  }

  /** @method authorHandle @description Returns the author's handle/username, or null. */
  get authorHandle(): string | null {
    return this._authorHandle;
  }

  /** @method authorAvatarUrl @description Returns the author's avatar URL, or null. */
  get authorAvatarUrl(): string | null {
    return this._authorAvatarUrl;
  }

  /** @method authorProviderId @description Returns the author's provider-side user ID. */
  get authorProviderId(): string {
    return this._authorProviderId;
  }

  /** @method body @description Returns the message body text. */
  get body(): string {
    return this._body;
  }

  /** @method mediaUrls @description Returns a defensive copy of attached media URLs. */
  get mediaUrls(): readonly string[] {
    return [...this._mediaUrls];
  }

  /** @method webhookEventId @description Returns the originating webhook event ID, or null. */
  get webhookEventId(): string | null {
    return this._webhookEventId;
  }

  /** @method relatedPostId @description Returns the related OmniPost post ID, or null. */
  get relatedPostId(): string | null {
    return this._relatedPostId;
  }

  /** @method status @description Returns the current message status value object. */
  get status(): SocialMessageStatus {
    return this._status;
  }

  /** @method assigneeId @description Returns the assigned team member ID, or null. */
  get assigneeId(): string | null {
    return this._assigneeId;
  }

  /** @method isArchived @description Returns whether the message has been archived. */
  get isArchived(): boolean {
    return this._isArchived;
  }

  /** @method providerCreatedAt @description Returns the timestamp from the provider. */
  get providerCreatedAt(): Date {
    return new Date(this._providerCreatedAt.getTime());
  }

  // -------------------------------------------------------------------------
  // Status predicates
  // -------------------------------------------------------------------------

  /** @method isUnread @description Returns true if the message is in UNREAD status. */
  get isUnread(): boolean {
    return this._status.isUnread();
  }

  /** @method isRead @description Returns true if the message is in READ status. */
  get isRead(): boolean {
    return this._status.isRead();
  }

  /** @method isReplied @description Returns true if the message is in REPLIED status. */
  get isReplied(): boolean {
    return this._status.isReplied();
  }

  /** @method isAssigned @description Returns true if the message is assigned to someone. */
  get isAssigned(): boolean {
    return this._assigneeId !== null;
  }

  // -------------------------------------------------------------------------
  // Behavior methods
  // -------------------------------------------------------------------------

  /**
   * @method markAsRead
   * @description Transitions message status from UNREAD to READ.
   *   Emits a SocialMessageRead domain event on success.
   * @returns Result<void> on success, InvalidStateTransitionError if transition is invalid
   */
  markAsRead(): Result<void, DomainError> {
    if (!this._status.canTransitionTo(SOCIAL_MESSAGE_STATUSES.READ)) {
      return err(
        new InvalidStateTransitionError(
          this._status.value,
          SOCIAL_MESSAGE_STATUSES.READ,
          "SocialMessage"
        )
      );
    }

    const transitionResult = this._status.transitionTo(SOCIAL_MESSAGE_STATUSES.READ);
    if (!transitionResult.ok) {
      return err(transitionResult.error);
    }

    this._status = transitionResult.value;
    this.markUpdated();

    this.addDomainEvent(new SocialMessageRead(this._id.value));

    return ok(undefined);
  }

  /**
   * @method markAsReplied
   * @description Transitions message status from READ to REPLIED.
   *   Emits a SocialMessageReplied domain event on success.
   * @returns Result<void> on success, InvalidStateTransitionError if transition is invalid
   */
  markAsReplied(): Result<void, DomainError> {
    if (!this._status.canTransitionTo(SOCIAL_MESSAGE_STATUSES.REPLIED)) {
      return err(
        new InvalidStateTransitionError(
          this._status.value,
          SOCIAL_MESSAGE_STATUSES.REPLIED,
          "SocialMessage"
        )
      );
    }

    const transitionResult = this._status.transitionTo(SOCIAL_MESSAGE_STATUSES.REPLIED);
    if (!transitionResult.ok) {
      return err(transitionResult.error);
    }

    this._status = transitionResult.value;
    this.markUpdated();

    this.addDomainEvent(new SocialMessageReplied(this._id.value));

    return ok(undefined);
  }

  /**
   * @method archive
   * @description Transitions message status to ARCHIVED from any non-terminal state.
   *   Sets the isArchived flag and emits a SocialMessageArchived domain event.
   * @returns Result<void> on success, InvalidStateTransitionError if already archived
   */
  archive(): Result<void, DomainError> {
    if (!this._status.canTransitionTo(SOCIAL_MESSAGE_STATUSES.ARCHIVED)) {
      return err(
        new InvalidStateTransitionError(
          this._status.value,
          SOCIAL_MESSAGE_STATUSES.ARCHIVED,
          "SocialMessage"
        )
      );
    }

    const transitionResult = this._status.transitionTo(SOCIAL_MESSAGE_STATUSES.ARCHIVED);
    if (!transitionResult.ok) {
      return err(transitionResult.error);
    }

    this._status = transitionResult.value;
    this._isArchived = true;
    this.markUpdated();

    this.addDomainEvent(new SocialMessageArchived(this._id.value));

    return ok(undefined);
  }

  /**
   * @method assign
   * @description Assigns this message to a team member for handling.
   *   Emits a SocialMessageAssigned domain event on success.
   * @param teamMemberId - The ID of the team member to assign
   * @returns Result<void> on success, InvalidValueError if teamMemberId is empty
   */
  assign(teamMemberId: string): Result<void, DomainError> {
    if (!teamMemberId || teamMemberId.trim().length === 0) {
      return err(
        new InvalidValueError("teamMemberId", teamMemberId, "Assignee ID must not be empty")
      );
    }

    this._assigneeId = teamMemberId.trim();
    this.markUpdated();

    this.addDomainEvent(new SocialMessageAssigned(this._id.value, this._assigneeId));

    return ok(undefined);
  }

  /**
   * @method unassign
   * @description Removes the current team member assignment from this message.
   * @returns Result<void> always succeeds
   */
  unassign(): Result<void, DomainError> {
    this._assigneeId = null;
    this.markUpdated();

    return ok(undefined);
  }

  /**
   * @method setConversationId
   * @description Links this message to a conversation thread.
   * @param id - The conversation identifier to link
   * @returns Result<void> always succeeds
   */
  setConversationId(id: SocialConversationId): Result<void, DomainError> {
    this._conversationId = id;
    this.markUpdated();

    return ok(undefined);
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  /**
   * @method toJSON
   * @description Converts the aggregate to a plain object for serialization and logging.
   * @returns A record containing all aggregate state as primitive values
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this._id.value,
      accountId: this._accountId.value,
      projectId: this._projectId.value,
      channelId: this._channelId.value,
      ...(this._conversationId !== null && { conversationId: this._conversationId.value }),
      provider: this._provider,
      providerMessageId: this._providerMessageId,
      ...(this._providerParentId !== null && { providerParentId: this._providerParentId }),
      messageType: this._messageType.value,
      authorName: this._authorName,
      ...(this._authorHandle !== null && { authorHandle: this._authorHandle }),
      ...(this._authorAvatarUrl !== null && { authorAvatarUrl: this._authorAvatarUrl }),
      authorProviderId: this._authorProviderId,
      body: this._body,
      mediaUrls: [...this._mediaUrls],
      ...(this._webhookEventId !== null && { webhookEventId: this._webhookEventId }),
      ...(this._relatedPostId !== null && { relatedPostId: this._relatedPostId }),
      status: this._status.value,
      ...(this._assigneeId !== null && { assigneeId: this._assigneeId }),
      isArchived: this._isArchived,
      providerCreatedAt: this._providerCreatedAt.toISOString(),
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
      version: this.version,
    };
  }
}
