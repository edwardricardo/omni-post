/**
 * @file SocialConversation.ts
 * @description Domain entity representing a threaded conversation in the Social Inbox.
 *   Groups SocialMessages by thread (rootProviderMessageId).
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { Entity } from "./Entity.js";
import { SocialConversationId } from "../value-objects/SocialConversationId.js";
import { type ProviderType } from "../value-objects/Provider.js";
import { type AccountId } from "../value-objects/EntityId.js";
import { type ProjectId } from "../value-objects/EntityId.js";
import { type ChannelId } from "../value-objects/EntityId.js";
import { InvalidValueError } from "../errors/index.js";
import { BaseDomainEvent } from "../events/DomainEvent.js";

// ── Domain Events ──────────────────────────────────────────────────────

/**
 * @class ConversationResolved
 * @description Emitted when a conversation is marked as resolved.
 */
export class ConversationResolved extends BaseDomainEvent {
  readonly eventType = "ConversationResolved";
  readonly aggregateType = "SocialConversation";

  constructor(
    readonly aggregateId: string,
    readonly resolvedById: string,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      conversationId: this.aggregateId,
      resolvedById: this.resolvedById,
    };
  }
}

/**
 * @class ConversationReopened
 * @description Emitted when a resolved conversation is reopened.
 */
export class ConversationReopened extends BaseDomainEvent {
  readonly eventType = "ConversationReopened";
  readonly aggregateType = "SocialConversation";

  constructor(
    readonly aggregateId: string,
    version: number = 1
  ) {
    super(version);
  }

  toPayload(): Record<string, unknown> {
    return {
      conversationId: this.aggregateId,
    };
  }
}

export type SocialConversationEvent = ConversationResolved | ConversationReopened;

// ── State interfaces ───────────────────────────────────────────────────

export interface CreateSocialConversationInput {
  accountId: AccountId;
  projectId: ProjectId;
  channelId: ChannelId;
  provider: ProviderType;
  subject?: string;
  rootProviderMessageId?: string;
  lastMessageAt: Date;
}

export interface SocialConversationState {
  id: SocialConversationId;
  accountId: AccountId;
  projectId: ProjectId;
  channelId: ChannelId;
  provider: ProviderType;
  subject: string | null;
  participantCount: number;
  messageCount: number;
  lastMessageAt: Date;
  isResolved: boolean;
  resolvedAt: Date | null;
  resolvedById: string | null;
  rootProviderMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Entity ─────────────────────────────────────────────────────────────

export class SocialConversation extends Entity<SocialConversationId> {
  private _accountId: AccountId;
  private _projectId: ProjectId;
  private _channelId: ChannelId;
  private _provider: ProviderType;
  private _subject: string | null;
  private _participantCount: number;
  private _messageCount: number;
  private _lastMessageAt: Date;
  private _isResolved: boolean;
  private _resolvedAt: Date | null;
  private _resolvedById: string | null;
  private _rootProviderMessageId: string | null;
  private _events: (ConversationResolved | ConversationReopened)[] = [];

  private constructor(
    id: SocialConversationId,
    accountId: AccountId,
    projectId: ProjectId,
    channelId: ChannelId,
    provider: ProviderType,
    subject: string | null,
    participantCount: number,
    messageCount: number,
    lastMessageAt: Date,
    isResolved: boolean,
    resolvedAt: Date | null,
    resolvedById: string | null,
    rootProviderMessageId: string | null,
    createdAt?: Date
  ) {
    super(id, createdAt);
    this._accountId = accountId;
    this._projectId = projectId;
    this._channelId = channelId;
    this._provider = provider;
    this._subject = subject;
    this._participantCount = participantCount;
    this._messageCount = messageCount;
    this._lastMessageAt = lastMessageAt;
    this._isResolved = isResolved;
    this._resolvedAt = resolvedAt;
    this._resolvedById = resolvedById;
    this._rootProviderMessageId = rootProviderMessageId;
  }

  // ── Getters ────────────────────────────────────────────────────────

  get entityType(): string {
    return "SocialConversation";
  }

  get accountId(): AccountId {
    return this._accountId;
  }

  get projectId(): ProjectId {
    return this._projectId;
  }

  get channelId(): ChannelId {
    return this._channelId;
  }

  get provider(): ProviderType {
    return this._provider;
  }

  get subject(): string | null {
    return this._subject;
  }

  get participantCount(): number {
    return this._participantCount;
  }

  get messageCount(): number {
    return this._messageCount;
  }

  get lastMessageAt(): Date {
    return new Date(this._lastMessageAt.getTime());
  }

  get isResolved(): boolean {
    return this._isResolved;
  }

