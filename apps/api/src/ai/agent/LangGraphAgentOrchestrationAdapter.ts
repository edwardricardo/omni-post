/**
 * @file LangGraphAgentOrchestrationAdapter.ts
 * @description Infrastructure adapter implementing `AgentOrchestrationPort`
 *              with LangGraph.js as the graph-execution engine (engine as
 *              backbone, custom logic inside the nodes). The engine never
 *              leaks past this file: callers depend only on the
 *              technology-free port. The checkpointer is injected via the
 *              constructor (an in-memory saver by default; a durable saver
 *              can be supplied without changing callers).
 * @layer infrastructure
 */

import {
  MemorySaver,
  Command,
  GraphRecursionError,
  isGraphInterrupt,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import { type Result, ok, err } from "@shared/types";
import type {
  AgentOrchestrationPort,
  AgentRunOptions,
  AgentRunOutcome,
  AgentOrchestrationError,
  AgentTrajectory,
} from "@ports/core";
import type { AIServicePort } from "../../domain/repositories/AIServicePort.js";
import { logger } from "../../lib/logger.js";
import { buildRepurposeGraph } from "./repurposeGraph.js";
import { TrajectoryRecorder } from "./types.js";

const agentLogger = logger.child({ module: "ai", component: "LangGraphAgentOrchestration" });

/** A registered graph builder. `recorder` is created fresh per run. */
type GraphFactory = (recorder: TrajectoryRecorder, maxAttempts: number) => unknown;

/**
 * @class LangGraphAgentOrchestrationAdapter
 * @description The single place LangGraph is referenced. Holds one
 *   checkpointer for its lifetime so `resume` can find a paused thread.
 */
export class LangGraphAgentOrchestrationAdapter implements AgentOrchestrationPort {
  private readonly factories: Map<string, GraphFactory>;

  constructor(
    private readonly ai: AIServicePort,
    private readonly checkpointer: BaseCheckpointSaver = new MemorySaver()
  ) {
    this.factories = new Map<string, GraphFactory>([
      [
        "repurpose",
        (recorder, maxAttempts) => buildRepurposeGraph({ ai: this.ai, recorder, maxAttempts }),
      ],
    ]);
  }

  /**
   * @method run
   * @description Compiles + runs `graphId` from `initialState`. Returns a
   *   completed outcome (final state + trajectory) or an interrupted outcome
   *   (HITL pause). Never throws — failures map to AgentOrchestrationError.
   * @param graphId - Registered graph id (e.g. "repurpose").
   * @param initialState - Typed initial state.
   * @param options - maxSteps recursion guard, threadId, determinism flag.
   * @returns Result of the run outcome or an AgentOrchestrationError.
   */
  async run<TState>(
    graphId: string,
    initialState: TState,
    options: AgentRunOptions
  ): Promise<Result<AgentRunOutcome<TState>, AgentOrchestrationError>> {
    const factory = this.factories.get(graphId);
    if (!factory) return err("GRAPH_NOT_FOUND");

    const recorder = new TrajectoryRecorder();
    const config: InvokeConfig = {
      recursionLimit: options.maxSteps,
      configurable: { thread_id: options.threadId },
    };
    let compiled: CompiledLike | undefined;
    try {
      const builder = factory(recorder, Math.max(1, options.maxSteps - 1));
      compiled = (
        builder as { compile(opts: { checkpointer: BaseCheckpointSaver }): CompiledLike }
      ).compile({ checkpointer: this.checkpointer });
      await compiled.invoke(initialState, config);
      return ok(await this.outcomeFrom<TState>(compiled, config, recorder));
    } catch (error: unknown) {
      return this.handleExecutionError<TState>(error, compiled, config, recorder);
    }
  }

  /**
   * @method resume
   * @description Resumes a HITL-interrupted run from its checkpoint thread
   *   with the human decision applied.
   * @param resumeToken - The threadId of the paused run.
   * @param decision - Human decision merged into state on resume.
   * @param options - Same recursion/determinism semantics as `run`.
   * @returns Result of the run outcome or an AgentOrchestrationError.
   */
  async resume<TState>(
    resumeToken: string,
    decision: Readonly<Record<string, unknown>>,
    options: AgentRunOptions
  ): Promise<Result<AgentRunOutcome<TState>, AgentOrchestrationError>> {
    // A single graph is registered, so resume targets it directly. When more
    // graphs are registered, the resume token must carry/resolve the graph id.
    const factory = this.factories.get("repurpose");
    if (!factory) return err("GRAPH_NOT_FOUND");

    const recorder = new TrajectoryRecorder();
    const config: InvokeConfig = {
      recursionLimit: options.maxSteps,
      configurable: { thread_id: resumeToken },
    };
    let compiled: CompiledLike | undefined;
    try {
      const builder = factory(recorder, Math.max(1, options.maxSteps - 1));
      compiled = (
        builder as { compile(opts: { checkpointer: BaseCheckpointSaver }): CompiledLike }
      ).compile({ checkpointer: this.checkpointer });
      const snapshot = await compiled.getState(config);
      if (!snapshot || snapshot.next.length === 0) return err("RESUME_TOKEN_INVALID");
      await compiled.invoke(new Command({ resume: decision }), config);
      return ok(await this.outcomeFrom<TState>(compiled, config, recorder));
    } catch (error: unknown) {
      return this.handleExecutionError<TState>(error, compiled, config, recorder);
    }
  }

  /** Builds the port outcome from the post-invoke checkpoint snapshot. */
  private async outcomeFrom<TState>(
    compiled: CompiledLike,
    config: InvokeConfig,
    recorder: TrajectoryRecorder
  ): Promise<AgentRunOutcome<TState>> {
    const trajectory: AgentTrajectory = recorder.snapshot();
    const snapshot = await compiled.getState(config);
    const pendingInterrupt = snapshot.tasks
      .flatMap((t) => t.interrupts ?? [])
      .find((i) => i !== undefined);

    if (snapshot.next.length > 0 && pendingInterrupt) {
      return {
        kind: "interrupted",
        interrupt: {
          resumeToken: String(config.configurable.thread_id),
          atNode: snapshot.next[0] ?? "unknown",
          pending: snapshot.values as TState,
          reason:
            (pendingInterrupt.value as { reason?: string } | undefined)?.reason ??
            "Human input required",
        },
        trajectory,
      };
    }
    return { kind: "completed", state: snapshot.values as TState, trajectory };
  }

  /**
   * Resolves a thrown engine signal. A graph interrupt is a HITL pause, not a
   * failure — it resolves to the interrupted outcome read from the checkpoint.
   * A recursion-limit breach maps to the step guard; anything else is a node
   * failure.
   */
  private async handleExecutionError<TState>(
    error: unknown,
    compiled: CompiledLike | undefined,
    config: InvokeConfig,
    recorder: TrajectoryRecorder
  ): Promise<Result<AgentRunOutcome<TState>, AgentOrchestrationError>> {
    if (isGraphInterrupt(error) && compiled) {
      return ok(await this.outcomeFrom<TState>(compiled, config, recorder));
    }
    if (error instanceof GraphRecursionError) return err("MAX_STEPS_EXCEEDED");
    agentLogger.error({ err: error }, "Agent graph execution failed");
    return err("NODE_FAILED");
  }
}

/** Minimal structural view of a compiled LangGraph graph used here. */
interface CompiledLike {
  invoke(input: unknown, config: InvokeConfig): Promise<unknown>;
  getState(config: InvokeConfig): Promise<StateSnapshotLike>;
}
interface InvokeConfig {
  recursionLimit: number;
  configurable: { thread_id: string };
}
interface StateSnapshotLike {
  values: unknown;
  next: readonly string[];
  tasks: ReadonlyArray<{ interrupts?: ReadonlyArray<{ value?: unknown }> }>;
}
