/**
 * @file OpenPublicationEpisodeUseCase.ts
 * @description The writer that opens an attempt episode over a post's per-channel record:
 *              it declares the intended targets when there is no record yet, replaces them
 *              while nothing of the post is live on a provider, and — once something IS
 *              live — admits only a request that names the recorded set exactly, so a
 *              re-drive can never quietly drop the channel that is holding content. The
 *              episode itself is opened by the aggregate, which refuses a channel pending
 *              retraction BY NAME with the fragments that are still out there.
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
  type PostAggregate,
  type PostRepository,
  type PublishStatusValue,
} from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { publicationRefusal, publicationSaveFailure } from "./publicationWriteOutcome.js";
import { RETRACTION_REFUSALS, RetractionRefusalError } from "./retractionRefusals.js";

/** Input DTO for opening an episode. `channelIds` absent means "every recorded channel". */
export interface OpenPublicationEpisodeInput {
  postId: string;
  channelIds?: readonly string[];
  /** True for publish-now: the post enters the publication family in the same write. */
  enterPublishing: boolean;
}

/** One channel the episode was opened for, and the ordinal it was opened at. */
export interface OpenedEpisodeChannel {
  readonly channelId: string;
  readonly episode: number;
}

/** Output DTO. `alreadyOpen` is true when the answer is the episode that was already open. */
export interface OpenPublicationEpisodeOutput {
  postId: string;
  /**
   * The owning project. Carried out of the transaction because the caller's cache
   * invalidation is keyed by it and the aggregate already holds it — a second read after
   * the commit would buy the same value at the price of another query that can fail.
   */
  projectId: string;
  opened: readonly OpenedEpisodeChannel[];
  alreadyOpen: boolean;
  status: PublishStatusValue;
}

type OpenResult = Result<OpenPublicationEpisodeOutput, UseCaseError>;

/**
 * @function setsDiffer
 * @description Every value that is in one set and not the other, in a stable order:
 *              what the record holds and the request omitted first, then what the request
 *              named and the record does not hold.
 * @param requested - The channel ids the caller named.
 * @param recorded - The channel ids the record holds.
 * @returns The differing ids; empty when the two sets are equal.
 */
function setsDiffer(requested: readonly string[], recorded: readonly string[]): string[] {
  const left = new Set(requested);
  const right = new Set(recorded);
  return [
    ...recorded.filter((value) => !left.has(value)),
    ...requested.filter((value) => !right.has(value)),
  ];
}

/** What admitting a request settled: which channels the episode is about, and whether
 *  settling them REPLACED the recorded target set. */
interface AdmittedTargets {
  /** The channels to open, or undefined to open every recorded channel. */
  readonly channelIds: readonly ChannelId[] | undefined;
  /**
   * True exactly when this call handed the aggregate a target set DIFFERENT from the one
   * it held, so the record was rewritten before the episode was opened.
   */
  readonly replacedTargets: boolean;
}

/**
 * Open Publication Episode Use Case
 *
 * @example
 * const useCase = new OpenPublicationEpisodeUseCase(postRepo, unitOfWork);
 * const result = await useCase.execute({
 *   postId: "…",
 *   channelIds: ["…"],
 *   enterPublishing: true,
 * });
 */
export class OpenPublicationEpisodeUseCase implements UseCase<
  OpenPublicationEpisodeInput,
  OpenPublicationEpisodeOutput,
  UseCaseError
