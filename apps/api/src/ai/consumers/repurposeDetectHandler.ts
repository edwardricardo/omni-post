/**
 * @file repurposeDetectHandler.ts
 * @description Job handler for the DETECT_REPURPOSE queue. Delegates to
 *              DetectRepurposeCandidatesUseCase, which scans the account's
 *              high-performing posts and creates repurpose proposals
 *              (idempotent at the proposal level), each of which enqueues a
 *              GENERATE_REPURPOSE job. A failed detection throws so the
 *              queue retries the job.
 * @layer infrastructure
 */
import type { DetectRepurposeCandidatesUseCase } from "@core/application/ai/DetectRepurposeCandidatesUseCase.js";
import type { RepurposeJobLogger } from "./repurposeGenerateHandler.js";

export interface RepurposeDetectDeps {
  readonly detect: DetectRepurposeCandidatesUseCase;
  readonly logger: RepurposeJobLogger;
}

export interface RepurposeDetectPayload {
  readonly accountId: string;
}

/**
 * @function processRepurposeDetectJob
 * @description Runs repurpose-candidate detection for one account. Logs
 *   the detected/already-proposed counts on success; throws on failure to
 *   signal the queue to retry the job.
 * @param deps - Detection use case + logger.
 * @param payload - `{ accountId }` from the job.
 */
export async function processRepurposeDetectJob(
  deps: RepurposeDetectDeps,
  payload: RepurposeDetectPayload
): Promise<void> {
  const { detect, logger } = deps;
  const accountId = payload.accountId;

  if (typeof accountId !== "string" || accountId.length === 0) {
    logger.warn({ payload }, "Repurpose detect job missing accountId; skipping");
    return;
  }

  const result = await detect.execute({ accountId });
  if (!result.ok) {
    logger.error({ accountId, error: result.error }, "Repurpose detection failed");
    throw new Error(`Repurpose detection failed for account ${accountId}`);
  }

  logger.info(
    {
      accountId,
      detected: result.value.detected,
      alreadyProposed: result.value.alreadyProposed,
    },
    "Repurpose detection complete"
  );
}
