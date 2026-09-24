/**
 * @file publishJobId.ts
 * @description The publish job's identity, minted and read in ONE place.
 *
 *   A publish job carries its publication EPISODE in its own id rather than in its
 *   payload, because the id is what BullMQ dedupes on: the queue ignores an `add`
 *   whose id already sits in the retained completed or failed set, so an id without
 *   the episode silently drops every re-drive of a channel that already ran, and the
 *   customer waits on a job that will never exist. The worker then reads that episode
 *   back out of the id to decide whether the channel it is addressed at is still open.
 *
 *   Minting and reading therefore live together, and the pairing is the point. This
 *   format was previously a string template copied into the producer, the worker, and
 *   two suites that re-derived it; changing the producer to carry the episode left the
 *   copies agreeing with a contract that no longer existed, and the suites that would
 *   have caught it were asserting against their own copy. A producer and a reader that
 *   agree by convention drift the moment one of them moves. Here they cannot: they
 *   share one regular expression that neither side restates.
 *
 *   The inverse holds over ATTEMPT ORDINALS, and the qualifier is not decoration.
 *   `mintPublishJobId` takes a `number`, so it will happily render `0`, `1.5`, `NaN`
 *   or `1e21` into an id its own reader then refuses — and a refusal at that point is
 *   expensive, because the job has already been enqueued past the pivot's point of no
 *   return, so the channel retires unattempted and the saga parks on its wait step to
 *   the timeout. Nothing narrows that here, deliberately: the ordinal is already
 *   guaranteed upstream by `readOpenedChannels` in `saga.ts`, which refuses a channel
 *   whose episode is not an integer >= 1 BEFORE the pivot opens anything, and a second
 *   guard here could not fire. It is stated rather than checked so the next reader
 *   knows where the guarantee actually lives instead of trusting this pair for a
 *   property it does not carry.
 * @layer domain
 */

/**
 * What a publish job id says about the attempt it was minted for.
 */
export interface PublishJobIdentity {
  /** The publication episode the job may attempt; an ordinal, so never zero. */
  readonly episode: number;
  /**
   * The id with its `-e{n}` suffix removed. The receipt mirror is keyed by it, so
   * one row covers a (post, channel) pair across every episode of that pair.
   */
  readonly mirrorKey: string;
}

/**
 * The episode suffix, anchored at the end. `[1-9][0-9]*` is deliberate: the episode
 * is an attempt ordinal, so `-e0` names an episode that cannot exist and must read as
 * no episode at all rather than as a zeroth one.
 */
const PUBLISH_JOB_EPISODE = /-e([1-9][0-9]*)$/;

/**
 * @function mintPublishJobId
 * @description Builds the BullMQ job id for one channel's attempt at one post.
 *
 *   `episode` must be an attempt ordinal, and this does not check it — see the file
 *   header for where that guarantee comes from and why re-checking here would be a
 *   guard that cannot fire.
 * @param target - The post, the channel it targets, and the episode opened for it.
 * @returns The job id, which is also the queue's dedupe key.
 */
export function mintPublishJobId(target: {
  postId: string;
  channelId: string;
  episode: number;
}): string {
  return `publish-${target.postId}-${target.channelId}-e${target.episode}`;
}

/**
 * @function readPublishJobId
 * @description Reads back what `mintPublishJobId` put into an id.
 *
 *   `undefined` is a verdict, not an absence of one: an id naming no episode was
 *   either assigned by BullMQ itself or minted before the publication record existed,
 *   and neither can be matched against a record. The caller refuses such a job rather
 *   than guessing an episode for it.
 * @param jobId - The BullMQ job id, or undefined when the queue assigned none.
 * @returns The episode and the mirror key, or undefined when the id names no episode.
 */
export function readPublishJobId(jobId: string | undefined): PublishJobIdentity | undefined {
  if (jobId === undefined) {
    return undefined;
  }
  const match = PUBLISH_JOB_EPISODE.exec(jobId);
  if (match?.[1] === undefined) {
    return undefined;
  }
  return { episode: Number(match[1]), mirrorKey: jobId.slice(0, match.index) };
}
