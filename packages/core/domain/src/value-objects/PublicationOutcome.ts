/**
 * @file PublicationOutcome.ts
 * @description The closed outcome of ONE channel's publication, composed from the
 *   record's own fields. Three kinds and no fourth: a channel is unresolved, fully
 *   published, or excluded. A channel holding SOME of a post's fragments is never a
 *   persistable outcome — it is an exclusion that still holds live content.
 * @layer domain
 */

import { type ContentFingerprint } from "./ContentFingerprint.js";
import { type FragmentReference } from "./FragmentReference.js";
import {
  CHANNEL_FAILURE_CODES,
  type ExclusionReason,
  type ChannelFailureRecord,
} from "./ExclusionReason.js";
import { type ProviderReference } from "./ProviderReference.js";

export const PUBLICATION_OUTCOME_KINDS = {
  UNRESOLVED: "unresolved",
  PUBLISHED: "published",
  EXCLUDED: "excluded",
} as const;

export type PublicationOutcomeKind =
  (typeof PUBLICATION_OUTCOME_KINDS)[keyof typeof PUBLICATION_OUTCOME_KINDS];

export const CHANNEL_RETRACTION_BLOCKS = {
  NO_CAPABILITY: "NO_CAPABILITY",
  EXHAUSTED: "EXHAUSTED",
} as const;

export type ChannelRetractionBlock =
  (typeof CHANNEL_RETRACTION_BLOCKS)[keyof typeof CHANNEL_RETRACTION_BLOCKS];

export const CHANNEL_RETRACTION_CLEARANCES = {
  RETRACTED: "RETRACTED",
  MANUALLY_REMOVED: "MANUALLY_REMOVED",
} as const;

export type ChannelRetractionClearance =
  (typeof CHANNEL_RETRACTION_CLEARANCES)[keyof typeof CHANNEL_RETRACTION_CLEARANCES];

/**
 * Why an alert about live content stopped standing: the content came down (either
 * way), or the customer's window to act closed. The third value is deliberately the
 * SAME token the record stores as its finalized reason, so the two never drift.
 */
export type RetractionAlertCause =
  ChannelRetractionClearance | typeof CHANNEL_FAILURE_CODES.ACTION_WINDOW_EXPIRED;

/** The customer's window to act on content this application cannot retract. */
export interface RetractionActionWindow {
  readonly startedAt: Date;
  readonly expiredAt?: Date;
}

/** Nothing of this post is live on this channel. */
export interface RetractionNotPending {
  readonly pending: false;
}

/** Fragments are live on the provider and only an explicit act can clear them. */
export interface RetractionPending {
  readonly pending: true;
  readonly live: readonly FragmentReference[];
  readonly blockedBy: ChannelRetractionBlock | null;
  readonly window: RetractionActionWindow | null;
}

export type RetractionState = RetractionNotPending | RetractionPending;

/** Not attempted, in flight, or failed transiently within budget. */
export interface UnresolvedOutcome {
  readonly kind: typeof PUBLICATION_OUTCOME_KINDS.UNRESOLVED;
  readonly lastFailure?: ChannelFailureRecord;
}

/** Every fragment of the post went out on this channel. */
export interface PublishedOutcome {
  readonly kind: typeof PUBLICATION_OUTCOME_KINDS.PUBLISHED;
  readonly head: ProviderReference;
  readonly fragments: readonly FragmentReference[];
  readonly publishedAt: Date;
  readonly contentHash: ContentFingerprint;
}

/** This channel will not be attempted again without an explicit act. */
export interface ExcludedOutcome {
  readonly kind: typeof PUBLICATION_OUTCOME_KINDS.EXCLUDED;
  readonly reason: ExclusionReason;
  readonly excludedAt: Date;
  readonly retraction: RetractionState;
}

export type PublicationOutcome = UnresolvedOutcome | PublishedOutcome | ExcludedOutcome;

/** What the worker reports back for ONE attempt on ONE channel. */
export interface PublishedAttemptResult {
  readonly kind: typeof PUBLICATION_OUTCOME_KINDS.PUBLISHED;
  readonly fragments: readonly FragmentReference[];
  readonly head?: ProviderReference;
  readonly publishedAt: Date;
  readonly contentHash: ContentFingerprint;
}

export const ATTEMPT_CLASSIFICATIONS = {
  TRANSIENT: "transient",
  NONTRANSIENT: "nontransient",
  UNCLASSIFIABLE: "unclassifiable",
} as const;