  get resolvedAt(): Date | null {
    return this._resolvedAt ? new Date(this._resolvedAt.getTime()) : null;
  }

  get resolvedById(): string | null {
    return this._resolvedById;
  }

  get rootProviderMessageId(): string | null {
    return this._rootProviderMessageId;
  }

  get domainEvents(): readonly (ConversationResolved | ConversationReopened)[] {
    return [...this._events];
  }

  // ── Factory methods ────────────────────────────────────────────────

  /**
   * @method create
   * @description Creates a new SocialConversation entity with validation.
   * @param input - Creation parameters
   * @returns Result containing the entity on success, InvalidValueError on failure
   */
  static create(
    input: CreateSocialConversationInput
  ): Result<SocialConversation, InvalidValueError> {
    if (!input.lastMessageAt) {
      return err(
        new InvalidValueError("SocialConversation", "lastMessageAt", "lastMessageAt is required")
      );
    }

    return ok(
      new SocialConversation(
        SocialConversationId.generate(),
        input.accountId,
        input.projectId,
        input.channelId,
        input.provider,
        input.subject ?? null,
        1,
        0,
        input.lastMessageAt,
        false,
        null,
        null,
        input.rootProviderMessageId ?? null
      )
    );
  }

  /**
   * @method reconstitute
   * @description Rebuilds a SocialConversation from persisted state (no events emitted).
   * @param state - The persisted state snapshot
   * @returns A SocialConversation instance
   */
  static reconstitute(state: SocialConversationState): SocialConversation {
    const entity = new SocialConversation(
      state.id,
      state.accountId,
      state.projectId,
      state.channelId,
      state.provider,
      state.subject,
      state.participantCount,
      state.messageCount,
      state.lastMessageAt,
      state.isResolved,
      state.resolvedAt,
      state.resolvedById,
      state.rootProviderMessageId,
      state.createdAt
    );
    entity._updatedAt = state.updatedAt;
    return entity;
  }

  // ── Behavior methods ───────────────────────────────────────────────

  /**
   * @method resolve
   * @description Marks this conversation as resolved.
   * @param resolvedById - The team member ID who resolved it
   * @returns Result<void> on success, error if already resolved
   */
  resolve(resolvedById: string): Result<void, InvalidValueError> {
    if (this._isResolved) {
      return err(
        new InvalidValueError(
          "SocialConversation",
          "isResolved",
          "Conversation is already resolved"
        )
      );
    }
    this._isResolved = true;
    this._resolvedAt = new Date();
    this._resolvedById = resolvedById;
    this.markUpdated();
    this._events.push(new ConversationResolved(this.id.value, resolvedById));
    return ok(undefined);
  }

  /**
   * @method reopen
   * @description Reopens a resolved conversation.
   * @returns Result<void> on success, error if not resolved
   */
  reopen(): Result<void, InvalidValueError> {
    if (!this._isResolved) {
      return err(
        new InvalidValueError("SocialConversation", "isResolved", "Conversation is not resolved")
      );
    }
    this._isResolved = false;
    this._resolvedAt = null;
    this._resolvedById = null;
    this.markUpdated();
    this._events.push(new ConversationReopened(this.id.value));
    return ok(undefined);
  }

  /**
   * @method incrementMessageCount
   * @description Increments the message count and updates lastMessageAt.
   * @param messageAt - The timestamp of the new message
   */
  incrementMessageCount(messageAt: Date): void {
    this._messageCount += 1;
    if (messageAt.getTime() > this._lastMessageAt.getTime()) {
      this._lastMessageAt = messageAt;
    }
    this.markUpdated();
  }

  /**
   * @method incrementParticipantCount
   * @description Increments the participant count when a new author contributes.
   */
  incrementParticipantCount(): void {
    this._participantCount += 1;
    this.markUpdated();
  }

  /**
   * @method clearDomainEvents
   * @description Clears all uncommitted domain events after persistence.
   */
  clearDomainEvents(): void {
    this._events = [];
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id.value,
      accountId: this._accountId.value,
      projectId: this._projectId.value,
      channelId: this._channelId.value,
      provider: this._provider,
      ...(this._subject !== null && { subject: this._subject }),
      participantCount: this._participantCount,
      messageCount: this._messageCount,
      lastMessageAt: this._lastMessageAt.toISOString(),
      isResolved: this._isResolved,
      ...(this._resolvedAt !== null && { resolvedAt: this._resolvedAt.toISOString() }),
      ...(this._resolvedById !== null && { resolvedById: this._resolvedById }),
      ...(this._rootProviderMessageId !== null && {
        rootProviderMessageId: this._rootProviderMessageId,
      }),
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