> {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Opens an episode for the requested channels. Refusals that need no state
   *              are decided first, so a malformed request costs no query and can write
   *              nothing.
   * @param input - The post, the channels the caller names, and whether this is publish-now.
   * @returns The opened channels, or a `UseCaseError` naming why the request was refused.
   */
  async execute(input: OpenPublicationEpisodeInput): Promise<OpenResult> {
    const postIdResult = PostId.fromString(input.postId);
    if (!postIdResult.ok) {
      return err(
        new UseCaseError(`Invalid post ID: ${input.postId}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    const requested = this.parseChannelIds(input.channelIds);
    if (!requested.ok) {
      return err(requested.error);
    }

    const postId = postIdResult.value;
    const doWork = async (): Promise<OpenResult> =>
      this.open(postId, requested.value, input.enterPublishing);

    try {
      if (this.unitOfWork) {
        // The Result-aware seam: an `err` returned from `open` ROLLS BACK and comes back
        // unchanged. With the throw-based form a partially completed multi-statement save
        // would commit (ADR-0023).
        return await this.unitOfWork.executeResultInTransaction(doWork);
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to open the publication episode",
          classifyPersistenceFailure(error),
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  /**
   * @method parseChannelIds
   * @description Validates the requested channel ids without touching persistence. An
   *              EMPTY list is refused rather than read as "every channel": the two
   *              requests mean opposite things, and the branch that replaces the recorded
   *              set would wipe it.
   * @param channelIds - The raw ids the caller named, when it named any.
   * @returns The parsed ids, or undefined when the caller named none.
   */
  private parseChannelIds(
    channelIds: readonly string[] | undefined
  ): Result<readonly ChannelId[] | undefined, UseCaseError> {
    if (channelIds === undefined) {
      return ok(undefined);
    }
    if (channelIds.length === 0) {
      return err(
        new UseCaseError(
          "The request names an empty channel set: omit the list to open every recorded channel",
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    const parsed: ChannelId[] = [];
    for (const channelId of channelIds) {
      const result = ChannelId.fromString(channelId);
      if (!result.ok) {
        return err(
          new UseCaseError(
            `Invalid channel ID: ${channelId}`,
            USE_CASE_ERRORS.VALIDATION_FAILED,
            result.error
          )
        );
      }
      parsed.push(result.value);
    }
    return ok(parsed);
  }

  /**
   * @method open
   * @description The transactional body: load, settle the recorded target set, open the
   *              episode through the root, and write once — and only when something
   *              actually changed.
   * @param postId - Validated aggregate identifier.
   * @param requested - The validated channel ids, or undefined for every recorded channel.
   * @param enterPublishing - Whether the post enters the publication family in this write.
   * @returns The opening outcome as a `Result`; every `err` aborts the transaction.
   */
  private async open(
    postId: PostId,
    requested: readonly ChannelId[] | undefined,
    enterPublishing: boolean
  ): Promise<OpenResult> {
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
    const admitted = this.admitTargets(post, requested);
    if (!admitted.ok) {
      return err(admitted.error);
    }

    const { channelIds, replacedTargets } = admitted.value;
    const statusBefore = post.status.value;
    const opened = post.openPublicationEpisode({
      ...(channelIds !== undefined && { channelIds }),
      enterPublishing,
    });
    if (!opened.ok) {
      return err(publicationRefusal(opened.error));
    }

    // An already-open episode that moved nothing is answered without a write: the caller
    // is a retry of a step that already ran, and spending a row version on it would
    // outdate a token another reader is still holding. The status and the pending events
    // are consulted because entering the publication family over an already-open episode
    // IS a change, and it is the one this branch must not swallow.
    //
    // `replacedTargets` is the term that makes this decision LOCAL. Without it the branch
    // would be correct only through a fact of another file — that `ChannelPublication.declare`
    // builds records at episode 0, so a replaced set can never report `alreadyOpen`. If that
    // ever stopped holding, a rewritten record set would read as "nothing changed" and the
    // write would be skipped in silence, with every test here still green. This use case
    // already knows it replaced the set, because it is the branch that did it.
    const changed =
      replacedTargets ||
      !opened.value.alreadyOpen ||
      statusBefore !== post.status.value ||
      post.domainEvents.length > 0;

    if (changed) {
      const saved = await this.postRepository.savePublication(post);
      if (!saved.ok) {
        return err(publicationSaveFailure(saved.error));
      }
      // Events reach consumers from the outbox after commit; dispatching here would
      // deliver before the transaction committed, and deliver twice.
      post.clearDomainEvents();
    }

    return ok({
      postId: post.id.value,
      projectId: post.projectId.value,
      opened: opened.value.opened.map((channel) => ({
        channelId: channel.channelId.value,
        episode: channel.episode,
      })),
      alreadyOpen: opened.value.alreadyOpen,
      status: post.status.value,
    });
  }

  /**
   * @method admitTargets
   * @description Settles WHICH channels this episode is about, in the three states the
   *              record can be in. With no record the request declares the targets. With a
   *              record and nothing live the request replaces them. With something live the
   *              request must name the recorded set EXACTLY — a narrowed request would
   *              silently abandon the channel holding content, and an unstated one cannot
   *              be compared to anything at all.
   * @param post - The loaded aggregate.
   * @param requested - The validated channel ids, or undefined when the caller named none.
   * @returns The channels to open and whether settling them replaced the recorded set.
   */
  private admitTargets(
    post: PostAggregate,
    requested: readonly ChannelId[] | undefined
  ): Result<AdmittedTargets, UseCaseError> {
    const records = post.publications;
    const recordedIds = records.all.map((record) => record.channelId.value);

    if (records.hasLiveContent()) {
      const recorded = recordedIds;
      if (requested === undefined) {
        return err(
          new UseCaseError(
            `Post ${post.id.value} holds live content: the request must name its recorded target set (${recorded.join(", ")})`,
            USE_CASE_ERRORS.VALIDATION_FAILED
          )
        );
      }
      const differing = setsDiffer(
        requested.map((channelId) => channelId.value),
        recorded
      );
      if (differing.length > 0) {
        return err(
          new UseCaseError(
            `Post ${post.id.value} holds live content: the requested channels must equal its recorded target set, but these differ: ${differing.join(", ")}`,
            USE_CASE_ERRORS.VALIDATION_FAILED
          )
        );
      }
      const stranded = this.strandedChannel(post, requested);
      if (stranded !== undefined) {
        return err(stranded);
      }
      // The live-content branch never declares: the request had to equal the record to
      // reach here, so nothing was replaced.
      return ok({ channelIds: requested, replacedTargets: false });
    }

    if (requested === undefined) {
      if (records.isEmpty()) {
        return err(
          new UseCaseError(
            `Post ${post.id.value} has no recorded target set and the request names no channel to declare one from`,
            USE_CASE_ERRORS.VALIDATION_FAILED
          )
        );
      }
      return ok({ channelIds: undefined, replacedTargets: false });
    }

    // Measured BEFORE the declare, because afterwards the record already holds the
    // requested set and the difference is gone. An empty record answers "differs" for any
    // request, which is right: declaring the first targets rewrites the record too.
    const replacedTargets =
      setsDiffer(
        requested.map((channelId) => channelId.value),
        recordedIds
      ).length > 0;

    const declared = post.declarePublicationTargets(requested);
    if (!declared.ok) {
      return err(publicationRefusal(declared.error));
    }
    return ok({ channelIds: requested, replacedTargets });
  }

  /**
   * @method strandedChannel
   * @description The first named channel whose fragments are still on its provider, as a
   *              refusal carrying a DISCRIMINATOR rather than a message prefix.
   *
   *              The aggregate refuses this too, and keeps refusing it — it is the
   *              invariant, and every caller of `openPublicationEpisode` is owed it. What
   *              the aggregate cannot do is say WHICH conflict in a form a route can
   *              switch on: its answer is an `InvariantViolationError` that the shared
   *              translation maps to a flat `CONFLICT`, leaving a caller to match the
   *              message text. Deciding it here, from the record this use case has already
   *              loaded, is what lets the refusal travel typed.
   * @param post - The loaded aggregate.
   * @param requested - The channel ids the caller named; each one is recorded by now.
   * @returns The refusal, or undefined when nothing the request names is holding content.
   */
  private strandedChannel(
    post: PostAggregate,
    requested: readonly ChannelId[]
  ): RetractionRefusalError | undefined {
    for (const channelId of requested) {
      const record = post.publications.find(channelId);
      if (record === undefined || !record.pendingRetraction) {
        continue;
      }
      const fragments = record.liveFragments.map((fragment) => fragment.toJSON());
      const named = fragments.map((fragment) => fragment.externalId).join(", ");
      return new RetractionRefusalError(
        `${RETRACTION_REFUSALS.CHANNEL_HAS_LIVE_FRAGMENTS}: channel ${channelId.value} still has live fragments (${named}) and must be cleared before it is attempted again`,
        RETRACTION_REFUSALS.CHANNEL_HAS_LIVE_FRAGMENTS,
        fragments
      );
    }
    return undefined;
  }
}
