/**
 * @file ChannelPublication.ts
 * @description The per-channel publication record: what this channel did with this
 *   post, what is live on the provider because of it, how many attempts it has spent,
 *   and whether the customer owes an action. It is the single place that decides a
 *   channel's outcome, so no caller can write "excluded" without a reason or
 *   "published" with fragments missing.
 * @layer domain
 */

import { randomUUID } from "crypto";
import { type Result, ok, err } from "@shared/types";
import { ChannelId } from "../value-objects/EntityId.js";
import { type ProviderType } from "../value-objects/Provider.js";
import { InvariantViolationError } from "../errors/index.js";
import { ContentFingerprint, digestOfFragments } from "../value-objects/ContentFingerprint.js";
import { FragmentReference, sortFragments } from "../value-objects/FragmentReference.js";
import {
  ExclusionReason,
  CHANNEL_FAILURE_CODES,
  type ChannelFailureCode,
  type ChannelFailureRecord,
} from "../value-objects/ExclusionReason.js";
import {
  noneReturnedReference,
  isProvidedReference,
  type ProviderReference,
} from "../value-objects/ProviderReference.js";
import {
  ATTEMPT_CLASSIFICATIONS,
  CHANNEL_RETRACTION_BLOCKS,
  CHANNEL_RETRACTION_CLEARANCES,
  PUBLICATION_OUTCOME_KINDS,
  excludedOutcome,
  publishedOutcome,
  unresolvedOutcome,
  type AttemptResult,
  type ChannelRetractionBlock,
  type ChannelRetractionClearance,
  type PublicationOutcome,
  type PublicationOutcomeKind,
  type RetractionAlertCause,
} from "../value-objects/PublicationOutcome.js";

export type { RetractionAlertCause };

/**
 * Attempts one channel may spend inside ONE episode before it is excluded. It is a
 * per-episode budget and not a lifetime cap, so a channel that is legitimately
 * re-driven gets its attempts back while `attempts` keeps the whole history.
 */
export const CHANNEL_ATTEMPT_BUDGET = 3;

/** Milliseconds. The action window is an argument, never read from the environment. */
export type DurationMs = number;

/** Persisted state of one record, as the mapper reads and writes it. */
export interface ChannelPublicationState {
  id: string;
  channelId: ChannelId;
  /** Read-only, filled from the joined channel row. Never persisted on the record. */
  provider?: ProviderType;
  outcomeKind: PublicationOutcomeKind;
  head?: ProviderReference;
  liveFragments?: readonly FragmentReference[];
  pendingRetraction?: boolean;
  retractionBlockedCause?: ChannelRetractionBlock;
  actionWindowStartedAt?: Date;
  actionWindowExpiredAt?: Date;
  retractionAlertHash?: string;
  retractionClearedCause?: ChannelRetractionClearance;
  retractionClearedAt?: Date;
  contentHash?: ContentFingerprint;
  publishedAt?: Date;
  reason?: ExclusionReason;
  lastFailure?: ChannelFailureRecord;
  excludedAt?: Date;
  attempts?: number;
  episode?: number;
  episodeAttempts?: number;
}

export interface RecordAttemptInput {
  episode: number;
  attemptNo: number;
  planSize: number;
  result: AttemptResult;
  now?: Date;
}

export interface MarkRetractionOutcomeInput {
  outcome: "retracted" | "exhausted";
  remaining: readonly FragmentReference[];
  now?: Date;
}

export interface ClearPendingRetractionInput {
  cause: "manually-removed";
  now?: Date;
}

export interface ExpireRetractionActionWindowInput {
  now: Date;
  window: DurationMs;
}

/** Nothing to tell the customer. */
export interface NoAlertTransition {
  readonly kind: "none";
}

/** A live set the customer has not been told about yet. */
export interface RaiseAlertTransition {
  readonly kind: "raise";
  readonly alertHash: string;
  readonly supersededAlertKey?: string;
}

/**
 * An alert that no longer stands, with the reason it ended and the digest it was
 * raised under — the caller needs that digest to name the alert it is resolving,
 * and this method has just cleared it from the record.
 */
export interface ResolveAlertTransition {
  readonly kind: "resolve";
  readonly cause: RetractionAlertCause;
  readonly alertHash: string;
}

export type AlertTransition = NoAlertTransition | RaiseAlertTransition | ResolveAlertTransition;

const NO_TRANSITION: AlertTransition = { kind: "none" };

