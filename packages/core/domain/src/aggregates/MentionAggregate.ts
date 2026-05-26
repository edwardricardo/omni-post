/**
 * @file MentionAggregate.ts
 * @description Aggregate root for the brand-listening Mention. Represents a single
 *   brand mention ingested from a provider search or inbound webhook. Identity +
 *   provider dedup key (provider, externalId) are immutable; sentiment is enriched
 *   later. No domain events are emitted on ingest — nothing consumes one today.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { AggregateRoot } from "./AggregateRoot.js";
import { MentionId } from "../value-objects/MentionId.js";
import { AccountId, ProjectId, ChannelId } from "../value-objects/EntityId.js";
import { type ProviderType } from "../value-objects/Provider.js";
import { type DomainError, InvalidValueError } from "../errors/index.js";

/** How a mention entered the system. */
export type MentionSource = "SEARCH" | "WEBHOOK";

/** Sentiment classification (enriched after ingest; null until scored). */
export type MentionSentimentLabel = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

/**
 * Input for ingesting a new Mention via the factory method.
 */
export interface CreateMentionInput {
  accountId: AccountId;
  projectId: ProjectId;
  channelId?: ChannelId;
  provider: ProviderType;
  externalId: string;
  source: MentionSource;
  trackedTermId?: string;
  authorName: string;
  authorHandle?: string;
  authorAvatarUrl?: string;
  authorProviderId: string;
  url?: string;
  body: string;
  lang?: string;
  mediaUrls?: string[];
  providerCreatedAt: Date;
}

/**
 * Complete state snapshot used to reconstitute the aggregate from persistence.
 */
export interface MentionState {
  id: MentionId;
  accountId: AccountId;
  projectId: ProjectId;
  channelId: ChannelId | null;
  provider: ProviderType;
  externalId: string;
  source: MentionSource;
  trackedTermId: string | null;
  authorName: string;
  authorHandle: string | null;
  authorAvatarUrl: string | null;
  authorProviderId: string;
  url: string | null;
  body: string;
  lang: string | null;
  mediaUrls: string[];
  sentimentScore: number | null;
  sentimentLabel: MentionSentimentLabel | null;
  providerCreatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/**
 * @class MentionAggregate
 * @description Aggregate root for an ingested brand mention. Created once per
 *   (provider, externalId); deduplication is enforced by the application layer
 *   and the DB unique constraint.
 */
export class MentionAggregate extends AggregateRoot<MentionId> {
  private _accountId: AccountId;
  private _projectId: ProjectId;
  private _channelId: ChannelId | null;
  private _provider: ProviderType;
  private _externalId: string;
  private _source: MentionSource;
  private _trackedTermId: string | null;
  private _authorName: string;
  private _authorHandle: string | null;
  private _authorAvatarUrl: string | null;
  private _authorProviderId: string;
  private _url: string | null;
  private _body: string;
  private _lang: string | null;
  private _mediaUrls: string[];
  private _sentimentScore: number | null;
  private _sentimentLabel: MentionSentimentLabel | null;
  private _providerCreatedAt: Date;

  private constructor(id: MentionId, state: Omit<MentionState, "id">) {
    super(id, state.createdAt, state.version);
    this._accountId = state.accountId;
    this._projectId = state.projectId;
    this._channelId = state.channelId;
    this._provider = state.provider;
    this._externalId = state.externalId;
    this._source = state.source;
    this._trackedTermId = state.trackedTermId;
    this._authorName = state.authorName;
    this._authorHandle = state.authorHandle;
    this._authorAvatarUrl = state.authorAvatarUrl;
    this._authorProviderId = state.authorProviderId;
    this._url = state.url;
    this._body = state.body;
    this._lang = state.lang;
    this._mediaUrls = [...state.mediaUrls];
    this._sentimentScore = state.sentimentScore;
    this._sentimentLabel = state.sentimentLabel;
    this._providerCreatedAt = state.providerCreatedAt;
    if (state.updatedAt) {
      this._updatedAt = state.updatedAt;
    }
  }

