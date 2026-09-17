/**
 * @file ChannelPublications.ts
 * @description The record SET of one post, and the only place the post's publication
 *   word is derived from. The derivation is total (every combination of channel
 *   outcomes maps to exactly one word) and order-independent (outcomes arrive in
 *   whatever order the providers answer in), so the word can never say something the
 *   record does not.
 * @layer domain
 */

import { type ChannelPublication } from "../entities/ChannelPublication.js";
import { type ChannelId } from "../value-objects/EntityId.js";
import { PUBLICATION_OUTCOME_KINDS } from "../value-objects/PublicationOutcome.js";
import { PUBLISH_STATUS, type PublishStatusValue } from "../value-objects/PublishStatus.js";

/**
 * @class ChannelPublications
 * @description A read view over one post's records. It holds no state of its own: the
 *   records are the state, and this is the vocabulary for asking about them.
 */
export class ChannelPublications {
  private readonly _records: readonly ChannelPublication[];

  private constructor(records: readonly ChannelPublication[]) {
    this._records = records;
  }

  /**
   * @method empty
   * @description The set of a post that has declared no targets. It has NO
   *   derivation — a post with no record is not a post that failed.
   * @returns The empty set
   */
  static empty(): ChannelPublications {
    return new ChannelPublications([]);
  }

  /**
   * @method of
   * @description Wraps the records of one post.
   * @param records - The post's per-channel records
   * @returns The set
   */
  static of(records: readonly ChannelPublication[]): ChannelPublications {
    return new ChannelPublications(records);
  }

  get size(): number {
    return this._records.length;
  }

  get all(): readonly ChannelPublication[] {
    return this._records;
  }

  /**
   * @method isEmpty
   * @description Whether this post has declared any target at all.
   * @returns true when no record exists
   */
  isEmpty(): boolean {
    return this._records.length === 0;
  }

  /**
   * @method find
   * @description The record for one channel.
   * @param channelId - The channel to look up
   * @returns The record, or undefined when the channel is outside the recorded set
   */
  find(channelId: ChannelId): ChannelPublication | undefined {
    return this._records.find((record) => record.channelId.value === channelId.value);
  }

  /**
   * @method has
   * @description Whether a channel belongs to the recorded target set.
   * @param channelId - The channel to look up
   * @returns true when the channel is recorded
   */
  has(channelId: ChannelId): boolean {
    return this.find(channelId) !== undefined;
  }

  /**
   * @method derive
   * @description The post's publication word, as a pure function of the record set:
   *   every channel fully published is `PUBLISHED`; any channel still unresolved is
   *   `PUBLISHING`; otherwise at least one fully published channel is
   *   `PARTIALLY_PUBLISHED`; otherwise `FAILED`.
   *
   *   "Partially Posted" requires at least one FULLY published channel. A post whose
   *   only channel got some of its fragments out is `FAILED` — the live fragments
   *   change the LOCK, never the WORD.
   * @returns The derived word, or undefined for the empty set
   */
  derive(): PublishStatusValue | undefined {
    if (this._records.length === 0) {
      return undefined;
    }

    let published = 0;
    let unresolved = 0;

    for (const record of this._records) {
      if (record.isPublished()) {
        published += 1;
      } else if (record.outcomeKind === PUBLICATION_OUTCOME_KINDS.UNRESOLVED) {
        unresolved += 1;
      }
    }

    if (published === this._records.length) {
      return PUBLISH_STATUS.PUBLISHED;
    }
    if (unresolved > 0) {
      return PUBLISH_STATUS.PUBLISHING;
    }
    if (published > 0) {
      return PUBLISH_STATUS.PARTIALLY_PUBLISHED;
    }
    return PUBLISH_STATUS.FAILED;
  }

  /**
   * @method hasLiveContent
   * @description Whether ANY channel holds content of this post on its provider —
   *   published, or excluded with fragments pending retraction.
   * @returns true when the post's content is live somewhere
   */
  hasLiveContent(): boolean {
    return this._records.some((record) => record.hasLiveContent());
  }

  /**
   * @method noLiveContent
   * @description The converse of {@link hasLiveContent}, named so a caller never has
   *   to negate the predicate itself.
   * @returns true when nothing of this post is live anywhere
   */
  noLiveContent(): boolean {
    return !this.hasLiveContent();
  }

  /**
   * @method redrivable
   * @description The channels that may be attempted again: neither published nor
   *   holding fragments a re-send would duplicate.
   * @returns The re-drivable records
   */
  redrivable(): readonly ChannelPublication[] {
    return this._records.filter((record) => record.redrivable());
  }

  /**
   * @method liveChannels
   * @description The records that hold live content, which is what an alert, a lock
   *   refusal or a retry refusal has to NAME rather than summarise.
   * @returns The records holding live content
   */
  liveChannels(): readonly ChannelPublication[] {
    return this._records.filter((record) => record.hasLiveContent());
  }

  /**
   * @method pendingRetraction
   * @description The records whose fragments are live although the channel did not
   *   publish — the ones that oblige the customer to act.
   * @returns The records pending retraction
   */
  pendingRetraction(): readonly ChannelPublication[] {
    return this._records.filter((record) => record.pendingRetraction);
  }
}
