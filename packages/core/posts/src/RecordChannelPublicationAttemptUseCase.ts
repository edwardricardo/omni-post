/**
 * @file RecordChannelPublicationAttemptUseCase.ts
 * @description The writer that records ONE attempt on ONE channel. Everything an attempt
 *              implies — the channel's outcome, what it left live on the provider, the
 *              content lock, the channel event, the alert transition and the post's derived
 *              word — is applied by the aggregate in one step, and this use case commits
 *              that step in one transaction so none of them can land without the others. A
 *              redelivered ordinal applies nothing and therefore writes nothing: at-least-once
 *              delivery must not spend a row version, and it must not be an error either.
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
  type AttemptResult,
  type PostAggregate,
  type PostRepository,
  type PublicationOutcome,
  type PublishStatusValue,
} from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { publicationRefusal, publicationSaveFailure } from "./publicationWriteOutcome.js";

/** Input DTO: what the worker observed for one channel on one attempt of one episode. */
export interface RecordChannelPublicationAttemptInput {
  postId: string;
  channelId: string;
  episode: number;
  attemptNo: number;
  /** How many fragments the plan had: a published result must carry every one of them. */
  planSize: number;
  result: AttemptResult;
  /** The moment the attempt settled; the action window a stranded fragment opens starts here. */
  now?: Date;
}

/** Output DTO. `applied` is false when the ordinal had already been recorded. */
export interface RecordChannelPublicationAttemptOutput {
  postId: string;
  /**
   * The owning project. Carried out of the transaction because the caller's cache
   * invalidation is keyed by it and the aggregate already holds it.
   */
  projectId: string;
  channelId: string;
  applied: boolean;
  /**
   * The channel's outcome AFTER the attempt. The worker decides whether to let the queue
   * retry from it: an unresolved channel still has budget, a settled one never does.
   */
  outcome: PublicationOutcome;
  status: PublishStatusValue;
}

type RecordResult = Result<RecordChannelPublicationAttemptOutput, UseCaseError>;

/**
 * Record Channel Publication Attempt Use Case
 *
 * @example
 * const useCase = new RecordChannelPublicationAttemptUseCase(postRepo, unitOfWork);
 * const result = await useCase.execute({
 *   postId: "…",
 *   channelId: "…",
 *   episode: 1,
 *   attemptNo: 1,
 *   planSize: 1,
 *   result: { kind: "published", fragments: [...], publishedAt: new Date(), contentHash },
 * });
 */
export class RecordChannelPublicationAttemptUseCase implements UseCase<
  RecordChannelPublicationAttemptInput,
  RecordChannelPublicationAttemptOutput,
  UseCaseError
> {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Records the attempt. Malformed identifiers are refused before any query,
   *              so a bad payload costs nothing and writes nothing.
   * @param input - The channel, the episode, the ordinal, the plan size and the result.
   * @returns The channel's outcome after the attempt, or the refusal that stopped it.
   */
  async execute(input: RecordChannelPublicationAttemptInput): Promise<RecordResult> {
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
    const doWork = async (): Promise<RecordResult> => this.record(postId, channelId, input);

    try {
      if (this.unitOfWork) {
        // The Result-aware seam: an `err` returned from `record` ROLLS BACK and comes back
        // unchanged. With the throw-based form a partially completed multi-statement save
        // would commit (ADR-0023).
        return await this.unitOfWork.executeResultInTransaction(doWork);
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to record the channel publication attempt",
          classifyPersistenceFailure(error),
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  /**
   * @method record
   * @description The transactional body: load, hand the attempt to the root, and write
   *              once — unless the root applied nothing, in which case there is nothing to
   *              write.
   * @param postId - Validated aggregate identifier.
   * @param channelId - Validated channel identifier.
   * @param input - The original input, for the attempt's own fields.
   * @returns The recording outcome as a `Result`; every `err` aborts the transaction.
   */
  private async record(
    postId: PostId,
    channelId: ChannelId,
    input: RecordChannelPublicationAttemptInput
  ): Promise<RecordResult> {
    const postResult = await this.postRepository.findById(postId);
    if (!postResult.ok) {
      return err(
        new UseCaseError(
          `Post not found: ${input.postId}`,
          USE_CASE_ERRORS.NOT_FOUND,
          postResult.error
        )
      );
    }

    const post = postResult.value;
    const recorded = post.recordChannelAttempt({
      channelId,
      episode: input.episode,
      attemptNo: input.attemptNo,
      planSize: input.planSize,
      result: input.result,
      ...(input.now !== undefined && { now: input.now }),
    });
    if (!recorded.ok) {
      return err(this.classifyRefusal(post, channelId, recorded.error));
    }

    const answer = (): RecordResult =>
      ok({
        postId: post.id.value,
        projectId: post.projectId.value,
        channelId: channelId.value,
        applied: recorded.value.applied,
        outcome: recorded.value.outcome,
        status: post.status.value,
      });

    // A redelivered ordinal changed nothing: the root applied no outcome, emitted no event
    // and moved no word. Writing here would bump the row version for a message the record
    // already accounted for, and outdate a token a concurrent reader still holds.
    if (!recorded.value.applied) {
      return answer();
    }

    const saved = await this.postRepository.savePublication(post);
    if (!saved.ok) {
      return err(publicationSaveFailure(saved.error));
    }
    // Events reach consumers from the outbox after commit; dispatching here would deliver
    // before the transaction committed, and deliver twice.
    post.clearDomainEvents();

    return answer();
  }

  /**
   * @method classifyRefusal
   * @description Separates "this post never declared that channel" from every other
   *              refusal. The distinction is not cosmetic: a missing record means the job
   *              is addressed at something that does not exist and its caller must stop
   *              retrying, while a stale episode means the caller is simply behind. The
   *              aggregate stays the decider — this only reads the record to name which
   *              kind of refusal it just returned.
   * @param post - The loaded aggregate.
   * @param channelId - The channel the attempt named.
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
