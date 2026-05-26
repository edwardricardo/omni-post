/**
 * @file types.ts
 * @description Infrastructure types for the LangGraph-backed agent adapter:
 *              the repurpose plan→act→reflect graph state and a per-run
 *              trajectory recorder. These types never cross the
 *              `AgentOrchestrationPort` boundary — the port stays
 *              technology-free.
 * @layer infrastructure
 */

import type { TrajectoryStep } from "@ports/core";

/**
 * Records per-node trajectory steps for one agent run. The deterministic CI
 * trajectory-eval asserts against `snapshot()` (node order, step count, cost).
 * One instance per run (not shared) so concurrent runs never interleave.
 */
export class TrajectoryRecorder {
  private readonly steps: TrajectoryStep[] = [];

  /**
   * @method record
   * @description Times `fn`, captures token cost + tool calls, appends a step.
   * @param node - Graph node name.
   * @param fn - The node body; returns its state delta plus optional cost.
   * @returns The node's state delta.
   */
  async record<TDelta>(
    node: string,
    fn: () => Promise<{ delta: TDelta; tokenCost?: number; toolCalls?: readonly string[] }>
  ): Promise<TDelta> {
    const startedAt = new Date().toISOString();
    const out = await fn();
    this.steps.push({
      node,
      startedAt,
      finishedAt: new Date().toISOString(),
      tokenCost: out.tokenCost ?? 0,
      toolCalls: out.toolCalls ?? [],
    });
    return out.delta;
  }

  /** Immutable snapshot for the port's `AgentTrajectory`. */
  snapshot(): { steps: readonly TrajectoryStep[]; totalSteps: number; totalTokenCost: number } {
    return {
      steps: [...this.steps],
      totalSteps: this.steps.length,
      totalTokenCost: this.steps.reduce((acc, s) => acc + s.tokenCost, 0),
    };
  }
}

/**
 * State of the repurpose plan→act→reflect graph. `attempts` + the engine
 * recursion limit bound the reflect↔act loop; `approved` is the
 * human-in-the-loop gate before any irreversible downstream publish. The
 * publish itself is performed by the worker, not by this graph.
 */
export interface RepurposeGraphState {
  readonly sourceContent: string;
  readonly sourcePlatform: string;
  readonly targetPlatform: string;
  plan?: { strategy: string; angles: string[] };
  draft?: string;
  critique?: { acceptable: boolean; feedback: string };
  attempts: number;
  approved?: boolean;
}

/** Decision merged into state when a HITL interrupt is resumed. */
export interface RepurposeHumanDecision {
  approved: boolean;
}
