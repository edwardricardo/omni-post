/**
 * @file ConfirmManualRetractionUseCase.ts
 * @description The customer's exit from a channel that is holding content no provider can
 *              take down: their statement that they removed the fragments themselves. It
 *              is the ONLY exit while retraction is manual, so it stays available after
 *              the action window closed — expiry finalizes the OUTCOME and never the
 *              content, and elapsed time cannot know what is still live on a platform.
 *              Clearing the live set is what releases the post's content lock, so the act
 *              is recorded with its cause rather than inferred from anything.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import {
  type UseCase,
  UseCaseError,
  USE_CASE_ERRORS,
  classifyPersistenceFailure,
} from "@core/application/UseCase.js";
import {
  PostId,
  ChannelId,
  CHANNEL_RETRACTION_CLEARANCES,
  type PostAggregate,
  type PostRepository,
  type PublishStatusValue,
} from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { publicationRefusal, publicationSaveFailure } from "./publicationWriteOutcome.js";
import { RETRACTION_REFUSALS, RetractionRefusalError } from "./retractionRefusals.js";

/** Input DTO: which channel of which post the customer says they cleared. */
export interface ConfirmManualRetractionInput {
  postId: string;
  channelId: string;
  /** The moment to record as the clearance; defaults to now. */
  now?: Date;
}

/** Output DTO. `applied` is false when the same confirmation was already recorded. */
export interface ConfirmManualRetractionOutput {
  postId: string;
  /**
   * The owning project. Carried out of the transaction because the caller's cache
   * invalidation is keyed by it and the aggregate already holds it.
   */
  projectId: string;
  channelId: string;
  applied: boolean;
  /**
   * Whether ANY channel of the post still holds live content. This is the answer the
   * act exists for and it is NOT derivable from `status`: a `FAILED` post with live
   * fragments is locked and a `FAILED` post without them is editable, and both read
   * `FAILED`.
   */
  hasLiveContent: boolean;
  status: PublishStatusValue;
}

type ConfirmResult = Result<ConfirmManualRetractionOutput, UseCaseError>;

/**
 * Confirm Manual Retraction Use Case
 *
 * @example
 * const useCase = new ConfirmManualRetractionUseCase(postRepo, unitOfWork);
 * const result = await useCase.execute({ postId: "…", channelId: "…" });
 */
export class ConfirmManualRetractionUseCase implements UseCase<
  ConfirmManualRetractionInput,
  ConfirmManualRetractionOutput,
  UseCaseError
> {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Records the customer's confirmation. Malformed identifiers are refused
   *              before any query, so a bad request costs nothing and writes nothing.
   * @param input - The post, the channel and the moment to record.
   * @returns Whether the confirmation applied, or the refusal that stopped it.
   */
  async execute(input: ConfirmManualRetractionInput): Promise<ConfirmResult> {
    const postIdResult = PostId.fromString(input.postId);
    if (!postIdResult.ok) {
      return err(
        new UseCaseError(`Invalid post ID: ${input.postId}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    const channelIdResult = ChannelId.fromString(input.channelId);
    if (!channelIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid channel ID: ${input.channelId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          channelIdResult.error
        )
      );
    }

    const postId = postIdResult.value;
    const channelId = channelIdResult.value;
    const doWork = async (): Promise<ConfirmResult> => this.confirm(postId, channelId, input.now);

    try {
      if (this.unitOfWork) {
        // The Result-aware seam: an `err` returned from `confirm` ROLLS BACK and comes
        // back unchanged. With the throw-based form a partially completed
        // multi-statement save would commit (ADR-0023).
        return await this.unitOfWork.executeResultInTransaction(doWork);
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to confirm the manual retraction",
          classifyPersistenceFailure(error),
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  /**
   * @method confirm
   * @description The transactional body: load, hand the confirmation to the root, and
   *              write once — unless the root applied nothing, in which case the answer
   *              depends on WHY, and that distinction is the whole of this method.
   * @param postId - Validated aggregate identifier.
   * @param channelId - Validated channel identifier.
   * @param now - The moment to record as the clearance, when the caller named one.
   * @returns The confirmation outcome as a `Result`; every `err` aborts the transaction.
   */
  private async confirm(
    postId: PostId,
    channelId: ChannelId,
    now: Date | undefined
  ): Promise<ConfirmResult> {
    const postResult = await this.postRepository.findById(postId);
    if (!postResult.ok) {
      return err(
        new UseCaseError(
          `Post not found: ${postId.value}`,
          USE_CASE_ERRORS.NOT_FOUND,
          postResult.error
        )
      );
    }

    const post = postResult.value;
    // Read BEFORE the act: afterwards the clearance this call recorded is
    // indistinguishable from one an earlier call recorded, and that difference is
    // exactly what decides between "already done" and "nothing to do".
    const alreadyConfirmed =
      post.publications.find(channelId)?.retractionClearedCause ===
      CHANNEL_RETRACTION_CLEARANCES.MANUALLY_REMOVED;

    const cleared = post.clearPendingRetraction({
      channelId,
      cause: "manually-removed",
      ...(now !== undefined && { now }),
    });
    if (!cleared.ok) {
      return err(this.classifyRefusal(post, channelId, cleared.error));
    }

    const answer = (applied: boolean): ConfirmResult =>
      ok({
        postId: post.id.value,
        projectId: post.projectId.value,
        channelId: channelId.value,
        applied,
        hasLiveContent: post.publications.hasLiveContent(),
        status: post.status.value,
      });

    if (!cleared.value.applied) {
      // A redelivered or double-clicked submit of THIS act applied nothing and is not
      // an error. Anything else that is not pending never was the customer's to clear —
      // a channel that published cleanly, or one another mechanism already retracted —
      // and reporting success for an act nobody performed would tell the customer their
      // confirmation was recorded when no such record exists.
      if (alreadyConfirmed) {
        return answer(false);
      }
      return err(
        new RetractionRefusalError(
          `channel ${channelId.value} of post ${post.id.value} holds no live content pending retraction`,
          RETRACTION_REFUSALS.NOTHING_PENDING
        )
      );
    }

    const saved = await this.postRepository.savePublication(post);
    if (!saved.ok) {
      return err(publicationSaveFailure(saved.error));
    }
    // Events reach consumers from the outbox after commit; dispatching here would
    // deliver before the transaction committed, and deliver twice.
    post.clearDomainEvents();

    return answer(true);
  }

  /**
   * @method classifyRefusal
   * @description Separates "this post never declared that channel" from every other
   *              refusal, so a caller addressing a channel that does not exist gets an
   *              answer it can act on instead of a conflict it will keep retrying. The
   *              aggregate stays the decider — this only reads the record to name which
   *              kind of refusal it just returned.
   * @param post - The loaded aggregate.
   * @param channelId - The channel the request named.
   * @param error - The refusal the aggregate returned.
   * @returns The use-case error the caller receives.
   */
  private classifyRefusal(post: PostAggregate, channelId: ChannelId, error: Error): UseCaseError {
    if (post.publications.find(channelId) === undefined) {
      return new UseCaseError(error.message, USE_CASE_ERRORS.NOT_FOUND, error);
    }
    return publicationRefusal(error);
  }
}
