/**
 * @file CompletePostPublishingUseCase.ts
 * @description The publish-now RECONCILIATION: given the per-channel outcome the saga
 *              observed, it re-derives the post's publication word FROM the record and
 *              repairs the row when the two have drifted. It chooses no status of its
 *              own, writes no channel result, and fabricates no publication moment —
 *              the record is the sole source of publication truth and this use case is
 *              one of its readers. Everything it cannot ESTABLISH from the record is
 *              refused before anything is written: a post that carries no record at
 *              all, a channel nobody recorded, and an outcome that contradicts what the
 *              record settled.
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
  type ChannelPublications,
  type PostAggregate,
  type PostRepository,
  type PublishStatusValue,
} from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { publicationSaveFailure } from "./publicationWriteOutcome.js";

/**
 * One channel's share of the publish outcome, as the saga observed it: which
 * channel, and whether it published. Nothing else, because nothing else is
 * read. The provider's identifier and the failure message describe the very
 * rows this use case then loads, so declaring them here would put a second
 * copy of the record on the input — free to disagree with the record the
 * reconciliation derives the word from, and answering to no reader.
 */
export interface PublishChannelOutcome {
  readonly channelId: string;
  readonly success: boolean;
}

/** Input DTO for completing a publish. */
export interface CompletePostPublishingInput {
  postId: string;
  outcome: { channels: readonly PublishChannelOutcome[] };
  /** OCC token, when the caller holds one. The reused-draft path carries none. */
  expectedVersion?: number;
}

/** Output DTO. `applied` is false when the word already matched the record. */
export interface CompletePostPublishingOutput {
  postId: string;
  /**
   * The owning project. Carried out of the transaction because the caller's
   * cache invalidation is keyed by it, and the aggregate already holds it — a
   * second read after the commit would buy the same value at the price of
   * another query that can fail.
   */
  projectId: string;
  /** The word the RECORD derives — `PUBLISHED`, `PARTIALLY_PUBLISHED` or `FAILED`. */
  status: PublishStatusValue;
  /**
   * Present only when every channel published. A partially published post did
   * not publish, so it carries no publication moment and this key is absent
   * rather than holding a value nothing earned.
   */
  publishedAt?: Date;
  version: number;
  applied: boolean;
}

type ReconciliationResult = Result<CompletePostPublishingOutput, UseCaseError>;

/**
 * Complete Post Publishing Use Case
 *
 * @example
 * const useCase = new CompletePostPublishingUseCase(postRepo, unitOfWork);
 * const result = await useCase.execute({
 *   postId: "…",
 *   outcome: { channels: [{ channelId: "…", success: true }] },
 * });
 */
export class CompletePostPublishingUseCase implements UseCase<
  CompletePostPublishingInput,
  CompletePostPublishingOutput,
  UseCaseError
