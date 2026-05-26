/**
 * @file triageInboxHandler.ts
 * @description Job handler for the TRIAGE_INBOX queue. Delegates to
 *              `TriageInboxMessageUseCase`, which loads the message, calls the
 *              AI through `AIServicePort.generateStructured` (schema-validated),
 *              and updates `SocialMessage` with priority, sentiment, and three
 *              reply suggestions. A failed triage throws so the queue retries.
 * @layer infrastructure
 */
import type { TriageInboxMessageUseCase } from "@core/application/inbox/TriageInboxMessageUseCase.js";
import type { RepurposeJobLogger } from "./repurposeGenerateHandler.js";

export interface TriageInboxDeps {
  readonly triage: TriageInboxMessageUseCase;
  readonly logger: RepurposeJobLogger;
}

export interface TriageInboxPayload {
  readonly messageId: string;
  readonly accountId: string;
}

/**
 * @function processTriageInboxJob
 * @description Triages one inbound social message. Logs counts on success;
 *   throws on failure to signal the queue to retry. Skips silently when the
 *   payload is malformed.
 * @param deps - Triage use case + logger.
 * @param payload - `{ messageId, accountId }` from the job.
 */
export async function processTriageInboxJob(
  deps: TriageInboxDeps,
  payload: TriageInboxPayload
): Promise<void> {
  const { triage, logger } = deps;
  const messageId = payload.messageId;
  const accountId = payload.accountId;

  if (typeof messageId !== "string" || messageId.length === 0) {
    logger.warn({ payload }, "Triage inbox job missing messageId; skipping");
    return;
  }
  if (typeof accountId !== "string" || accountId.length === 0) {
    logger.warn({ payload }, "Triage inbox job missing accountId; skipping");
    return;
  }

  const result = await triage.execute({ messageId, accountId });
  if (!result.ok) {
    logger.error({ messageId, accountId, error: result.error }, "Triage inbox failed");
    throw new Error(`Triage inbox failed for message ${messageId}`);
  }

  logger.info(
    {
      messageId,
      accountId,
      priority: result.value.priority,
      sentimentScore: result.value.sentimentScore,
      suggestedReplies: result.value.suggestedReplies.length,
    },
    "Triage inbox complete"
  );
}