/**
 * What a PUBLISHED channel carries, held as ONE value so the three facts are written
 * and cleared together. Separately optional fields let a caller hold "published with
 * no fingerprint", which the outcome could then only answer by inventing one.
 */
interface PublishedFacts {
  readonly head: ProviderReference;
  readonly publishedAt: Date;
  readonly contentHash: ContentFingerprint;
}

/** What an EXCLUDED channel carries, held as one value for the same reason. */
interface ExcludedFacts {
  readonly reason: ExclusionReason;
  readonly excludedAt: Date;
}

/**
 * @class ChannelPublication
 * @description One (post, channel) record. Every state change goes through a method
 *   here; the fields have no setters, so an impossible combination — published with
 *   fragments missing, excluded without a reason, pending retraction with nothing
 *   live — cannot be reached from outside.
 */
export class ChannelPublication {
  private readonly _id: string;
  private readonly _channelId: ChannelId;
  private readonly _provider: ProviderType | undefined;

  private _published: PublishedFacts | undefined;
  private _excluded: ExcludedFacts | undefined;
  private _liveFragments: readonly FragmentReference[];
  private _pendingRetraction: boolean;
  private _retractionBlockedCause: ChannelRetractionBlock | undefined;
  private _actionWindowStartedAt: Date | undefined;
  private _actionWindowExpiredAt: Date | undefined;
  private _retractionAlertHash: string | undefined;
  private _retractionClearedCause: ChannelRetractionClearance | undefined;
  private _retractionClearedAt: Date | undefined;
  private _lastFailure: ChannelFailureRecord | undefined;
  private _attempts: number;
  private _episode: number;
  private _episodeAttempts: number;

  private constructor(
    state: ChannelPublicationState,
    published: PublishedFacts | undefined,
    excluded: ExcludedFacts | undefined
  ) {
    this._id = state.id;
    this._channelId = state.channelId;
    this._provider = state.provider;
    this._published = published;
    this._excluded = excluded;
    this._liveFragments = state.liveFragments ?? [];
    this._pendingRetraction = state.pendingRetraction ?? false;
    this._retractionBlockedCause = state.retractionBlockedCause;
    this._actionWindowStartedAt = state.actionWindowStartedAt;
    this._actionWindowExpiredAt = state.actionWindowExpiredAt;
    this._retractionAlertHash = state.retractionAlertHash;
    this._retractionClearedCause = state.retractionClearedCause;
    this._retractionClearedAt = state.retractionClearedAt;
    this._lastFailure = state.lastFailure;
    this._attempts = state.attempts ?? 0;
    this._episode = state.episode ?? 0;
    this._episodeAttempts = state.episodeAttempts ?? 0;
  }

  /**
   * @method declare
   * @description Declares a channel as an intended target. The record exists from
   *   that moment, unresolved and on no episode, so a channel that never ran is
   *   recorded rather than missing.
   * @param channelId - The intended channel
   * @param options - An explicit id (persistence) and the joined provider
   * @returns The declared record
   */
  static declare(
    channelId: ChannelId,
    options?: { id?: string; provider?: ProviderType }
  ): ChannelPublication {
    return new ChannelPublication(
      {
        id: options?.id ?? ChannelPublication.generateId(),
        channelId,
        ...(options?.provider !== undefined && { provider: options.provider }),
        outcomeKind: PUBLICATION_OUTCOME_KINDS.UNRESOLVED,
      },
      undefined,
      undefined
    );
  }

  /**
   * @method reconstitute
   * @description Rebuilds a record from persistence, re-running no rule but REFUSING a
   *   state the record could never have produced: a published channel with no head, no
   *   moment or no fingerprint, and an exclusion with no reason or no moment. Those are
   *   corrupted rows, and the only honest answers are to refuse them or to invent the
   *   missing fact — an invented fingerprint is indistinguishable from a real one, so
   *   this refuses.
   * @param state - The stored state
   * @returns Result with the record, or InvariantViolationError naming the missing fact
   */
  static reconstitute(
    state: ChannelPublicationState
  ): Result<ChannelPublication, InvariantViolationError> {
    const channel = state.channelId.value;
    let published: PublishedFacts | undefined;
    let excluded: ExcludedFacts | undefined;

    if (state.outcomeKind === PUBLICATION_OUTCOME_KINDS.PUBLISHED) {
      const { head, publishedAt, contentHash } = state;
      if (head === undefined) {
        return err(new InvariantViolationError(`published channel ${channel} carries no head`));
      }
      if (publishedAt === undefined) {
        return err(
          new InvariantViolationError(`published channel ${channel} carries no publication moment`)
        );
      }
      if (contentHash === undefined) {
        return err(
          new InvariantViolationError(`published channel ${channel} carries no content fingerprint`)
        );
      }
      published = { head, publishedAt, contentHash };
    }

    if (state.outcomeKind === PUBLICATION_OUTCOME_KINDS.EXCLUDED) {
      const { reason, excludedAt } = state;
      if (reason === undefined) {
        return err(new InvariantViolationError(`excluded channel ${channel} carries no reason`));
      }
      if (excludedAt === undefined) {
        return err(
          new InvariantViolationError(`excluded channel ${channel} carries no exclusion moment`)
        );
      }
      excluded = { reason, excludedAt };
    }

    return ok(new ChannelPublication(state, published, excluded));
  }

