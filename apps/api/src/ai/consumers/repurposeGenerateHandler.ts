/**
 * @file repurposeGenerateHandler.ts
 * @description Job handler for the GENERATE_REPURPOSE queue. For each
 *              connected target platform it runs the plan→act→reflect
 *              agent graph and persists the produced draft as a PENDING
 *              repurpose variant. The graph pauses at its human-approval
 *              interrupt before any irreversible publish; this handler
 *              never publishes — it only persists the pending draft for
 *              the existing approval flow. Idempotent: platforms that
 *              already have a variant for the proposal are skipped.
 * @layer infrastructure
 */
import type { AgentOrchestrationPort } from "@ports/core";
import type { RepurposeVariantPort } from "@core/ai/GenerateRepurposeVariantsUseCase.js";

/** Minimal logger surface (a pino child satisfies this structurally). */
export interface RepurposeJobLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/**
 * Technology-free view of the repurpose graph state. The handler only
 * seeds the inputs and reads back the produced `draft`; the graph engine
 * owns everything else behind `AgentOrchestrationPort`.
 */
export interface RepurposeAgentState {
  readonly sourceContent: string;
  readonly sourcePlatform: string;
  readonly targetPlatform: string;
  readonly attempts: number;
  readonly draft?: string;
}

export interface RepurposeGenerateDeps {
  readonly agent: AgentOrchestrationPort;
  readonly variants: RepurposeVariantPort;
  readonly logger: RepurposeJobLogger;
  /** Recursion guard passed to the agent run. */
  readonly maxSteps?: number;
  /** Pins non-deterministic surfaces (CI / mocked LLM). */
  readonly deterministic?: boolean;
}

export interface RepurposeGeneratePayload {
  readonly proposalId: string;
}

/**
 * @function processRepurposeGenerateJob
 * @description Generates repurpose variants for a proposal by running the
 *   agent graph once per missing target platform and persisting each
 *   produced draft as a PENDING variant. Skips platforms already
 *   generated (idempotent). Throws only to signal the queue that some
 *   platform failed and the job should be retried — successful platforms
 *   are already persisted and skipped on the retry.
 * @param deps - Agent port, variant port, logger, run options.
 * @param payload - `{ proposalId }` from the job.
 */
export async function processRepurposeGenerateJob(
  deps: RepurposeGenerateDeps,
  payload: RepurposeGeneratePayload
): Promise<void> {
  const { agent, variants, logger } = deps;
  const proposalId = payload.proposalId;

  if (typeof proposalId !== "string" || proposalId.length === 0) {
    logger.warn({ payload }, "Repurpose job missing proposalId; skipping");
    return;
  }

  const proposal = await variants.loadProposal(proposalId);
  if (!proposal) {
    logger.warn({ proposalId }, "Repurpose proposal not found; skipping");
    return;
  }

  const sourceContent = await variants.getPostContent(proposal.sourcePostId);
  if (!sourceContent) {
    logger.warn(
      { proposalId, sourcePostId: proposal.sourcePostId },
      "Source post content not found; skipping"
    );
    return;
  }

  const connected = await variants.getConnectedPlatforms(proposal.accountId);
  const alreadyGenerated = new Set(await variants.existingVariantPlatforms(proposalId));
  const targets = connected.filter(
    (p) => p !== proposal.sourcePlatform && !alreadyGenerated.has(p)
  );

  if (targets.length === 0) {
    logger.info({ proposalId }, "No target platforms pending; nothing to generate");
    return;
  }

  const failed: string[] = [];

  for (const targetPlatform of targets) {
    const result = await agent.run<RepurposeAgentState>(
      "repurpose",
      {
        sourceContent,
        sourcePlatform: proposal.sourcePlatform,
        targetPlatform,
        attempts: 0,
      },
      {
        maxSteps: deps.maxSteps ?? 25,
        threadId: `repurpose:${proposalId}:${targetPlatform}`,
        ...(deps.deterministic !== undefined && { deterministic: deps.deterministic }),
      }
    );

    if (!result.ok) {
      logger.error({ proposalId, targetPlatform, error: result.error }, "Agent run failed");
      failed.push(targetPlatform);
      continue;
    }

    // `completed` carries the final state; `interrupted` carries the
    // pre-publish human-approval snapshot. Either way the produced draft
    // is what gets persisted for review — the handler never publishes.
    const draft =
      result.value.kind === "completed"
        ? result.value.state.draft
        : result.value.interrupt.pending.draft;

    if (!draft) {
      logger.error({ proposalId, targetPlatform }, "Agent produced no draft");
      failed.push(targetPlatform);
      continue;
    }

    await variants.createVariant({
      proposalId,
      platform: targetPlatform,
      content: draft,
      hashtags: [],
    });
    logger.info(
      { proposalId, targetPlatform, outcome: result.value.kind },
      "Repurpose variant persisted (pending review)"
    );
  }

  if (failed.length > 0) {
    throw new Error(
      `Repurpose generation incomplete for proposal ${proposalId}: ${failed.join(", ")}`
    );
  }
}
