/**
 * @file setupAgentOrchestration.ts
 * @description DI registration for the agent-orchestration port. The
 *              LangGraph adapter is instantiated in the composition root
 *              and depends only on the registered AIServicePort singleton.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { AgentOrchestrationPort } from "@ports/core";
import type { AIServicePort } from "../../domain/repositories/AIServicePort.js";
import { LangGraphAgentOrchestrationAdapter } from "../../ai/agent/LangGraphAgentOrchestrationAdapter.js";

/**
 * @function setupAgentOrchestration
 * @description Registers `AgentOrchestrationPort` (LangGraph adapter with
 *   an in-memory checkpointer) as a singleton resolving `AIServicePort`.
 * @param container - The DI container (composition root).
 */
export function setupAgentOrchestration(container: Container): void {
  container.register<AgentOrchestrationPort>(
    TOKENS.AgentOrchestrationPort,
    () =>
      new LangGraphAgentOrchestrationAdapter(
        container.resolve<AIServicePort>(TOKENS.AIServicePort)
      ),
    true
  );
}
