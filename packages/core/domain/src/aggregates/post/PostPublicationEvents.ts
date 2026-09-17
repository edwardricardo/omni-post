/**
 * @file PostPublicationEvents.ts
 * @description What the publication facet TELLS the rest of the system: the
 *   channel-keyed outcome events, the retraction alert events and the two v1 payloads
 *   built from the record. Separated from the state machine next to it because "what
 *   the record says" and "what the outbox is told" fail in different ways and are read
 *   by different people.
 * @layer domain
 */

import {
  PostChannelPublished,
  PostChannelExcluded,
  PostChannelRetractionAlertRaised,
  PostChannelRetractionAlertResolved,
} from "../../events/PostEvents.js";
import { type ChannelPublication } from "../../entities/ChannelPublication.js";
import { type ProviderType } from "../../value-objects/Provider.js";
import { isProvidedReference } from "../../value-objects/ProviderReference.js";
import { type PublicationContext, type ProviderResultsPayload } from "./PostPublicationTypes.js";

/**
 * @function emitChannelOutcome
 * @description Raises the channel-keyed internal event for the outcome just recorded.
 *   It carries what a consumer needs to act without re-reading the record.
 */
export function emitChannelOutcome(context: PublicationContext, record: ChannelPublication): void {
  if (record.isPublished()) {
    context.emit(
      new PostChannelPublished({
        postId: context.postId,
        projectId: context.projectId,
        ...(context.accountId !== undefined && { accountId: context.accountId }),
        channelId: record.channelId.value,
        ...(record.externalId !== undefined && { externalId: record.externalId }),
        fragmentCount: record.liveFragments.length,
        publishedAt: record.publishedAt ?? new Date(),
        ...(record.contentHash !== undefined && { contentHash: record.contentHash.value }),
      })
    );
    return;
  }

  const reason = record.reason;
  if (reason === undefined) {
    return;
  }

  context.emit(
    new PostChannelExcluded({
      postId: context.postId,
      projectId: context.projectId,
      ...(context.accountId !== undefined && { accountId: context.accountId }),
      channelId: record.channelId.value,
      reasonCode: reason.code,
      attempts: record.attempts,
      pendingRetraction: record.pendingRetraction,
      liveFragmentCount: record.liveFragments.length,
    })
  );
}

/**
 * @function emitAlertTransition
 * @description Asks the record whether the customer has to be told anything, and raises
 *   exactly what it answers. The decision lives in the record; this only carries it to
 *   the outbox.
 */
export function emitAlertTransition(context: PublicationContext, record: ChannelPublication): void {
  const transition = record.alertTransition();

  if (transition.kind === "raise") {
    context.emit(
      new PostChannelRetractionAlertRaised({
        postId: context.postId,
        projectId: context.projectId,
        ...(context.accountId !== undefined && { accountId: context.accountId }),
        channelId: record.channelId.value,
        liveFragments: record.liveFragments.map((fragment) => fragment.toJSON()),
        cause: record.retractionBlockedCause ?? "NO_CAPABILITY",
        alertKey: alertKey(context, record, transition.alertHash),
        ...(transition.supersededAlertKey !== undefined && {
          supersededAlertKey: alertKey(context, record, transition.supersededAlertKey),
        }),
      })
    );
    return;
  }

  if (transition.kind === "resolve") {
    context.emit(
      new PostChannelRetractionAlertResolved({
        postId: context.postId,
        projectId: context.projectId,
        ...(context.accountId !== undefined && { accountId: context.accountId }),
        channelId: record.channelId.value,
        alertKey: alertKey(context, record, transition.alertHash),
        cause: transition.cause,
      })
    );
  }
}

/**
 * @function alertKey
 * @description The identity of one alert: this post, this channel, this exact live set.
 *   Deterministic by construction, which is what lets a delivery ledger claim it once
 *   per medium and per target.
 */
export function alertKey(
  context: PublicationContext,
  record: ChannelPublication,
  digest: string
): string {
  return `${context.postId}:${record.channelId.value}:${digest}`;
}

/**
 * @function providersOf
 * @description The distinct providers behind a set of records, read from the joined
 *   channel rows the mapper filled.
 */
export function providersOf(records: readonly ChannelPublication[]): ProviderType[] {
  const providers = records
    .map((record) => record.provider)
    .filter((provider): provider is ProviderType => provider !== undefined);
  return [...new Set(providers)];
}

/**
 * @function buildProviderResults
 * @description The v1 `providerResults` map, built from the record. The key is the
 *   CHANNEL id, which is what the map has always carried under its provider-shaped
 *   name; renaming it is a separate, announced change.
 */
export function buildProviderResults(context: PublicationContext): ProviderResultsPayload {
  const results: ProviderResultsPayload = {};
  for (const record of context.records) {
    if (!record.isPublished()) {
      continue;
    }
    const head = record.head;
    results[record.channelId.value] = {
      success: true,
      ...(head !== undefined && isProvidedReference(head) && { externalId: head.id }),
    };
  }
  return results;
}

/**
 * @function buildFailurePayload
 * @description The v1 failure payload, built from the record: the first not-published
 *   channel's reason, the providers of the not-published channels, and whether any of
 *   them may still be attempted.
 */
export function buildFailurePayload(context: PublicationContext): {
  error: string;
  failedProviders: ProviderType[];
  retryable: boolean;
} {
  const notPublished = context.records.filter((record) => !record.isPublished());
  const firstReason = notPublished.find((record) => record.reason !== undefined)?.reason;
  return {
    error: firstReason?.code ?? "UNKNOWN",
    failedProviders: providersOf(notPublished),
    retryable: notPublished.some((record) => record.redrivable()),
  };
}

/**
 * @function lastChannelPublishedAt
 * @description The moment the last channel accepted the content — the post's own
 *   publication moment. Never fabricated: when no record carries one, the caller falls
 *   back to the current time explicitly.
 */
export function lastChannelPublishedAt(context: PublicationContext): Date | undefined {
  const moments = context.records
    .map((record) => record.publishedAt)
    .filter((moment): moment is Date => moment !== undefined);
  if (moments.length === 0) {
    return undefined;
  }
  return new Date(Math.max(...moments.map((moment) => moment.getTime())));
}
