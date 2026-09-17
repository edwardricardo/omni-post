/**
 * @file PostPublicationMethods.ts
 * @description The publication facet of the Post root: declaring targets, opening
 *   episodes, recording per-channel attempts, the retraction exits, and the word
 *   derived from the record at every hop.
 *
 *   It is a COMPANION of the aggregate, not a second entry point. Every function here
 *   takes the narrow mutable view the root builds for it ({@link PublicationContext}),
 *   which only the root can construct, so the record set stays behind the aggregate
 *   boundary while the root file stays readable.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { PostPublished, PostPublishingFailed } from "../../events/PostEvents.js";
import { ChannelPublication } from "../../entities/ChannelPublication.js";
import { ChannelPublications } from "../ChannelPublications.js";
import { type ChannelId } from "../../value-objects/EntityId.js";
import { type ProviderType } from "../../value-objects/Provider.js";
import { PublishStatus, PUBLISH_STATUS } from "../../value-objects/PublishStatus.js";
import {
  PUBLICATION_OUTCOME_KINDS,
  type PublicationOutcome,
} from "../../value-objects/PublicationOutcome.js";
import {
  ContentLockedError,
  InvalidStateTransitionError,
  InvariantViolationError,
} from "../../errors/index.js";
export type {
  PublicationContext,
  OpenedPublicationChannel,
  OpenPublicationEpisodeInput,
  RecordChannelAttemptInput,
  MarkChannelRetractionOutcomeInput,
  ClearChannelPendingRetractionInput,
  ExpireChannelRetractionWindowInput,
  ProviderResultsPayload,
};

import {
  type PublicationContext,
  type PublicationError,
  type OpenedPublicationChannel,
  type OpenPublicationEpisodeInput,
  type RecordChannelAttemptInput,
  type MarkChannelRetractionOutcomeInput,
  type ClearChannelPendingRetractionInput,
  type ExpireChannelRetractionWindowInput,
  type ProviderResultsPayload,
} from "./PostPublicationTypes.js";
import {
  buildFailurePayload,
  buildProviderResults,
  emitAlertTransition,
  emitChannelOutcome,
  lastChannelPublishedAt,
  providersOf,
} from "./PostPublicationEvents.js";

/**
 * @function viewOf
 * @description The read vocabulary over the context's records.
 */
function viewOf(context: PublicationContext): ChannelPublications {
  return ChannelPublications.of(context.records);
}

/**
 * @function channelOutsideRecord
 * @description The refusal a channel that was never a target gets. Named once so
 *   every entry point refuses it in the same words.
 */
function channelOutsideRecord(context: PublicationContext, channelId: ChannelId): PublicationError {
  return new InvariantViolationError(
    `channel ${channelId.value} is outside the recorded target set of post ${context.postId}`
  );
}

/**
 * @function declarePublicationTargets
 * @description Records the channels this post is INTENDED for. The record exists from
 *   scheduling, so a channel that never ran is recorded rather than missing. Declaring
 *   the same set again changes nothing; declaring a different set replaces it while
 *   nothing is live, and is refused once anything is.
 * @param context - The root's narrow view
 * @param channelIds - The intended channels
 * @returns Result.ok, or InvariantViolationError when content is already live
 */
export function declarePublicationTargets(
  context: PublicationContext,
  channelIds: readonly ChannelId[]
): Result<void, InvariantViolationError> {
  const requested = [...new Set(channelIds.map((channelId) => channelId.value))];
  const recorded = new Set(context.records.map((record) => record.channelId.value));
  const identical =
    requested.length === recorded.size && requested.every((value) => recorded.has(value));

  if (identical) {
    return ok(undefined);
  }

  if (viewOf(context).hasLiveContent()) {
    return err(
      new InvariantViolationError(
        `post ${context.postId} has live content and its recorded target set cannot be replaced`
      )
    );
  }

  context.replaceRecords(channelIds.map((channelId) => ChannelPublication.declare(channelId)));
  context.touch();
  return ok(undefined);
}

/**
 * @function openPublicationEpisode
 * @description Includes channels in a new attempt episode. Only re-drivable channels
 *   are opened: a published channel is never re-sent, and a channel holding live
 *   fragments is refused BY NAME with those fragments, because a re-send would
 *   duplicate them.
 * @param context - The root's narrow view
 * @param input - The channels to open (all recorded ones when omitted) and whether the
 *   post enters the publication family now
 * @returns Result with the opened channels and whether the episode was already open
 */