  /**
   * @method create
   * @description Creates a new Mention aggregate. Validates required fields.
   * @param input - Validated creation parameters from the application layer
   * @returns Result<MentionAggregate> on success, InvalidValueError on failure
   */
  static create(input: CreateMentionInput): Result<MentionAggregate, DomainError> {
    if (!input.externalId || input.externalId.trim().length === 0) {
      return err(
        new InvalidValueError("externalId", input.externalId, "External ID must not be empty")
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
      return err(new InvalidValueError("body", input.body, "Body must not be empty"));
    }

    const now = new Date();
    return ok(
      new MentionAggregate(MentionId.generate(), {
        accountId: input.accountId,
        projectId: input.projectId,
        channelId: input.channelId ?? null,
        provider: input.provider,
        externalId: input.externalId.trim(),
        source: input.source,
        trackedTermId: input.trackedTermId ?? null,
        authorName: input.authorName,
        authorHandle: input.authorHandle ?? null,
        authorAvatarUrl: input.authorAvatarUrl ?? null,
        authorProviderId: input.authorProviderId,
        url: input.url ?? null,
        body: input.body,
        lang: input.lang ?? null,
        mediaUrls: input.mediaUrls ?? [],
        sentimentScore: null,
        sentimentLabel: null,
        providerCreatedAt: input.providerCreatedAt,
        createdAt: now,
        updatedAt: now,
        version: 0,
      })
    );
  }

  /**
   * @method reconstitute
   * @description Rebuilds a Mention aggregate from a persisted state snapshot.
   * @param state - The complete persisted state
   * @returns The reconstituted aggregate
   */
  static reconstitute(state: MentionState): MentionAggregate {
    const { id, ...rest } = state;
    return new MentionAggregate(id, rest);
  }

  get accountId(): AccountId {
    return this._accountId;
  }
  get projectId(): ProjectId {
    return this._projectId;
  }
  get channelId(): ChannelId | null {
    return this._channelId;
  }
  get provider(): ProviderType {
    return this._provider;
  }
  get externalId(): string {
    return this._externalId;
  }
  get source(): MentionSource {
    return this._source;
  }
  get trackedTermId(): string | null {
    return this._trackedTermId;
  }
  get authorName(): string {
    return this._authorName;
  }
  get authorHandle(): string | null {
    return this._authorHandle;
  }
  get authorAvatarUrl(): string | null {
    return this._authorAvatarUrl;
  }
  get authorProviderId(): string {
    return this._authorProviderId;
  }
  get url(): string | null {
    return this._url;
  }
  get body(): string {
    return this._body;
  }
  get lang(): string | null {
    return this._lang;
  }
  get mediaUrls(): readonly string[] {
    return [...this._mediaUrls];
  }
  get sentimentScore(): number | null {
    return this._sentimentScore;
  }
  get sentimentLabel(): MentionSentimentLabel | null {
    return this._sentimentLabel;
  }
  get providerCreatedAt(): Date {
    return this._providerCreatedAt;
  }

  /** @method entityType @description Returns the aggregate type name for logging. */
  get entityType(): string {
    return "Mention";
  }

  /** @method toJSON @description Serializes the aggregate to a plain object. */
  toJSON(): Record<string, unknown> {
    return {
      id: this.id.value,
      accountId: this._accountId.value,
      projectId: this._projectId.value,
      ...(this._channelId !== null && { channelId: this._channelId.value }),
      provider: this._provider,
      externalId: this._externalId,
      source: this._source,
      ...(this._trackedTermId !== null && { trackedTermId: this._trackedTermId }),
      authorName: this._authorName,
      ...(this._authorHandle !== null && { authorHandle: this._authorHandle }),
      ...(this._authorAvatarUrl !== null && { authorAvatarUrl: this._authorAvatarUrl }),
      authorProviderId: this._authorProviderId,
      ...(this._url !== null && { url: this._url }),
      body: this._body,
      ...(this._lang !== null && { lang: this._lang }),
      mediaUrls: [...this._mediaUrls],
      ...(this._sentimentScore !== null && { sentimentScore: this._sentimentScore }),
      ...(this._sentimentLabel !== null && { sentimentLabel: this._sentimentLabel }),
      providerCreatedAt: this._providerCreatedAt.toISOString(),
    };
  }
}
