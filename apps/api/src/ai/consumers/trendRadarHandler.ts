/**
 * @file trendRadarHandler.ts
 * @description Job handler for the TREND_RADAR queue. Delegates to
 *              `DetectTrendsUseCase`, which fetches multi-source trending
 *              topics, scores them, and persists the high-scoring trends.
 *              A failed run throws so the queue retries.
 * @layer infrastructure
 */
import type { DetectTrendsUseCase } from "@core/trends/DetectTrendsUseCase.js";
import type { RepurposeJobLogger } from "./repurposeGenerateHandler.js";

export interface TrendRadarDeps {
  readonly detect: DetectTrendsUseCase;
  readonly logger: RepurposeJobLogger;
}

export interface TrendRadarPayload {
  readonly accountId: string;
}

/**
 * @function processTrendRadarJob
 * @description Runs the trend-radar pipeline for one account. Logs counts on
 *   success; throws on failure to signal a queue retry. Skips silently when
 *   the payload is malformed.
 */
export async function processTrendRadarJob(
  deps: TrendRadarDeps,
  payload: TrendRadarPayload
): Promise<void> {
  const { detect, logger } = deps;
  const accountId = payload.accountId;

  if (typeof accountId !== "string" || accountId.length === 0) {
    logger.warn({ payload }, "Trend radar job missing accountId; skipping");
    return;
  }

  const result = await detect.execute({ accountId });
  if (!result.ok) {
    logger.error({ accountId, error: result.error }, "Trend radar detection failed");
    throw new Error(`Trend radar detection failed for account ${accountId}`);
  }

  logger.info(
    {
      accountId,
      fetched: result.value.fetched,
      scored: result.value.scored,
      persisted: result.value.persisted,
      updated: result.value.updated,
    },
    "Trend radar detection complete"
  );
}