export function openPublicationEpisode(
  context: PublicationContext,
  input: OpenPublicationEpisodeInput
): Result<{ opened: readonly OpenedPublicationChannel[]; alreadyOpen: boolean }, PublicationError> {
  const records = viewOf(context);
  if (records.isEmpty()) {
    return err(
      new InvariantViolationError(
        `post ${context.postId} has no recorded target set to open an episode over`
      )
    );
  }

  const targets: ChannelPublication[] = [];
  if (input.channelIds === undefined) {
    targets.push(...records.all);
  } else {
    for (const channelId of input.channelIds) {
      const record = records.find(channelId);
      if (record === undefined) {
        return err(channelOutsideRecord(context, channelId));
      }
      if (record.pendingRetraction) {
        const named = record.liveFragments.map((fragment) => fragment.externalId).join(", ");
        return err(
          new InvariantViolationError(
            `CHANNEL_HAS_LIVE_FRAGMENTS: channel ${channelId.value} still has live fragments (${named}) and must be cleared before it is attempted again`
          )
        );
      }
      targets.push(record);
    }
  }

  const redrivable = targets.filter((record) => record.redrivable());
  if (redrivable.length === 0) {
    return err(
      new InvariantViolationError(
        `post ${context.postId} has no re-drivable channel to open an episode for`
      )
    );
  }

  const maxEpisode = records.all.reduce((highest, record) => Math.max(highest, record.episode), 0);
  const alreadyOpen =
    maxEpisode > 0 &&
    redrivable.every(
      (record) =>
        record.episode === maxEpisode &&
        record.outcomeKind === PUBLICATION_OUTCOME_KINDS.UNRESOLVED &&
        record.episodeAttempts === 0
    );

  if (!alreadyOpen) {
    const nextEpisode = maxEpisode + 1;
    for (const record of redrivable) {
      const opened = record.openEpisode(nextEpisode);
      if (!opened.ok) {
        return err(opened.error);
      }
    }
  }

  const opened: OpenedPublicationChannel[] = redrivable.map((record) => ({
    channelId: record.channelId,
    episode: record.episode,
  }));

  if (input.enterPublishing) {
    const entered = enterPublishing(context, redrivable);
    if (!entered.ok) {
      return err(entered.error);
    }
    const projected = applyDerivedStatus(context);
    if (!projected.ok) {
      return err(projected.error);
    }
  } else if (!context.status.isDraft() && !context.status.isScheduled()) {
    return err(new InvalidStateTransitionError(context.status.value, "OPEN_EPISODE", "Post"));
  }

  context.touch();
  return ok({ opened, alreadyOpen });
}

/**
 * @function recordChannelAttempt
 * @description Records ONE attempt's result for ONE channel, then re-derives the post's
 *   word from the whole record. Every effect of an attempt — the outcome, the live set,
 *   the lock, the channel event, the alert and the word — happens here, in one place,
 *   so none of them can be applied without the others.
 * @param context - The root's narrow view
 * @param input - The channel, the episode, the attempt ordinal, the plan size, the result
 * @returns Result with whether the attempt applied and the channel's outcome
 */
export function recordChannelAttempt(
  context: PublicationContext,
  input: RecordChannelAttemptInput
): Result<{ applied: boolean; outcome: PublicationOutcome }, PublicationError> {
  const record = viewOf(context).find(input.channelId);
  if (record === undefined) {
    return err(channelOutsideRecord(context, input.channelId));
  }

  const applied = record.recordAttempt({
    episode: input.episode,
    attemptNo: input.attemptNo,
    planSize: input.planSize,
    result: input.result,
    ...(input.now !== undefined && { now: input.now }),
  });
  if (!applied.ok) {
    return err(applied.error);
  }
  if (!applied.value.applied) {
    return ok({ applied: false, outcome: record.outcome });
  }

  if (context.status.isDraft() || context.status.isScheduled()) {
    const entered = enterPublishing(context, context.records);
    if (!entered.ok) {
      return err(entered.error);
    }
  }

  emitChannelOutcome(context, record);
  emitAlertTransition(context, record);

  const projected = applyDerivedStatus(context);
  if (!projected.ok) {
    return err(projected.error);
  }

  context.touch();
  return ok({ applied: true, outcome: record.outcome });
}

