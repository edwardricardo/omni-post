/**
 * @file CompletePostPublishingUseCase.ts
 * @description The single writer of the publish-now promotion: given the outcome of a publish
 *              that already happened at the providers, it advances the Post aggregate through
 *              `DRAFT -> PUBLISHING -> PUBLISHED` in ONE transaction, persisting the status, the
 *              publication timestamp and both transition events together. Anything short of a
 *              total success is refused before any I/O, and an already-published post is
 *              answered rather than rejected so a retryable saga step never fails a publication
 *              that in fact completed.
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
  VERSION_CONFLICT_CODE,
  type PostAggregate,
  type PostRepository,
  type ChannelRepository,
  type ProviderType,
} from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * One channel's share of the publish outcome, as the saga observed it.
 * `externalId` and `error` are carried for the provider-receipt work that is
 * not wired yet; nothing in this use case reads them to decide totality.
 */
export interface PublishChannelOutcome {
  readonly channelId: string;
  readonly success: boolean;
  readonly externalId?: string;
  readonly error?: string;
}

/** Input DTO for completing a publish. */
export interface CompletePostPublishingInput {
  postId: string;
  outcome: { channels: readonly PublishChannelOutcome[] };
  /** OCC token, when the caller holds one. The reused-draft path carries none. */
  expectedVersion?: number;
}

/** Output DTO. `applied` is false when the post was already published. */
export interface CompletePostPublishingOutput {
  postId: string;
  /**
   * The owning project. Carried out of the transaction because the caller's
   * cache invalidation is keyed by it, and the aggregate already holds it — a
   * second read after the commit would buy the same value at the price of
   * another query that can fail.
   */
  projectId: string;
  status: "PUBLISHED";
  publishedAt: Date;
  version: number;
  applied: boolean;
  /**
   * Channels whose provider could not be named in the publishing-started event
   * (D7). Empty when nothing failed to resolve AND when no started event was
   * emitted at all — an already-PUBLISHING post does not re-announce the start,
   * so there is no provider list for a channel to be missing from.
   */
  unresolvedChannelIds: string[];
}

type PromotionResult = Result<CompletePostPublishingOutput, UseCaseError>;

/**
 * @function isVersionConflict
 * @description Recognises an optimistic-concurrency failure by the STABLE `code`
 *              the domain error carries, never by class identity. `instanceof`
 *              compares constructors, and `@core/domain` ships a dual
 *              conditional export (`development` -> src, `default` -> dist), so
 *              the adapter's copy of the class and this module's copy can be two
 *              distinct objects in one process. Under that resolution an
 *              `instanceof` narrowing turns every CAS conflict into
 *              `INTERNAL_ERROR` — a lost update reported as an infrastructure
 *              blip, with every test still green. A string compares by value and
 *              survives the duplicate.
 * @param error - The error a repository handed back inside its `Result`.
 * @returns True when the error identifies itself as a version conflict.
 */
function isVersionConflict(error: Error): boolean {
  return "code" in error && error.code === VERSION_CONFLICT_CODE;
}

