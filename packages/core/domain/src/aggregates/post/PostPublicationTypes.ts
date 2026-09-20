/**
 * @file PostPublicationTypes.ts
 * @description The vocabulary the publication facet is written in: the narrow mutable
 *   view of the root it operates on, and the input shapes its entry points take. They
 *   live in their own file because the state machine and the event builders both need
 *   them, and neither should have to import the other to get them.
 * @layer domain
 */

import { type Result } from "@shared/types";
import { type DomainEvent } from "../../events/DomainEvent.js";
import { type ChannelPublication, type DurationMs } from "../../entities/ChannelPublication.js";
import { type ChannelId } from "../../value-objects/EntityId.js";
import { type ProviderType } from "../../value-objects/Provider.js";
import { type PublishStatus } from "../../value-objects/PublishStatus.js";
import { type FragmentReference } from "../../value-objects/FragmentReference.js";
import { type AttemptResult } from "../../value-objects/PublicationOutcome.js";
import {
  type InvalidStateTransitionError,
  type InvariantViolationError,
} from "../../errors/index.js";

/**
 * The narrow, mutable view of the root that the publication facet needs. The root is
 * the only thing that can build one, which is what keeps this module a companion of
 * the aggregate rather than a way around it.
 */
export interface PublicationContext {
  readonly postId: string;
  readonly projectId: string;
  readonly accountId: string | undefined;
  readonly records: ChannelPublication[];
  readonly status: PublishStatus;
  readonly publishedAt: Date | undefined;
  replaceRecords(records: ChannelPublication[]): void;
  setStatus(status: PublishStatus): void;
  setPublishedAt(publishedAt: Date): void;
  emit(event: DomainEvent): void;
  touch(): void;
  /**
   * Declares that this call changed a per-channel RECORD, as opposed to the post's word.
   * Only the narrow save writes records, so the full save reads this to refuse rather
   * than drop the change — and the distinction is why it is separate from `touch()`:
   * `markAsPublished` touches the context and changes no record at all.
   */
  markRecordsChanged(): void;
  /** Enters the publication family through the lifecycle state machine. */
  startPublishing(providers: ProviderType[]): Result<void, InvalidStateTransitionError>;
}

/** One channel included in a freshly opened attempt episode. */
export interface OpenedPublicationChannel {
  channelId: ChannelId;
  episode: number;
}

export interface OpenPublicationEpisodeInput {
  channelIds?: readonly ChannelId[];
  enterPublishing: boolean;
}

export interface RecordChannelAttemptInput {
  channelId: ChannelId;
  episode: number;
  attemptNo: number;
  planSize: number;
  result: AttemptResult;
  now?: Date;
}

export interface MarkChannelRetractionOutcomeInput {
  channelId: ChannelId;
  outcome: "retracted" | "exhausted";
  remaining: readonly FragmentReference[];
  now?: Date;
}

export interface ClearChannelPendingRetractionInput {
  channelId: ChannelId;
  cause: "manually-removed";
  now?: Date;
}

export interface ExpireChannelRetractionWindowInput {
  channelId: ChannelId;
  now: Date;
  window: DurationMs;
}

/** The v1 `providerResults` map shape, unchanged since the contract was published. */
export type ProviderResultsPayload = Record<
  string,
  { success: boolean; externalId?: string; error?: string }
>;

export type PublicationError = InvariantViolationError | InvalidStateTransitionError;
