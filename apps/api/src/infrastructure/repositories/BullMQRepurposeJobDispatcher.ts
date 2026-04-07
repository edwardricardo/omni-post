/**
 * @file BullMQRepurposeJobDispatcher.ts
 * @description BullMQ adapter for RepurposeJobDispatcher port.
 *              Enqueues variant generation jobs on the GENERATE_REPURPOSE queue.
 * @layer infrastructure
 */

import type { QueuePort } from "@ports/core";
import type { RepurposeJobDispatcher } from "../../application/ai/DetectRepurposeCandidatesUseCase.js";

export class BullMQRepurposeJobDispatcher implements RepurposeJobDispatcher {
  constructor(
    private readonly queue: QueuePort,
    private readonly queueName: string
  ) {}

  async dispatchGenerateVariants(proposalId: string): Promise<void> {
    await this.queue.enqueue({
      dedupeKey: `repurpose-generate-${proposalId}`,
      payload: { proposalId },
    });
  }
}