/**
 * @function markRetractionOutcome
 * @description Records what a retraction attempt achieved on one channel. No production
 *   caller issues it yet; it is the seam the retraction mechanism plugs into, and it is
 *   here so the outcome is written through the root like every other.
 * @param context - The root's narrow view
 * @param input - The channel, the retraction outcome and what is still live
 * @returns Result.ok, or the refusal that stopped it
 */
export function markRetractionOutcome(
  context: PublicationContext,
  input: MarkChannelRetractionOutcomeInput
): Result<void, PublicationError> {
  const record = viewOf(context).find(input.channelId);
  if (record === undefined) {
    return err(channelOutsideRecord(context, input.channelId));
  }

  const marked = record.markRetractionOutcome({
    outcome: input.outcome,
    remaining: input.remaining,
    ...(input.now !== undefined && { now: input.now }),
  });
  if (!marked.ok) {
    return err(marked.error);
  }

  emitAlertTransition(context, record);
  const projected = applyDerivedStatus(context);
  if (!projected.ok) {
    return err(projected.error);
  }

  context.touch();
  return ok(undefined);
}

/**
 * @function clearPendingRetraction
 * @description The customer's confirmation that they removed the live fragments
 *   themselves. It stays available after the action window expired: expiry fixes the
 *   OUTCOME, never the content, so this exit never closes.
 * @param context - The root's narrow view
 * @param input - The channel and the recorded cause
 * @returns Result with `applied` — false when nothing was pending on that channel
 */
export function clearPendingRetraction(
  context: PublicationContext,
  input: ClearChannelPendingRetractionInput
): Result<{ applied: boolean }, PublicationError> {
  const record = viewOf(context).find(input.channelId);
  if (record === undefined) {
    return err(channelOutsideRecord(context, input.channelId));
  }

  const cleared = record.clearPendingRetraction({
    cause: input.cause,
    ...(input.now !== undefined && { now: input.now }),
  });
  if (!cleared.ok) {
    return err(cleared.error);
  }
  if (!cleared.value.applied) {
    return ok({ applied: false });
  }

  emitAlertTransition(context, record);
  const projected = applyDerivedStatus(context);
  if (!projected.ok) {
    return err(projected.error);
  }

  context.touch();
  return ok({ applied: true });
}

/**
 * @function expireRetractionActionWindow
 * @description Closes the customer's window on one channel. The window LENGTH is an
 *   argument: the domain reads no configuration, and the record re-asserts the cutoff
 *   so a mis-parametrized caller cannot expire anything early.
 * @param context - The root's narrow view
 * @param input - The channel, the moment and the window length
 * @returns Result with `applied` — false when the window is not open, already closed,
 *   or has not elapsed
 */
export function expireRetractionActionWindow(
  context: PublicationContext,
  input: ExpireChannelRetractionWindowInput
): Result<{ applied: boolean }, PublicationError> {
  const record = viewOf(context).find(input.channelId);
  if (record === undefined) {
    return err(channelOutsideRecord(context, input.channelId));
  }

  const expired = record.expireRetractionActionWindow({ now: input.now, window: input.window });
  if (!expired.ok) {
    return err(expired.error);
  }
  if (!expired.value.applied) {
    return ok({ applied: false });
  }

  emitAlertTransition(context, record);
  const projected = applyDerivedStatus(context);
  if (!projected.ok) {
    return err(projected.error);
  }

  context.touch();
  return ok({ applied: true });
}

/**
 * @function assertPublicationProjection
 * @description The invariant every save re-asserts: with at least one record, a
 *   publication word must EQUAL the derivation, and live content must not rest under a
 *   lifecycle word. This is the mechanism behind "divergence shall not be
 *   representable" — a save that cannot assert it refuses.
 * @param context - The root's narrow view
 * @returns Result.ok, or InvariantViolationError naming the divergence
 */
export function assertPublicationProjection(
  context: PublicationContext
): Result<void, InvariantViolationError> {
  const records = viewOf(context);
  if (records.isEmpty()) {
    return ok(undefined);
  }

  const derived = records.derive();
  if (context.status.isPublicationFamily() && derived !== context.status.value) {
    return err(
      new InvariantViolationError(
        `post ${context.postId} reads ${context.status.value} while its record derives ${String(derived)}`
      )
    );
  }

  if (records.hasLiveContent() && !context.status.isPublicationFamily()) {
    return err(
      new InvariantViolationError(
        `post ${context.postId} has live content while reading ${context.status.value}`
      )
    );
  }

  return ok(undefined);
}

