/**
 * @file AgentOrchestrationPort.ts
 * @description Technology-free port for executing agentic plan→act→reflect
 *              graphs. Application and domain depend on THIS interface only;
 *              the concrete graph engine lives in an infrastructure adapter,
 *              so swapping the engine never touches application code. No
 *              graph-engine types cross this boundary.
 * @layer domain
 */

import type { Result } from "@shared/types";

/**
 * One observed step in the agent's trajectory. The deterministic CI
 * trajectory-eval asserts against the sequence of these (node order,
 * step count, tool-call validity, cost ceiling).
 */
export interface TrajectoryStep {
  /** Graph node name that executed (stable identifier). */
  readonly node: string;
  /** ISO-8601 timestamp when the node started. */
  readonly startedAt: string;
  /** ISO-8601 timestamp when the node finished. */
  readonly finishedAt: string;
  /** Tokens consumed by this node (0 for non-LLM nodes). */
  readonly tokenCost: number;
  /** Tool / structured-call names invoked in this node, in invocation order. */
  readonly toolCalls: readonly string[];
}

/**
 * Telemetry returned alongside the final state. The trajectory-eval test
 * fails if `steps` order, `totalSteps`, or `totalTokenCost` regress.
 */
export interface AgentTrajectory {
  readonly steps: readonly TrajectoryStep[];
  readonly totalSteps: number;
  readonly totalTokenCost: number;
}

/**
 * Emitted when the graph reaches a human-in-the-loop interrupt point
 * (e.g. approval required before an irreversible publish). The caller
 * persists `resumeToken` + `pending` and later calls `resume()`.
 */
export interface AgentInterrupt<TState> {
  /** Opaque, durable token that re-enters the graph at the interrupt node. */
  readonly resumeToken: string;
  /** Node at which the graph paused. */
  readonly atNode: string;
  /** Snapshot of state at the interrupt (for surfacing to the approver). */
  readonly pending: TState;
  /** Why approval is required (shown to the human). */
  readonly reason: string;
}

export type AgentRunOutcome<TState> =
  | {
      readonly kind: "completed";
      readonly state: TState;
      readonly trajectory: AgentTrajectory;
    }
  | {
      readonly kind: "interrupted";
      readonly interrupt: AgentInterrupt<TState>;
      readonly trajectory: AgentTrajectory;
    };

/** Failure modes are data, never thrown — callers always receive a Result across the port boundary. */
export type AgentOrchestrationError =
  | "GRAPH_NOT_FOUND"
  | "MAX_STEPS_EXCEEDED"
  | "NODE_FAILED"
  | "INVALID_STATE"
  | "RESUME_TOKEN_INVALID"
  | "ENGINE_ERROR";

export interface AgentRunOptions {
  /**
   * Hard recursion guard. The engine terminates with `MAX_STEPS_EXCEEDED`
   * once the trajectory exceeds this many steps (runaway-loop protection).
   */
  readonly maxSteps: number;
  /**
   * Stable id for durable checkpointing/resume — one per logical agent run
   * (e.g. `repurpose:<postId>`). Enables fault-tolerant resume.
   */
  readonly threadId: string;
  /**
   * When true, the adapter pins any non-deterministic surface it controls so
   * CI trajectory-evals are reproducible (LLM calls are mocked by the caller).
   */
  readonly deterministic?: boolean;
}

/**
 * Executes a registered agentic graph (plan→act→reflect) over a typed state.
 * The concrete graph-engine implementation lives in infrastructure. Never
 * throws — engine/internal failures map to `AgentOrchestrationError`.
 */
export interface AgentOrchestrationPort {
  /**
   * Run `graphId` from `initialState`. Resolves to a `completed` outcome
   * (final state + trajectory) or an `interrupted` outcome (HITL pause).
   *
   * @param graphId - Registered graph identifier (e.g. `"repurpose"`).
   * @param initialState - Typed initial state for the graph.
   * @param options - Recursion guard, checkpoint thread id, determinism flag.
   * @returns Result of the run outcome, or an AgentOrchestrationError.
   */
  run<TState>(
    graphId: string,
    initialState: TState,
    options: AgentRunOptions
  ): Promise<Result<AgentRunOutcome<TState>, AgentOrchestrationError>>;

  /**
   * Resume a previously interrupted run from its durable checkpoint with the
   * human decision applied.
   *
   * @param resumeToken - Token from a prior `AgentInterrupt`.
   * @param decision - The human decision merged into state before resuming.
   * @param options - Same recursion guard / determinism semantics as `run`.
   * @returns Result of the run outcome, or an AgentOrchestrationError.
   */
  resume<TState>(
    resumeToken: string,
    decision: Readonly<Record<string, unknown>>,
    options: AgentRunOptions
  ): Promise<Result<AgentRunOutcome<TState>, AgentOrchestrationError>>;
}