> {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Reconciles a post's word with its publication record. Refusals that
   *              need no state are decided first, so a rejected reconciliation costs
   *              no query and can write nothing.
   * @param input - The post id, the per-channel outcome, and an optional OCC token.
   * @returns The post's reconciled state, or a `UseCaseError` naming why it was refused.
   */
  async execute(input: CompletePostPublishingInput): Promise<ReconciliationResult> {
    const postIdResult = PostId.fromString(input.postId);
    if (!postIdResult.ok) {
      return err(
        new UseCaseError(`Invalid post ID: ${input.postId}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    const channels = input.outcome.channels;

    // An outcome that names nobody establishes nothing. It is refused here, with
    // no query, because the answer does not depend on any state.
    if (channels.length === 0) {
      return err(
        new UseCaseError(
          "Publish outcome names zero channels: an outcome that names nobody is not an outcome",
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    const postId = postIdResult.value;
    const doWork = async (): Promise<ReconciliationResult> =>
      this.reconcile(postId, input, channels);

    try {
      if (this.unitOfWork) {
        // The Result-aware seam: an `err` returned from `reconcile` ROLLS BACK
        // and comes back unchanged. With the throw-based form a partially
        // completed multi-statement save would commit (ADR-0023).
        return await this.unitOfWork.executeResultInTransaction(doWork);
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to complete post publishing",
          classifyPersistenceFailure(error),
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  /**
   * @method reconcile
   * @description The transactional body: load, refuse everything the record cannot
   *              substantiate, then project the derived word and save only if it moved.
   * @param postId - Validated aggregate identifier.
   * @param input - The original input, for the optional OCC token.
   * @param channels - The reported per-channel outcome.
   * @returns The reconciliation outcome as a `Result`; every `err` aborts the transaction.
   */
  private async reconcile(
    postId: PostId,
    input: CompletePostPublishingInput,
    channels: readonly PublishChannelOutcome[]
  ): Promise<ReconciliationResult> {
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
    const agreement = agreeWithRecord(post.publications, input.postId, channels);
    if (!agreement.ok) {
      return err(agreement.error);
    }

    const reconciled = post.reconcilePublicationProjection();
    if (!reconciled.ok) {
      return err(
        new UseCaseError(reconciled.error.message, USE_CASE_ERRORS.INTERNAL_ERROR, reconciled.error)
      );
    }

    // The idempotent answer resolves BEFORE the version comparison, and it is
    // now the same branch as "nothing to do": the reconciliation advances the
    // version itself, so a retry of one that already committed necessarily
    // presents a token it already outdated (R4). Comparing first would fail a
    // saga whose post is already settled.
    if (!reconciled.value.changed) {
      return this.answer(post, false);
    }

    // `post.version` is still the version the load returned. The projection
    // above moves the word, the publication moment and `_updatedAt`; the
    // version moves only in `AggregateRoot.incrementVersion`, which the
    // repository calls after the save. The token describes the state the
    // caller read, so that is the value it must be compared against.
    if (input.expectedVersion !== undefined && input.expectedVersion !== post.version) {
      return err(
        new UseCaseError(
          `Post ${input.postId} version conflict: expected ${input.expectedVersion}, found ${post.version}`,
          USE_CASE_ERRORS.CONFLICT
        )
      );
    }

    // The NARROW save: the word, the publication moment, the version and the
    // outbox rows. No content statement and no media statement — a
    // reconciliation that also rewrote content would be indistinguishable from
    // one that did not.
    const saveResult = await this.postRepository.savePublication(post);
    if (!saveResult.ok) {
      // Narrowed on the Result rather than caught: both branches roll back
      // because both are returned as values through the seam. The translation is
      // the SHARED one every publication writer performs, so a lost
      // compare-and-swap cannot read as a conflict on one route and an
      // infrastructure failure on another for the very same event.
      return err(publicationSaveFailure(saveResult.error));
    }

    // Events reach consumers from the outbox after commit; dispatching here
    // would deliver before the transaction committed and deliver twice.
    post.clearDomainEvents();

    return this.answer(post, true);
  }

  /**
   * @method answer
   * @description Reports the post's reconciled state. `publishedAt` is OMITTED rather
   *              than defaulted when the post did not publish everywhere: a key holding
   *              a moment nothing earned is a publication record that never happened.
   * @param post - The loaded aggregate, after reconciliation.
   * @param applied - Whether the word had to move.
   * @returns The success payload.
   */
  private answer(post: PostAggregate, applied: boolean): ReconciliationResult {
    const publishedAt = post.publishedAt;
    return ok({
      postId: post.id.value,
      projectId: post.projectId.value,
      status: post.status.value,
      ...(publishedAt !== undefined && { publishedAt }),
      version: post.version,
      applied,
    });
  }
}

/**
 * @function agreeWithRecord
 * @description Refuses every outcome the record cannot substantiate, in the order a
 *              reader needs them: the record must EXIST, every reported channel must be
 *              IN it, and each reported result must match what its record settled. The
 *              last one is a CONFLICT rather than a validation failure because both
 *              sides are well-formed and they disagree — the caller is describing a
 *              state the record does not hold.
 *
 *              It does NOT require the reported set to be the WHOLE recorded set, and
 *              that omission is the load-bearing one. An attempt episode is opened only
 *              over the channels that are still re-drivable, so a re-drive of a post
 *              whose first run left one channel published and one failed schedules —
 *              and therefore reports — exactly one of the two. Demanding a census would
 *              refuse the partial-failure recovery this capability exists to perform.
 *              The set the outcome MUST account for is the SCHEDULED one, which this
 *              use case never sees; the saga's wait step holds that set and already
 *              refuses an outcome missing any of it. Re-stating it here over a
 *              different set would not be the same rule, only a second one free to
 *              contradict the first.
 * @param records - The post's loaded record set.
 * @param postId - The post id, for the refusal messages.
 * @param channels - The reported per-channel outcome.
 * @returns Result.ok, or the `UseCaseError` that refuses the outcome.
 */
function agreeWithRecord(
  records: ChannelPublications,
  postId: string,
  channels: readonly PublishChannelOutcome[]
): Result<void, UseCaseError> {
  if (records.isEmpty()) {
    return err(
      new UseCaseError(
        `Post ${postId} carries no publication record: its publication outcome cannot be established`,
        USE_CASE_ERRORS.VALIDATION_FAILED
      )
    );
  }

  for (const channel of channels) {
    const channelIdResult = ChannelId.fromString(channel.channelId);
    if (!channelIdResult.ok) {
      return err(
        new UseCaseError(
          `Publish outcome names an invalid channel id: ${channel.channelId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }
    const record = records.find(channelIdResult.value);
    if (record === undefined) {
      return err(
        new UseCaseError(
          `Channel ${channel.channelId} is outside the recorded target set of post ${postId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }
    if (record.isPublished() !== channel.success) {
      return err(
        new UseCaseError(
          `Publish outcome reports channel ${record.channelId.value} as ${channel.success ? "published" : "not published"}, and its record settled the opposite`,
          USE_CASE_ERRORS.CONFLICT
        )
      );
    }
  }

  return ok(undefined);
}
