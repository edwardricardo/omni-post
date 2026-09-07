/**
 * @file triageInboxHandler.ts
 * @description Job handler for the TRIAGE_INBOX queue. Delegates to
 *              `TriageInboxMessageUseCase`, which loads the message, calls the
 *              AI through `AIServicePort.generateStructured` (schema-validated),
 *              and updates `SocialMessage` with priority, sentiment, and three
 *              reply suggestions. A failed triage throws so the queue retries.
 * @layer infrastructure
 */
import type { TriageInboxMessageUseCase } from "@core/inbox/TriageInboxMessageUseCase.js";
import { withTenantContext } from "../../security/tenantContext.js";
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

  // A queue job carries no request, so the tenant scope is bound HERE, from the payload the
  // producer put the account in — the in-process consumer convention. `socialMessage` and
  // `crmContact` are tenant-guard-enrolled, so without this the triage adapters read on the
  // container's guarded client with no context and throw; with it, layer 1 holds the read to
  // this account and layer 2 binds the same scope for the policy.
  const result = await withTenantContext({ accountId }, () =>
    triage.execute({ messageId, accountId })
  );
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