  private static generateId(): string {
    return randomUUID();
  }

  // ── reads ────────────────────────────────────────────────────────────────

  get id(): string {
    return this._id;
  }

  get channelId(): ChannelId {
    return this._channelId;
  }

  get provider(): ProviderType | undefined {
    return this._provider;
  }

  /**
   * DERIVED, never stored: the kind IS which settlement the record holds. Keeping a
   * separate field would let it disagree with the facts it names.
   */
  get outcomeKind(): PublicationOutcomeKind {
    if (this._published !== undefined) {
      return PUBLICATION_OUTCOME_KINDS.PUBLISHED;
    }
    if (this._excluded !== undefined) {
      return PUBLICATION_OUTCOME_KINDS.EXCLUDED;
    }
    return PUBLICATION_OUTCOME_KINDS.UNRESOLVED;
  }

  get head(): ProviderReference | undefined {
    return this._published?.head;
  }

  /** True when the provider accepted the content and returned no identifier. */
  get externalIdMissing(): boolean {
    const head = this._published?.head;
    return head !== undefined && !isProvidedReference(head);
  }

  get externalId(): string | undefined {
    const head = this._published?.head;
    return head !== undefined && isProvidedReference(head) ? head.id : undefined;
  }

  get liveFragments(): readonly FragmentReference[] {
    return this._liveFragments;
  }

  get pendingRetraction(): boolean {
    return this._pendingRetraction;
  }

  get retractionBlockedCause(): ChannelRetractionBlock | undefined {
    return this._retractionBlockedCause;
  }

  get actionWindowStartedAt(): Date | undefined {
    return this._actionWindowStartedAt;
  }

  get actionWindowExpiredAt(): Date | undefined {
    return this._actionWindowExpiredAt;
  }

  get retractionAlertHash(): string | undefined {
    return this._retractionAlertHash;
  }

  get retractionClearedCause(): ChannelRetractionClearance | undefined {
    return this._retractionClearedCause;
  }

  get retractionClearedAt(): Date | undefined {
    return this._retractionClearedAt;
  }

  get contentHash(): ContentFingerprint | undefined {
    return this._published?.contentHash;
  }

  get publishedAt(): Date | undefined {
    return this._published?.publishedAt;
  }

  get reason(): ExclusionReason | undefined {
    return this._excluded?.reason;
  }

  get lastFailure(): ChannelFailureRecord | undefined {
    return this._lastFailure;
  }

  get excludedAt(): Date | undefined {
    return this._excluded?.excludedAt;
  }

  get attempts(): number {
    return this._attempts;
  }

  get episode(): number {
    return this._episode;
  }

  get episodeAttempts(): number {
    return this._episodeAttempts;
  }

  /**
   * @method outcome
   * @description The composed outcome — the closed view every reader outside the
   *   record uses.
   * @returns One of the three outcome kinds
   */
  get outcome(): PublicationOutcome {
    const published = this._published;
    if (published !== undefined) {
      return publishedOutcome({
        head: published.head,
        fragments: this._liveFragments,
        publishedAt: published.publishedAt,
        contentHash: published.contentHash,
      });
    }

    const excluded = this._excluded;
    if (excluded !== undefined) {
      return excludedOutcome({
        reason: excluded.reason,
        excludedAt: excluded.excludedAt,
        retraction: this._pendingRetraction
          ? {
              pending: true,
              live: this._liveFragments,
              blockedBy: this._retractionBlockedCause ?? null,
              window:
                this._actionWindowStartedAt === undefined
                  ? null
                  : {
                      startedAt: this._actionWindowStartedAt,
                      ...(this._actionWindowExpiredAt !== undefined && {
                        expiredAt: this._actionWindowExpiredAt,
                      }),
                    },
            }
          : { pending: false },
      });
    }

    return unresolvedOutcome(this._lastFailure);
  }