/**
 * @function contentLock
 * @description The lock, in one place: the refusal a write gets when any channel holds
 *   content of this post on its provider. It names the channel and, when the channel is
 *   pending retraction, the exact fragments — a summarised refusal would leave the
 *   customer nothing to act on.
 * @param context - The root's narrow view
 * @param operation - The write being refused
 * @returns The refusal, or undefined when nothing is live
 */
export function contentLock(
  context: PublicationContext,
  operation: string
): ContentLockedError | undefined {
  const live = viewOf(context).liveChannels();
  const first = live.find((record) => record.pendingRetraction) ?? live[0];
  if (first === undefined) {
    return undefined;
  }

  return new ContentLockedError({
    postId: context.postId,
    channelId: first.channelId.value,
    fragments: first.liveFragments.map((fragment) => fragment.toJSON()),
    pendingRetraction: first.pendingRetraction,
    operation,
  });
}

/**
 * @function markAsPublishedFromRecord
 * @description The `PUBLISHED` hop as a PROJECTION write gated by the record: the
 *   derivation must already read `PUBLISHED`, and the v1 payload is built FROM the
 *   record, so the word can never claim more than the channels did.
 * @param context - The root's narrow view
 * @returns Result.ok, or InvariantViolationError when the record does not derive it
 */
export function markAsPublishedFromRecord(
  context: PublicationContext
): Result<void, InvariantViolationError> {
  const records = viewOf(context);
  const derived = records.derive();
  if (derived !== PUBLISH_STATUS.PUBLISHED) {
    return err(
      new InvariantViolationError(
        `post ${context.postId} derives ${String(derived)} and cannot be marked PUBLISHED`
      )
    );
  }

  const wasPublished = context.status.isPublished();
  context.setStatus(PublishStatus.published());
  const publishedAt = context.publishedAt ?? lastChannelPublishedAt(context) ?? new Date();
  context.setPublishedAt(publishedAt);
  context.touch();

  if (!wasPublished) {
    context.emit(new PostPublished(context.postId, publishedAt, buildProviderResults(context)));
  }

  return ok(undefined);
}

/**
 * @function markAsPublishedWithoutRecord
 * @description The `PUBLISHED` hop for a post that declared no targets: there is no
 *   record to gate the word, so the lifecycle state machine decides and the caller's
 *   provider results are the payload.
 * @param context - The root's narrow view
 * @param providerResults - The caller's results map
 * @returns Result.ok, or the refusal that stopped it
 */
export function markAsPublishedWithoutRecord(
  context: PublicationContext,
  providerResults: ProviderResultsPayload
): Result<void, PublicationError> {
  if (!context.status.canTransitionTo(PUBLISH_STATUS.PUBLISHED)) {
    return err(
      new InvalidStateTransitionError(context.status.value, PUBLISH_STATUS.PUBLISHED, "Post")
    );
  }

  const transitioned = context.status.transitionTo(PUBLISH_STATUS.PUBLISHED);
  if (!transitioned.ok) {
    return err(transitioned.error);
  }

  const publishedAt = new Date();
  context.setStatus(transitioned.value);
  context.setPublishedAt(publishedAt);
  context.touch();
  context.emit(new PostPublished(context.postId, publishedAt, providerResults));
  return ok(undefined);
}

/**
 * @function markAsFailedWithoutRecord
 * @description The `FAILED` hop for a post that declared no targets, on the caller's
 *   own words.
 * @param context - The root's narrow view
 * @param error - The failure the caller reports
 * @param failedProviders - The providers the caller reports
 * @param retryable - Whether the caller considers it retryable
 * @returns Result.ok, or the refusal that stopped it
 */
export function markAsFailedWithoutRecord(
  context: PublicationContext,
  error: string,
  failedProviders: ProviderType[],
  retryable: boolean
): Result<void, PublicationError> {
  if (!context.status.canTransitionTo(PUBLISH_STATUS.FAILED)) {
    return err(
      new InvalidStateTransitionError(context.status.value, PUBLISH_STATUS.FAILED, "Post")
    );
  }

  const transitioned = context.status.transitionTo(PUBLISH_STATUS.FAILED);
  if (!transitioned.ok) {
    return err(transitioned.error);
  }

  context.setStatus(transitioned.value);
  context.touch();
  context.emit(new PostPublishingFailed(context.postId, error, failedProviders, retryable));
  return ok(undefined);
}

