/**
 * @file ExpireRetractionActionWindowUseCase.ts
 * @description Closes ONE channel's customer action window. The window LENGTH arrives as
 *              an argument and is handed to the aggregate unchanged: the domain reads no
 *              configuration, and the record re-asserts the same cutoff its caller used
 *              for discovery so a stale or mis-parametrized sweep cannot expire anything
 *              early. Expiry finalizes the OUTCOME only — every live fragment reference
 *              and the content lock survive it, because elapsed time cannot know that
 *              content came down.
 *
 *              An unusable duration is refused HERE, before the load, and REFUSED AGAIN
 *              by the record — the entity owns the invariant and this refusal only saves
 *              a query. The two are not redundant in the way that word usually means:
 *              this one answers `VALIDATION_FAILED` to a caller that can fix its input,
 *              the record's answers the same question for every other caller it will
 *              ever have.
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
  type DurationMs,
  type PostAggregate,
  type PostRepository,
  type PublishStatusValue,
} from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { publicationRefusal, publicationSaveFailure } from "./publicationWriteOutcome.js";

/** Input DTO: the row the sweep selected, the moment of the tick, and the window it used. */
export interface ExpireRetractionActionWindowInput {
  postId: string;
  channelId: string;
  /** The tick's moment; recorded as the expiry and compared against the window. */
  now: Date;
  /** The SAME window length the caller used for discovery, in milliseconds. */
  window: DurationMs;
}

/** Output DTO. `applied` is false when the window is not open, already closed, or unelapsed. */
export interface ExpireRetractionActionWindowOutput {
  postId: string;
  /**
   * The owning project. Carried out of the transaction because the caller's cache
   * invalidation is keyed by it and the aggregate already holds it.
   */
  projectId: string;
  channelId: string;
  applied: boolean;
  /**
   * Whether ANY channel of the post still holds live content. After an expiry it is
   * true by construction, and it is reported so a caller can see that the lock did NOT
   * release — the property the window deliberately does not touch.
   */
  hasLiveContent: boolean;
  status: PublishStatusValue;
}

type ExpireResult = Result<ExpireRetractionActionWindowOutput, UseCaseError>;

/**
 * Expire Retraction Action Window Use Case
 *
 * @example
 * const useCase = new ExpireRetractionActionWindowUseCase(postRepo, unitOfWork);
 * const result = await useCase.execute({
 *   postId: "…",
 *   channelId: "…",
 *   now: tickStartedAt,
 *   window: windowHours * 60 * 60 * 1000,
 * });
 */
export class ExpireRetractionActionWindowUseCase implements UseCase<
  ExpireRetractionActionWindowInput,
  ExpireRetractionActionWindowOutput,
  UseCaseError
> {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Expires the window when it has elapsed. Everything decidable without
   *              state — the identifiers and the window itself — is decided first, so a
   *              malformed request costs no query and can write nothing.
   * @param input - The post, the channel, the tick's moment and the window length.
   * @returns Whether the expiry applied, or the refusal that stopped it.
   */
  async execute(input: ExpireRetractionActionWindowInput): Promise<ExpireResult> {
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

    // The record's cutoff is `now < startedAt + window`. A non-finite window makes that
    // comparison FALSE, so the guard is not taken and EVERY selected row expires
    // immediately — the one malformed value here that fails open rather than closed. A
    // negative window expires everything for the same reason, one step later. The record
    // refuses both itself; this guard refuses them before the load so the sweep's
    // misconfiguration surfaces without spending a query.
    if (!Number.isFinite(input.window) || input.window < 0) {
      return err(
        new UseCaseError(
          `Invalid action window: ${String(input.window)}ms is not a usable duration`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    const postId = postIdResult.value;
    const channelId = channelIdResult.value;
    const doWork = async (): Promise<ExpireResult> =>
      this.expire(postId, channelId, input.now, input.window);

    try {
      if (this.unitOfWork) {
        // The Result-aware seam: an `err` returned from `expire` ROLLS BACK and comes
        // back unchanged. With the throw-based form a partially completed
        // multi-statement save would commit (ADR-0023).
        return await this.unitOfWork.executeResultInTransaction(doWork);
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to expire the retraction action window",
          classifyPersistenceFailure(error),
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  /**
   * @method expire
   * @description The transactional body: load, hand the caller's own window to the root,
   *              and write once — unless nothing was applied, which is the ordinary
   *              answer for a row that raced with a customer's confirmation or with an
   *              earlier tick, and therefore never an error.
   * @param postId - Validated aggregate identifier.
   * @param channelId - Validated channel identifier.
   * @param now - The tick's moment.
   * @param window - The window length the caller used for discovery.
   * @returns The expiry outcome as a `Result`; every `err` aborts the transaction.
   */
  private async expire(
    postId: PostId,
    channelId: ChannelId,
    now: Date,
    window: DurationMs
  ): Promise<ExpireResult> {
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
    const expired = post.expireRetractionActionWindow({ channelId, now, window });
    if (!expired.ok) {
      return err(this.classifyRefusal(post, channelId, expired.error));
    }

    const answer = (applied: boolean): ExpireResult =>
      ok({
        postId: post.id.value,
        projectId: post.projectId.value,
        channelId: channelId.value,
        applied,
        hasLiveContent: post.publications.hasLiveContent(),
        status: post.status.value,
      });

    // The predicate that selected this row can be stale by the time the row is loaded:
    // a customer confirmation or an earlier tick may have settled it. Writing anyway
    // would bump the row version for a decision the record already holds.
    if (!expired.value.applied) {
      return answer(false);
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
   *              refusal. A sweep addressing a channel outside the record is reading a
   *              row that does not belong to this post, which its caller must stop
   *              retrying; every other refusal is the record disagreeing with the act.
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
