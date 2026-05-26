/**
 * @file DispatchMentionSearchUseCase.ts
 * @description Coordinator that finds active brand-listening terms per project and
 *              enqueues one mention-search job per connected channel of a
 *              search-capable provider. Called on a schedule (frequent search +
 *              periodic wide-window reconciliation). Mirrors the inbox-sync
 *              dispatch pattern: a thin fan-out loop over the read model.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { QueuePort } from "@ports/core";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { ChannelQueryForIngestion } from "@core/domain/repositories/ChannelQueryForIngestion.js";
import type {
  TrackedTermQuery,
  TrackedTermForSearch,
} from "@core/domain/repositories/TrackedTermQuery.js";

const DEFAULT_LOOKBACK_MS = 60 * 60 * 1000;

export interface DispatchMentionSearchInput {
  accountId?: string;
  /** Lower-bound window for the search. Wider on reconciliation passes. */
  lookbackMs?: number;
}

export interface DispatchMentionSearchOutput {
  dispatched: number;
  skipped: number;
}

export class DispatchMentionSearchError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "DispatchMentionSearchError";
  }
}

export class DispatchMentionSearchUseCase {
  /**
   * @param trackedTermQuery - Source of active listening terms per project.
   * @param channelQuery - Source of active channels (provider + ids).
   * @param queue - Mention-ingest queue producer.
   * @param searchCapableProviders - Lowercase provider ids that implement
   *   `searchMentions` (e.g. ["x","bluesky"]). Provider-agnostic: the worker
   *   re-checks the capability, so this list is only a fan-out optimization.
   * @param unitOfWork - Optional UoW (mutating: enqueues jobs).
   */
  constructor(
    private readonly trackedTermQuery: TrackedTermQuery,
    private readonly channelQuery: ChannelQueryForIngestion,
    private readonly queue: QueuePort,
    private readonly searchCapableProviders: readonly string[],
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Enqueues a mention-search job per (search-capable channel) whose
   *   project has active tracked terms.
   * @param input - Optional account scope and lookback window.
   * @returns Result with dispatched/skipped counts, or DispatchMentionSearchError.
   */
  async execute(
    input: DispatchMentionSearchInput
  ): Promise<Result<DispatchMentionSearchOutput, DispatchMentionSearchError>> {
    const lookbackMs = input.lookbackMs ?? DEFAULT_LOOKBACK_MS;
    const capable = new Set(this.searchCapableProviders.map((p) => p.toLowerCase()));

    const doWork = async (): Promise<
      Result<DispatchMentionSearchOutput, DispatchMentionSearchError>
    > => {
      const terms = await this.trackedTermQuery.findActiveTerms(input.accountId);

      const termsByProject = new Map<string, TrackedTermForSearch[]>();
      for (const t of terms) {
        const existing = termsByProject.get(t.projectId);
        if (existing) {
          existing.push(t);
        } else {
          termsByProject.set(t.projectId, [t]);
        }
      }

      if (termsByProject.size === 0) {
        return ok({ dispatched: 0, skipped: 0 });
      }

      const channels = await this.channelQuery.findActiveChannels(input.accountId);
      const since = new Date(Date.now() - lookbackMs);
      const windowStamp = since.toISOString().slice(0, 13);

      let dispatched = 0;
      let skipped = 0;

      for (const channel of channels) {
        const provider = channel.provider.toLowerCase();
        const projectTerms = termsByProject.get(channel.projectId);
        if (!capable.has(provider) || !projectTerms) {
          continue;
        }

        const dedupeKey = `mention-search-${channel.id}-${windowStamp}`;
        const enqueueResult = await this.queue.enqueue({
          payload: {
            kind: "search",
            channelId: channel.id,
            accountId: channel.accountId,
            projectId: channel.projectId,
            provider,
            terms: projectTerms.map((t) => ({ id: t.id, term: t.term, kind: t.kind })),
            since: since.toISOString(),
          },
          dedupeKey,
        });

        if (enqueueResult.ok) {
          dispatched++;
        } else {
          skipped++;
        }
      }

      return ok({ dispatched, skipped });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<DispatchMentionSearchOutput, DispatchMentionSearchError> = ok({
          dispatched: 0,
          skipped: 0,
        });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new DispatchMentionSearchError(
          "Failed to dispatch mention search jobs",
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