/**
 * @function markAsPartiallyPublishedFromRecord
 * @description The `PARTIALLY_PUBLISHED` hop. No external event — the channel-keyed
 *   events carry the news — and `publishedAt` stays null because the post did not
 *   publish everywhere.
 * @param context - The root's narrow view
 * @returns Result.ok, or InvariantViolationError when the record does not derive it
 */
export function markAsPartiallyPublishedFromRecord(
  context: PublicationContext
): Result<void, InvariantViolationError> {
  const derived = viewOf(context).derive();
  if (derived !== PUBLISH_STATUS.PARTIALLY_PUBLISHED) {
    return err(
      new InvariantViolationError(
        `post ${context.postId} derives ${String(derived)} and cannot be marked PARTIALLY_PUBLISHED`
      )
    );
  }

  context.setStatus(PublishStatus.partiallyPublished());
  context.touch();
  return ok(undefined);
}

/**
 * @function markAsFailedFromRecord
 * @description The `FAILED` hop, with the v1 payload built FROM the record: the error
 *   is the first not-published channel's reason, the providers are those of the
 *   not-published channels, and `retryable` says whether any may still be attempted.
 * @param context - The root's narrow view
 * @returns Result.ok, or InvariantViolationError when the record does not derive it
 */
export function markAsFailedFromRecord(
  context: PublicationContext
): Result<void, InvariantViolationError> {
  const derived = viewOf(context).derive();
  if (derived !== PUBLISH_STATUS.FAILED) {
    return err(
      new InvariantViolationError(
        `post ${context.postId} derives ${String(derived)} and cannot be marked FAILED`
      )
    );
  }

  const wasFailed = context.status.isFailed();
  context.setStatus(PublishStatus.failed());
  context.touch();

  if (!wasFailed) {
    const failure = buildFailurePayload(context);
    context.emit(
      new PostPublishingFailed(
        context.postId,
        failure.error,
        failure.failedProviders,
        failure.retryable
      )
    );
  }

  return ok(undefined);
}

/**
 * @function applyDerivedStatus
 * @description Routes the derived word to the hop that owns it. Resolution inside the
 *   publication family is a projection write with the record as its precondition, never
 *   a free-hand status write.
 * @param context - The root's narrow view
 * @returns Result with whether the word changed
 */
export function applyDerivedStatus(context: PublicationContext): Result<boolean, PublicationError> {
  const derived = viewOf(context).derive();
  if (derived === undefined || derived === context.status.value) {
    return ok(false);
  }

  if (derived === PUBLISH_STATUS.PUBLISHED) {
    const marked = markAsPublishedFromRecord(context);
    return marked.ok ? ok(true) : err(marked.error);
  }

  if (derived === PUBLISH_STATUS.PARTIALLY_PUBLISHED) {
    const marked = markAsPartiallyPublishedFromRecord(context);
    return marked.ok ? ok(true) : err(marked.error);
  }

  if (derived === PUBLISH_STATUS.FAILED) {
    const marked = markAsFailedFromRecord(context);
    return marked.ok ? ok(true) : err(marked.error);
  }

  if (derived === PUBLISH_STATUS.PUBLISHING) {
    if (context.status.canTransitionTo(PUBLISH_STATUS.PUBLISHING)) {
      const started = context.startPublishing(providersOf(context.records));
      return started.ok ? ok(true) : err(started.error);
    }
    context.setStatus(PublishStatus.publishing());
    return ok(true);
  }

  return ok(false);
}

/**
 * @function enterPublishing
 * @description Enters the publication family for the given records, naming their
 *   providers in the internal event. The providers are read from the records' joined
 *   channel rows — no caller is ever asked for them.
 */
function enterPublishing(
  context: PublicationContext,
  records: readonly ChannelPublication[]
): Result<void, InvalidStateTransitionError> {
  if (context.status.isPublishing()) {
    return ok(undefined);
  }
  if (!context.status.canTransitionTo(PUBLISH_STATUS.PUBLISHING)) {
    return ok(undefined);
  }
  return context.startPublishing(providersOf(records));
}