/**
 * Complete Post Publishing Use Case
 *
 * @example
 * const useCase = new CompletePostPublishingUseCase(postRepo, channelRepo, unitOfWork);
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
    private readonly channelRepository: ChannelRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Promotes a post whose every scheduled channel published. Refusals that need no
   *              state are decided first, so a rejected promotion costs no query and can write
   *              nothing.
   * @param input - The post id, the per-channel outcome, and an optional OCC token.
   * @returns The promoted post's terminal state, or a `UseCaseError` naming why it was refused.
   */
  async execute(input: CompletePostPublishingInput): Promise<PromotionResult> {
    const postIdResult = PostId.fromString(input.postId);
    if (!postIdResult.ok) {
      return err(
        new UseCaseError(`Invalid post ID: ${input.postId}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    const channels = input.outcome.channels;

    // Emptiness precedes totality deliberately: `[].every(...)` is true, so a
    // vacuous outcome would otherwise read as a total success and promote a
    // post nobody published.
    if (channels.length === 0) {
      return err(
        new UseCaseError(
          "Publish outcome names zero channels: a vacuous total is not a publish",
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    if (!channels.every((channel) => channel.success)) {
      return err(
        new UseCaseError(
          "Partial publish outcomes are not promoted by this capability; choosing a status for a partially published post is N-COR-2",
          USE_CASE_ERRORS.NOT_IMPLEMENTED
        )
      );
    }

    const postId = postIdResult.value;
    const doWork = async (): Promise<PromotionResult> => this.promote(postId, input, channels);

    try {
      if (this.unitOfWork) {
        // The Result-aware seam: an `err` returned from `promote` ROLLS BACK and
        // comes back unchanged. With the throw-based form a partially completed
        // multi-statement save would commit (ADR-0023).
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
   * @method promote
   * @description The transactional body: load, answer a terminal state, honour the OCC token,
   *              then run both aggregate hops and save once.
   * @param postId - Validated aggregate identifier.
   * @param input - The original input, for the optional OCC token.
   * @param channels - The already-validated total-success outcome.
   * @returns The promotion outcome as a `Result`; every `err` aborts the transaction.
   */
  private async promote(
    postId: PostId,
    input: CompletePostPublishingInput,
    channels: readonly PublishChannelOutcome[]
  ): Promise<PromotionResult> {
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

    // The already-published answer resolves BEFORE the version comparison: the
    // promotion advances the version itself, so a retry necessarily presents a
    // token this promotion already outdated (R5).
    if (post.isPublished) {
      return this.idempotentAnswer(post);
    }

    if (input.expectedVersion !== undefined && input.expectedVersion !== post.version) {
      return err(
        new UseCaseError(
          `Post ${input.postId} version conflict: expected ${input.expectedVersion}, found ${post.version}`,
          USE_CASE_ERRORS.CONFLICT
        )
      );
    }

    // Resolution lives INSIDE the branch because the started event is its only
    // consumer (D7). On the already-PUBLISHING path no such event is emitted,
    // so resolving would spend one sequential channel read per channel inside
    // the interactive transaction on a value nothing reads.
    let unresolvedChannelIds: string[] = [];

    if (!post.isPublishing) {
      const resolution = await this.resolveProviders(channels);
      unresolvedChannelIds = resolution.unresolvedChannelIds;

      const startResult = post.startPublishing(resolution.providers);
      if (!startResult.ok) {
        return err(
          new UseCaseError(startResult.error.message, USE_CASE_ERRORS.FORBIDDEN, startResult.error)
        );
      }
    }

    const publishResult = post.markAsPublished(toProviderResults(channels));
    if (!publishResult.ok) {
      return err(
        new UseCaseError(
          publishResult.error.message,
          USE_CASE_ERRORS.FORBIDDEN,
          publishResult.error
        )
      );
    }

    const saveResult = await this.postRepository.save(post);
    if (!saveResult.ok) {
      // Narrowed on the Result rather than caught: both branches roll back
      // because both are returned as values through the seam.
      return err(
        isVersionConflict(saveResult.error)
          ? new UseCaseError(saveResult.error.message, USE_CASE_ERRORS.CONFLICT, saveResult.error)
          : new UseCaseError(
              "Failed to save the promoted post",
              USE_CASE_ERRORS.INTERNAL_ERROR,
              saveResult.error
            )
      );
    }

    const publishedAt = post.publishedAt;
    if (publishedAt === undefined) {
      return err(
        new UseCaseError(
          `Post ${input.postId} reached PUBLISHED without a publishedAt`,
          USE_CASE_ERRORS.INTERNAL_ERROR
        )
      );
    }

    // Events reach consumers from the outbox after commit; dispatching here
    // would deliver before the transaction committed and deliver twice.
    post.clearDomainEvents();

    return ok({
      postId: post.id.value,
      projectId: post.projectId.value,
      status: "PUBLISHED",
      publishedAt,
      version: post.version,
      applied: true,
      unresolvedChannelIds,
    });
  }

  /**
   * @method idempotentAnswer
   * @description Answers a post already in the terminal state without writing anything.
   * @param post - The loaded, already-published aggregate.
   * @returns Success carrying the ORIGINAL publication timestamp, or `INTERNAL_ERROR` when the
   *          persisted row has none — a fabricated timestamp would mint a publication record
   *          that never happened, which is worse than refusing.
   */
  private idempotentAnswer(post: PostAggregate): PromotionResult {
    const publishedAt = post.publishedAt;
    if (publishedAt === undefined) {
      return err(
        new UseCaseError(
          `Post ${post.id.value} is PUBLISHED but carries no publishedAt; refusing to fabricate one`,
          USE_CASE_ERRORS.INTERNAL_ERROR
        )
      );
    }
    return ok({
      postId: post.id.value,
      projectId: post.projectId.value,
      status: "PUBLISHED",
      publishedAt,
      version: post.version,
      applied: false,
      unresolvedChannelIds: [],
    });
  }

  /**
   * @method resolveProviders
   * @description Resolves each channel to its provider for the publishing-started event.
   * @param channels - The outcome's channels.
   * @returns The deduplicated provider set and the ids that could not be resolved. Resolution
   *          NEVER blocks the promotion: totality was decided from the outcome, and the provider
   *          already holds the post.
   */
  private async resolveProviders(
    channels: readonly PublishChannelOutcome[]
  ): Promise<{ providers: ProviderType[]; unresolvedChannelIds: string[] }> {
    const providers = new Set<ProviderType>();
    const unresolvedChannelIds: string[] = [];

    for (const channel of channels) {
      const channelIdResult = ChannelId.fromString(channel.channelId);
      if (!channelIdResult.ok) {
        unresolvedChannelIds.push(channel.channelId);
        continue;
      }
      const found = await this.channelRepository.findById(channelIdResult.value);
      if (!found.ok) {
        unresolvedChannelIds.push(channel.channelId);
        continue;
      }
      providers.add(found.value.provider.type);
    }

    return { providers: [...providers], unresolvedChannelIds };
  }
}

/**
 * @function toProviderResults
 * @description Reshapes the outcome into the channel-keyed record `markAsPublished` takes.
 * @param channels - The outcome's channels.
 * @returns A record keyed by channel id.
 */
function toProviderResults(
  channels: readonly PublishChannelOutcome[]
): Record<string, { success: boolean; externalId?: string; error?: string }> {
  const results: Record<string, { success: boolean; externalId?: string; error?: string }> = {};
  for (const channel of channels) {
    results[channel.channelId] = {
      success: channel.success,
      ...(channel.externalId !== undefined && { externalId: channel.externalId }),
      ...(channel.error !== undefined && { error: channel.error }),
    };
  }
  return results;
}
