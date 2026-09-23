/**
 * @file publicationRecordProbe.ts
 * @description What the publish worker must know about a channel BEFORE it calls a
 *   provider: which episode the record is on, and whether that channel has already
 *   settled. A job carries the episode it was minted for, so a job addressed at a
 *   channel that has moved on — or at one that already published — is content nobody
 *   asked for twice, and reading the record is what makes that decidable without
 *   sending anything.
 * @layer infrastructure
 */

import { ok, err, type Result } from "@shared/types";
import {
  ChannelId,
  PostId,
  type PostRepository,
  type PublicationOutcomeKind,
} from "@core/domain/index.js";
import { withWorkerTenant } from "./security/workerTenantContext.js";

/** One channel's recorded state, reduced to what the pre-publish decision reads. */
export interface ChannelRecordState {
  readonly episode: number;
  readonly outcome: PublicationOutcomeKind;
}

/** What the handler asks about the channel a job is addressed at. */
export interface PublicationRecordProbe {
  /**
   * `ok(undefined)` means the post carries no entry for that channel — never an
   * assumption about what the channel did. A repository that could not answer
   * returns `err`, which the caller retries rather than reading as "no entry".
   */
  readChannel(input: {
    postId: string;
    channelId: string;
    accountId: string;
  }): Promise<Result<ChannelRecordState | undefined, string>>;
}

/**
 * @function createPublicationRecordProbe
 * @description Builds the probe over the post aggregate the workers composition root
 *   already owns.
 * @param postRepository - The tenant-guarded repository to load the aggregate through.
 * @returns The probe.
 */
export function createPublicationRecordProbe(
  postRepository: PostRepository
): PublicationRecordProbe {
  return {
    async readChannel({ postId, channelId, accountId }) {
      const id = PostId.fromString(postId);
      if (!id.ok) {
        return err(`Invalid post id ${postId}: ${id.error.message}`);
      }
      const channel = ChannelId.fromString(channelId);
      if (!channel.ok) {
        return err(`Invalid channel id ${channelId}: ${channel.error.message}`);
      }

      try {
        const post = await withWorkerTenant(accountId, async () =>
          postRepository.findById(id.value)
        );
        if (!post.ok) {
          return err(`Post ${postId} could not be loaded: ${post.error.message}`);
        }
        const record = post.value.publications.find(channel.value);
        if (record === undefined) {
          return ok(undefined);
        }
        return ok({ episode: record.episode, outcome: record.outcomeKind });
      } catch (error: unknown) {
        // Answered as a value rather than raised: the caller decides whether an
        // unreadable record is worth another attempt, and this runs before any
        // provider call, so nothing is live when it does.
        return err(
          error instanceof Error
            ? error.message
            : "the repository raised something that is not an Error"
        );
      }
    },
  };
}