  /**
   * @method hasLiveContent
   * @description THE live-content predicate: published, or excluded with fragments
   *   still on the provider. An expired action window changes nothing here.
   * @returns true when content of this post is live on this channel
   */
  hasLiveContent(): boolean {
    return this._published !== undefined || this._pendingRetraction;
  }

  /**
   * @method redrivable
   * @description Whether this channel may be attempted again. A published channel is
   *   never re-sent, and a channel with live fragments would double-post.
   * @returns true when the channel can be included in a new episode
   */
  redrivable(): boolean {
    return this._published === undefined && !this._pendingRetraction;
  }

  /**
   * @method isPublished
   * @description Whether every fragment of the post went out on this channel.
   * @returns true when the channel is fully published
   */
  isPublished(): boolean {
    return this._published !== undefined;
  }

  // ── writes ───────────────────────────────────────────────────────────────

  /**
   * @method openEpisode
   * @description Includes the channel in a new attempt episode: the outcome returns
   *   to unresolved, the per-episode budget resets, and the previous exclusion is kept
   *   as history. The monotonic attempt count is NEVER reset.
   * @param episode - The episode ordinal being opened
   * @returns Result.ok, or InvariantViolationError when content is live or the
   *   ordinal does not advance
   */
  openEpisode(episode: number): Result<void, InvariantViolationError> {
    if (this.hasLiveContent()) {
      return err(
        new InvariantViolationError(
          `channel ${this._channelId.value} still has live content and cannot open an episode`
        )
      );
    }

    if (!Number.isInteger(episode) || episode <= this._episode) {
      return err(
        new InvariantViolationError(
          `episode ${episode} does not advance channel ${this._channelId.value} past ${this._episode}`
        )
      );
    }

    const excluded = this._excluded;
    if (excluded !== undefined) {
      this._lastFailure = {
        code: excluded.reason.code,
        ...(excluded.reason.detail !== undefined && { detail: excluded.reason.detail }),
        at: excluded.excludedAt,
      };
    }

    this._published = undefined;
    this._excluded = undefined;
    this._liveFragments = [];
    this._actionWindowStartedAt = undefined;
    this._actionWindowExpiredAt = undefined;
    this._retractionAlertHash = undefined;
    this._retractionBlockedCause = undefined;
    this._episode = episode;
    this._episodeAttempts = 0;

    return ok(undefined);
  }

  /**
   * @method recordAttempt
   * @description Records ONE attempt's result for this channel. Refuses an attempt
   *   against no episode or a stale one, answers `applied: false` to a replayed
   *   ordinal, refuses a published result that does not carry every fragment of the
   *   plan, and turns a failure that left fragments behind into an exclusion pending
   *   retraction whatever the classification and the budget say.
   * @param input - The episode, the attempt ordinal, the plan size and the result
   * @returns Result with `applied`, or InvariantViolationError
   */
  recordAttempt(input: RecordAttemptInput): Result<{ applied: boolean }, InvariantViolationError> {
    const now = input.now ?? new Date();

    if (this._episode === 0) {
      return err(
        new InvariantViolationError(
          `channel ${this._channelId.value} has no open episode to record an attempt against`
        )
      );
    }

    if (input.episode !== this._episode) {
      return err(
        new InvariantViolationError(
          `attempt names episode ${input.episode} while channel ${this._channelId.value} is on episode ${this._episode}`
        )
      );
    }

    if (input.attemptNo <= this._episodeAttempts) {
      return ok({ applied: false });
    }

    if (input.result.kind === PUBLICATION_OUTCOME_KINDS.PUBLISHED) {
      if (input.result.fragments.length !== input.planSize) {
        return err(
          new InvariantViolationError(
            `channel ${this._channelId.value} reported ${input.result.fragments.length} of ${input.planSize} fragments published — a channel is published only when every fragment went out`
          )
        );
      }

      this._attempts += 1;
      this._episodeAttempts = input.attemptNo;
      this._published = {
        head: input.result.head ?? noneReturnedReference(),
        publishedAt: input.result.publishedAt,
        contentHash: input.result.contentHash,
      };
      this._excluded = undefined;
      this._liveFragments = sortFragments(input.result.fragments);
      this._pendingRetraction = false;
      this._retractionBlockedCause = undefined;
      return ok({ applied: true });
    }

    this._attempts += 1;
    this._episodeAttempts = input.attemptNo;
    this._lastFailure = {
      code: input.result.code,
      ...(input.result.detail !== undefined && { detail: input.result.detail }),
      at: now,
    };

    if (input.result.publishedFragments.length > 0) {
      return this.strand(input.result.publishedFragments, input.result.detail, now);
    }

    if (input.result.classification === ATTEMPT_CLASSIFICATIONS.NONTRANSIENT) {
      return this.exclude(input.result.code, input.result.detail, now);
    }

    if (this._episodeAttempts >= CHANNEL_ATTEMPT_BUDGET) {
      const exhaustionCode =
        input.result.classification === ATTEMPT_CLASSIFICATIONS.UNCLASSIFIABLE
          ? CHANNEL_FAILURE_CODES.UNCLASSIFIED_BUDGET_EXHAUSTED
          : CHANNEL_FAILURE_CODES.BUDGET_EXHAUSTED;
      return this.exclude(exhaustionCode, input.result.detail, now);
    }

    this._published = undefined;
    this._excluded = undefined;
    return ok({ applied: true });
  }

