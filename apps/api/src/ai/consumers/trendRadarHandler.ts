/**
 * @file trendRadarHandler.ts
 * @description Job handler for the TREND_RADAR queue. Delegates to
 *              `DetectTrendsUseCase`, which fetches multi-source trending
 *              topics, scores them, and persists the high-scoring trends.
 *              A failed run throws so the queue retries.
 * @layer infrastructure
 */
import type { DetectTrendsUseCase } from "@core/trends/DetectTrendsUseCase.js";
import { withTenantContext } from "../../security/tenantContext.js";
import type { RepurposeJobLogger } from "./repurposeGenerateHandler.js";

export interface TrendRadarDeps {
  readonly detect: DetectTrendsUseCase;
  readonly logger: RepurposeJobLogger;
}

export interface TrendRadarPayload {
  readonly accountId: string;
  /** Calendar day bucket snapshotted at dispatch time (YYYY-MM-DD UTC).
   * Propagated through to the result port so the unique constraint
   * deduplicates results when the consumer crosses midnight. */
  readonly dayKey: string;
}

const DAY_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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
  const dayKey = payload.dayKey;

  if (typeof accountId !== "string" || accountId.length === 0) {
    logger.warn({ payload }, "Trend radar job missing accountId; skipping");
    return;
  }

  if (typeof dayKey !== "string" || !DAY_KEY_REGEX.test(dayKey)) {
    logger.warn({ payload }, "Trend radar job missing or malformed dayKey; skipping");
    return;
  }

  // A queue job carries no request, so the tenant scope is bound HERE, from the payload the
  // producer put the account in — the in-process consumer convention. `channel`, `brandVoice`
  // and `trendRadarResult` are tenant-guard-enrolled, so without this the trend adapters read
  // and write on the container's guarded client with no context and throw; with it, the whole
  // pipeline runs inside the account it was dispatched for.
  const result = await withTenantContext({ accountId }, () =>
    detect.execute({ accountId, dayKey })
  );
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