export type AttemptClassification =
  (typeof ATTEMPT_CLASSIFICATIONS)[keyof typeof ATTEMPT_CLASSIFICATIONS];

/**
 * A failed attempt. `publishedFragments` is what actually went out before the
 * failure — non-empty makes the channel an exclusion holding live content, whatever
 * the classification says and whatever the budget has left.
 */
export interface FailedAttemptResult {
  readonly kind: "failed";
  readonly classification: AttemptClassification;
  readonly code: ChannelFailureRecord["code"];
  readonly detail?: string;
  readonly publishedFragments: readonly FragmentReference[];
}

export type AttemptResult = PublishedAttemptResult | FailedAttemptResult;

/**
 * @function unresolvedOutcome
 * @description Builds the unresolved outcome, optionally carrying the last failure.
 * @param lastFailure - The failure seen on the most recent attempt, when there was one
 * @returns The unresolved outcome
 */
export function unresolvedOutcome(lastFailure?: ChannelFailureRecord): UnresolvedOutcome {
  return {
    kind: PUBLICATION_OUTCOME_KINDS.UNRESOLVED,
    ...(lastFailure !== undefined && { lastFailure }),
  };
}

/**
 * @function publishedOutcome
 * @description Builds the published outcome from the head reference, every fragment
 *   that went out, the moment and the fingerprint.
 * @param props - The published outcome's fields
 * @returns The published outcome
 */
export function publishedOutcome(props: Omit<PublishedOutcome, "kind">): PublishedOutcome {
  return { kind: PUBLICATION_OUTCOME_KINDS.PUBLISHED, ...props };
}

/**
 * @function excludedOutcome
 * @description Builds the excluded outcome from its reason, the moment and the
 *   retraction state.
 * @param props - The excluded outcome's fields
 * @returns The excluded outcome
 */
export function excludedOutcome(props: Omit<ExcludedOutcome, "kind">): ExcludedOutcome {
  return { kind: PUBLICATION_OUTCOME_KINDS.EXCLUDED, ...props };
}

/**
 * @function isPublishedOutcome
 * @description Narrows to the published outcome.
 * @param outcome - The outcome to narrow
 * @returns true when every fragment went out
 */
export function isPublishedOutcome(outcome: PublicationOutcome): outcome is PublishedOutcome {
  return outcome.kind === PUBLICATION_OUTCOME_KINDS.PUBLISHED;
}

/**
 * @function isExcludedOutcome
 * @description Narrows to the excluded outcome.
 * @param outcome - The outcome to narrow
 * @returns true when the channel is terminally not published
 */
export function isExcludedOutcome(outcome: PublicationOutcome): outcome is ExcludedOutcome {
  return outcome.kind === PUBLICATION_OUTCOME_KINDS.EXCLUDED;
}

/**
 * @function isUnresolvedOutcome
 * @description Narrows to the unresolved outcome.
 * @param outcome - The outcome to narrow
 * @returns true when the channel has not settled
 */
export function isUnresolvedOutcome(outcome: PublicationOutcome): outcome is UnresolvedOutcome {
  return outcome.kind === PUBLICATION_OUTCOME_KINDS.UNRESOLVED;
}

/**
 * @function liveFragmentsOf
 * @description The fragments of this post live on the provider for this channel — the
 *   whole post when published, the interrupted prefix when excluded pending
 *   retraction, empty otherwise.
 * @param outcome - The channel's outcome
 * @returns The ordered live fragments
 */
export function liveFragmentsOf(outcome: PublicationOutcome): readonly FragmentReference[] {
  if (isPublishedOutcome(outcome)) {
    return outcome.fragments;
  }
  if (isExcludedOutcome(outcome) && outcome.retraction.pending) {
    return outcome.retraction.live;
  }
  return [];
}

/**
 * @function outcomeHasLiveContent
 * @description THE live-content predicate at outcome level: published, or excluded
 *   with fragments pending retraction. Every lock, admission and guard reads this and
 *   nothing else decides "is anything live".
 * @param outcome - The channel's outcome
 * @returns true when content of this post is on the provider
 */
export function outcomeHasLiveContent(outcome: PublicationOutcome): boolean {
  return isPublishedOutcome(outcome) || (isExcludedOutcome(outcome) && outcome.retraction.pending);
}