  /**
   * @method markRetractionOutcome
   * @description Records what a retraction attempt achieved: everything removed
   *   clears the state with its cause, a partial removal shrinks the live set, and an
   *   exhausted retraction hands the obligation to the customer and opens their
   *   window.
   * @param input - The retraction outcome and the fragments still live
   * @returns Result.ok, or InvariantViolationError when nothing is pending
   */
  markRetractionOutcome(input: MarkRetractionOutcomeInput): Result<void, InvariantViolationError> {
    if (!this._pendingRetraction) {
      return err(
        new InvariantViolationError(
          `channel ${this._channelId.value} has no pending retraction to report on`
        )
      );
    }

    const now = input.now ?? new Date();

    if (input.outcome === "retracted" && input.remaining.length === 0) {
      this.clearLiveFragments(CHANNEL_RETRACTION_CLEARANCES.RETRACTED, now);
      return ok(undefined);
    }

    this._liveFragments = sortFragments(input.remaining);

    if (input.outcome === "exhausted") {
      this._retractionBlockedCause = CHANNEL_RETRACTION_BLOCKS.EXHAUSTED;
      if (this._actionWindowStartedAt === undefined) {
        this._actionWindowStartedAt = now;
      }
    }

    return ok(undefined);
  }

  /**
   * @method clearPendingRetraction
   * @description The customer's confirmation that they removed the fragments
   *   themselves. Available after the action window expired: expiry fixes the
   *   OUTCOME and never the content, so the exit stays open.
   * @param input - The recorded cause and the moment
   * @returns Result with `applied` — false when nothing was pending
   */
  clearPendingRetraction(
    input: ClearPendingRetractionInput
  ): Result<{ applied: boolean }, InvariantViolationError> {
    if (!this._pendingRetraction) {
      return ok({ applied: false });
    }

    this.clearLiveFragments(
      CHANNEL_RETRACTION_CLEARANCES.MANUALLY_REMOVED,
      input.now ?? new Date()
    );
    return ok({ applied: true });
  }

  /**
   * @method expireRetractionActionWindow
   * @description Closes the customer's window. The cutoff is re-asserted here from the
   *   `window` the caller passed, so a stale or mis-parametrized sweep cannot expire a
   *   record early. Every live fragment is kept and the lock stays engaged — elapsed
   *   time cannot know that content came down.
   * @param input - The moment and the window length
   * @returns Result with `applied` — false when the window is not open, already
   *   closed, or has not elapsed
   */
  expireRetractionActionWindow(
    input: ExpireRetractionActionWindowInput
  ): Result<{ applied: boolean }, InvariantViolationError> {
    const startedAt = this._actionWindowStartedAt;

    if (
      !this._pendingRetraction ||
      this._retractionBlockedCause === undefined ||
      startedAt === undefined ||
      this._actionWindowExpiredAt !== undefined ||
      input.now.getTime() < startedAt.getTime() + input.window
    ) {
      return ok({ applied: false });
    }

    const reason = ExclusionReason.create({
      code: CHANNEL_FAILURE_CODES.ACTION_WINDOW_EXPIRED,
    });
    if (!reason.ok) {
      return err(new InvariantViolationError(reason.error.message));
    }

    this._actionWindowExpiredAt = input.now;
    this._published = undefined;
    this._excluded = {
      reason: reason.value,
      excludedAt: this._excluded?.excludedAt ?? input.now,
    };

    return ok({ applied: true });
  }

  /**
   * @method alertTransition
   * @description The ONE place that decides whether the customer is told about live
   *   content, and the only writer of the alerted-set digest. Evaluated at the end of
   *   every method that touches a record.
   *
   *   Clause 1 takes precedence over every other: once the window has expired nothing
   *   is ever raised again for this channel, including on a later change of the live
   *   set or a later clearance.
   * @returns The transition to act on
   */
  alertTransition(): AlertTransition {
    if (this._actionWindowExpiredAt !== undefined) {
      const expiredHash = this._retractionAlertHash;
      if (expiredHash === undefined) {
        return NO_TRANSITION;
      }
      this._retractionAlertHash = undefined;
      return {
        kind: "resolve",
        cause: CHANNEL_FAILURE_CODES.ACTION_WINDOW_EXPIRED,
        alertHash: expiredHash,
      };
    }

    if (this._pendingRetraction && this._retractionBlockedCause !== undefined) {
      const digest = digestOfFragments(
        this._liveFragments.map((fragment) => ({
          index: fragment.index,
          externalId: fragment.externalId,
        }))
      );
      if (digest === this._retractionAlertHash) {
        return NO_TRANSITION;
      }
      const superseded = this._retractionAlertHash;
      this._retractionAlertHash = digest;
      return {
        kind: "raise",
        alertHash: digest,
        ...(superseded !== undefined && { supersededAlertKey: superseded }),
      };
    }

    if (!this._pendingRetraction && this._retractionAlertHash !== undefined) {
      const clearedHash = this._retractionAlertHash;
      this._retractionAlertHash = undefined;
      return {
        kind: "resolve",
        cause: this._retractionClearedCause ?? CHANNEL_RETRACTION_CLEARANCES.MANUALLY_REMOVED,
        alertHash: clearedHash,
      };
    }

    return NO_TRANSITION;
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * @method exclude
   * @description Writes the terminal not-published outcome with its reason. A failed
   *   reason value is reported rather than swallowed, because an exclusion without a
   *   reason is the state this record exists to make impossible.
   */
  private exclude(
    code: ChannelFailureCode,
    detail: string | undefined,
    now: Date
  ): Result<{ applied: boolean }, InvariantViolationError> {
    const reason = ExclusionReason.create({ code, ...(detail !== undefined && { detail }) });
    if (!reason.ok) {
      return err(new InvariantViolationError(reason.error.message));
    }

    this._published = undefined;
    this._excluded = { reason: reason.value, excludedAt: now };
    this._lastFailure = {
      code: reason.value.code,
      ...(reason.value.detail !== undefined && { detail: reason.value.detail }),
      at: now,
    };
    return ok({ applied: true });
  }

  /**
   * @method strand
   * @description Records an attempt that left fragments on the provider: the channel
   *   is excluded as an interrupted thread, the fragments become the live set, the
   *   retraction is pending with no capability to perform it, and the customer's
   *   window opens at this moment.
   */
  private strand(
    publishedFragments: readonly FragmentReference[],
    detail: string | undefined,
    now: Date
  ): Result<{ applied: boolean }, InvariantViolationError> {
    const excluded = this.exclude(CHANNEL_FAILURE_CODES.THREAD_INTERRUPTED, detail, now);
    if (!excluded.ok) {
      return excluded;
    }

    this._liveFragments = sortFragments(publishedFragments);
    this._pendingRetraction = true;
    this._retractionBlockedCause = CHANNEL_RETRACTION_BLOCKS.NO_CAPABILITY;
    this._actionWindowStartedAt = now;
    this._actionWindowExpiredAt = undefined;
    this._retractionClearedCause = undefined;
    this._retractionClearedAt = undefined;

    return ok({ applied: true });
  }

  /**
   * @method clearLiveFragments
   * @description Drops the live set with a recorded cause. Never called except from
   *   an explicit act — nothing here runs on a timer or an assumption of success.
   */
  private clearLiveFragments(cause: ChannelRetractionClearance, now: Date): void {
    this._liveFragments = [];
    this._pendingRetraction = false;
    this._retractionBlockedCause = undefined;
    this._retractionClearedCause = cause;
    this._retractionClearedAt = now;
  }
}
